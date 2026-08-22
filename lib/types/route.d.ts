/**
 * Request routing decision: replace an image-bearing request's model route
 * with the configured image-capable fallback when the selected route cannot
 * accept images.
 * @module dsh-ds-vision-auto-route/route
 */
import type { LlmCallConfig, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { RoutePolicy, VisionFallbackRoute } from './types.ts';
/** Facts one routing decision needs. */
export interface RouteDecisionInput {
    /** Enabled route-selection policy. */
    policy: RoutePolicy;
    /** The image-capable fallback route. */
    fallback: VisionFallbackRoute;
}
/** Resolves exact model metadata for one provider route. */
export type ResolveModelInfo = (provider: string, model: string, signal?: AbortSignal) => Promise<LlmResolvedModelInfo>;
/** One image-routing decision for a request proposal. */
export type RouteDecision = {
    readonly routed: true;
    readonly config: LlmCallConfig;
} | {
    readonly routed: false;
};
/**
 * Decide the model route for one request proposal.
 *
 * The proposal returns unchanged unless the log contains an image the policy
 * routes on and the proposal's model route does not declare image input. A
 * routed decision replaces provider and model with the fallback and drops
 * `reasoningEffort`, which the fallback model may not support; the loop logs
 * the replacement as the request header, so the switch is reconstructable.
 * @param input - policy and fallback facts.
 * @param events - the session log, oldest first.
 * @param proposed - the request proposal from the request waterfall.
 * @param resolve - exact model metadata resolver.
 * @param signal - optional cancellation for metadata resolution.
 * @returns the routing decision.
 * @throws LlmError with code INVALID_REQUEST when the fallback route does not declare image input.
 */
export declare function decideRoute(input: RouteDecisionInput, events: readonly SessionEvent[], proposed: LlmCallConfig, resolve: ResolveModelInfo, signal?: AbortSignal): Promise<RouteDecision>;
//# sourceMappingURL=route.d.ts.map