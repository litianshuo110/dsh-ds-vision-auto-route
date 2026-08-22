/**
 * Package-owned vision-routing log invariants: every routing record must sit
 * inside an open turn and step, name the configured fallback route, and follow
 * image-bearing input in its own turn.
 * @module dsh-ds-vision-auto-route/invariant
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "llm-vision-route-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/**
 * Register the vision routing invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map