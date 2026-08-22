import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createToolResultMessage, createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { VISION_ROUTE_SERVICE } from '../src/index.ts'
import * as VisionRouteInvariant from '../src/invariant.ts'

async function setup(withService: boolean): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  if (withService) {
    ctx.provide(VISION_ROUTE_SERVICE, {
      fallbackRoute: () => ({ provider: 'mock', model: 'vision' }),
      active: () => true,
      routesImagesFor: async () => true,
    })
  }
  await ctx.plugin(VisionRouteInvariant)
  return ctx
}

function imageBlock(): ContentBlock {
  return {
    type: 'image',
    attachment: {
      attachmentId: AttachmentId('sha256:abcdef0123456789'),
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    },
  }
}

function openStep(ctx: Context, id: string, turn = 1, step = 1): Session {
  const session = ctx.sessions.create(SessionId(id))
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step })
  return session
}

function appendImageInput(session: Session, kind: 'user' | 'tool'): void {
  if (kind === 'user') {
    session.append('user/message', createUserMessage({
      content: [imageBlock()],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  } else {
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('image-tool'),
        content: [imageBlock()],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
  }
}

const valid = {
  turn: 1,
  step: 1,
  provider: 'mock',
  model: 'vision',
  policy: 'turn-image' as const,
}

describe('llm-vision-route invariants', () => {
  it('accepts a user-message image followed by the fallback record', async () => {
    const ctx = await setup(true)
    const session = openStep(ctx, 'vision-route-invariant-user')
    expect(() => {
      appendImageInput(session, 'user')
      session.append('llm-vision-route/route', valid)
    }).not.toThrow()
  })

  it('accepts a tool-result image followed by the fallback record', async () => {
    const ctx = await setup(true)
    const session = openStep(ctx, 'vision-route-invariant-tool')
    expect(() => {
      appendImageInput(session, 'tool')
      session.append('llm-vision-route/route', valid)
    }).not.toThrow()
  })

  it('accepts an any-image record', async () => {
    const ctx = await setup(true)
    const session = openStep(ctx, 'vision-route-invariant-any-image')
    expect(() => {
      appendImageInput(session, 'user')
      session.append('llm-vision-route/route', { ...valid, policy: 'any-image' })
    }).not.toThrow()
  })

  it('accepts an any-image record whose image came from an earlier turn tool result', async () => {
    const ctx = await setup(true)
    const session = openStep(ctx, 'vision-route-invariant-any-image-tool')
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'no image here' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => {
      appendImageInput(session, 'tool')
      session.append('llm-vision-route/route', { ...valid, policy: 'any-image' })
    }).not.toThrow()
  })

  it('rejects an any-image record when the whole log carries no image', async () => {
    const ctx = await setup(true)
    const session = openStep(ctx, 'vision-route-invariant-any-image-none')
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'no image here' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => {
      session.append('llm-vision-route/route', { ...valid, policy: 'any-image' })
    }).toThrow(/any-image\) must follow an image-bearing user message or tool result in its turn/)
  })

  it('accepts any provider/model when the service is absent', async () => {
    const ctx = await setup(false)
    const session = openStep(ctx, 'vision-route-invariant-no-service')
    expect(() => {
      appendImageInput(session, 'user')
      session.append('llm-vision-route/route', {
        ...valid,
        provider: 'other',
        model: 'other-vision',
      })
    }).not.toThrow()
  })

  it('rejects a record appended with no open turn', async () => {
    const ctx = await setup(true)
    const session = ctx.sessions.create(SessionId('vision-route-invariant-no-turn'))
    expect(() => {
      session.append('llm-vision-route/route', valid)
    }).toThrow(/inside an open turn/)
  })

  it('rejects a record appended after its turn closed', async () => {
    const ctx = await setup(true)
    const session = ctx.sessions.create(SessionId('vision-route-invariant-closed-turn'))
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(() => {
      session.append('llm-vision-route/route', valid)
    }).toThrow(/inside an open turn/)
  })

  it('rejects a record appended with no open step', async () => {
    const ctx = await setup(true)
    const session = ctx.sessions.create(SessionId('vision-route-invariant-no-step'))
    session.append('turn/start', { turn: 1 })
    appendImageInput(session, 'user')
    expect(() => {
      session.append('llm-vision-route/route', valid)
    }).toThrow(/inside an open step/)
  })

  it('rejects a record appended after its step closed', async () => {
    const ctx = await setup(true)
    const session = ctx.sessions.create(SessionId('vision-route-invariant-closed-step'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    appendImageInput(session, 'user')
    session.append('step/end', { turn: 1, step: 1 })
    expect(() => {
      session.append('llm-vision-route/route', valid)
    }).toThrow(/inside an open step/)
  })

  it.each([
    ['wrong-turn', { turn: 2 }, /names turn 2, but the open turn is 1/],
    ['wrong-step', { step: 2 }, /open step is 1\/1/],
    ['empty-provider', { provider: '' }, /provider must be a non-empty string/],
    ['empty-model', { model: '' }, /model must be a non-empty string/],
    ['bad-policy', { policy: 'sometimes' }, /policy must be turn-image or any-image/],
    ['fractional-turn', { turn: 1.5 }, /non-negative safe integer/],
    ['negative-step', { step: -1 }, /non-negative safe integer/],
    ['fallback-mismatch', { provider: 'other' }, /configured fallback is mock\/vision/],
  ] as const)('rejects an invalid record: %s', async (name, override, message) => {
    const ctx = await setup(true)
    const session = openStep(ctx, `vision-route-invariant-${name}`)
    appendImageInput(session, 'user')
    expect(() => {
      session.append('llm-vision-route/route', { ...valid, ...override } as never)
    }).toThrow(message)
  })

  it('rejects a record whose turn carries no image', async () => {
    const ctx = await setup(true)
    const session = openStep(ctx, 'vision-route-invariant-no-image')
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'no image here' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => {
      session.append('llm-vision-route/route', valid)
    }).toThrow(/must follow an image-bearing user message or tool result in its turn/)
  })

  it('accepts records already present in a loaded session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry)
    const session = ctx.sessions.create(SessionId('vision-route-invariant-loaded'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    appendImageInput(session, 'user')
    session.append('llm-vision-route/route', valid)
    await expect(ctx.plugin(VisionRouteInvariant)).resolves.toBeTruthy()
  })
})
