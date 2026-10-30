# DSH 兼容矩阵

> **验证基线：dsh 0.2.1-rc.4**（CI pin `deepseek-ai/deepseek-harness@dsh-v0.2.1-rc.4`）；**支持下限：dsh ≥ 0.1.7-rc.2**（CI 的 `seam-matrix` 保留该档作回归哨兵）；**声明上界：< 0.3.0**（`engines.dsh` 的右半，见「版本策略」）· 插件 v1.34.1。
> 复现：`npm test`（含 `host-check` 与 `integration-check`）；探针指向的 checkout 可用环境变量 `DSH_CHECKOUT` 覆盖（见 `scripts/integration-check.mjs`）。
>
> 参数校验现状（Phase D2 已落地）：87 个 wire 挂 `mode: 'strict'`，网关按 `codec.create().parse(value)` 在边界校验；
> 校验器为零依赖手写（`lib/rpc-schema.js`，7 个 schema：text/scalar/number/boolean/textList/entry/json），
> 刻意不比服务更严（不枚举 entry 字段），必填/可选为 81/6（`RPC_OPTIONAL_WIRES` + `verify-rpc-schema.mjs` 独立字面量契约）。
> 包级 `schemas: []` 为空是历史形态，不等于“无校验”。

## 怎么读这张表

- **官方对应**：同一能力在该 dsh 版本里是否已有第一方实现（包名取自 `packages/client/*` 与 `packages/*`）。
- **本插件策略**：`独占`（官方无对应，短期无冲突）／`增量`（官方有基础能力，插件补管理面）／`让位`（官方已覆盖，按 Phase E 的 native-coverage 探测自动隐藏该面板）／`覆盖`（插件在官方 slot 之上叠加，需显式声明）。
- **机制**：插件赖以工作的宿主接缝。标 ⚠ 的是非公开/内部接缝，升级时风险最高。

## 矩阵

| 面板 / 能力 | 官方对应（0.2.1-rc.4） | 本插件策略 | 机制 | 验证 |
|---|---|---|---|---|
| 扩展插件（装/卸/启停/更新） | `ui-plugin-manager` + `ui-settings-plugin-inventory` + `pluginManager` remote | **让位** | profile `cordis.patch.yml` + pnpm 编排 | integration-check |
| 技能清单 | `ui-skill`（调用侧）、`skill-filesystem` | 增量（只读全量清单：来源 / 作用域 / 双旗标） | `agentPresets.acquireScope`（⚠ 与宿主同款用法） | verify-skills-admin |
| MCP 服务器 | 仅宿主 `mcp-client`，无 UI | **独占** | profile patch row + ⚠ `fiber.update(config, true)` 热应用 | host-check / verify-mcp-cache |
| 子智能体（编写侧） | `ui-settings-subagent`（深度/容量/模型）、`ui-subagent`（浏览） | 增量（具名委派实例 / persona / 工具约束 / CLI 后端） | profile patch rows + `ctx.subagents` | verify-subagents-host / -client |
| 命令（文件化 CRUD） | `ui-commands`（客户端命令 API，非文件管理） | 增量 | `ctx.commands` + `$DSH_HOME/commands` + fs.watch | verify-command-hooks |
| 钩子（hooks.json / 双桥） | 宿主 hooks + claude-code / codex 桥（无 UI） | **独占** | `hooks.json` + patch 行 + ⚠ `fiber.update` | verify-hooks-codex-bridge |
| 定时任务 | `ui-schedule` + `packages/schedule`（**宿主级任务页**：`schedule/catalog` 读全量、`storageDomain` 持久、带 cron 编辑 UI） | 增量（**唯一真实差异**：官方 `create(sessionId, …)` 必须绑定会话，无会话绑定的任务无官方路径；另加每任务进程内 timer 与「错过不补投」语义） | `~/.dsh/cron-tasks.json` + 每任务 timer | verify-cron-admin / verify-cron-panel |
| Webhook 入站规则 | `packages/webhook`、`webhook-github`（无规则管理 UI） | **独占** | prefix route + `x-webhook-secret` + 去重历史；**默认仅本机**（非 loopback 与"报不出对端地址"的传输层都 403，远程需 `webhookAllowRemote`） | verify-webhook-triggers / verify-webhook-hardening |
| 工作流（journal / 续跑 / 工作库） | `workflow` + `tool-workflow` + `ui-workflow-run` | 增量 | `node:vm` realm + JSON 桥 + 同步前缀 vm timeout + `$DSH_HOME/workflows`（同进程，非硬隔离） | verify-workflow-* |
| 历史会话（批删 / 导出 / 体检 / 置顶） | `ui-workspace`（会话管理）、`session-query` | 增量 | `sessionPersistence` + ⚠ `workspaceRegistry` 归档集 | host-check |
| Web 搜索（provider 切换） | `ui-settings-web-search`（DeepSeek provider 配置） | 增量（exa / perplexity 装卸） | profile patch row + `settings.mutate`（有 settings 命名空间时） | verify-web-search-admin |
| 用量仪表盘 | 无 | **独占** | `session/event` 事件流 + `$DSH_HOME/usage-ledger.json` | verify-usage-ledger |
| 待办 dock | `ui-conversation` 的 `TodoPanel`（`conversation.input.dock` order 0） | **让位**（官方 todo 条已挂载即不注册；`dsh-admin-panels` / `config.panels.todo: 'on'` 可强制） | `conversation.input.dock` slot | verify-todo-panel |
| 工作区管理 | `ui-workspace` + `ui-sidebar-browser` | **已退役** | —（宿主侧 `workspaceAdmin` 命名空间保留为兼容 RPC 面；服务可经 `config.workspaceAdmin: 'off'` 停挂——描述符保留、调用在网关处失败） | integration-check |

## 已知的高风险接缝（升级时优先回归）

| 接缝 | 用途 | 风险 | 现网兜底 |
|---|---|---|---|
| ⚠ `fiber.update(config, true)`（Cordis/loader 内部） | MCP 已挂载条目 / hooks 桥热应用 | 非公开 API，宿主重构即失效 | 两条热应用路径**收敛到 `lib/patch-utils.js:hotApplyFiberConfig()`**（能力探测 + 失败回落"需重启"提示，**永不抛**）；`integration-check` 三条探针钉住 `Fiber.update(config, noSave)` 签名、其文档语义、以及 loader 消费 `noSave` 的 `internal/update` 钩子 |
| ⚠ `ctx.typert.register` 描述符 | 14 个命名空间的 RPC 面 | 包级 `schemas:[]` 为空，但 87 个 wire 已挂 `mode:strict` 边界校验（见下） | `lib/rpc-manifest.js` + `lib/rpc-schema.js` + `verify-rpc-schema` |
| ⚠ `workspaceRegistry.unarchiveSession` 等动词 | 归档集清理 / 取消归档 | 版本间增删 | 挂载期能力探测 + 显式降级警告 |
| ⚠ `agentPresets.acquireScope` 租约 | 读取预设 skill 作用域 | 与宿主 `dsh-webhook` 同款用法，属半公开 | 读毕即 dispose；失败逐作用域降级 |
| 客户端 `slots.entries` 装配时点 | native-coverage 官方覆盖探测（自动让位） | 探测读的是 slot 列表，官方面板可能晚于本插件 `apply()` 才声明 | **v1.32.0 起已收敛**：结论不再冻结于开机快照，`impl.js` 订阅 `COVERAGE_SLOT_KEYS`（由表内 `signals` 派生）并在任一键变动时重算+对账，所以晚到的官方声明会在同一次会话内生效；`localStorage dsh-admin-panels` 仍可强制开关（native-coverage.js 的 TIMING ASSUMPTION 注释已同步改写） |

## 接缝矩阵（Phase G）

`scripts/integration-check.mjs` 读取 dsh 的 **TypeScript 源码**（源码是事实来源，不需要构建），断言插件所依赖的每一条接缝仍然存在；`scripts/check-matrix.mjs` 把同一份探测**并行地跑在多个 checkout 上**，于是"支持哪些 dsh 版本"从文档承诺变成可执行事实。

```bash
# 单个 checkout（默认取 $DSH_CHECKOUT，再退回同级 deepseek-harness）
npm test

# 多版本矩阵：逗号/分号分隔；隐式回退时没有 dsh 的目录记为 SKIP（不算失败），
# 任何一个存在的 checkout 契约漂移则整体失败。
DSH_CHECKOUTS="D:/dsh/0.2.1-rc.4, D:/dsh/next" npm run test:matrix
```

**CI 里两者都不是可跳过的**：`.github/workflows/ci.yml` 的 `test` 作业先 `actions/checkout` 一个 pin 住的 dsh（`deepseek-ai/deepseek-harness@dsh-v0.2.1-rc.4`，公开仓库、`fetch-depth: 1`、不安装不构建）并把路径交给 `DSH_CHECKOUT`；`seam-matrix` 作业再 checkout **三档**——验证基线 `0.2.1-rc.4`、支持下限 `0.1.7-rc.2`（回归哨兵：基线证明插件在用户当前版本上可用，这一档证明它在**声明承诺支持的最老版本**上仍可用，只有下限本身移动时才删）、以及 `master` 预警行（例行重构应当通过，契约变化必须先在这里响）。**CI 下没有 checkout 就是失败** —— 跳过接缝契约探针与全部通过会打印同样的绿灯，那正是上游漂移能溜进发布的路径。

矩阵当前覆盖的契约数以 `integration-check` 实际输出为准（历史快照曾为 93/112/124），其中与插件自身最新能力直接相关的几条：

| 接缝 | 探测来源 | 谁在用 |
|---|---|---|
| `slots.entries(key)` 返回 `StoredEntry[]` | `packages/client/ui-slots/src/index.ts` | Phase E 的官方优先自动让位（读不到条目就不让位） |
| `slots.inject(key, callback)` 的声明生命周期（已声明即同步运行、折叠后重跑） | `packages/client/ui-renderer/src/client/registry.ts` | 面板注入：**声明在 renderer 而不是 ui-slots 包里**，只查 ui-slots 会漏掉整条注入路径 |
| `slots.register(options: ErasedOptions, component)` + `ErasedOptions.name/id/order/inject` | `packages/client/ui-slots/src/index.ts` | 面板注册（插件传的四个键） |
| `locale.register/bind/subscribe/setLocale` | `packages/client/locale/src/client/index.ts` | Phase C 的客户端本地化与语言切换 |
| `WebRoute { kind: 'prefix' \| 'exact', path, handler(req,res) }` | `packages/host/webserver/src/index.ts` | Webhook 入站端点（Phase F4 的加固读 `req.socket.remoteAddress`） |
| `commands.register(definition)` + `CommandInvocation.agent/rawInput/attachments` | `packages/interaction/commands/src/index.ts` | 命令钩子（handler 解构这三个字段）与 `/workflow` 斜杠命令 |
| `session/created` / `disposed` / `event` / `flush` 四个事件 + `Session.id/firstLiveSeq/header` | `packages/core/session/src/index.ts` | 用量台账的实时观察与 drain 时机（`lib/index.js:610-763`） |
| `sessions.get(id)`（宿主存活判定）+ `ISessions.refresh()/refreshProjections()`（客户端侧栏） | `packages/core/session/src/index.ts`、`packages/api/session-controller/src/client/contract/sessions.ts` | steer 前的会话存活校验；删除会话后立即刷新侧栏 |
| `llm.listProviders()` / `listModels(provider)` + `LlmProviderInfo` / `LlmModelInfo` | `packages/llm/llm/src/index.ts`、`types.ts` | 子代理面板的 provider / model 下拉（缺了就退化成空列表） |
| `storageDomain.get(name)` → `table(name).delete(key)` | `packages/storage/storage-domain/src/index.ts`、`domain.ts` | 删除会话时立即清掉 projection cache（否则侧栏残留到刷新） |
| `subagentModelSelection` 服务键 | `packages/subagent/tool-subagent/src/model-selection-settings.ts` | 子代理入口校验里的"模型选择是否可用" |

漂移时的处理顺序：先 diff 探测点名的文件，确认是**契约变化**还是**例行重构**；契约变化要先改插件适配，再更新探测针。探测针只钉稳定且承重的行——例行重构应该通过，契约变化必须报警。
## 官方覆盖与让位（Phase E）

面板是否注册由 `src/client/native-coverage.js` 的探测表决定。**v1.32.0 起让位有三个粒度**（表的 `scope` 字段，与本表同源，改探测逻辑时两边一起改）：

| `scope` | 含义 | 命中后的行为 |
|---|---|---|
| `panel` | 官方页面**就是**等价管理页 | 整个面板不注册（不是隐藏、不是禁用） |
| `tabs` | 官方只覆盖面板内的**部分页签** | 面板照常注册，只有列出的页签消失 |
| `none` | 官方有相近面但**不等价**（或客户端看不见） | 全部保留，只在挂载日志里记一条重叠说明 |

`localStorage['dsh-admin-panels']` 可用逗号分隔的面板 id 强制要回某个面板（对 `tabs` 行同样生效：强制即恢复全部页签）。

**为什么 v1.32.0 改粒度**：v1.29.0 的表把任何命中都当成「整页被覆盖」，这只在官方页与我们的页职责相同时成立。
三处不成立，其中一处是**功能消失**：`ui-schedule` 是任务页，而「自动化」是三个页签（定时任务 / Webhook / 工作流）——
按整面板让位，装了官方任务页的用户会连 Webhook 入站与工作流一起丢掉，而上游 `packages/client/**` 里
**这两者根本没有页面**（`packages/hooks`、`packages/mcp` 连 `src/client` 半都没有）。子智能体与 Web 搜索是
另一类：官方子页只配置深度/容量/模型、官方 provider 页只配置官方 provider，而插件做的是「编写侧」与「provider 装卸切换」，
所以改为保留并在日志里说明重叠。

| 面板 | 官方对应（0.2.1-rc.4） | 探测信号（客户端） | `scope` | 当前结论 |
|---|---|---|---|---|
| 扩展插件 | 插件侧边栏页 `ui-plugin-manager` + 插件列表页签 `ui-settings-plugin-inventory` | `sidebar.panellist` 有 id `plugins`，或 `settings.plugins.tab` 有 id `all` | `panel` | **让位**（探测命中即不注册；装/卸/启停四个动词与官方页相同） |
| MCP 服务器 | 无（仅宿主 `mcp-client`） | — | `none` | 保留（上游无 client 半） |
| 技能 | `ui-skill`（`/` 触发与调用卡片） | — | `none` | 保留（全量清单无官方页） |
| 子智能体 | `ui-settings-subagent`（深度/容量/模型） | `plugins.item` 有 id `subagent` | `none` | **保留**（官方子页不含编写侧：具名委派实例 / persona / 工具约束 / CLI 后端） |
| 命令 | `ui-commands`（客户端命令 API） | — | `none` | 保留（文件化管理无官方页） |
| 钩子 | 无 UI | — | `none` | 保留 |
| Web 与会话 | `ui-workspace`（浏览/归档/重命名/分叉） | — | `none` | 保留（批删/导出/体检无官方页） |
| Web 搜索 | `ui-settings-web-search`（官方 provider 配置页） | `plugins.item` 有 id `web-search` | `none` | **保留**（官方页只配官方 provider；provider 装卸切换无官方页） |
| 用量仪表盘 | 无 | — | `none` | 保留 |
| 自动化 | `ui-schedule`（宿主级任务页 + cron 编辑） | `sidebar.panellist` 有 id `schedules` | `tabs`（`cron`） | **仅让出「定时任务」页签**；Webhook 与工作流保留 |
| 待办清单 | `ui-conversation` TodoPanel（`conversation.input.dock` id `todo`） | `conversation.input.dock` 有 id `todo` | `panel` | **让位**（同一 dock 位放两份待办就是重复） |

**已实现的探测（5 行）**：扩展插件、子智能体、Web 搜索、自动化、待办清单——每一条都读**上游源码里真实注册的 slot id**（`ui-plugin-manager` 的 `sidebar.panellist`/`plugins`、`ui-settings-plugin-inventory` 的 `settings.plugins.tab`/`all`、`ui-settings-subagent` 与 `ui-settings-web-search` 的 `plugins.item`、`ui-schedule` 的 `sidebar.panellist`/`schedules`、`ui-conversation` 的 `conversation.input.dock`/`todo`），并都有注释标明 file:line，便于上游重构时按图索骥。**探测为真不等于让位**——上表最后两列分开，正是因为五个真探测里只有**两个**会真正退场：`extensions`（`panel`）与 `todo`（`panel`）；`automation` 只让出一个页签（`tabs`），`subagents` 与 `webSearch` 一行都不让（`none`）。

**探测何时生效（v1.32.0）**：探测读的是 shell 的 slot 列表，而官方面板可能在**本插件 `apply()` 之后**才声明（见上文「客户端 `slots.entries` 装配时点」那行风险）。因此结论不是开机快照：`impl.js` 订阅 `native-coverage.js` 导出的 `COVERAGE_SLOT_KEYS`（由表内每行的 `signals` 派生，导入期校验 `signals` 必须被 `detect()` 真的读到），任一键有声明变动就重算并按需对账。**没有 `signals` 的行会在导入期直接报错**——那正是「结论被冻结」这个 bug 的成因，不允许静默复发。

**未实现的探测（6 行，仍恒为 false → 面板保留）**：MCP 服务器、技能、命令、钩子、Web 与会话、用量仪表盘。这是刻意的：**探测不到就不让位**——把看不见的东西当作"已覆盖"会让功能凭空消失；这六项要么上游没有对应 UI（`mcp-client` 只有宿主半、hooks 只有文件），要么上游只有调用侧/浏览侧而非等价管理页（`ui-skill` 的触发卡片、`ui-commands` 的客户端命令 API、`ui-workspace` 的浏览/归档），要么根本没有第一方实现（用量台账）。后续上游补齐（例如官方 MCP 管理页）时，只需给对应行加一条 `hasSlotEntry(...)` 探测，并同步本表。

## 会话行菜单与界面语言（客户端契约）

这两块原先都建立在**脆弱假设**上，本轮换成公开契约；依据全部读自上游源码（`packages/client/**`），不靠记忆。

| 能力 | 旧实现 | 现在 | 依据（上游源码） |
|---|---|---|---|
| 会话「…」行菜单 | DOM 抓取：按 `aria-label` 文案挑按钮 → 用菜单矩形几何反推最近一行 → 按 `归档会话` / `Delete workspace` 字面量判断菜单种类 → 再按 DOM 标题对 `sessionAdmin/list` 做模糊匹配拿 id（`impl.js` 旧 `setupMenuInjection`） | 注册 `sidebar.workspaces.session.menu.item`（`kind: 'list'`, `scope: 'root'`, owner `SessionRowOwnerProps` 直接给 `sessionId`），条目 id `plugin-admin.delete-session`（order 460），删除走 `sessionAdmin/closeSession`（在线/已结束都由它处理，故不再需要 list 快照）；**未捕获 handle 的在线会话**不再要求重启 dsh——`recoverLiveAgentHandle` 从存活 agent 重建 teardown（cancel → whenIdle → scope.dispose → 两个 registry 的 `detachEntered`），原语缺失时才退回重启提示 | `ui-workspace/src/client/contract/slots.ts:186-195`（slot 定义）、`:78-83`（owner props）、`:164-185`（注册示例）；`lib/session-admin.js:1712-1769`（closeSession 对两种状态都正确）、`:693-800`（重建 teardown 的降级路径） |
| 工作区「…」菜单 | 同一段 DOM 抓取里的工作区分支（`在资源管理器打开`）：按菜单矩形几何反推最近一行 → 用 DOM 标题对工作区做模糊匹配拿路径 | **改由结构性 DOM 钩子承担**（`src/client/workspace-menu.js`，唯一一处 DOM 注入）：上游没有工作区行菜单 slot，`ProjectRowItem` 里 rename/delete 两行是第一方硬编码。钩子只认结构——点中 `[data-row-key="workspace:<id>"]` 即取 `<id>`（`groupByWorkspace` 传的就是 `workspace.workspaceId`），等 1 秒内新出现的 `[role="menu"]` 把「打开工作目录」追加到末行（即「删除工作区」下方）；**不读任何菜单文案**，也不做标题模糊匹配。目录由宿主侧 `workspaceAdmin/list` 按 id 解析，再走 `fsAdmin/reveal`（该 RPC 自身还有 `assertRevealablePath` 闸门），客户端不猜路径 | `ui-workspace/src/client/rows/Rows.tsx`（`ProjectRowItem`：`data-row-key` 与硬编码 `workspaceMenuItems`）；`packages/workspace/workspace/src/index.ts`（`workspaceId` 即分组键）；`lib/workspace-admin.js`（`list` 投影 `workspaceId`/`path`）、`lib/workspace-path.js`（reveal 闸门） |
| 界面语言 | 工具栏胶囊写 `localStorage['dsh-admin-lang']`、必要时 `window.location.reload()`，且 `locale` 服务只在 `apply()` 时读一次（服务晚到则永久回退中文源串） | 语言归属宿主：切换只经 `locale.setLocale(id)`（宿主唯一用户偏好写入口，自带持久化与通知）；宿主未提供该能力时控件禁用并说明原因；`locale` 经 `ctx.inject(['locale'], …)` 等待，晚到也能挂上 | `packages/client/locale/src/client/index.ts:256`（setLocale 语义）、`:588`（`ctx.provide('locale', …)`）、`:403-423`（`register(ns, locale, dict)` 及其非法/重复抛错）、`:622`（第一方语言选择器位置） |

**取舍说明**：`dsh-admin-lang` 键**只读不写**，仅在"服务尚未到位/无宿主"的替身环境里充当兜底种子（大量 verify 脚本与基准跑在无 locale 服务的伪 ctx 上）；真实宿主里它不参与任何决策。菜单条目的 `inject` face 与组件作为 `register(options, component)` 的**第二个参数**传入（`ui-slots/src/index.ts:1207`），而不是塞进 options。

## 真实宿主冒烟（L3）

前面三节都是"不启动宿主"的验证：`host-check` 用替身 ctx 挂载、`self-check` 用 jsdom 跑面板、`integration-check` 只**读** dsh 源码。它们能证明契约还在，但证明不了"loader 组出了我们的行、服务却根本没挂上"、"客户端 bundle 没进模块表"、"网关不认我们的描述符"这类事。`scripts/smoke-real-host.mjs` 补的就是这一层：

```
npm run smoke:real-host          # 需要 PATH 上有 dsh 与 pnpm（dsh 用它安装 profile 依赖）；缺任一则 SKIP
                                 # CI 里用 SMOKE_REQUIRE_DSH=1 让"缺工具"变成失败而不是静默跳过
```

它**只用一次性目录**（`mkdtempSync` 做 `DSH_HOME`，从 dsh 自带的 web 模板生成 profile，用 `dsh plugin … add link:<repo>` 装本插件），跑完在 `finally` 里杀掉进程树并删目录 —— **绝不碰你真实的 `$DSH_HOME`**。断言四件事：

| 阶段 | 断言 | 抓的是什么 |
|---|---|---|
| 1 组合 | `dsh <profile> --dump-config` 里出现 `- id: dsh-plugin-admin / name: dsh-plugin-admin` | 宿主 loader 读到了我们包里的 `dsh.bundle.patch` 并把行组合进配置树 |
| 2 启动 | Host 打印带 token 的 URL | 插件存在时宿主能正常 boot（挂载抛错就会在这里断） |
| 3 浏览器半 | shell 的模块表里有 `plugins/??dsh-plugin-admin/client.js`，且取回的是**我们的字节**（`PluginsSection` 等标记） | `dsh.client` 清单被发现、产物被真实 web 服务端出来 |
| 4 RPC | `POST /api/pluginAdmin/list` 返回 `ok:true` 且列表里是本插件；另用畸形信封确认网关回 `gateway/bad-request` | 服务真的挂上了、typert 描述符真的注册了（网关只受理已声明端点）、strict codec 真的校验了参数 |

实测：当时基线 dsh `0.2.0-rc.1` 上 **28/28 通过，约 11–30 秒**（该数字尚未在新基线上复测；接缝契约探针则在 `0.2.1-rc.2`、`0.2.1-rc.3` 两个 tag 与上游 HEAD——rc.3 之后 1533 个提交——上都是 148/148 通过）；其中第 5 步用 **21 次只读调用覆盖 14 个命名空间里的 13 个**（`fsAdmin` 唯一豁免：它只有 `reveal`，会在宿主上打开文件管理器），并显式断言**没有任何端点撞上 Cordis 的 scope guard**。CI 里 `host-smoke` 作业跑同一套（装 pin 住的 dsh + pnpm → `npm run smoke:real-host`，`SMOKE_REQUIRE_DSH=1`、`SMOKE_REQUIRE_BROWSER=1`）。

v1.25.4 起还有两步：

- **步骤 6 · 写路径**：`cronAdmin/upsert`/`remove` 真的写进一次性 `$DSH_HOME` 的 `cron-tasks.json`；`pluginAdmin/setEnabled` 在真实 profile patch 写/删 `disabled: true` 行（F1 锁 + 原子 rename + hot-apply），并用 `pluginAdmin/list` 的 `disabled` 字段做往返断言；两次写都由 `admin-audit.jsonl` 留痕。靶子是一个冒烟自己生成的 no-op 插件 —— **不能拿我们自己的行当靶子**：禁用它会卸载正在服务这次调用的服务。
- **步骤 7 · 真实浏览器**：headless Chromium + 原生 CDP（Node 内置 `WebSocket`，零依赖）打开真实 shell，断言无未捕获异常，并在点开设置后断言**我们自己的 `settings.section` 文案**（`用量仪表盘` / `自动化`）出现在 DOM 中 —— 只存在于我们 i18n 表的文案出现，即证明客户端 bundle 被真实 shell 执行并挂载。**注意别用侧栏的「插件/会话」当断言**：那是 shell 自带 plugin manager 与会话列表的入口，第一版冒烟正是这样误判的（已改正并伪证锁住）。缺浏览器则 SKIP，CI 用 `SMOKE_REQUIRE_BROWSER=1` 强制。

**它第一次跑就抓到一个生产 bug**（v1.25.3 修）：`projectAdmin/list` 直接读 `ctx.workspaceRegistry`，而该服务不在插件的 `inject` 声明里 —— 真实 Cordis 抛 `cannot get property "workspaceRegistry" without inject`，面板拿到 `gateway/internal`。**所有替身 ctx 的检查都看不见它**（假 ctx 没有 scope guard，host-check/self-check/30 个 verify 全绿）。同一类问题在 `lib/subagent-admin.js` 还有 4 处（`ctx.get(…) ?? ctx.<service>` 形式的回退），由随后的静态闸门抓出。因此这一层与 `scripts/verify-service-injects.mjs`（扫描 `lib/**` 里未声明的直接服务读取，进 `npm test`）是配套的：**冒烟覆盖它调用的路径，静态规则覆盖写入路径与冷分支**。

这条不放进 `npm test`：它需要真实 `dsh` 且要起进程，属于"重量级但承重"的独立闸门，而不是每个开发者每次都要跑的 40 个脚本之一（`npm test` 共 45 步 = 5 道静态闸门 + 这 40 个脚本）。

## profile 包管理器 pin（C-2）

插件的装/卸/更新**不再**用 `PATH` 上的 `pnpm`：`runPnpm` 先读 profile 的 `package.json`，把其中的 Corepack pin（`"packageManager": "pnpm@11.28.5"`，可带 `+sha512…`）解析成 `corepack pnpm@<version>` 再执行——与宿主 `profile.packageManager ?? { command }` 的口径一致，保证写 `pnpm-lock.yaml` 的版本就是 profile 自己声明的那个。

- **没有这个字段**（老 dsh 建的 profile 就是如此）：用内置默认 pin **`11.28.5`**（与 dsh 仓库根同款），并**每个进程告警一次**，提示到 `<profile>/package.json` 里加 `"packageManager"`；仍然是显式 Corepack 版本，不是 PATH 上的 `pnpm`。
- **字段存在但不可用**（版本区间、dist-tag、`yarn@…` 等）：**直接拒绝**并指向该字段——那是配置错误，不是缺省，拿错管理器改写锁文件正是 C-2 要消除的漂移。
- 缺 Corepack（或 `corepack` 不在 PATH）时同样给出指名错误，不退化成裸 `pnpm`。

## Webhook 入站的信任模型（C-5，**已决策：不签名**）

入站端点 `/webhook-triggers/<ruleId>` 只做**静态共享密钥**认证，不签 body、不签时间戳：

- 默认**仅本机**（`webhookAllowRemote !== true` 时非回环、以及无法报告对端地址的传输层一律 403，且该闸门跑在方法与 Content-Type 检查**之前**，远程扫描器拿到的是统一的 403 而不是路由存在性预言）。
- 每个规则一条 ≥16 字符的 `secret`，比较走 SHA-256 等长化 + `timingSafeEqual`；"规则不存在/已停用/未设 secret/secret 不匹配"共用**一个** 401，避免规则枚举。
- 有每调用方请求预算（默认 60/min，回环字面量折叠成单桶）与认证失败刹车（10 次），body 上限 1 MiB 且必须是 JSON 对象。
- 重投去重靠调用方自报的 `x-webhook-delivery`（≤200 字符，环 512 条、持久化）。

**为什么不加 HMAC / 时间戳**（本轮决定，理由要写清而不是留白）：

1. 要伪造一次投递必须先拿到 `secret`；而 `secret` 存在 profile 目录的 `webhook-triggers.json` 里，**能读到它的本地进程本来就能直接走 `/api` RPC**——签名对这条路径不增加任何难度，只是让合法的本地集成多写一段 HMAC 代码。
2. 远程面默认关闭。真要靠远程投递，链路安全性应由**传输层**（TLS + 反代）承担，而不是在应用层再发明一套签名协议；且时间戳方案需要定时钟容差、密钥轮换与多密钥并存窗口，这些是产品决策，不是本轮审计能单方面定的。
3. 重放的实际危害被"去重集 + 动作幂等性"限制：重复投递同一 `x-webhook-delivery` 不会重复执行动作；伪造一个新的 delivery id 需要 `secret`，回到第 1 条。

**因此 C-5 的处置是"记录 + 约束"而不是"修"**：一旦有部署要开 `webhookAllowRemote`，**先**补 body 签名与时间戳（届时需要同时定算法、容差与轮换），并把该开关的文档措辞一并升级。这句话就是那条前置条件。

## 已知边界（并发写）

跨进程写保护（Phase F1/F2）的适用面是**明确的**，不等于"所有落盘都安全"：

| 文件 | 读-改-写 | 说明 |
|---|---|---|
| `cordis.patch.yml`（profile patch） | ✅ 锁内 `mutatePatch` / `mutateProfilePatch` | 21 处写入点全部走它；锁跨 读 → 变换 → 写 |
| `cron-tasks.json` | ✅ 锁内 `mutateTasksStore` | `upsert` / `remove` / `toggle`；校验看到的 id 集就是写入替换的修订 |
| `webhook-triggers.json` | ✅ 锁内 `mutateRulesStore` | `saveRule` / `deleteRule`；"空 secret 继承已存值"查的也是锁内那一份 |
| `usage-ledger.json` | ✅ 锁内 `withFileLock` 读-合并-替换 | 跨进程锁内重读磁盘 + 与内存镜像取并集（`unionUsageEntries`，镜像优先），两实例写入不互丢 |
| `subagent-admin.cli.json`（通用 CLI 后端店） | ✅ 锁内 `withFileLock` | `cliUpsertGeneric` / `cliRemoveGeneric` 的受保护读、校验（providerName 集就是写入替换的修订）与写都在同一临界区；journal 是追加写、不受锁约束（与审计同姿态） |
| profile `package.json`、`admin-audit.jsonl`、`webhook-history.json` + `webhook-history.seen.json`、`workflow/runs/**` | ⚠️ 仅**原子写**（唯一临时名 + `atomicRename` 重试）；读-改-写靠**进程内**串行队列 | 同一 profile 同时跑两个 dsh 实例时这些文件仍可能丢一次更新 |

上表 ⚠️ 行的取舍与兜底：交付历史是**可重建的派生数据**（下一次投递会覆盖，且去重集已拆分减少写放大），审计是**追加写**（两个实例的行会交错，但不会互相删除；只有"到达上限压缩"那一步会以读-改-写覆盖），workflow journal 是单实例写入的产物。用量台账已在锁内实现"镜像 ∪ 文件"的合并（`unionUsageEntries()`），彻底消除了跨进程抹掉对方更新的窗口。

两条容易误判的边界：

- **交付历史的写放大 —— 已拆分**（原为"单文件双用途"）：`webhook-history.json` 现在只装历史环，`x-webhook-delivery` 去重集搬到派生路径 `webhook-history.seen.json`（`seenPathFor()`：仅换 `webhookHistoryPath` 的扩展名，**不是**新的 config 键，所以 30 键的配置面与 host-check 的键集断言不变）。一次投递仍是两次写（先落去重集、动作后再落历史行，两次都有意为之：第一次保证崩溃后重投不会重复执行），但**每次写只承担自己的上限** —— 过去 200 条历史 + 512 条去重合成一份、整份重写两遍（约 1400 条 JSON/投递），且 `webhookHistoryCap` 还会放大去重写的成本。老版本留下的合并文件仍可读：挂载时把内联的 `seen` 列表**先**写进新文件（在任何一次历史写把该键丢掉之前），因此升级不会遗忘已认领的投递 id。历史本身仍是 JSON 整份重写（**建议 `webhookHistoryCap` ≤ 1000**）；要再降一档需把历史改成 JSONL 追加（尚未实现）。
- **`withFileLock` 默认是失败关闭的（v1.29.0 / C-9 起）**：等不到锁就**拒绝这次写**，抛 `plugin-admin: … lockWaitTimeout …`（含锁文件路径、持有者 pid、目标文件与该做什么），由 RPC 错误信封交给调用方——语义是"宁可让操作重试一次，也不静默丢一次更新"。**旧的失败开放仍保留，但必须显式要**：`{ onTimeout: 'proceed' }` 才在预算耗尽后无锁继续，且同一把锁每个进程只告警一次；目前只有一个调用点这么用（`plugin-admin.js` 里 install/remove 失败路径的清单回滚，理由见代码注释）。原子 `temp + rename` 仍然保证文件不会被撕裂；抢占（过期锁 / 持有者已死）后带 5ms + 随机退避重试，**无主的半写锁在 250ms 内不会被抢**（`open(…,'wx')` 与写入 pid 之间的窗口），所以两个实例不会同时进入临界区。跨进程丢失更新的窗口因此只剩"两个 dsh 同时写同一个 profile"时那一次**被拒绝并提示重试**的写 —— 这也是上表三件"锁内"文件仍要覆盖读-改-写整体的原因。

## 裸色值与深色主题（N-14/N-15，**已决策：不批量 token 化**）

v1.29.0 的修复轮跳过了「160 处裸色值换 token」，理由是「状态色换成 token 会改浅色色相，而本轮没有截图回归能力」。本轮补上了截图能力（`npm run screenshots`），并把那条判断**量化验证**了——结论是原判断正确，但理由需要写准，否则下一个人会再来一遍。

**普查口径**（数字与修复轮一致，但含义更精确）：`src/client` 下 322 处十六进制字面量里，168 处位于 `var(--token, <fallback>)` 的兜底位——那是**正确**写法，不是债；真正「没有任何 token 兜底」的裸值 **161 处**（styles.js 111 / workflow 25 / automation 13 / sessions 8 / 其余 4）。

**为什么这 161 处不能批量换 token**——三个各自独立的理由，任何一个都足以否掉批量替换：

1. **没有语义正确的 token。** 裸值绝大多数是「实心徽章」的固定底色 + 固定白字（`.danger-solid` `#b91c1c`+`#fff`、`.tag.plugin` `#15803d`+`#fff`、toast 的 `rgba(16,185,129,.95)`+`#fff`）。上游只提供 `state-*-primary/secondary/tertiary` 这类**文字色**与 `*-tertiary` 浅色填充，**没有**「状态容器底色」别名。把徽章底色映射到任何现成 token 都是借用别的语义。
2. **只换字色会让深色主题崩掉。** 唯一字面值精确相等的候选是 `--dsw-alias-label-primary-foreground`（浅色 `rgb(255,255,255)`，深色 `rgb(15,17,21)`）。实测 WCAG 对比度：把 28 处 `#fff` 换成它之后，深色主题下同一批徽章的「字/底」对比度 **7/7 全部下降**，其中 5 处跌破 4.5（`#b91c1c` 6.47→2.92、`#1d4ed8` 6.70→2.82、`#6d28d9` 7.10→2.66、`#991b1b` 8.31→2.27）——**从可读变成不可读**。
3. **`#ef4444` 与 `state-error-primary` 并不等值。** 浅色主题下后者是 `rgb(236,19,19)`，前者是 `rgb(239,68,68)`；替换即改浅色色相，正是修复轮担心的那件事。

**当前配色的实测状况（这才是 N-15 的答案）**：实心徽章的「字/底」对比度在**两套主题下相同**（6.47 / 8.31 / 5.02 / 6.70 / 7.10，全部 ≥ 4.5），因为字与底都不随主题移动——这是**自洽**而非缺陷。徽章与页面底色的对比度在深色主题下降（1.89–3.13），但那是图形边界而非文字可读性，且色块本身仍然清晰可见。

**因此本轮的实际处置**：

- 新增 `scripts/screenshot-panels.mjs`（`npm run screenshots`）：真机起 web profile、headless Chromium 走 CDP、逐面板 × 亮/暗两套主题截图到 `.screenshots/`。**它是基线采集器，不是像素闸门**——没有入库的基准图可对比，字体/渲染差异会让闸门变 flaky；把它升级成闸门需要先决定基准图放哪。
- 深色主题维持现状：`--dsw-alias-*` 已经自适应，插件只补 token 表达不了的两处（原生控件 `color-scheme`、工具栏投影）。**不**为实心徽章发明 token。
- 将来若上游提供「状态容器」别名（例如 `state-error-container`），届时可以一次性把徽章底色 + 字色成对迁移——那才是真正的清理，且必须**成对**改，不能只改一半。

**这条决策的反面证据保留在脚本里**：`npm run screenshots` 采到的图可直接用于「改前/改后」目检；任何想重做这件事的人应该先跑它、按上面的对比度口径复算，再决定。

## 版本策略

**支持下限：dsh ≥ 0.1.7-rc.2**，**声明上界：dsh < 0.3.0**（**验证基线已升到 0.2.1-rc.4**：CI 主门禁、`host-smoke`、`smoke-published` 与 `seam-early-warning` 都跑基线档，`seam-matrix` 另留下限档作哨兵）。 自 v1.25.0 起不再支持 dsh 0.1.6，这是**已决策**（不再是"待定"）：

**为什么 v1.32.0 才补上界**：`engines.dsh` 一旦存在，宿主兼容闸门就「it decides alone」
（`packages/boot/app-boot/src/plugin-compatibility.ts:55-60`：有 `engines.dsh` 则独自裁决、忽略 peerDependencies）。
v1.29.0 之前这个字段根本不存在，于是闸门永远放行；v1.29.0 补了 `>=0.1.7-rc.2`，但没有上界 ——
一个硬依赖 25 个宿主服务面与 6 条客户端 slot 契约的插件，在 0.3 / 1.0 上也会被放行，而跨 minor 必然漂移。
现在写成 `>=0.1.7-rc.2 <0.3.0`：左端是**实测过的**最老版本，右端是**尚未验证**的第一个 minor。
上界只在验证推进时才抬（例如基线搬到 0.3 并跑通后改成 `<0.4.0`），不提前放开。

- 客户端直接静态引用平台共享模块（`@deepseek-ai/dsh-client-ui-primitives` / `-ui-slots` / `-client-store`，见 `scripts/build-client.mjs` 的 `PLATFORM_BASELINE`）与 `ctx.locale` 服务：0.1.6 的宿主模块表里没有这些 seed，缺一项就是**整包加载失败**，而不是降级。既然实现里已经没有 0.1.6 的回落分支，"继续支持 0.1.6"就只是一句与代码不符的承诺，本次把口径改成事实。
- 保留的"先探测、后降级"分支（如 `agentPresets.acquireScope` → `standingKeyFor`、`fiber.update` 能力探测、`workspaceRegistry.unarchiveSession` 的缺失告警）是**同一范围内的防御性探测**（0.1.7 的 rc 与正式版之间、以及未来版本删动词时用），不是 0.1.6 支持。
- 升级一台 0.1.6 的宿主前请先升 dsh；插件在 0.1.6 上的失败模式是"客户端整包不加载"，不会有半可用状态。
- CI 矩阵**已落地**（`.github/workflows/ci.yml`）：`test` 作业对 `dsh-v0.2.1-rc.4` 跑完整 `npm test`（含接缝契约探针，无 checkout 即失败），`seam-matrix` 作业对 `dsh-v0.2.1-rc.4`、`dsh-v0.1.7-rc.2`（支持下限哨兵）与 `master` 三档跑 `npm run test:matrix`。加一档新版本只需往 `DSH_CHECKOUTS` 里加路径。当前探针数为 `integration-check` 实际输出为准（历史快照曾为 93/112/124，新增探针只增不改旧数）。
