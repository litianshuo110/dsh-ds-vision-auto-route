/**
 * Deterministic image-introduction detection over the session log. The routing
 * decision is a pure function of logged events, so the same history always
 * routes the same way and the routed request stays reconstructable.
 * @module dsh-ds-vision-auto-route/detect
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { RoutePolicy } from './types.ts';
/**
 * Whether the session log contains an image the given policy routes on.
 * `turn-image` inspects only the open turn — events after the latest
 * `turn/start` — so a text-only follow-up returns to the selected model while
 * the historical image stays in the log. `any-image` inspects the whole log.
 * @param events - the session log, oldest first.
 * @param policy - the route-selection policy in effect.
 * @returns whether an image-bearing user message or tool result exists in the inspected range.
 */
export declare function introducesImages(events: readonly SessionEvent[], policy: RoutePolicy): boolean;
//# sourceMappingURL=detect.d.ts.map