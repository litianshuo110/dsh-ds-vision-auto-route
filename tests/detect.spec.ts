import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { introducesImages } from '../src/detect.ts'

let seq = 0
function event<K extends keyof SessionEventMap>(type: K, data: SessionEventMap[K]): SessionEvent<K> {
  seq += 1
  return { type, seq, time: seq, data } as SessionEvent<K>
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

const image = imageBlock()
const text: ContentBlock = { type: 'text', text: 'plain' }

function user(content: ContentBlock[]): SessionEvent<'user/message'> {
  return event('user/message', createUserMessage({ content, source: { kind: 'user' } }))
}

function toolResult(content: ContentBlock[]): SessionEvent<'tool/result'> {
  return event('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId: CallId('image-tool'), content, isError: false }),
  })
}

describe('introducesImages', () => {
  it('sees no image in an empty log under either policy', () => {
    expect(introducesImages([], 'turn-image')).toBe(false)
    expect(introducesImages([], 'any-image')).toBe(false)
  })

  it('detects a user-message image in the open turn', () => {
    expect(introducesImages([
      event('turn/start', { turn: 1 }),
      user([text]),
      user([image]),
    ], 'turn-image')).toBe(true)
  })

  it('detects a tool-result image in the open turn', () => {
    expect(introducesImages([
      event('turn/start', { turn: 1 }),
      user([text]),
      toolResult([image]),
    ], 'turn-image')).toBe(true)
  })

  it('detects an image nested in a tool-result block', () => {
    expect(introducesImages([
      event('turn/start', { turn: 1 }),
      toolResult([{ type: 'text', text: 'before' }, image]),
    ], 'turn-image')).toBe(true)
  })

  it('ignores images from closed turns under turn-image', () => {
    expect(introducesImages([
      event('turn/start', { turn: 1 }),
      user([image]),
      event('turn/start', { turn: 2 }),
      user([text]),
    ], 'turn-image')).toBe(false)
  })

  it('ignores non-surface events inside the open turn', () => {
    expect(introducesImages([
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      user([text]),
    ], 'turn-image')).toBe(false)
  })

  it('finds a closed-turn image under any-image', () => {
    expect(introducesImages([
      event('turn/start', { turn: 1 }),
      user([image]),
      event('turn/start', { turn: 2 }),
      user([text]),
    ], 'any-image')).toBe(true)
  })

  it('returns false under any-image when no event carries an image', () => {
    expect(introducesImages([
      event('turn/start', { turn: 1 }),
      user([text]),
      toolResult([text]),
    ], 'any-image')).toBe(false)
  })
})
