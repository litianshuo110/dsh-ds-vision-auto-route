/**
 * Deterministic image-introduction detection over the session log. The routing
 * decision is a pure function of logged events, so the same history always
 * routes the same way and the routed request stays reconstructable.
 * @module @deepseek-ai/dsh-llm-vision-route/detect
 */

import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RoutePolicy } from './types.ts'

/** True when one surface event carries an image block anywhere in its content tree. */
function eventHasImage(event: SessionEvent): boolean {
  switch (event.type) {
    case 'user/message':
      return contentHasImage(event.data.content)
    case 'tool/result':
      return contentHasImage(event.data.message.content)
    default:
      return false
  }
}

/**
 * Whether the session log contains an image the given policy routes on.
 * `turn-image` inspects only the open turn — events after the latest
 * `turn/start` — so a text-only follow-up returns to the selected model while
 * the historical image stays in the log. `any-image` inspects the whole log.
 * @param events - the session log, oldest first.
 * @param policy - the route-selection policy in effect.
 * @returns whether an image-bearing user message or tool result exists in the inspected range.
 */
export function introducesImages(events: readonly SessionEvent[], policy: RoutePolicy): boolean {
  if (policy === 'any-image') return events.some(eventHasImage)
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    /* v8 ignore next -- the loop bound keeps the index in range */
    if (event === undefined) continue
    if (event.type === 'turn/start') return false
    if (eventHasImage(event)) return true
  }
  return false
}
