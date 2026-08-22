/**
 * Route image-bearing requests to a configurable image-capable model.
 *
 * Listens on the `agent/request` waterfall: when the current request's turn
 * introduced an image (per {@link Config.routePolicy}) and the selected model
 * route does not declare image input, the listener replaces provider and model
 * with the configured vision fallback and drops reasoning effort. The loop
 * logs the routed `request/header`, keeping the switch reconstructable. The
 * plugin also provides {@link VisionRouteService} under
 * {@link VISION_ROUTE_SERVICE} so image-admission surfaces (Web, ACP) can admit
 * image prompts the router will serve.
 * @module @deepseek-ai/dsh-llm-vision-route
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RoutePolicy } from './types.ts';
export type { RouteDecision, RouteDecisionInput, ResolveModelInfo } from './route.ts';
export { introducesImages } from './detect.ts';
export type { RoutePolicy, VisionFallbackRoute, VisionRouteEventData, VisionRouteService } from './types.ts';
/** Cordis service key under which the vision routing service is provided. */
export declare const VISION_ROUTE_SERVICE = "llm-vision-route";
export declare const name = "llm-vision-route";
export declare const inject: string[];
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
    /** Provider route of the image-capable fallback (default `deepseek-official`). */
    visionProvider?: string;
    /** Model id of the image-capable fallback (default `deepseek-v4-flash-vision-exp`). */
    visionModel?: string;
    /**
     * When to route: `turn-image` — the open turn introduced an image (default);
     * `any-image` — the session log contains any image; `off` — never route.
     */
    routePolicy?: RoutePolicy | 'off';
}
export declare const Config: z<Schemastery.ObjectS<{
    visionProvider: z<string, string>;
    visionModel: z<string, string>;
    routePolicy: z<"turn-image" | "any-image" | "off", "turn-image" | "any-image" | "off">;
}>, Schemastery.ObjectT<{
    visionProvider: z<string, string>;
    visionModel: z<string, string>;
    routePolicy: z<"turn-image" | "any-image" | "off", "turn-image" | "any-image" | "off">;
}>>;
/**
 * Install the vision routing service and the request waterfall listener.
 * @param ctx - Cordis context carrying the `llm` service.
 * @param config - validated plugin config.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map