import z from "@deepseek-ai/schemastery";
import { LlmError, contentHasImage } from "@deepseek-ai/dsh-llm";
//#region lib/types/detect.js
/**
* Deterministic image-introduction detection over the session log. The routing
* decision is a pure function of logged events, so the same history always
* routes the same way and the routed request stays reconstructable.
* @module dsh-ds-vision-auto-route/detect
*/
/** True when one surface event carries an image block anywhere in its content tree. */
function eventHasImage(event) {
	switch (event.type) {
		case "user/message": return contentHasImage(event.data.content);
		case "tool/result": return contentHasImage(event.data.message.content);
		default: return false;
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
function introducesImages(events, policy) {
	if (policy === "any-image") return events.some(eventHasImage);
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		/* v8 ignore next -- the loop bound keeps the index in range */
		if (event === void 0) continue;
		if (event.type === "turn/start") return false;
		if (eventHasImage(event)) return true;
	}
	return false;
}
//#endregion
//#region lib/types/route.js
/**
* Request routing decision: replace an image-bearing request's model route
* with the configured image-capable fallback when the selected route cannot
* accept images.
* @module dsh-ds-vision-auto-route/route
*/
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
async function decideRoute(input, events, proposed, resolve, signal) {
	if (!introducesImages(events, input.policy)) return { routed: false };
	if ((await resolve(proposed.provider, proposed.model, signal)).inputModalities?.includes("image") === true) return { routed: false };
	const fallback = await resolve(input.fallback.provider, input.fallback.model, signal);
	if (fallback.inputModalities?.includes("image") !== true) throw new LlmError(`llm-vision-route: fallback route "${fallback.provider}/${fallback.id}" does not declare image input`, "INVALID_REQUEST");
	const { reasoningEffort: _droppedEffort, ...withoutEffort } = proposed;
	return {
		routed: true,
		config: {
			...withoutEffort,
			provider: fallback.provider,
			model: fallback.id
		}
	};
}
//#endregion
//#region lib/types/index.js
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
* @module dsh-ds-vision-auto-route
*/
/** Cordis service key under which the vision routing service is provided. */
const VISION_ROUTE_SERVICE = "llm-vision-route";
/** Default provider route for the vision fallback. */
const DEFAULT_VISION_PROVIDER = "deepseek-official";
/** Default model id for the vision fallback. */
const DEFAULT_VISION_MODEL = "deepseek-v4-flash-vision-exp";
const name = "llm-vision-route";
const inject = ["llm"];
const Config = z.object({
	visionProvider: z.string().min(1).default(DEFAULT_VISION_PROVIDER),
	visionModel: z.string().min(1).default(DEFAULT_VISION_MODEL),
	routePolicy: z.union([
		z.const("turn-image"),
		z.const("any-image"),
		z.const("off")
	]).default("turn-image")
});
/**
* Install the vision routing service and the request waterfall listener.
* @param ctx - Cordis context carrying the `llm` service.
* @param config - validated plugin config.
*/
function apply(ctx, config) {
	const policy = config.routePolicy ?? "turn-image";
	const fallback = {
		provider: config.visionProvider ?? DEFAULT_VISION_PROVIDER,
		model: config.visionModel ?? DEFAULT_VISION_MODEL
	};
	ctx.provide(VISION_ROUTE_SERVICE, {
		fallbackRoute: () => ({ ...fallback }),
		active: () => policy !== "off",
		async available(signal) {
			if (policy === "off") return false;
			try {
				return (await ctx.llm.resolveModelInfo(fallback.provider, fallback.model, signal)).inputModalities?.includes("image") === true;
			} catch {
				return false;
			}
		},
		async routesImagesFor(agent, signal) {
			if (policy === "off") return false;
			const header = agent.session.requestHeader()?.config;
			const provider = header?.provider ?? agent.options.provider;
			const model = header?.model ?? agent.options.model;
			if (provider === void 0 || model === void 0) return false;
			try {
				if ((await ctx.llm.resolveModelInfo(provider, model, signal)).inputModalities?.includes("image") === true) return true;
			} catch {
				return false;
			}
			try {
				return (await ctx.llm.resolveModelInfo(fallback.provider, fallback.model, signal)).inputModalities?.includes("image") === true;
			} catch {
				return false;
			}
		}
	});
	ctx.on("agent/request", async ({ agent, turn, step, signal }, next) => {
		const proposed = await next();
		if (policy === "off") return proposed;
		const decision = await decideRoute({
			policy,
			fallback
		}, agent.session.events, proposed, (provider, model, requestSignal) => ctx.llm.resolveModelInfo(provider, model, requestSignal), signal);
		if (!decision.routed) return proposed;
		agent.session.append("llm-vision-route/route", {
			turn,
			step,
			provider: decision.config.provider,
			model: decision.config.model,
			policy
		});
		return decision.config;
	});
}
//#endregion
export { Config, VISION_ROUTE_SERVICE, apply, inject, introducesImages, name };
