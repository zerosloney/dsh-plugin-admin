# DSH 兼容矩阵

> 基线：**dsh 0.1.7-rc.2**（checkout `D:/code/deepseek-harness`，HEAD 477b4f4）· 插件 v1.25.0。
> 复现：`npm test`（含 `host-check` 与 `integration-check`）；探针指向的 checkout 可用环境变量 `DSH_CHECKOUT` 覆盖（见 `scripts/integration-check.mjs`）。

## 怎么读这张表

- **官方对应**：同一能力在该 dsh 版本里是否已有第一方实现（包名取自 `packages/client/*` 与 `packages/*`）。
- **本插件策略**：`独占`（官方无对应，短期无冲突）／`增量`（官方有基础能力，插件补管理面）／`让位`（官方已覆盖，按 Phase E 的 native-coverage 探测自动隐藏该面板）／`覆盖`（插件在官方 slot 之上叠加，需显式声明）。
- **机制**：插件赖以工作的宿主接缝。标 ⚠ 的是非公开/内部接缝，升级时风险最高。

## 矩阵

| 面板 / 能力 | 官方对应（0.1.7-rc.2） | 本插件策略 | 机制 | 验证 |
|---|---|---|---|---|
| 扩展插件（装/卸/启停/更新） | `ui-plugin-manager` + `ui-settings-plugin-inventory` + `pluginManager` remote | **让位** | profile `cordis.patch.yml` + pnpm 编排 | integration-check |
| 技能清单 | `ui-skill`（调用侧）、`skill-filesystem` | 增量（只读全量清单：来源 / 作用域 / 双旗标） | `agentPresets.acquireScope`（⚠ 与宿主同款用法） | verify-skills-admin |
| MCP 服务器 | 仅宿主 `mcp-client`，无 UI | **独占** | profile patch row + ⚠ `fiber.update(config, true)` 热应用 | host-check / verify-mcp-cache |
| 子智能体（编写侧） | `ui-settings-subagent`（深度/容量/模型）、`ui-subagent`（浏览） | 增量（具名委派实例 / persona / 工具约束 / CLI 后端） | profile patch rows + `ctx.subagents` | verify-subagents-host / -client |
| 命令（文件化 CRUD） | `ui-commands`（客户端命令 API，非文件管理） | 增量 | `ctx.commands` + `$DSH_HOME/commands` + fs.watch | verify-command-hooks |
| 钩子（hooks.json / 双桥） | 宿主 hooks + claude-code / codex 桥（无 UI） | **独占** | `hooks.json` + patch 行 + ⚠ `fiber.update` | verify-hooks-codex-bridge |
| 定时任务 | `ui-schedule` + `packages/schedule`（会话级任务） | 增量（宿主级 cron，语义不同） | `~/.dsh/cron-tasks.json` + 每任务 timer | verify-cron-admin / verify-cron-panel |
| Webhook 入站规则 | `packages/webhook`、`webhook-github`（无规则管理 UI） | **独占** | prefix route + `x-webhook-secret` + 去重历史；**默认仅本机**（非 loopback 与"报不出对端地址"的传输层都 403，远程需 `webhookAllowRemote`） | verify-webhook-triggers / verify-webhook-hardening |
| 工作流（journal / 续跑 / 工作库） | `workflow` + `tool-workflow` + `ui-workflow-run` | 增量 | `node:vm` realm + `$DSH_HOME/workflows` | verify-workflow-* |
| 历史会话（批删 / 导出 / 体检 / 置顶） | `ui-workspace`（会话管理）、`session-query` | 增量 | `sessionPersistence` + ⚠ `workspaceRegistry` 归档集 | host-check |
| Web 搜索（provider 切换） | `ui-settings-web-search`（DeepSeek provider 配置） | 增量（exa / perplexity 装卸） | profile patch row + `settings.mutate`（有 settings 命名空间时） | verify-web-search-admin |
| 用量仪表盘 | 无 | **独占** | `session/event` 事件流 + `$DSH_HOME/usage-ledger.json` | verify-usage-ledger |
| 待办 dock | `ui-conversation` 的 `TodoPanel`（`conversation.input.dock` order 0） | **覆盖**（order 5；有数据时隐藏原生条） | `conversation.input.dock` slot | verify-todo-panel |
| 工作区管理 | `ui-workspace` + `ui-sidebar-browser` | **已退役** | —（宿主侧 `workspaceAdmin` 命名空间保留为兼容 RPC 面） | integration-check |

## 已知的高风险接缝（升级时优先回归）

| 接缝 | 用途 | 风险 | 现网兜底 |
|---|---|---|---|
| ⚠ `fiber.update(config, true)`（loader 内部） | MCP 已挂载条目 / hooks 桥热应用 | 非公开 API，宿主重构即失效 | 能力探测 + 失败回落"需重启"提示 |
| ⚠ `ctx.typert.register` 裸描述符 | 14 个命名空间的 RPC 面 | 无 schema / 无客户端类型（`schemas` 为空） | Phase D 补 schema 与单一真相表 |
| ⚠ `workspaceRegistry.unarchiveSession` 等动词 | 归档集清理 / 取消归档 | 版本间增删 | 挂载期能力探测 + 显式降级警告 |
| ⚠ `agentPresets.acquireScope` 租约 | 读取预设 skill 作用域 | 与宿主 `dsh-webhook` 同款用法，属半公开 | 读毕即 dispose；失败逐作用域降级 |

## 接缝矩阵（Phase G）

`scripts/integration-check.mjs` 读取 dsh 的 **TypeScript 源码**（源码是事实来源，不需要构建），断言插件所依赖的每一条接缝仍然存在；`scripts/check-matrix.mjs` 把同一份探测**并行地跑在多个 checkout 上**，于是"支持哪些 dsh 版本"从文档承诺变成可执行事实。

```bash
# 单个 checkout（默认取 $DSH_CHECKOUT，再退回同级 deepseek-harness）
npm test

# 多版本矩阵：逗号/分号分隔；隐式回退时没有 dsh 的目录记为 SKIP（不算失败），
# 任何一个存在的 checkout 契约漂移则整体失败。
DSH_CHECKOUTS="D:/dsh/0.1.7-rc.2, D:/dsh/next" npm run test:matrix
```

**CI 里两者都不是可跳过的**：`.github/workflows/ci.yml` 的 `test` 作业先 `actions/checkout` 一个 pin 住的 dsh（`deepseek-ai/deepseek-harness@dsh-v0.1.7-rc.2`，公开仓库、`fetch-depth: 1`、不安装不构建）并把路径交给 `DSH_CHECKOUT`；`seam-matrix` 作业再 checkout 该 pin 与 `master` 两档，跑 `npm run test:matrix`（`master` 是预警行：例行重构应当通过，契约变化必须先在这里响）。**CI 下没有 checkout 就是失败** —— 跳过 124 条契约与全部通过会打印同样的绿灯，那正是上游漂移能溜进发布的路径。

矩阵当前覆盖 **124 条契约**，其中与插件自身最新能力直接相关的几条：

| 接缝 | 探测来源 | 谁在用 |
|---|---|---|
| `slots.entries(key)` 返回 `StoredEntry[]` | `packages/client/ui-slots/src/index.ts` | Phase E 的官方优先自动让位（读不到条目就不让位） |
| `slots.inject(key, callback)` 的声明生命周期（已声明即同步运行、折叠后重跑） | `packages/client/ui-renderer/src/client/registry.ts` | 面板注入：**声明在 renderer 而不是 ui-slots 包里**，只查 ui-slots 会漏掉整条注入路径 |
| `slots.register(options: ErasedOptions, component)` + `ErasedOptions.name/id/order/inject` | `packages/client/ui-slots/src/index.ts` | 面板注册（插件传的四个键） |
| `locale.register/bind/subscribe/setLocale` | `packages/client/locale/src/client/index.ts` | Phase C 的客户端本地化与语言切换 |
| `WebRoute { kind: 'prefix' \| 'exact', path, handler(req,res) }` | `packages/host/webserver/src/index.ts` | Webhook 入站端点（Phase F4 的加固读 `req.socket.remoteAddress`） |
| `commands.register(definition)` + `CommandInvocation.agent/rawInput/attachments` | `packages/interaction/commands/src/index.ts` | 命令钩子（handler 解构这三个字段）与 `/workflow` 斜杠命令 |
| `session/created` / `disposed` / `event` / `flush` 四个事件 + `Session.id/firstLiveSeq/header` | `packages/core/session/src/index.ts` | 用量台账的实时观察与 drain 时机（`lib/index.js:1756-1795`） |
| `sessions.get(id)`（宿主存活判定）+ `ISessions.refresh()/refreshProjections()`（客户端侧栏） | `packages/core/session/src/index.ts`、`packages/api/session-controller/src/client/contract/sessions.ts` | steer 前的会话存活校验；删除会话后立即刷新侧栏 |
| `llm.listProviders()` / `listModels(provider)` + `LlmProviderInfo` / `LlmModelInfo` | `packages/llm/llm/src/index.ts`、`types.ts` | 子代理面板的 provider / model 下拉（缺了就退化成空列表） |
| `storageDomain.get(name)` → `table(name).delete(key)` | `packages/storage/storage-domain/src/index.ts`、`domain.ts` | 删除会话时立即清掉 projection cache（否则侧栏残留到刷新） |
| `subagentModelSelection` 服务键 | `packages/subagent/tool-subagent/src/model-selection-settings.ts` | 子代理入口校验里的"模型选择是否可用" |

漂移时的处理顺序：先 diff 探测点名的文件，确认是**契约变化**还是**例行重构**；契约变化要先改插件适配，再更新探测针。探测针只钉稳定且承重的行——例行重构应该通过，契约变化必须报警。
## 官方覆盖与让位（Phase E）

面板是否注册由 `src/client/native-coverage.js` 的探测表决定：**官方已覆盖的面板直接不注册**（不是隐藏、不是禁用），`localStorage['dsh-admin-panels']` 可用逗号分隔的面板 id 强制要回某个面板。下面这张表与该模块同源——改探测逻辑时两边一起改。

| 面板 | 官方对应（0.1.7-rc.2） | 探测信号（客户端） | 当前结论 |
|---|---|---|---|
| 扩展插件 | 插件侧边栏页 `ui-plugin-manager` + 插件列表页签 `ui-settings-plugin-inventory` | `sidebar.panellist` 有 id `plugins`，或 `settings.plugins.tab` 有 id `all` | **让位**（探测命中即不注册） |
| MCP 服务器 | 无（仅宿主 `mcp-client`） | — | 保留 |
| 技能 | `ui-skill`（`/` 触发与调用卡片） | — | 保留（全量清单无官方页） |
| 子智能体 | `ui-settings-subagent`（深度/容量/模型） | — | 保留（编写侧无官方页） |
| 命令 | `ui-commands`（客户端命令 API） | — | 保留（文件化管理无官方页） |
| 钩子 | 无 UI | — | 保留 |
| Web 与会话 | `ui-workspace`（浏览/归档/重命名/分叉） | — | 保留（批删/导出/体检无官方页） |
| Web 搜索 | `ui-settings-web-search`（官方 provider 配置页） | — | 保留（provider 切换无官方页） |
| 用量仪表盘 | 无 | — | 保留 |
| 自动化 | `ui-schedule`（会话级任务） | — | 保留（宿主级 cron / Webhook 入站无官方页） |
| 待办清单 | `ui-conversation` TodoPanel（`conversation.input.dock` id `todo`） | — | 保留（是叠加增强：有数据时替换原生条） |

**未实现的探测**：上表中标 "—" 的行目前 `detect` 恒为 false，即面板保留。这是刻意的：**探测不到就不让位**——把看不见的东西当作"已覆盖"会让功能凭空消失。后续上游补齐（例如官方 MCP 管理页）时，只需给对应行加一条探测。

## 真实宿主冒烟（L3）

前面三节都是"不启动宿主"的验证：`host-check` 用替身 ctx 挂载、`self-check` 用 jsdom 跑面板、`integration-check` 只**读** dsh 源码。它们能证明契约还在，但证明不了"loader 组出了我们的行、服务却根本没挂上"、"客户端 bundle 没进模块表"、"网关不认我们的描述符"这类事。`scripts/smoke-real-host.mjs` 补的就是这一层：

```
npm run smoke:real-host          # 需要 PATH 上有 dsh；没有则 SKIP（CI 里用 SMOKE_REQUIRE_DSH=1 变成失败）
```

它**只用一次性目录**（`mkdtempSync` 做 `DSH_HOME`，从 dsh 自带的 web 模板生成 profile，用 `dsh plugin … add link:<repo>` 装本插件），跑完在 `finally` 里杀掉进程树并删目录 —— **绝不碰你真实的 `$DSH_HOME`**。断言四件事：

| 阶段 | 断言 | 抓的是什么 |
|---|---|---|
| 1 组合 | `dsh <profile> --dump-config` 里出现 `- id: plugin-admin / name: dsh-plugin-admin` | 宿主 loader 读到了我们包里的 `dsh.bundle.patch` 并把行组合进配置树 |
| 2 启动 | Host 打印带 token 的 URL | 插件存在时宿主能正常 boot（挂载抛错就会在这里断） |
| 3 浏览器半 | shell 的模块表里有 `plugins/??dsh-plugin-admin/client.js`，且取回的是**我们的字节**（`PluginsSection` 等标记） | `dsh.client` 清单被发现、产物被真实 web 服务端出来 |
| 4 RPC | `POST /api/pluginAdmin/list` 返回 `ok:true` 且列表里是本插件；另用畸形信封确认网关回 `gateway/bad-request` | 服务真的挂上了、typert 描述符真的注册了（网关只受理已声明端点）、strict codec 真的校验了参数 |

实测：dsh `0.1.7-rc.2` 上 **11/11 通过，约 5 秒**。CI 里 `host-smoke` 作业跑同一套（装 pin 住的 dsh → `npm run smoke:real-host`）。

这条不放进 `npm test`：它需要真实 `dsh` 且要起进程，属于"重量级但承重"的独立闸门，而不是每个开发者每次都要跑的 34 个脚本之一。

## 已知边界（并发写）

跨进程写保护（Phase F1/F2）的适用面是**明确的**，不等于"所有落盘都安全"：

| 文件 | 读-改-写 | 说明 |
|---|---|---|
| `cordis.patch.yml`（profile patch） | ✅ 锁内 `mutatePatch` / `mutateProfilePatch` | 21 处写入点全部走它；锁跨 读 → 变换 → 写 |
| `cron-tasks.json` | ✅ 锁内 `mutateTasksStore` | `upsert` / `remove` / `toggle`；校验看到的 id 集就是写入替换的修订 |
| `webhook-triggers.json` | ✅ 锁内 `mutateRulesStore` | `saveRule` / `deleteRule`；"空 secret 继承已存值"查的也是锁内那一份 |
| profile `package.json`、`admin-audit.jsonl`、`usage-ledger.json`、`webhook-history.json`、`workflow/runs/**`、`subagent-admin.*.json` | ⚠️ 仅**原子写**（唯一临时名 + `atomicRename` 重试）；读-改-写靠**进程内**串行队列 | 同一 profile 同时跑两个 dsh 实例时这些文件仍可能丢一次更新 |

上表 ⚠️ 行的取舍与兜底：台账与交付历史是**可重建的派生数据**（会话日志仍在，下一次读取或投递会覆盖），审计是**追加写**（两个实例的行会交错，但不会互相删除；只有"到达上限压缩"那一步会以读-改-写覆盖），workflow journal / subagent 侧车是单实例写入的产物。要彻底消除，可把 `withFileLock` 套到这些 store 的读-改-写；代价是**持锁期间不能 await**，而台账的合并依赖内存镜像（镜像里还有尚未落盘的保留行），改造前要先解决"镜像 ↔ 文件"的双向合并，属于独立的改动。

两条容易误判的边界：

- **交付历史的写放大**：`webhook-history.json` 是"单文件双用途"（历史环 + `x-webhook-delivery` 去重集），一次投递最多整文件重写**两次**（执行动作前先落去重集，动作后再落历史行），两次都是有意为之：第一次保证崩溃后重投不会重复执行，第二次记录结果。因此 `webhookHistoryCap` 越大，每次投递的同步写越贵（上限 10000 ≈ 2 × 约 2MB/投递）。**建议 ≤ 1000**；若要既大又不贵，替代方案是把历史改成 JSONL 追加、去重集单独存放（尚未实现）。
- **`withFileLock` 是失败开放的**：等 3 秒仍拿不到锁就照写。语义是"宁丢一次更新，也不拒绝用户当下的操作"，原子 `temp + rename` 仍保证文件不会撕裂。抢占（过期锁 / 持有者已死）后带 5ms + 随机退避重试，且**无主的半写锁在 250ms 内不会被抢**（`open(…,'wx')` 与写入 pid 之间那个窗口），所以两个实例不会同时进入临界区。跨进程丢失更新只在"两个 dsh 同时写同一个 profile、且恰好落在同一窗口内"时才会发生 —— 这也是上表三件"锁内"文件要覆盖读-改-写整体的原因。

## 版本策略

**支持范围：dsh ≥ 0.1.7-rc.2。** 自 v1.25.0 起不再支持 dsh 0.1.6，这是**已决策**（不再是"待定"）：

- 客户端直接静态引用平台共享模块（`@deepseek-ai/dsh-client-ui-primitives` / `-ui-slots` / `-client-store`，见 `scripts/build-client.mjs` 的 `PLATFORM_BASELINE`）与 `ctx.locale` 服务：0.1.6 的宿主模块表里没有这些 seed，缺一项就是**整包加载失败**，而不是降级。既然实现里已经没有 0.1.6 的回落分支，"继续支持 0.1.6"就只是一句与代码不符的承诺，本次把口径改成事实。
- 保留的"先探测、后降级"分支（如 `agentPresets.acquireScope` → `standingKeyFor`、`fiber.update` 能力探测、`workspaceRegistry.unarchiveSession` 的缺失告警）是**同一范围内的防御性探测**（0.1.7 的 rc 与正式版之间、以及未来版本删动词时用），不是 0.1.6 支持。
- 升级一台 0.1.6 的宿主前请先升 dsh；插件在 0.1.6 上的失败模式是"客户端整包不加载"，不会有半可用状态。
- CI 矩阵**已落地**（`.github/workflows/ci.yml`）：`test` 作业对 `dsh-v0.1.7-rc.2` 跑完整 `npm test`（含 124 条接缝契约，无 checkout 即失败），`seam-matrix` 作业对 `dsh-v0.1.7-rc.2` 与 `master` 两档跑 `npm run test:matrix`。加一档新版本只需往 `DSH_CHECKOUTS` 里加路径。
