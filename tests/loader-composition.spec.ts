import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as visionRoute from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

class RoutingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: model === 'vision' ? ['text', 'image'] : ['text'],
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(policy: 'turn-image' | 'any-image' | 'off'): Promise<{ adapter: RoutingAdapter; agent: ReturnType<AgentLoop['create']> }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-vision-route-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-llm-vision-route'",
    '  config:',
    '    visionProvider: mock',
    '    visionModel: vision',
    `    routePolicy: ${policy}`,
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-llm-vision-route', visionRoute],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()

  const unloaded = [...context.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])

  const adapter = new RoutingAdapter()
  context.llm.registerAdapter(['mock'], adapter)
  const agent = context.agentLoop.create(SessionId('vision-route-loader'), { provider: 'mock', model: 'pro' })
  // The Web entry point installs the user's model selection the same way;
  // without it the loop would restore the routed header as the next baseline.
  const selection: ModelSelectionRef = { current: { provider: 'mock', model: 'pro' }, assembled: undefined }
  installModelSelection(agent.ctx, selection)
  return { adapter, agent }
}

function imagePrompt(): UserMessage {
  return createUserMessage({
    content: [{
      type: 'image',
      attachment: {
        attachmentId: AttachmentId('sha256:abcdef0123456789'),
        mediaType: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
      },
    }],
    source: { kind: 'user' },
  })
}

function textPrompt(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function routeRecords(session: Session): SessionEvent<'llm-vision-route/route'>[] {
  return session.events.filter(
    (event): event is SessionEvent<'llm-vision-route/route'> => event.type === 'llm-vision-route/route',
  )
}

function requestHasImage(options: GenerateOptions): boolean {
  return options.messages.some(message => message.content.some(block => block.type === 'image'))
}

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; first resolution after the host/client program split is slow enough
  // to trip the default 5s budget on cold caches.
  it('routes an image turn to the vision model and returns text turns to the selected model', { timeout: 60_000 }, async () => {
    const { adapter, agent } = await loadComposition('turn-image')

    agent.followup(imagePrompt())
    await agent.whenIdle()
    expect(adapter.requests[0]?.model).toBe('vision')
    expect(requestHasImage(adapter.requests[0]!)).toBe(true)
    expect(routeRecords(agent.session)).toHaveLength(1)
    expect(routeRecords(agent.session)[0]?.data).toMatchObject({
      provider: 'mock',
      model: 'vision',
      policy: 'turn-image',
    })
    expect(agent.session.requestHeader()?.config).toMatchObject({ provider: 'mock', model: 'vision' })

    agent.followup(textPrompt('follow-up'))
    await agent.whenIdle()
    expect(adapter.requests[1]?.model).toBe('pro')
    expect(requestHasImage(adapter.requests[1]!)).toBe(false)
    expect(routeRecords(agent.session)).toHaveLength(1)
  })

  it('routes every later turn under any-image', { timeout: 60_000 }, async () => {
    const { adapter, agent } = await loadComposition('any-image')

    agent.followup(imagePrompt())
    await agent.whenIdle()
    agent.followup(textPrompt('text-only follow-up'))
    await agent.whenIdle()

    expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'vision'])
    expect(routeRecords(agent.session)).toHaveLength(2)
    expect(routeRecords(agent.session)[1]?.data.policy).toBe('any-image')
  })

  it('leaves the selected model in place under routePolicy off', { timeout: 60_000 }, async () => {
    const { adapter, agent } = await loadComposition('off')

    agent.followup(imagePrompt())
    await agent.whenIdle()

    expect(adapter.requests[0]?.model).toBe('pro')
    expect(requestHasImage(adapter.requests[0]!)).toBe(false)
    expect(routeRecords(agent.session)).toHaveLength(0)
  })
})
