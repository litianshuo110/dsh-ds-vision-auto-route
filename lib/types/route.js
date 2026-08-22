/**
 * Request routing decision: replace an image-bearing request's model route
 * with the configured image-capable fallback when the selected route cannot
 * accept images.
 * @module @deepseek-ai/dsh-llm-vision-route/route
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
import { introducesImages } from "./detect.js";
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
export async function decideRoute(input, events, proposed, resolve, signal) {
    if (!introducesImages(events, input.policy))
        return { routed: false };
    const current = await resolve(proposed.provider, proposed.model, signal);
    if (current.inputModalities?.includes('image') === true)
        return { routed: false };
    const fallback = await resolve(input.fallback.provider, input.fallback.model, signal);
    if (fallback.inputModalities?.includes('image') !== true) {
        throw new LlmError(`llm-vision-route: fallback route "${fallback.provider}/${fallback.id}" does not declare image input`, 'INVALID_REQUEST');
    }
    const { reasoningEffort: _droppedEffort, ...withoutEffort } = proposed;
    return {
        routed: true,
        config: { ...withoutEffort, provider: fallback.provider, model: fallback.id },
    };
}
//# sourceMappingURL=route.js.map