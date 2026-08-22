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
import z from '@deepseek-ai/schemastery';
import { decideRoute } from "./route.js";
export { introducesImages } from "./detect.js";
/** Cordis service key under which the vision routing service is provided. */
export const VISION_ROUTE_SERVICE = 'llm-vision-route';
/** Default provider route for the vision fallback. */
const DEFAULT_VISION_PROVIDER = 'deepseek-official';
/** Default model id for the vision fallback. */
const DEFAULT_VISION_MODEL = 'deepseek-v4-flash-vision-exp';
export const name = 'llm-vision-route';
export const inject = ['llm'];
export const Config = z.object({
    visionProvider: z.string().min(1).default(DEFAULT_VISION_PROVIDER),
    visionModel: z.string().min(1).default(DEFAULT_VISION_MODEL),
    routePolicy: z.union([
        z.const('turn-image'),
        z.const('any-image'),
        z.const('off'),
    ]).default('turn-image'),
});
/**
 * Install the vision routing service and the request waterfall listener.
 * @param ctx - Cordis context carrying the `llm` service.
 * @param config - validated plugin config.
 */
export function apply(ctx, config) {
    const policy = config.routePolicy ?? 'turn-image';
    const fallback = {
        provider: config.visionProvider ?? DEFAULT_VISION_PROVIDER,
        model: config.visionModel ?? DEFAULT_VISION_MODEL,
    };
    const service = {
        fallbackRoute: () => ({ ...fallback }),
        active: () => policy !== 'off',
        async available(signal) {
            if (policy === 'off')
                return false;
            try {
                const fallbackInfo = await ctx.llm.resolveModelInfo(fallback.provider, fallback.model, signal);
                return fallbackInfo.inputModalities?.includes('image') === true;
            }
            catch {
                // Availability answers negative when the fallback cannot be verified;
                // admission never promises a route the request path cannot serve.
                return false;
            }
        },
        async routesImagesFor(agent, signal) {
            if (policy === 'off')
                return false;
            const header = agent.session.requestHeader()?.config;
            const provider = header?.provider ?? agent.options.provider;
            const model = header?.model ?? agent.options.model;
            if (provider === undefined || model === undefined)
                return false;
            try {
                const current = await ctx.llm.resolveModelInfo(provider, model, signal);
                if (current.inputModalities?.includes('image') === true)
                    return true;
            }
            catch {
                // Admission answers negative when the selected route cannot be verified;
                // the request path then fails loudly instead of promising a route.
                return false;
            }
            try {
                const fallbackInfo = await ctx.llm.resolveModelInfo(fallback.provider, fallback.model, signal);
                return fallbackInfo.inputModalities?.includes('image') === true;
            }
            catch {
                // Admission answers negative when the fallback route cannot be verified.
                return false;
            }
        },
    };
    ctx.provide(VISION_ROUTE_SERVICE, service);
    ctx.on('agent/request', async ({ agent, turn, step, signal }, next) => {
        const proposed = await next();
        if (policy === 'off')
            return proposed;
        const decision = await decideRoute({ policy, fallback }, agent.session.events, proposed, (provider, model, requestSignal) => ctx.llm.resolveModelInfo(provider, model, requestSignal), signal);
        if (!decision.routed)
            return proposed;
        agent.session.append('llm-vision-route/route', {
            turn,
            step,
            provider: decision.config.provider,
            model: decision.config.model,
            policy,
        });
        return decision.config;
    });
}
//# sourceMappingURL=index.js.map