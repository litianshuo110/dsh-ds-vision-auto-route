import { contentHasImage } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
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
* @module @deepseek-ai/dsh-llm-vision-route
*/
/** Cordis service key under which the vision routing service is provided. */
const VISION_ROUTE_SERVICE = "llm-vision-route";
z.object({
	visionProvider: z.string().min(1).default("deepseek-official"),
	visionModel: z.string().min(1).default("deepseek-v4-flash-vision-exp"),
	routePolicy: z.union([
		z.const("turn-image"),
		z.const("any-image"),
		z.const("off")
	]).default("turn-image")
});
//#endregion
//#region lib/types/invariant.js
/**
* Package-owned vision-routing log invariants: every routing record must sit
* inside an open turn and step, name the configured fallback route, and follow
* image-bearing input in its own turn.
* @module @deepseek-ai/dsh-llm-vision-route/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-llm-vision-route";
/** Cordis companion plugin name. */
const name = "llm-vision-route-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Validate one routing record against the events strictly before it. */
function validateRouteRecord(history, event, fallback, fail) {
	const { turn, step, provider, model, policy } = event.data;
	if (!Number.isSafeInteger(turn) || turn < 0) fail("llm-vision-route/route turn must be a non-negative safe integer");
	if (!Number.isSafeInteger(step) || step < 0) fail("llm-vision-route/route step must be a non-negative safe integer");
	if (typeof provider !== "string" || provider.length === 0) fail("llm-vision-route/route provider must be a non-empty string");
	if (typeof model !== "string" || model.length === 0) fail("llm-vision-route/route model must be a non-empty string");
	if (policy !== "turn-image" && policy !== "any-image") fail(`llm-vision-route/route policy must be turn-image or any-image, got ${String(policy)}`);
	if (fallback !== void 0 && (provider !== fallback.provider || model !== fallback.model)) fail(`llm-vision-route/route names ${provider}/${model}, but the configured fallback is ${fallback.provider}/${fallback.model}`);
	let turnStart = -1;
	let turnClosed = false;
	let stepStart = -1;
	let stepClosed = false;
	for (let cursor = history.length - 1; cursor >= 0; cursor--) {
		const prior = history[cursor];
		/* v8 ignore next -- the loop bound keeps the cursor in range */
		if (prior === void 0) continue;
		if (turnStart === -1 && !turnClosed && (prior.type === "turn/start" || prior.type === "turn/end")) if (prior.type === "turn/start") turnStart = cursor;
		else turnClosed = true;
		if (stepStart === -1 && !stepClosed && (prior.type === "step/start" || prior.type === "step/end")) if (prior.type === "step/start") stepStart = cursor;
		else stepClosed = true;
		if ((turnStart !== -1 || turnClosed) && (stepStart !== -1 || stepClosed)) break;
	}
	if (turnClosed || turnStart === -1) {
		fail("llm-vision-route/route must be appended inside an open turn");
		return;
	}
	const turnEvent = history[turnStart];
	if (turnEvent?.type === "turn/start" && turnEvent.data.turn !== turn) fail(`llm-vision-route/route names turn ${turn}, but the open turn is ${turnEvent.data.turn}`);
	if (stepClosed || stepStart === -1) {
		fail("llm-vision-route/route must be appended inside an open step");
		return;
	}
	const stepEvent = history[stepStart];
	if (stepEvent?.type === "step/start" && (stepEvent.data.turn !== turn || stepEvent.data.step !== step)) fail(`llm-vision-route/route names turn ${turn}/step ${step}, but the open step is ${stepEvent.data.turn}/${stepEvent.data.step}`);
	let hasImage = false;
	if (policy === "any-image") {
		for (const prior of history) if (prior.type === "user/message" && contentHasImage(prior.data.content) || prior.type === "tool/result" && contentHasImage(prior.data.message.content)) {
			hasImage = true;
			break;
		}
	} else for (let cursor = turnStart + 1; cursor < history.length; cursor++) {
		const prior = history[cursor];
		/* v8 ignore next -- the loop bound keeps the cursor in range */
		if (prior === void 0) continue;
		if (prior.type === "user/message" && contentHasImage(prior.data.content)) {
			hasImage = true;
			break;
		}
		if (prior.type === "tool/result" && contentHasImage(prior.data.message.content)) {
			hasImage = true;
			break;
		}
	}
	if (!hasImage) fail(`llm-vision-route/route (${policy}) must follow an image-bearing user message or tool result in its turn`);
}
/** Validate every routing record already present in one loaded session. */
function validateSession(session, fallback, fail) {
	session.events.forEach((event, index) => {
		if (event.type === "llm-vision-route/route") validateRouteRecord(session.events.slice(0, index), event, fallback, fail);
	});
}
/** Install validation for loaded and newly appended routing records. */
const install = Object.assign((ctx, fail) => {
	const fallback = ctx.get(VISION_ROUTE_SERVICE)?.fallbackRoute();
	for (const session of ctx.sessions.list()) validateSession(session, fallback, fail);
	ctx.on("session/created", (session) => {
		validateSession(session, fallback, fail);
	}, { global: true });
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const [session, event] = args;
		if (event.type !== "llm-vision-route/route") return;
		validateRouteRecord(session.events, event, fallback, fail);
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register the vision routing invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
