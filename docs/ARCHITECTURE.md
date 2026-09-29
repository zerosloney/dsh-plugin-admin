# 架构与安全（dsh-plugin-admin）

> 本文自 v1.26.x 起从 README 搬家而来（README 收敛为一页式）：源码结构、写回与降级机制、各面板的机制细节、可调配置参考、信任边界与安全、测试与接缝契约。dsh 版本兼容矩阵与「让位」策略另见 [docs/COMPAT.md](COMPAT.md)。

## 1. 总体形态

插件分两半，**零 dsh 导入**是一切的前提：宿主半与浏览器半都不 `import` 任何 `@deepseek-ai/dsh-*` 包，全部骑运行时的 Cordis Context（按服务键取服务 + 纯数据 typert 注册），这样插件才能跨 dsh 版本可活——缺的服务逐面板降级，绝不让整个插件挂掉。

- **宿主半** `lib/*.js`：直接入库、无构建步骤。14 个管理 RPC 命名空间在 `lib/index.js` 底部的单次 `ctx.typert.register()` 发布，描述符由 `lib/rpc-manifest.js` 单一真相表生成（见 §6）。
- **浏览器半** `src/client/` → 构建产物 `lib/client.js`（Phase B1 起）+ 懒加载面板 chunk `lib/client.panels.js`（Phase B2 起）：

| 文件 | 职责 |
|---|---|
| `src/client/index.js` | 入口：导出 `apply` 与 `inject`（dsh 模块加载器只读这两个键；`loadPanels` 随行导出供测试挂载面板 chunk） |
| `src/client/impl.js` | slot 装配（即时注册 + 首次渲染时拉取面板 chunk 的包装器）、locale 运行时绑定与共享辅助函数（经 `configure()` 递给面板 chunk） |
| `src/client/panels.js` | 十一个面板的实现，自成 chunk：主 bundle 只注册 slot，面板代码在设置页首次打开时按需加载（首屏 −80%） |
| `src/client/native-coverage.js` | 官方覆盖探测表 + 自动让位策略（Phase E）：官方 UI 补齐的能力自动隐藏对应面板，localStorage `dsh-admin-panels` 可强制开关 |
| `src/client/i18n.js` | 中英文案表与 `dshT()` |
| `src/client/styles.js` | 四组注入样式与各自的一次性安装函数 |

改完源码必须重建产物：

```sh
npm run build:client          # 写入 lib/client.js
npm run build:client --check  # 校验产物与源码一致（npm test 会跑这一档）
```

## 2. 写回、并发与降级

所有写回（插件启停 / MCP / 子智能体 / 钩子桥 / Web 搜索 / Webhook 运行时 / overlay）收敛到 `lib/patch-utils.js` 的 `writePatch()`——原子写（temp + rename）+ 改写前把上一版留为 `cordis.patch.yml.dsh-admin.bak`（滚动一版），写坏用 `.bak` 覆盖重启；全部走共享串行操作队列，读-改-写不交错；`withFileLock` 把备份 + rename 包进跨进程文件锁（失败开放 / 过期回收），双进程并发写同一 profile 无丢失更新。

依赖的 dsh 服务缺失时**逐面板降级**提示，绝不整插件不加载。改动 profile 配置的操作（插件安装/卸载/启停、MCP 新增/删除、Web 搜索、Webhook 运行时、overlay 启用）需重启 dsh 生效；例外是 MCP 已挂载条目的**编辑**（见 §3）。

## 3. 面板机制细节

### 🔌 扩展插件
pnpm 编排安装 / 卸载 / 更新 + bundles 清单同步。安装/更新完成后自动做 **dsh peer 兼容预检**：比对新装包的 `@deepseek-ai/dsh*` peerDependencies 与运行中的 dsh 版本（dsh 0.1.7 起宿主启动时会跳过不兼容 bundle）——不兼容时给出警示与 `dsh plugin allow-version` 豁免指引；解析不到运行版本时静默跳过。已停用插件跳过更新检测。

### 🕘 历史会话（Web 与会话 · 第一页签）
挂在设置 → Web 与会话的第一个页签，与 Web 搜索共用侧边栏入口、页内双页签，所有 dsh 版本下行为一致。原「工作区」面板已退役（各版本 dsh 均原生覆盖工作区管理）；宿主侧 `workspaceAdmin` 命名空间仍随插件注册（历史兼容 RPC 面，不是面板入口）。

批量删除的语义：在线会话自动先关停（closeSession）再删日志，其余直接删除（deleteSession）；单个失败不阻塞其余，结束汇总失败数。删除路径在物理删除前做 `lstat` 与 realpath 包含性校验（见 §5）。

### 📚 技能
只读全量清单，三层作用域合并——**全局层**、**每个 Agent 预设的 standing 作用域**、**每个已知会话的 (cwd, 预设) 作用域**。Web 部署（`dsh-web-app`）会把宿主层 `skill-filesystem` 行禁用、改由预设挂载本地发现，所以那里全局层为 0 属正常，用户目录（`~/.agents/skills`、`~/.dsh/skills`）由预设作用域列出。读取预设作用域会经 `agentPresets.acquireScope`（dsh 0.1.7 租约式，读毕即释放；旧宿主回退 `standingKeyFor`）确保该预设的 standing 挂载（只组合插件，不启动 agent / 会话 / 轮次），这是宿主侧读取预设层的唯一入口。严格只读：只调 `snapshot()` / `list()` 摘要，正文 loader `get()` 从不调用，不写任何东西；覆盖面 / 失败 / `complete` 旗标随行返回，残缺清单永远不会读成完整清单。

### 🔌 MCP 服务器
行级 CRUD + 真实握手探测（initialize → tools/list）+ 工具试调用台（tools/call，60s 预算、16KB 截断）。**已挂载条目的配置修改热应用至运行中的 server（无需重启）**：保存即通过 loader 同款 `fiber.update` 通道热重启对应 server（按 serverName 匹配，改名也生效；noSave 保证 patch 文件不被宿主改写）；**新增条目**与**删除**仍需重启（新 fiber 挂载是 loader 启动期职责）。热应用失败时面板显示具体原因并回退到重启提示。

### 🛰️ 子智能体
受管子代理（toolName / persona / 工具约束 / 模型 / 执行后端 / 委托深度 / 后台模式）作为 profile patch 行 CRUD + 运行中监控/续接；CLI 后端页签检测 codex / claude-code provider 包，并扫描 PATH 上其他 agent CLI（gemini / qwen / opencode 等）一键挂载或手填自定义命令。

### 🧵 工作流
agent 写 TS/JS 脚本并行编排子代理，执行底座是 `ctx.subagents`（宿主原生并行 + 可续接）。生命周期（journal / 状态机 / amend / resume）在 `lib/workflow-runs.js`，引擎只负责「把一段脚本跑完」。

**脚本 facade**：`agent(prompt, opts?)` 委派一个子代理（失败返回 `null` 不拖垮整体；`opts` 支持 `{ provider, model, schema }`，`schema` 命中时该步返回结构化值）；`parallel(thunks)` 信号量限流并行；`pipeline(items, ...stages)` 逐项流水线（任一 stage 抛出该 item 记 null）；`phase / log / report` 记进度；`ask(question)` 阻塞等回答（详情页行内作答，停止运行即拒答）；`shell(cmd, opts?)` 走宿主 shell（`opts` 支持 `workdir` / `timeoutMs`），返回 `{ exitCode, stdout, stderr, timedOut }`——**非零退出码是数据不是异常**，只有宿主 `ctx.shell` 不可用或运行被中止才抛出。

**realm 边界**：脚本跑在 `node:vm` 独立 realm，没有 process / fetch / require / fs 等宿主全局，且宿主返回值一律折成 JSON 文本再在 realm 内重建（`args`、`agent()`/`shell()` 返回值、`parallel()`/`pipeline()` 数组、rejection 里的宿主 Error 都不带宿主原型链进 realm）；首个 `await` 之前的同步前缀有 V8 vm timeout 预算，一行死循环会在预算处被掐断而不是冻住宿主。**这不是硬安全边界**：脚本与宿主同进程同信任级，真正的权力来自 `agent()` 与 `shell()`（后者跑真实宿主命令，受调用会话的沙箱策略约束）——要硬边界得放子进程（宿主 PTC 工作流的做法）。**顶层 `return` 必须是 JSON 值**（循环引用 / BigInt 让运行判 errored 而不是产出损坏记录）。

**生命周期**：停止对忽略取消信号的卡死脚本有 10s 落定预算——超时回报 `abandoned` 并写 journal，此时「改建」被拒绝（防新旧双跑）；续跑/改建默认回原会话（已下线时报错并给出会话 id，可换其他在线会话 override）；宿主重启后 stopped / errored 的运行仍可列出并续跑（「孤儿」标记 `orphaned` 是读取时按父会话是否在线派生的，不落盘）。**步骤缓存键是 `站点序号:kind:sha256(prompt + 语义 opts)`**——`agent()` 的 provider/model/schema 与 `shell()` 的 workdir/timeoutMs 进键，只改这些会让该步重跑，改 `args` 而 prompt 不变仍命中。

**工作库**：保存到全局 `$DSH_HOME/workflows/saved/` 或项目 `<workspace>/.dsh/workflows/`（随仓库走，项目覆盖全局同名）。**项目根必须已存在**，且显式传入的项目根只能是**调用会话自己的树**或**本 dsh 实例已知的工作区**——模型传的 `workspacePath` 与浏览器 RPC 的 `spec.workspacePath` 都按这条闸门校验，任意目录会被拒绝（否则提示注入就能借它在任意路径建树写文件、或删文件）；`<workspace>/.dsh` 若是指向项目外的符号链接/junction 同样拒绝。保存作用域自动识别：会话内经工具保存且未指定 scope 时，调用会话有 cwd → 存项目；识别不了 → 工具回 `needsScopeChoice`，由模型转问用户「存项目还是全局」，带选择重调；`delete_saved` 对称识别。

**模型工具 `workflow_admin`**（单工具 + action 枚举）：create / amend / resume / stop / list / get / answer / eval / save / run_saved / list_saved / delete_saved；`eval` 干跑（同一次工具调用内 await 完成、不起后台运行，`agent()` 桩化、`shell()` 直接报错，零子代理成本）供模型先验证语法与控制流；`wait: true` 阻塞到落定再回结果摘要。名字刻意避开 dsh 内置 `workflow` 工具（全局层同名注册会抛错）。

**斜杠命令 `/workflow`** 随插件挂载自动注册（与既有命令重名时只降级告警）：`/workflow create <任务描述>`（任务 steer 给当前会话的模型 → 生成脚本 → eval 干跑 → create 后台启动并回报 run id）、`/workflow [list]`、`/workflow run <名称> [argsJSON]`、`/workflow runs`、`/workflow stop <runId>`。

TS 脚本需要 esbuild（**可选** peer dependency：不装也能用纯 JS 工作流，TS 脚本给出明确诊断而不是静默失败）。运行与工作库落 `$DSH_HOME/workflows/{runs,saved}/`。

### ⌨️ 命令与钩子
命令保存即实时注册（fs.watch），会话里输入 `/名称 <输入>` 使用；JSON 导出/导入批量迁移（同名跳过）。钩子编辑 hooks.json 保存即热重启桥；「停用」移入 hooks.disabled.json；桥三态横幅（未安装 → ⚡ 安装并挂载 → 重启）；Codex 兄弟桥同页第二条状态条。项目 hooks 与官方 hooks 桥共用同一默认超时（单钩子 10 分钟，dsh 官方 hook 协议默认值；可用 hooks 配置里的 `timeout` 按钩子覆盖）——若干挂起的钩子会串行拖慢当前轮次，可用轮次取消中断。

### 🤖 定时任务（自动化 · 第一页签）
**宿主级**语义：dsh 进程存活期间到点即触发，与任何会话无关（区别于 `dsh-schedule` 的会话级 every 语义与 300s 下限）。结构化频率编辑器（每小时 / 每天 / 每周 / 自定义）实时回显合成表达式；五字段语法支持 `*` / 逗号列表 / 短横范围 / 斜杠步长，周接受 `0-7` 与 `SUN-SAT`。

调度细节：任务存 `~/.dsh/cron-tasks.json`（原子写 + fs.watch 镜像，面板外的编辑在 300ms 防抖窗口内进入镜像）；每任务一个 timer，触发前重读**内存镜像**并复核到点时刻（timer 有上限 clamp，稀疏计划可能被提前唤醒，此时只重新挂表不执行）；插件卸载 / dsh 退出清理全部 timer；**进程停止期间到期的任务不补投**，恢复后重算下一个未来时刻。「▶ 立即触发」走与定时触发完全相同的路径。create 模式与 Webhook 共用 `@deepseek-ai/dsh-webhook` 运行时（先在 Webhook 页签安装并挂载 → 重启）。

### 🪝 Webhook（自动化 · 第二页签）
规则 = id + secret（新建自动生成 16 位随机密钥，「🎲 换一个」可重摇；编辑留空 = 保持已存值）+ 可选事件名 + 动作（steer：选目标在线会话；create：workspacePath + agentPreset + permissionPreset + 可选 model）。

触发：`POST /webhook-triggers/<规则ID>`，头 `x-webhook-secret`（必填），可选 `x-webhook-event` / `x-webhook-delivery`（幂等去重）。**默认只接受本机投递**：非 loopback 来源，以及传输层报告不出对端地址的请求，一律 403（远程需显式开启 `webhookAllowRemote`）；401/429 与封锁各留一条日志和一条交付历史。限速按连接分桶 + 匿名认证失败桶（防「每次猜测换连接」绕过刹车）；封锁期内出示正确 secret 仍放行并解除封锁。交付历史（默认 200 条）与去重集合落 `$DSH_HOME/webhook-history.json`（原子写），**重启后历史保留、重发的同 delivery id 依旧去重**。

注意：端点与 Web UI 同端口、绕过浏览器认证，secret 是唯一防线；默认 127.0.0.1 绑定时外部 SaaS 需隧道。

### 🔍 Web 搜索（Web 与会话 · 第二页签）
provider 切换（deepseek-official / exa / perplexity）+ 装卸（仅 exa / perplexity 可装卸；卸载活动 provider 自动回落默认）。配置双路径：provider 注册了 dsh settings 命名空间时经 `settings.mutate` 路径操作（热生效、revision 守卫，脱敏视图永不回写），否则写 `cordis.patch.yml` 行（需重启）。**密钥只写不回显**——已存的 API key 永不回传浏览器。

### 📊 用量仪表盘
dsh 自身的 token 记账只存在于会话日志里——删掉会话，用量跟着消失。本插件三层兜底，删会话不再丢用量：

- **实时事件观察**：订阅 `session/event` 事件流（每次 append 都触发），对本进程从 seq 0 就开始观察的会话按绝对量累计，2 秒防抖落盘，并在 `session/disposed` / `session/flush` 时立即落盘——会话在扫描间隔内被创建、用完、删掉也不会漏。
- **后台定时快照**：每 60 分钟扫一遍整张会话表（`usageSnapshotIntervalMs`，`0` 关闭），覆盖上次进程启动前就存在的会话。
- **删除前快照**：本插件自己的 `deleteSession` / `closeSession` 在删日志**之前**先把该会话的用量写进台账。

台账在 `$DSH_HOME/usage-ledger.json`（每会话一行，原子写 + 串行队列 + 跨进程锁；上限默认 2000 行、`usageLedgerCap` 可调，按最后见到时间淘汰）；被删会话以 `deleted: true` 留在数据里并入 KPI。空转不读日志（revision 缓存）也不写盘（无变化即跳过）；读取路径不会覆盖实时观察器掌握的数字。

> 为什么不是 `fs.watch` 盯 `$DSH_HOME/sessions`：文件监听只能告诉你「目录/文件变了」，压缩日志要重新整份解析，而且删除事件和防抖窗口会互相抢跑；`session/event` 是 append 时刻的同步火线，更准也更省。

### ✅ 待办清单
输入框上方浮层，随会话实时投影；勾选完成（删除线 + 进度条）、进行中项实时计时、已完成折叠；git 文件变更区（分支徽标 + 每文件 ± 行数 + 复制 diff + 定位文件）。

### 🌐 i18n
面板文案内置简体/English 双语，**接在 dsh 自己的语言服务上**（`ctx.locale`）：工具栏 🌐 切换的是整个界面的语言，面板即时重绘、无需刷新；宿主未提供该服务时回落到「跟随浏览器语言 + 中文原文兜底」，永不出坏。

## 4. 可调配置键（插件 config 行）

`resolvePluginConfig` 认 **30 个键，全部受校验**：**16 个可调项**（第一张表）与 **14 个直通覆盖**（第二张表）。任意一个写错类型 / 范围都会在**挂载期直接报错**（fail-loud，不会静默降级）——包括 `commandsDir: 5` 这类直通键，不再静默失效。

两处例外按同一契约处理：**未文档化的键**不报错（同一 config 行也可能载着别的 reader 的键），但会**每进程告警一次**（`warnUnknownConfigKeys`，日志形如 `plugin-admin: unknown config key(s) ignored: xxx — see docs/ARCHITECTURE.md 可调配置键`），写错拼写不再无声无息；**直通键缺省时保持 undefined**，各子模块仍用自己的历史默认值，因此不改变既有行为。

导出的 `VALIDATED_CONFIG_KEYS` / `PASSTHROUGH_CONFIG_KEYS` 就是这两张表的代码形态，`host-check` 断言前者与 `resolvePluginConfig` 实际填出的键集完全一致 —— 新增旋钮忘了登记会在测试里失败，而不是在挂载期被当成"未知键"。

**受校验可调项（16）**——`resolvePluginConfig`（`lib/index.js`）解析，`Config` schema 走同一个函数：

| 分组 | 键 | 默认 | 说明 |
|---|---|---|---|
| 插件与更新 | `pnpmTimeoutMs` | 300000 | pnpm 操作预算（ms，过期杀进程树） |
| 插件与更新 | `updateCheckTimeoutMs` | 8000 | 单次 registry 检查预算（ms） |
| 插件与更新 | `updateCheckConcurrency` | 4 | 并发检查条数（正整数） |
| 插件与更新 | `updateCheckCacheTtlMs` | 300000 | 检查结果缓存 TTL（ms） |
| git 与待办 | `gitTimeoutMs` | 5000 | 单条 git 命令预算（ms） |
| git 与待办 | `gitStatsCacheTtlMs` | 3000 | 文件变更统计缓存 TTL（ms） |
| git 与待办 | `gitDiffMaxChars` | 524288 | diff 最大字符数，超出截断并标注 |
| 会话 | `sessionSummaryCacheTtlMs` | 60000 | 会话摘要缓存 TTL（ms） |
| 会话 | `sessionListConcurrency` | 4 | 会话表并发读取数（正整数） |
| 会话 | `sessionEventScanCap` | 20000 | 摘要回放的事件上限（正整数） |
| 会话 | `sessionSearchLimit` | 30 | 全文搜索返回上限（正整数） |
| 会话 | `sessionExportEventCap` | 200000 | 导出/体检整份读日志的事件上限，超出标记截断 |
| 用量台账 | `usageSnapshotIntervalMs` | 3600000 | 后台快照间隔（ms），`0` 关闭 |
| 用量台账 | `usageLedgerCap` | 2000 | 台账保留行数（100–100000；>100000 挂载期报错），超出按最后见到时间淘汰 |
| 面板开关 | `panels` | `{}` | 逐面板三态开关：`auto`（默认，官方已覆盖就让位）/ `on`（即使官方有也注册）/ `off`（不注册，优先级最高）。键名必须是 11 个面板 id 之一（`extensions` / `mcp` / `skills` / `subagents` / `commands` / `hooks` / `sessions` / `webSearch` / `usage` / `automation` / `todo`），值必须是三态之一；写错任一处**挂载期报错**。浏览器半读不到 config 行，所以挂载时经 `pluginAdmin/panels` 问宿主一次，答**上次的答案缓存**在 localStorage（键 `dsh-admin-panels-policy`），新答案到达后对账（关掉该关的、补上该开的）。 |
| 安装 | `installScripts` | `allow` | pnpm 安装时是否允许依赖的生命周期脚本：`allow`（默认，与 `dsh plugin add` 一致）/ `local-only`（只有**本机路径**与 `file:` / `link:` 规格可跑脚本，registry / git / URL 一律加 `--ignore-scripts`）/ `deny`（一律 `--ignore-scripts`）。写错值挂载期报错。注意：`deny` 会让**需要 prepare/postinstall 构建**的包装上却跑不起来，这一取舍由部署方决定。 |

**受校验直通覆盖（14）**——同一 config 行原样透传给各子模块（缺省时保持 undefined，由各模块取下表默认值），类型 / 范围同样在挂载期校验：

| 键 | 默认 | 说明 |
|---|---|---|
| `commandsDir` | `$DSH_HOME/commands` | 命令目录（缺失自动创建） |
| `hooksPath` | `$DSH_HOME/hooks.json` | hooks 存储 |
| `disabledPath` | `$DSH_HOME/hooks.disabled.json` | 停用钩子 sidecar |
| `codexHooksPath` | `$DSH_HOME/hooks.codex.json` | Codex 兄弟桥（手改文件） |
| `cronTasksPath` | `$DSH_HOME/cron-tasks.json` | 定时任务存储 |
| `webhookTriggersPath` | `$DSH_HOME/webhook-triggers.json` | Webhook 规则存储 |
| `webhookHistoryPath` | `$DSH_HOME/webhook-history.json` | 交付历史存储（与去重集合同文件） |
| `auditLogPath` | `$DSH_HOME/admin-audit.jsonl` | 特权动作审计日志（追加写、上限 2000 行后压缩；密钥类参数按**键名**脱敏） |
| `webhookAllowRemote` | `false` | webhook 入站是否接受**非本机**投递（默认只收本机，远程需显式开启） |
| `webhookRateLimit` | `60` | 每个来源每 60 秒的入站请求上限（超出答 429 + `retry-after`；认证失败另有 10 次/分钟的封锁） |
| `webhookHistoryCap` | 200 | 交付历史条数（1–10000；越界挂载期报错） |
| `projectCommands` | 启用 | `false` 关闭项目 `.agents` 命令注册 |
| `projectHooks` | 启用 | `false` 关闭项目 hooks 拦截 |
| `projectHooksTrust` | `confirm` | 仅 `allow-all` 启用自动放行，其余值一律 `confirm` |

> 路径类键（`commandsDir` / `hooksPath` / … / `cronTasksPath`）是测试与特殊部署用的覆盖点，取值须为非空字符串；只有 `usageLedgerCap` 额外受 `lib/usage-ledger.js` 自身预算钳制。

## 5. 信任边界与安全

浏览器端可触发本地 pnpm 安装（含 package prepare 脚本——可用 `installScripts: 'local-only' | 'deny'` 关掉；pnpm 子进程的 `DSH_*` 环境变量会被剔除，其余环境（含 registry 凭据）按 `dsh plugin add` 的语义继承）、hooks 桥一键安装与挂载（桥会在宿主本地执行钩子命令）、会话日志物理删除——与 `dsh plugin` CLI 及本地管理同属最高本地信任级（loopback 默认信任面）。工作流脚本体来自模型或面板，可经 `shell()` 在宿主执行命令——暴露到非本机前请务必评估权限范围。

- **pnpm 操作数走 shell 元字符白名单**——`& | > < %` 等注入面不存在。
- **原子写 + 权限收紧**：`package.json` / `cordis.patch.yml` / 全部 JSON 状态走 temp + rename，被替换的 patch 版本留滚动 `.bak`；凡是可能装着凭据的存储（patch 及其备份、hooks、MCP/子代理行、审计、webhook 规则、工作流脚本）创建即 `0600`，已存在的宽权限文件在下一次写入时收紧。
- **进程树超时击杀**（`taskkill /T /F`）覆盖包与 MCP 探测操作，且异步 spawn——卡死的进程树不会冻结宿主事件循环。
- **webhook 入站**：常量时间 secret 比较（两侧 SHA-256）、空 secret 拒绝一切、secret 在读 body 之前校验、1MiB 载荷上限、统一 401（不可枚举规则）。限速按来源（报不出地址的传输层按连接分桶，另加一个共享的暴力破解刹车——正确投递可解除封锁），封锁期内正确 secret 仍放行。
- **provider 密钥只写不回显**——MCP `env`/`headers`、CLI 后端 `env`、web-search `apiKey`、webhook `secret` 全部只投影键名 + 空值；保存时空值 = 沿用已存值。
- **危险删除双重确认**；同名会话删除按设计拒绝；会话日志目录绝不穿过符号链接/junction、也绝不从 sessions 根之外递归删除（删除路径先 `lstat` + realpath 包含性校验，推导出的删除路径先验身再动手）。
- **工作流 `shell()` 与项目 `.agents` hooks 执行命令时，都按调用会话解析出的沙箱策略围栏**（`ctx.sandboxPolicy.resolve({ session })`，与同会话的 bash 工具同一套解析），因此会话被切到 `read-only` / `workspace-write` 时这两条路径同样受约束；`danger-full-access` 下与宿主一致不受围栏。宿主没有挂 `ctx.sandboxPolicy` 而执行器又是围栏型时，两条路径都**拒绝执行**而不是无围栏跑（项目 hooks 记一条告警后跳过，工作流 `shell()` 抛给脚本）。
- **审批（`ctx.approval`）刻意不在这两条路径上**：dsh 只在调用方要**放宽**既定策略时才问审批（bash 工具的 `sandbox_permissions` 升级通道），普通受限命令不问；而审批服务的 `never` 策略——`danger-full-access` 部署下的默认值——会确定性地答 `rejected`，逐次询审批只会让恰好授权了全权的部署反而跑不动。本插件没有"放宽沙箱"的通道，所以也没有审批入口。workflow 的 `node:vm` realm 不是安全边界（脚本体与宿主同进程同信任级）。

## 6. 测试与接缝契约

```sh
npm test   # 3 道静态闸门 + 35 个脚本（self-check / host-check / 32 个 verify-* / integration-check），共 38 步；数字以 npm test 输出为准
```

静态闸门（`npm test` 先跑，任一失败即中止）：

- `check:types`：`tsc --noEmit`（`checkJs`）覆盖 `lib/**` 与 `src/client/**`；`lib/client.js` 作为产物被排除。
- `check:lint`：oxlint。
- `build:client --check`：`lib/client.js` 与 `src/client/**` 不一致即失败，防"改了源码忘重建"。

- `integration-check.mjs` 对真实 dsh checkout 做源码级契约探针（**142 条断言**，覆盖全部管理 RPC 命名空间与 workflow 引擎接缝；条数以 `npm test` 输出为准）。
- **`npm run smoke:real-host`** —— 唯一会**启动真实 dsh** 的检查（**28 项断言**，实测约 11–30 秒）：用一次性 `DSH_HOME` 从 dsh 自带模板生成 profile、把本插件装进去、boot 起来，依次断言 loader 组出了我们的行、客户端 bundle 进了模块表并被真实 web 服务端出来、**21 次只读调用覆盖 13/14 个管理命名空间**、**写路径真的落盘**（cron 存储 + profile patch 的 `disabled` 行 + `admin-audit.jsonl` 留痕，并用 `pluginAdmin/list` 的 `disabled` 字段做往返），最后在**真实 headless Chromium** 里点开设置、断言我们自己的面板文案出现在 DOM 中且页面无未捕获异常。不碰你真实的 `$DSH_HOME`；CI 里是独立的 `host-smoke` 作业（无浏览器即失败）。
- `verify-service-injects.mjs` 静态扫描 `lib/**`，断言每一处直接的 `ctx.<service>` 读取都在 `inject` 声明里 —— 少了这一条，真实宿主会抛 `cannot get property … without inject`，而所有替身 ctx 的检查都看不见（`projectAdmin/list` 就是这样在 v1.25.3 前一直坏着）。
- `verify-i18n.mjs` 断言英文文案表与全部 `dshT()` 调用点互为覆盖（防新增文案漏翻）、英文值不得残留中文。
- `self-check.mjs` 末尾包含 **en 模式冒烟**：以英文 locale 重新物化一份客户端，断言导航/工具栏 chrome 翻译与语言切换控件。
- `verify-cron-panel.mjs` 在 jsdom 里真实挂载「自动化」页并驱动定时任务页签（列表 / 开关 / 手填编辑器：id + 每小时频率 → `0 * * * *` → 保存）；模板卡片路径由 `self-check` 用例 15y1 覆盖，两者互补。
- 诊断工具（不在 npm test 内）：`node scripts/repro-delete-session.mjs` 复现会话删除路径的全部失败模式（在线未捕获 / 布局漂移 / 并发竞态），用于把面板报错对号入座。

RPC 契约同源：`lib/rpc-manifest.js` 是唯一真相表（**91 方法 / 14 命名空间**；以 `host-check` 输出为准），模块描述符从表生成（`invocationsFor`），87 个参数 wire 挂 `mode: 'strict'` 由网关在边界校验（零依赖手写校验器 `lib/rpc-schema.js`）；host-check 双向闸门（表↔描述符、表↔客户端调用点、必填/可选线名）。

多版本矩阵：`npm run test:matrix` 对 pin 住的 dsh release 与 master 两档 checkout 跑同一套探针（无 checkout 记 SKIP；CI 的 `seam-matrix` 作业显式列出目录，让"无可探测"变成失败而不是绿色静默）。
