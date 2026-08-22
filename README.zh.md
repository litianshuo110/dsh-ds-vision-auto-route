# dsh-ds-vision-auto-route

[English](README.md) | 中文

函数插件：通过 agent 循环的 `agent/request` waterfall，把含图片的请求路由到可配置的视觉模型。它不改变所选模型：纯文本请求保持原选择，只有"本轮引入了图片"的请求才会被替换为视觉回退；循环把替换结果记入 `request/header`，因此每次路由都可在日志中重建，插件还会追加一条非表面事件 `llm-vision-route/route`，记录该次路由的 turn、step、策略与回退路由。

路由决策是会话日志的纯函数。`routePolicy: turn-image`（默认）只检查当前轮（最近一次 `turn/start` 之后的事件），因此纯文本的后续轮次会回到所选模型，而历史图片仍留在日志里；这些后续请求会走所选模型既有的负能力投影，把历史图片替换为稳定的占位文本。`any-image` 只要日志中存在图片就路由；`off` 关闭路由。

仅当所选模型的确切元数据未声明 image 输入时才路由；本身支持图片的所选模型永远不会被替换。回退路由必须声明 image 输入，否则请求以 `INVALID_REQUEST` 失败并指明回退路由——指向坏回退的部署会响亮失败，而不是静默丢弃像素。被路由的请求会去掉回退模型可能不支持的 `reasoningEffort`，其余采样参数原样保留。

插件以 `llm-vision-route` 服务（`VISION_ROUTE_SERVICE`）对外提供查询：`routesImagesFor(agent)` 回答某个 agent 上的含图提示能否到达支持图片的模型（直接支持或经路由）。Web 提示准入与 ACP 内容桥在接收图片前都会查询它，因此图片提示恰好在该被路由服务时放行；没有该服务时两个入口保持原有的"文本-only 拒绝"行为。`available()` 用于初始化期的能力广告（ACP `promptCapabilities.image`），任何未知事实都回答 false。

独立发布的 `./invariant` 伴随插件校验：每条路由记录都位于开启的 turn 与 step 内、与配置的回退一致、策略合法，并且在对应检查范围内（`turn-image` 为当前轮、`any-image` 为此前整个日志）存在含图输入。

```yaml
- name: 'dsh-ds-vision-auto-route'
  config:
    visionProvider: deepseek-official
    visionModel: deepseek-v4-flash-vision-exp
    routePolicy: turn-image
```

三个配置项均可省略：默认分别为官方 provider 路由、内置视觉模型与 `turn-image`。

## 安装

```sh
dsh plugin --profile web add github:litianshuo110/dsh-ds-vision-auto-route
```

`dsh plugin add` 直通 pnpm，本包的 `dsh.bundle.patch` 会把 `llm-vision-route` 行自动接入 profile。手动方式：克隆本仓库并把 `dsh-ds-vision-auto-route` 加入 profile，或把 `cordis.patch.yml` 中的行追加到 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。

## 开发

本插件在 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)的 `packages/llm/llm-vision-route` 下开发，单测、REAL-composition、invariant 与 keyless 快照测试都在那里维护；本仓库镜像发布的包。用 `pnpm install && pnpm run build` 重新构建已提交的 `lib/` 产物。

## 模型体验（Model Experience）

### 视觉路由

#### 模型看到什么

含图轮次在被路由的视觉模型上看到完整图片内容（前带 provider 适配器附加的稳定附件句柄文本）。纯文本轮次看不到任何路由痕迹；`turn-image` 下，历史图片以标准占位文本而非像素到达所选文本模型。非表面路由事件仅存在于日志，不进入模型。

#### Token 影响

路由本身不产生 token。被路由的轮次按回退模型价格计费；每张请求图片经 provider 自动缩放后最多计 384 token。每次请求的两次精确模型元数据解析只是目录查询，不是模型调用。

#### KV Cache 影响

被路由的请求运行在另一个模型上，缓存身份与所选模型不同。`turn-image` 下，所选模型与回退模型逐轮交替会在每次切换边界重置前缀缓存；从不发图的会话保持单一连续缓存前缀。

## 已知限制与后续工作

- **选择本身不变**——Web 模型选择器始终显示所选模型；被路由的轮次运行在回退模型上，但不移动选择。从未显式选过模型的会话会继承最近记录的 header，因此发图之后其下一次请求会跟随被路由的路由，直到用户作出选择。
- **轮内路由会把历史图片投影掉**——图片轮结束后，文本模型上下文中的持久图片被替换为占位文本；像素只在重新附加图片（会再次触发路由）或工具在被路由轮次上读取时回归。
- **目录元数据决定能力**——确切元数据未声明 `inputModalities` 的模型按文本-only 处理，出现图片即被路由；支持图片的未登记直通模型应声明 image 输入以免被路由。
- **`any-image` 会持续路由**——日志一旦含图，之后每个提案不支持图片的请求都会再次路由，直到压缩或选择变更；需要"图像上下文永不降级"时选它。
- **不提供 provider 故障转移**——回退必须是一条已注册且支持图片的路由（同或不同 provider 均可）；缺失或不支持图片的回退会让含图请求响亮失败。
