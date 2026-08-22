/**
 * Package-owned vision-routing log invariants: every routing record must sit
 * inside an open turn and step, name the configured fallback route, and follow
 * image-bearing input in its own turn.
 * @module @deepseek-ai/dsh-llm-vision-route/invariant
 */
import { contentHasImage } from '@deepseek-ai/dsh-llm';
import { VISION_ROUTE_SERVICE } from "./index.js";
const PACKAGE_NAME = '@deepseek-ai/dsh-llm-vision-route';
/** Cordis companion plugin name. */
export const name = 'llm-vision-route-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** Validate one routing record against the events strictly before it. */
function validateRouteRecord(history, event, fallback, fail) {
    const { turn, step, provider, model, policy } = event.data;
    if (!Number.isSafeInteger(turn) || turn < 0) {
        fail('llm-vision-route/route turn must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(step) || step < 0) {
        fail('llm-vision-route/route step must be a non-negative safe integer');
    }
    if (typeof provider !== 'string' || provider.length === 0) {
        fail('llm-vision-route/route provider must be a non-empty string');
    }
    if (typeof model !== 'string' || model.length === 0) {
        fail('llm-vision-route/route model must be a non-empty string');
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- durable JSON may carry any policy value
    if (policy !== 'turn-image' && policy !== 'any-image') {
        fail(`llm-vision-route/route policy must be turn-image or any-image, got ${String(policy)}`);
    }
    if (fallback !== undefined && (provider !== fallback.provider || model !== fallback.model)) {
        fail(`llm-vision-route/route names ${provider}/${model}, but the configured fallback is ${fallback.provider}/${fallback.model}`);
    }
    let turnStart = -1;
    let turnClosed = false;
    let stepStart = -1;
    let stepClosed = false;
    for (let cursor = history.length - 1; cursor >= 0; cursor--) {
        const prior = history[cursor];
        /* v8 ignore next -- the loop bound keeps the cursor in range */
        if (prior === undefined)
            continue;
        if (turnStart === -1 && !turnClosed && (prior.type === 'turn/start' || prior.type === 'turn/end')) {
            if (prior.type === 'turn/start')
                turnStart = cursor;
            else
                turnClosed = true;
        }
        if (stepStart === -1 && !stepClosed && (prior.type === 'step/start' || prior.type === 'step/end')) {
            if (prior.type === 'step/start')
                stepStart = cursor;
            else
                stepClosed = true;
        }
        if ((turnStart !== -1 || turnClosed) && (stepStart !== -1 || stepClosed))
            break;
    }
    if (turnClosed || turnStart === -1) {
        fail('llm-vision-route/route must be appended inside an open turn');
        return;
    }
    const turnEvent = history[turnStart];
    if (turnEvent?.type === 'turn/start' && turnEvent.data.turn !== turn) {
        fail(`llm-vision-route/route names turn ${turn}, but the open turn is ${turnEvent.data.turn}`);
    }
    if (stepClosed || stepStart === -1) {
        fail('llm-vision-route/route must be appended inside an open step');
        return;
    }
    const stepEvent = history[stepStart];
    if (stepEvent?.type === 'step/start' && (stepEvent.data.turn !== turn || stepEvent.data.step !== step)) {
        fail(`llm-vision-route/route names turn ${turn}/step ${step}, but the open step is ${stepEvent.data.turn}/${stepEvent.data.step}`);
    }
    let hasImage = false;
    if (policy === 'any-image') {
        for (const prior of history) {
            if ((prior.type === 'user/message' && contentHasImage(prior.data.content))
                || (prior.type === 'tool/result' && contentHasImage(prior.data.message.content))) {
                hasImage = true;
                break;
            }
        }
    }
    else {
        for (let cursor = turnStart + 1; cursor < history.length; cursor++) {
            const prior = history[cursor];
            /* v8 ignore next -- the loop bound keeps the cursor in range */
            if (prior === undefined)
                continue;
            if (prior.type === 'user/message' && contentHasImage(prior.data.content)) {
                hasImage = true;
                break;
            }
            if (prior.type === 'tool/result' && contentHasImage(prior.data.message.content)) {
                hasImage = true;
                break;
            }
        }
    }
    if (!hasImage) {
        fail(`llm-vision-route/route (${policy}) must follow an image-bearing user message or tool result in its turn`);
    }
}
/** Validate every routing record already present in one loaded session. */
function validateSession(session, fallback, fail) {
    session.events.forEach((event, index) => {
        if (event.type === 'llm-vision-route/route') {
            validateRouteRecord(session.events.slice(0, index), event, fallback, fail);
        }
    });
}
/** Install validation for loaded and newly appended routing records. */
const install = Object.assign((ctx, fail) => {
    const service = ctx.get(VISION_ROUTE_SERVICE);
    const fallback = service?.fallbackRoute();
    for (const session of ctx.sessions.list())
        validateSession(session, fallback, fail);
    ctx.on('session/created', (session) => { validateSession(session, fallback, fail); }, { global: true });
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
        if (eventName !== 'session/event')
            return;
        const [session, event] = args;
        if (event.type !== 'llm-vision-route/route')
            return;
        // The dispatched event is not yet in `session.events`; the boundary and
        // image scans only read prior events, so the full log is the exact input.
        validateRouteRecord(session.events, event, fallback, fail);
    }, { global: true });
}, { inject: ['sessions'] });
/**
 * Register the vision routing invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map