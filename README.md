> **Deprecated: this plugin is no longer needed.**
>
> DeepSeek V4.1 Flash (released 2026-09-10) is natively multimodal, and DeepSeek Harness now ships it built in: the `deepseek-flash` model declares `inputModalities: ['text', 'image']`, so image-bearing turns need no routing. The legacy `deepseek-v4-flash-vision-exp` model has been retired and routes server-side to V4.1 Flash, so the fallback this plugin targeted no longer exists.
>
> Use DeepSeek Harness 0.1.5-rc.2 or later with the `deepseek-flash` model instead — see the [release notes](https://github.com/deepseek-ai/deepseek-harness/releases). This repository is archived and read-only.

# dsh-ds-vision-auto-route

English | [中文](README.zh.md)

Function plugin that routes image-bearing requests to a configurable image-capable model through the agent loop's `agent/request` waterfall. It does not change the selected model: every text-only request keeps the selection, and only a request whose turn introduced an image is replaced with the vision fallback. The loop logs the replacement as the `request/header`, so every routed call stays reconstructable, and the plugin appends a non-surface `llm-vision-route/route` record naming the turn, step, policy, and fallback route.

## Compatibility with the published DeepSeek Harness release

This plugin routes on the agent loop's `agent/request` waterfall, which runs **after** the host's prompt-admission step. The image-admission gate lives in the Web and ACP entry layers, not in this plugin.

- In the **source harness** (running `pnpm dsh web` from the checkout), that admission consults this plugin's `llm-vision-route` service before accepting image input, so an image prompt on a text-only main model is admitted and the request is routed to the vision fallback automatically.
- In the **published npm release** (`@deepseek-ai/dsh` installed globally, `dsh web`), the admission still rejects image prompts for a text-only model **before this plugin's waterfall can act**. Installing this plugin alone does not change that host behavior, so a stock npm host will **not** auto-route images on a text-only main model — the image is rejected and you would need to switch the model to the vision model manually.

The plugin takes effect out of the box on a source build, or on any host whose admission consults the vision-route service (the service-aware host admission is planned to ship in a future official release). Manual model selection always works either way.


The routing decision is a pure function of the durable log. `routePolicy: turn-image` (default) inspects only the open turn — events after the latest `turn/start` — so a text-only follow-up returns to the selected model while the historical image remains in the log; those later requests reach the selected model's ordinary negative-capability projection, which replaces the historical image with a stable placeholder text. `any-image` routes whenever the log contains any image, and `off` disables routing.

A request routes only when the selected model's exact metadata does not declare image input; a selected model that already accepts images is never replaced. The fallback route must declare image input, or the request fails with `INVALID_REQUEST` naming the fallback — a deployment pointing at a broken fallback fails loud instead of silently dropping pixels. A routed request drops `reasoningEffort`, which the fallback model may not support; sampling values pass through unchanged.

The plugin provides the `llm-vision-route` service (`VISION_ROUTE_SERVICE`), whose `routesImagesFor(agent)` answers whether an image-bearing prompt on one agent reaches an image-capable model, either directly or through routing. The Web prompt admission and the ACP content bridge consult it before accepting image input, so image prompts are admitted exactly when the router will serve them; without the service both surfaces keep their existing text-only rejection. `available()` answers the same question for initialization-time capability advertising (ACP `promptCapabilities.image`) and answers false on any unknown fact.

The separately published `./invariant` companion checks that every routing record sits inside an open turn and step, names the configured fallback, carries a valid policy, and follows image-bearing input in the inspected range (the open turn under `turn-image`, the whole prior log under `any-image`).

```yaml
- name: 'dsh-ds-vision-auto-route'
  config:
    visionProvider: deepseek-official
    visionModel: deepseek-v4-flash-vision-exp
    routePolicy: turn-image
```

All three keys are optional: the defaults are the official provider route, the shipped vision model, and `turn-image`.

## Installation

```sh
dsh plugin --profile web add github:litianshuo110/dsh-ds-vision-auto-route
```

`dsh plugin add` forwards to pnpm, and this package's `dsh.bundle.patch` wires the `llm-vision-route` row into the profile automatically. Manual alternative: clone the repository and add `dsh-ds-vision-auto-route` to the profile, or append the row from `cordis.patch.yml` to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`.

## Development

The plugin is developed in the [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) at `packages/llm/llm-vision-route`, where its unit, REAL-composition, invariant, and keyless snapshot tests live; this repository mirrors the shipped package. Rebuild the committed `lib/` artifacts with `pnpm install && pnpm run build`.

## Model Experience

### Vision routing

#### What the model sees

An image-bearing turn sees the complete image content on the routed vision model, preceded by the stable attachment handle text the provider adapter adds. Text-only turns see no routing artifacts; under `turn-image`, historical images reach the selected text model as the standard placeholder text instead of pixels. The non-surface routing record is log-only.

#### Token effect

Routing itself adds no tokens. The routed turn bills under the fallback model's pricing; each request image costs at most 384 tokens after the provider's automatic resize. The two exact-model metadata resolutions per request are catalog lookups, not model calls.

#### KV Cache effect

The routed request runs on a different model, so its cache identity differs from the selected model's. Under `turn-image`, alternating between the selected model and the fallback across turns resets the prefix cache at each switch boundary; a session that never sends images keeps one uninterrupted cache prefix.

## Known Limitations and Deferred Work

- **The selection itself never changes** — the Web model selector keeps showing the selected model; a routed turn runs on the fallback without moving the selection. A session that has never picked a model explicitly inherits the last logged header, so after an image turn its next request follows the routed route until a selection is made.
- **Turn-local routing projects historical images** — after the image turn, later text-model contexts replace the durable image with placeholder text; the pixels return only when the image is attached again (which re-triggers routing) or when a tool reads it on a routed turn.
- **Catalog metadata decides capability** — a model whose exact metadata omits `inputModalities` is treated as text-only and gets routed when images appear; declare image input on unlisted pass-through models that accept images to keep them un-routed.
- **`any-image` stays routed** — once the log contains an image, every later request whose proposal is not image-capable routes again until compaction or a selection change; choose it when image context should never degrade.
- **No provider failover** — the fallback must be a registered, image-capable route on the same or another provider; a missing or non-image fallback fails the image-bearing request loudly.
