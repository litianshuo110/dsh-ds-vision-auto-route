import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { decideRoute } from '../src/route.ts'

const input = {
  policy: 'turn-image' as const,
  fallback: { provider: 'mock', model: 'vision' },
}

function info(model: string, modalities: readonly ('text' | 'image')[] | undefined): LlmResolvedModelInfo {
  return {
    provider: 'mock',
    id: model,
    name: model,
    ...modalities === undefined ? {} : { inputModalities: modalities },
  }
}

function imageTurnEvents(): SessionEvent[] {
  const message = createUserMessage({
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
  return [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 2, data: message },
  ]
}

describe('decideRoute', () => {
  it('keeps the proposal when the log introduces no image and resolves no model', async () => {
    const resolve = vi.fn<(_provider: string, model: string) => Promise<LlmResolvedModelInfo>>()
    const decision = await decideRoute(
      input,
      [{ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }],
      { provider: 'mock', model: 'pro' },
      resolve,
    )
    expect(decision).toEqual({ routed: false })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('keeps the proposal when the selected model already accepts images', async () => {
    const resolve = vi.fn(async (_provider: string, model: string) => info(model, ['text', 'image']))
    const decision = await decideRoute(
      input,
      imageTurnEvents(),
      { provider: 'mock', model: 'vision-pro' },
      resolve,
    )
    expect(decision).toEqual({ routed: false })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('mock', 'vision-pro', undefined)
  })

  it('keeps the proposal when the current model has no declared modalities but the fallback would apply', async () => {
    // Modality omission is negative capability: the fallback must still be verified.
    const resolve = vi.fn(async (_provider: string, model: string) => info(model, model === 'vision' ? ['text', 'image'] : undefined))
    const decision = await decideRoute(
      input,
      imageTurnEvents(),
      { provider: 'mock', model: 'pro' },
      resolve,
    )
    expect(decision).toEqual({
      routed: true,
      config: { provider: 'mock', model: 'vision' },
    })
  })

  it('replaces the route and drops reasoning effort while keeping sampling values', async () => {
    const resolve = vi.fn(async (_provider: string, model: string) => info(model, model === 'vision' ? ['text', 'image'] : ['text']))
    const proposed: LlmCallConfig = {
      provider: 'mock',
      model: 'pro',
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.7,
      maxTokens: 100,
      stop: ['end'],
    }
    const decision = await decideRoute(input, imageTurnEvents(), proposed, resolve)
    expect(decision).toEqual({
      routed: true,
      config: { provider: 'mock', model: 'vision', temperature: 0.7, maxTokens: 100, stop: ['end'] },
    })
    expect(resolve).toHaveBeenNthCalledWith(1, 'mock', 'pro', undefined)
    expect(resolve).toHaveBeenNthCalledWith(2, 'mock', 'vision', undefined)
  })

  it('routes a proposal without reasoning effort', async () => {
    const resolve = vi.fn(async (_provider: string, model: string) => info(model, model === 'vision' ? ['text', 'image'] : ['text']))
    const decision = await decideRoute(
      input,
      imageTurnEvents(),
      { provider: 'mock', model: 'pro' },
      resolve,
    )
    expect(decision).toEqual({
      routed: true,
      config: { provider: 'mock', model: 'vision' },
    })
  })

  it('passes the cancellation signal to both resolutions', async () => {
    const signal = new AbortController().signal
    const resolve = vi.fn(async (_provider: string, model: string) => info(model, model === 'vision' ? ['text', 'image'] : ['text']))
    await decideRoute(input, imageTurnEvents(), { provider: 'mock', model: 'pro' }, resolve, signal)
    expect(resolve).toHaveBeenNthCalledWith(1, 'mock', 'pro', signal)
    expect(resolve).toHaveBeenNthCalledWith(2, 'mock', 'vision', signal)
  })

  it('rejects a fallback that does not declare image input', async () => {
    const resolve = vi.fn(async (_provider: string, model: string) => info(model, ['text']))
    const attempt = decideRoute(input, imageTurnEvents(), { provider: 'mock', model: 'pro' }, resolve)
    await expect(attempt).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(attempt).rejects.toThrow(/fallback route "mock\/vision" does not declare image input/)
  })

  it('propagates model-metadata resolution failures', async () => {
    const resolve = vi.fn<(_provider: string, model: string) => Promise<LlmResolvedModelInfo>>()
      .mockRejectedValue(new LlmError('catalog unavailable', 'SERVER'))
    const attempt = decideRoute(input, imageTurnEvents(), { provider: 'mock', model: 'pro' }, resolve)
    await expect(attempt).rejects.toMatchObject({ code: 'SERVER' })
  })
})
