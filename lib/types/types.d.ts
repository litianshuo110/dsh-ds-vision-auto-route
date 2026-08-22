/**
 * Vision routing service contract and the durable routing-record event.
 * @module dsh-ds-vision-auto-route/types
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
/** Route-selection policy for image-bearing requests. */
export type RoutePolicy = 'turn-image' | 'any-image';
/** The fallback route an image-bearing request is replaced with. */
export interface VisionFallbackRoute {
    /** Registered provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
}
/**
 * Query surface for entry points that admit image input (the Web prompt
 * admission and the ACP content bridge). All answers are negative on unknown
 * facts: admission must never promise a route the request waterfall cannot
 * then serve.
 */
export interface VisionRouteService {
    /** The fallback route the plugin replaces image-bearing requests with. */
    fallbackRoute(): VisionFallbackRoute;
    /** Whether routing is enabled in this deployment. */
    active(): boolean;
    /**
     * Whether routing is enabled and the configured fallback declares image
     * input. Initialization-time admission (ACP capability advertising) uses
     * this; it answers false on any unknown fact.
     * @param signal - optional cancellation for model-metadata resolution.
     */
    available(signal?: AbortSignal): Promise<boolean>;
    /**
     * Whether an image-bearing prompt on this agent reaches an image-capable
     * model, either directly (the selected route declares image input) or
     * through routing to the configured fallback.
     * @param agent - the agent the prompt will run on.
     * @param signal - optional cancellation for model-metadata resolution.
     * @returns false when routing is off, no route resolves, or neither route declares image input.
     */
    routesImagesFor(agent: Agent, signal?: AbortSignal): Promise<boolean>;
}
/** Durable payload of one image-bearing request routed to the fallback model. */
export interface VisionRouteEventData {
    /** The turn owning the routed request. */
    turn: number;
    /** The step whose request was routed. */
    step: number;
    /** Provider route of the routed request. */
    provider: string;
    /** Model id of the routed request. */
    model: string;
    /** The routePolicy value that produced the routing. */
    policy: RoutePolicy;
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * Log-only record that one image-bearing request was routed to the
         * configured vision model. Appended inside the `agent/request` waterfall
         * before the loop logs the routed `request/header`; the invariant
         * companion validates it against the image evidence in its turn.
         */
        'llm-vision-route/route': VisionRouteEventData;
    }
}
//# sourceMappingURL=types.d.ts.map