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

所有写回（插件启停 / MCP / 子智能体 / 钩子桥 / Web 搜索 / Webhook 运行时 / overlay）收敛到 `lib/patch-utils.js` 的 `writePatch()`——原子写（temp + rename）+ 改写前把上一版留为 `cordis.patch.yml.dsh-admin.bak`（滚动一版），写坏用 `.bak` 覆盖重启；全部走共享串行操作队列，读-改-写不交错；`withFileLock` 把备份 + rename 包进跨进程文件锁（失败开放 / 过期回收），双进程并发写同一 profile 无丢失更新。注意该锁刻意是同步实现（`Atomics.wait`）：争用时最多阻塞宿主事件循环约 3 秒即 fail-open 继续写——「拒绝写入比丢更新更糟」的既定取舍；只有多实例并发写同一 profile 时才会出现这短暂停顿，单实例部署无争用。

一个刻意的例外：**会话删除/关停不在这条队列上，而是走一把模块内互斥锁**（`lib/session-admin.js` 的 `makeOperationMutex`）。它们**不能**入共享队列——删除序列里的用量台账写入（`usageLedger.upsert`）本身就入该队列，从队列槽位内部再入队会永久等待（已实测：嵌套 `serial()` 按构造即死锁）。互斥锁提供真正需要的那条性质（同一 id 的并发删除、删除与关停之间串行，活跃/包含性校验紧邻 `rm`），台账写入仍留在共享队列上。

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
行级 CRUD + 真实握手探测（initialize → tools/list）+ 工具试调用台（tools/call，60s 预算、16KB 截断）。「测试连接」与试调用读取**未掩码的存储配置**——探测必须等价于真实挂载，凭据型 server 才测得通；掩码只是读路径的投影，探测结果（不含秘密）回浏览器。**已挂载条目的配置修改热应用至运行中的 server（无需重启）**：保存即通过 loader 同款 `fiber.update` 通道热重启对应 server（按 serverName 匹配，改名也生效；noSave 保证 patch 文件不被宿主改写）；**新增条目**与**删除**仍需重启（新 fiber 挂载是 loader 启动期职责）。热应用失败时面板显示具体原因并回退到重启提示。

### 🛰️ 子智能体
受管子代理（toolName / persona / 工具约束 / 模型 / 执行后端 / 委托深度 / 后台模式）作为 profile patch 行 CRUD + 运行中监控/续接；CLI 后端页签检测 codex / claude-code provider 包，并扫描 PATH 上其他 agent CLI（gemini / qwen / opencode 等）一键挂载或手填自定义命令。

### 🧵 工作流
agent 写 TS/JS 脚本并行编排子代理，执行底座是 `ctx.subagents`（宿主原生并行 + 可续接）。生命周期（journal / 状态机 / amend / resume）在 `lib/workflow-runs.js`，引擎只负责「把一段脚本跑完」。

**脚本 facade**：`agent(prompt, opts?)` 委派一个子代理（失败返回 `null` 不拖垮整体；`opts` 支持 `{ provider, model, schema, cwd }`，`schema` 命中时该步返回结构化值（`cwd` 目前是语义占位：dsh 的 `SubagentStartRequest` 还没有 cwd 字段、in-process provider 从 parent 会话取工作区，改它只会让该步重跑，不改变子代理目录））；`parallel(thunks)` 信号量限流并行；`pipeline(items, ...stages)` 逐项流水线（任一 stage 抛出该 item 记 null）；`phase / log / report` 记进度；`ask(question)` 阻塞等回答（详情页行内作答，停止运行即拒答）；`shell(cmd, opts?)` 走宿主 shell（`opts` 支持 `workdir` / `timeoutMs`），返回 `{ exitCode, stdout, stderr, timedOut }`——**非零退出码是数据不是异常**。`shell()` 抛出的情形比"不可用/被中止"稍多，都是刻意的硬失败：`ctx.shell` 未挂载、运行被中止、以及**围栏型执行器缺 `ctx.sandboxPolicy`**（宁可拒绝执行也不无围栏跑）；此外运行未被中止时，shell 自身的错误（如 `resolve` 失败）也会向上抛而不是吞成数据。

**realm 边界**：脚本跑在 **worker 线程内的 `node:vm` 独立 realm**，没有 process / fetch / require / fs 等宿主全局，跨桥值一律折成 JSON 文本再在 realm 内重建（`args`、`agent()`/`shell()` 返回值、rejection 里的宿主 Error 都不带宿主原型链进 realm；`parallel`/`pipeline` 的 thunk 是 realm 闭包，编排因此在 realm 内以同语义实现，并发上限由宿主注入）。两层防护各管一头：**vm timeout 管同步前缀**——首个 `await` 之前的死循环由 V8 预算掐断；**线程边界管可抢占性**——微任务自旋（`while (true) { await 0 }`）在任何单线程事件循环上都不可抢占、一切定时器兜底都会被饿死，所以脚本冻住的只是自己的 worker，stop()/eval 的预算到点 `terminate()` 连 isolate 一起回收。**这不是硬安全边界**：worker 与宿主同用户同信任级，真正的权力来自 `agent()` 与 `shell()`（后者跑真实宿主命令，受调用会话的沙箱策略约束）——realm 防「意外拿到宿主能力」，线程防「失控拖垮宿主」。**顶层 `return` 必须是 JSON 值**（循环引用 / BigInt 让运行判 errored 而不是产出损坏记录）。**跨回来的值再经一次结构安全化**（`jsonSafeValue`）：剥掉 undefined 与函数值属性、Date 折成 ISO 串，并对 `__proto__` 这个唯一会让"赋值"变成别的事情的键特判——`Object.prototype` 上它是访问器，普通赋值设置的是**原型**而非属性，于是脚本写的键从结果里消失（静默丢数据）、宿主拿到的对象却继承了脚本放进去的东西；`JSON.parse` 会把 `__proto__` 建成自有属性，所以返回解析结果的脚本真能走到这里。现在该键以 `defineProperty` 存成普通数据：键保留、原型不变、全局 `Object.prototype` 不受影响。

**生命周期**：停止对忽略取消信号的卡死脚本有 10s 落定预算——预算到点回报 `abandoned` 并 **terminate 掉脚本执行线程**（记录落定为 stopped、journal 落盘；不再存在「仍在执行」的僵尸运行，此后改建/续跑可以安全继续）。同一 runId 的 stop/amend/resume 走一把进程内互斥锁，且同一份 journal 已有派生中的 amend/resume 运行时再开会被拒绝（双跑防线）。续跑/改建默认回原会话（已下线时报错并给出会话 id，可换其他在线会话 override）——**换绑到不同 parent 会话时缓存整体弃用**（指纹不绑定会话，跨会话命中会把旧会话语境下的结果当命中）；宿主重启后 stopped / errored 的运行仍可列出并续跑（「孤儿」标记 `orphaned` 是读取时按父会话是否在线派生的，不落盘）。**步骤缓存键是 `站点序号:kind:sha256([payload, ...语义 opts 键值对])`（全 64 hex）**——`agent()` 的 provider/model/schema/**cwd** 与 `shell()` 的 workdir/timeoutMs 进键，只改这些会让该步重跑；改 `args` 而 prompt 不变仍命中——所以**若某步的产出可能依赖 args，请把差异写进该步的 prompt 或 opts**，否则续跑/改建会拿到按旧 args 算出的缓存值。命中缓存的步骤也作为本 run 自己的 after 步骤进 journal，链式 amend/resume 的缓存因此可传递、`stepCount` 计数完整。

**工作库**：保存到全局 `$DSH_HOME/workflows/saved/` 或项目 `<workspace>/.dsh/workflows/`（随仓库走，项目覆盖全局同名）。**项目根必须已存在**，且显式传入的项目根只能是**调用会话自己的树**或**本 dsh 实例已知的工作区**——模型传的 `workspacePath` 与浏览器 RPC 的 `spec.workspacePath` 都按这条闸门校验，任意目录会被拒绝（否则提示注入就能借它在任意路径建树写文件、或删文件）；`<workspace>/.dsh` 若是指向项目外的符号链接/junction 同样拒绝。保存作用域自动识别：会话内经工具保存且未指定 scope 时，调用会话有 cwd → 存项目；识别不了 → 工具回 `needsScopeChoice`，由模型转问用户「存项目还是全局」，带选择重调；`delete_saved` 对称识别。

**模型工具 `workflow_admin`**（单工具 + action 枚举）：create / amend / resume / stop / list / get / answer / eval / save / run_saved / list_saved / delete_saved；`eval` 干跑（同一次工具调用内 await 完成、不起后台运行，`agent()` 桩化、`shell()` 直接报错，零子代理成本）供模型先验证语法与控制流；`wait: true` 阻塞到落定再回结果摘要。名字刻意避开 dsh 内置 `workflow` 工具（全局层同名注册会抛错）。

**斜杠命令 `/workflow`** 随插件挂载自动注册（与既有命令重名时只降级告警）：`/workflow create <任务描述>`（任务 steer 给当前会话的模型 → 生成脚本 → eval 干跑 → create 后台启动并回报 run id）、`/workflow [list]`、`/workflow run <名称> [argsJSON]`、`/workflow runs`、`/workflow stop <runId>`。

TS 脚本需要 esbuild（**可选** peer dependency：不装也能用纯 JS 工作流，TS 脚本给出明确诊断而不是静默失败）。运行与工作库落 `$DSH_HOME/workflows/{runs,saved}/`。

### ⌨️ 命令与钩子
命令保存即实时注册（fs.watch），会话里输入 `/名称 <输入>` 使用；JSON 导出/导入批量迁移（同名跳过）。钩子编辑 hooks.json 保存即热重启桥；「停用」移入 hooks.disabled.json；桥三态横幅（未安装 → ⚡ 安装并挂载 → 重启）；Codex 兄弟桥同页第二条状态条。项目 hooks 与官方 hooks 桥共用同一默认超时（单钩子 10 分钟，dsh 官方 hook 协议默认值；可用 hooks 配置里的 `timeout` 按钩子覆盖）——若干挂起的钩子会串行拖慢当前轮次，可用轮次取消中断。

### 🤖 定时任务（自动化 · 第一页签）
**宿主级**语义：dsh 进程存活期间到点即触发，与任何会话无关（区别于 `dsh-schedule` 的会话级 every 语义；其 every 下限随 dsh 版本为 300s——旧版——或 60s——`MIN_EVERY_INTERVAL_SECONDS` 已下调的新版）。结构化频率编辑器（每小时 / 每天 / 每周 / 自定义）实时回显合成表达式；五字段语法支持 `*` / 逗号列表 / 短横范围 / 斜杠步长，周接受 `0-7` 与 `SUN-SAT`。

调度细节：任务存 `~/.dsh/cron-tasks.json`（原子写 + fs.watch 镜像，面板外的编辑在 300ms 防抖窗口内进入镜像）；每任务一个 timer，触发前重读**内存镜像**并复核到点时刻（timer 有上限 clamp，稀疏计划可能被提前唤醒，此时只重新挂表不执行）；插件卸载 / dsh 退出清理全部 timer；**进程停止期间到期的任务不补投**，恢复后重算下一个未来时刻。「▶ 立即触发」走与定时触发完全相同的路径。create 模式与 Webhook 共用 `@deepseek-ai/dsh-webhook` 运行时（先在 Webhook 页签安装并挂载 → 重启）。

### 🪝 Webhook（自动化 · 第二页签）
规则 = id + secret（新建自动生成 16 位随机密钥，「🎲 换一个」可重摇；编辑留空 = 保持已存值）+ 可选事件名 + 动作（steer：选目标在线会话；create：workspacePath + agentPreset + permissionPreset + 可选 model）。**create 的 `workspacePath` 必须落在本实例已知的工作区内**（`assertTrustedWorkspacePath`，与工作流保存库、CLI 后端同一道闸门）——它会被持久化进规则、每次投递都按它新建会话，而本端点刻意绕过浏览器认证，secret 是唯一防线，所以"绝对路径"远远不够。

触发：`POST /webhook-triggers/<规则ID>`，头 `x-webhook-secret`（必填），可选 `x-webhook-event` / `x-webhook-delivery`（幂等去重）。**默认只接受本机投递**：非 loopback 来源，以及传输层报告不出对端地址的请求，一律 403（远程需显式开启 `webhookAllowRemote`）；401/429 与封锁**每来源每窗口**至多各留一条日志与一条交付历史（拒绝历史另有全局 10 条/窗口的预算，防刷屏）。限速按来源地址分桶（报不出对端地址的传输层按连接分桶）+ 无地址调用方的认证失败共享桶（防「每次猜测换连接」绕过刹车）；两张限速表各有 **512 个来源的硬上界**，滚动换址撑不大（排空的桶回收；无一排空时按最后触达逐出最冷端）。封锁期内出示正确 secret 仍放行并解除封锁。交付历史（默认 200 条）与 `x-webhook-delivery` 去重集合分落**两个文件**：历史在 `$DSH_HOME/webhook-history.json`，去重集在派生路径 `webhook-history.seen.json`（`seenPathFor()`，非新 config 键），两者都原子写，**重启后历史保留、重发的同 delivery id 依旧去重**。

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

**git 读取失败与"工作区干净"是两件事，分开呈现**：`gitDiff` / `fileStats` 各自带一个 `error` 字段（成功路径为 `null`）。读不出来时（非仓库、无 git、超时）不再返回零值充当"无改动"——那会让"复制 diff"按钮复制空字符串并弹出「工作区干净」，把相反的结论说得斩钉截铁。失败时 `gitDiff` 回 `error` 而非空 diff（超时与非超时措辞不同，因为二者对用户含义不同），`fileStats` 回零值 + `error`，面板据此隐藏该区段而不是显示 `0 个文件`；"没有 cwd"仍算合法的空答案（`error: null`）。git 的 stderr 常是一大段选项用法，诊断只取能说明原因的那一行，取不到就只报退出码——不把无关的 flag 列表念给用户。

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
| 安装 | `installScripts` | `allow` | pnpm 安装时是否允许依赖的生命周期脚本、以及什么样的来源规格可以被安装：`allow`（默认，与 `dsh plugin add` 一致——registry / git / URL / 本机路径一律装、一律可跑脚本）/ `registry-only`（**registry 包**与**本机路径**照常装且可跑脚本——原生模块需要它的 prepare；而任意**远程仓库/协议规格**——`git+https://…`、`github:user/repo`、`user/repo`、tarball URL——直接**拒绝**，不是禁脚本）/ `local-only`（只有**本机路径**与 `file:` / `link:` 规格可跑脚本，registry / git / URL 一律加 `--ignore-scripts`）/ `deny`（一律 `--ignore-scripts`）。写错值挂载期报错。注意：`deny` 会让**需要 prepare/postinstall 构建**的包装上却跑不起来，这一取舍由部署方决定；`registry-only` 正是为了避免这个取舍而加——在它之前，想让 registry 包构建就只能同时在任意 git 仓库上也构建。**`registry-only` 的拒绝发生在 pnpm 启动之前**（拒绝之后已经克隆并构建完了）。`remove` 不受该键约束（卸载不取代码）。**运行这些脚本的子进程会继承操作者的环境（只剔除 `DSH_*`）——含 API key 等凭据，详见 §5。** |

**受校验直通覆盖（14）**——同一 config 行原样透传给各子模块（缺省时保持 undefined，由各模块取下表默认值），类型 / 范围同样在挂载期校验：

| 键 | 默认 | 说明 |
|---|---|---|
| `commandsDir` | `$DSH_HOME/commands` | 命令目录（缺失自动创建） |
| `hooksPath` | `$DSH_HOME/hooks.json` | hooks 存储 |
| `disabledPath` | `$DSH_HOME/hooks.disabled.json` | 停用钩子 sidecar |
| `codexHooksPath` | `$DSH_HOME/hooks.codex.json` | Codex 兄弟桥（手改文件） |
| `cronTasksPath` | `$DSH_HOME/cron-tasks.json` | 定时任务存储 |
| `webhookTriggersPath` | `$DSH_HOME/webhook-triggers.json` | Webhook 规则存储 |
| `webhookHistoryPath` | `$DSH_HOME/webhook-history.json` | 交付历史存储；去重集在同目录的派生文件 `<同名>.seen.json` |
| `auditLogPath` | `$DSH_HOME/admin-audit.jsonl` | 特权动作审计日志（追加写、上限 2000 行后压缩；密钥类参数按**键名**脱敏） |
| `webhookAllowRemote` | `false` | webhook 入站是否接受**非本机**投递（默认只收本机，远程需显式开启） |
| `webhookRateLimit` | `60` | 每个来源每 60 秒的入站请求上限（超出答 429 + `retry-after`；认证失败另有 10 次/分钟的封锁） |
| `webhookHistoryCap` | 200 | 交付历史条数（1–10000；越界挂载期报错） |
| `projectCommands` | 启用 | `false` 关闭项目 `.agents` 命令注册 |
| `projectHooks` | 启用 | `false` 关闭项目 hooks 拦截 |
| `projectHooksTrust` | `confirm` | 仅 `allow-all` 启用自动放行，其余值一律 `confirm` |

> 路径类键（`commandsDir` / `hooksPath` / … / `cronTasksPath`）是测试与特殊部署用的覆盖点，取值须为非空字符串；只有 `usageLedgerCap` 额外受 `lib/usage-ledger.js` 自身预算钳制。

## 5. 信任边界与安全

浏览器端可触发本地 pnpm 安装（含 package prepare 脚本——可用 `installScripts: 'local-only' | 'deny'` 关掉，或用 **`registry-only`**：registry 包与本机路径照常构建、**任意远程仓库/协议规格直接拒绝**）、hooks 桥一键安装与挂载（桥会在宿主本地执行钩子命令）、会话日志物理删除——与 `dsh plugin` CLI 及本地管理同属最高本地信任级（loopback 默认信任面）。工作流脚本体来自模型或面板，可经 `shell()` 在宿主执行命令——暴露到非本机前请务必评估权限范围。

关于 pnpm 子进程的环境：**剔除的只有 `DSH_*` 命名空间（大小写不敏感），其余环境原样继承**——包括 `NPM_TOKEN` 这类 registry 凭据，也包括 `DEEPSEEK_API_KEY` / `GITHUB_TOKEN` / `AWS_*` / 任何 `*_PASSWORD` 等与本插件无关的凭据。这是**刻意的**：pnpm 需要 registry 凭据才能装私有包（丢掉会把可用的安装变成看起来像网络故障的 401），而精确区分"pnpm 需要的凭据"与"不该外传的凭据"在环境变量这一层做不到。**后果要如实认知**：`pnpm add` 的依赖，其 `prepare` / `postinstall` 生命周期脚本会继承这份环境，因此**只应安装你信任的包**；默认的 `installScripts: 'allow'` 与 `dsh plugin add` 语义一致（需要本地构建的包能装上），要收紧就用 `installScripts: 'local-only'`（只有本机路径与 `file:` / `link:` 规格可跑脚本）或 `'deny'`（一律 `--ignore-scripts`）。注意 MCP 探测走的是**另一套**更严的策略（按 `KEY|PASSWORD|SECRET|TOKEN` 名称模式剔除），两处不同是刻意的：探测是拿存储凭据去连第三方 server，而 pnpm 是要用凭据访问 registry。

- **pnpm 操作数走 shell 元字符白名单**——`& | > < %` 等注入面不存在（`assertPnpmOperand` 只放行包名 / 作用域名 / 版本区间 / `git+` 与本地路径这几类字符，因此引号、空白、重定向、展开符都到不了命令行）。**白名单管的是 shell 注入，不是"会执行远端代码"**——后者由 `installScripts` 管，因为 `pnpm add <registry 包>` 本身就允许包自带 `prepare` 脚本通过。两者分工明确：白名单保证一条操作数不会变成第二条命令，`installScripts` 决定什么样的**来源**被允许构建。**Windows 上另有一层传输修正**：pnpm 经 cmd.exe（`.cmd` shim）启动，而 cmd.exe 把 `^` 当转义字符吃掉——`pkg@^1.2.3` 会**静默**变成 `pkg@1.2.3`（用户要区间，profile 却记下精确锁定，此后永不升级）。**双写 `^` 修不好它**：cmd.exe 只按 4 个一组放行 caret，`^^1.2.3` 实测仍然落成 `1.2.3`；`pnpmSpawnArgs` 因此改为给**带 caret 的那个操作数加引号**（引号内 cmd.exe 不再把 `^` 当转义），实测 manifest 正确记下 `^1.2.3`。引号安全的前提是白名单已经排除了 `"` 与空白，两者是配套的；无需转义的参数一律原样透传。这条端到端结论由 `scripts/check-pnpm-caret.mjs` 用**真实 pnpm** 复验（需要 registry 且会真装一个包，故与 `bench-*` / `repro-*` / `smoke:real-host` 同类，**不在 `npm test` 内**；缺 pnpm 或无网时如实 SKIP 而不是假装通过）。
- **原子写 + 权限收紧**：`package.json` / `cordis.patch.yml` / 全部 JSON 状态走 temp + rename，被替换的 patch 版本留滚动 `.bak`；凡是可能装着凭据的存储（patch 及其备份、hooks、MCP/子代理行、审计、webhook 规则、工作流脚本）创建即 `0600`，已存在的宽权限文件在下一次写入时收紧。
- **进程树超时击杀**（`taskkill /T /F`）覆盖包与 MCP 探测操作，且异步 spawn——卡死的进程树不会冻结宿主事件循环。
- **webhook 入站**：常量时间 secret 比较（两侧 SHA-256）、空 secret 拒绝一切、secret 在读 body 之前校验、1MiB 载荷上限、统一 401（不可枚举规则）。**路径必须恰好一段**——`/webhook-triggers/<ruleId>/<任何多余段>` 一律 404 且在任何规则被读取之前返回；早期实现只取第一个路径分量、静默丢弃其余，于是这条路径会被当成裸路径正常处理，一个持有**任意**有效 secret 的调用方只要比较"带尾段的路径"与"裸路径"的应答（越过认证 vs 401）就能问出某个规则是否存在——正是统一 401 要关掉的那件事。**本机来源判定分两步：先证明"这是一个被观测到的地址"，再判断"它是不是本机"**。第一步（`remoteAddressOf`）要求地址是 socket 上**自有且非访问器**的数据属性——取值本身合法不算数，因为访问器可以返回一个完全合法的 `127.0.0.1`；实测未加这道校验时，访问器属性、原型继承的值、甚至挂在数组上的键都会被当成可信来源，而本机判定是未认证请求通往 steer 活跃会话的唯一闸门。同时它要求 `socket`/`req` 不是数组、必须是 IPv4/IPv6 字面量（`net.isIP`，排除主机名与带端口文本）、且传输层上报的 `remoteFamily` 与字面量一致（二者同出一次内核调用，不一致说明对象是拼出来的）。第二步（`isLoopbackAddress`）是**解析而非前缀匹配**——严格 dotted-quad（四位 0–255）、`::1` 与 `::ffff:` 映射分别处理，主机名（含 `localhost`）与带端口文本一律不算本机。限速按来源地址（报不出地址的传输层按连接分桶；**无地址调用方**的认证失败走一个共享刹车，正确投递可解除封锁；`webhookAllowRemote` 下每个远端地址各有独立预算，不存在全局刹车），封锁期内正确 secret 仍放行。**两张限速表都有硬上界（512 个来源），滚动换址不能把它们撑大**：窗口已排空的桶随时回收，若换址攻击让**没有任何桶排空**，则从表的**最冷端**逐出（按"最后触达"排序，因此**持续被触达的调用方**——例如一个长期集成——不会被一次换址洪水挤掉，而闲置键会）。这一取舍要如实认知：逐出会**清零该来源的计数**，这是硬上界的必然代价，另一侧是无上界内存（且长在同一事件循环上、与 UI 争用）；每请求的预算与无地址共享刹车不受影响。早期实现的 `sweep` 以 `size <= 512` 提前返回，于是它只在第 513 个来源出现时才"上膛"，而换址攻击永远不会让窗口排空——**实测 5000 个不同来源在两张表里各留下 5000 条**，`MAX_TRACKED_CALLERS` 实际什么都没界住。**重放去重是"动作前占位 + 失败后释放"**：占位先于动作使崩溃中途的重投不会重复执行；而动作**上报失败**（如目标会话离线）会经 `release()` 交还 delivery id 并落盘，故发送方的重试能真正重跑，不会拿到 `202 {duplicate:true}` 后被永久吞掉。
- **provider 密钥只写不回显**——MCP `env`/`headers`、CLI 后端 `env`、web-search `apiKey`、webhook `secret` 全部只投影键名 + 空值；保存时空值 = 沿用已存值。**掩码只是读投影**：MCP 的「测试连接」/试调用读取未掩码的存储配置（探测必须等价于真实挂载），探测结果本身不含秘密。
- **特权动作留痕且按值脱敏**（`$DSH_HOME/admin-audit.jsonl`）：安装/卸载/启停、MCP 增删改、删除会话、webhook 规则变更等写路径各记一行。脱敏是**双通道**——按**键名**丢弃（`secret` / `token` / `api[-_]?key` / `password` / `authorization` …）**并且**对每个剩余字符串按**密钥形态**替换（`sk-…`、`ghp_…`、`AKIA…`、JWT、`Bearer …`、URL userinfo），所以同一把密钥被粘进 `command` / `promptTemplate` / `args` 也活不下来。
- **危险路径的绝对路径统一受工作区栅门**（`lib/workspace-path.js`）：`assertTrustedWorkspacePath` 要求显式传入的绝对路径落在**调用会话自己的树**或本实例**已知的工作区**内，并经 `realpath` 规范化（符号链接/junction 无法借字符串比较蒙混）。适用于：通用 CLI 后端的绝对 `command` / `cwd`（`assertTrustedCliPaths`）、工作流保存库的 `spec.workspacePath`、**以及 webhook / cron 的 `create` 模式动作**——后者把路径**持久化**成规则的一部分，每次投递都按它新建会话，因此"绝对"远远不够。**可判定才拦截**——宿主没有 `workspaceRegistry`（纯 CLI / headless profile）时闸门按"无已知工作区"处理，即拒绝显式路径而不是放行。
- **危险删除双重确认**；同名会话删除按设计拒绝；会话日志目录绝不穿过符号链接/junction、也绝不从 sessions 根之外递归删除——删除前先 `lstat` 叶子、再逐级 `lstat` **根到叶子之间的每一个路径分量**（project-key 目录是 junction 时叶子 realpath 仍可能落在根内、却指向另一个会话的目录），且包含性校验与 `rm` 之间**没有 await**，检查到的状态就是删除作用的状态。
- **删除的"读不到"与"读出来是空"是两件事**：`stat` **抛错**（日志锁死/无权限/头部解码失败）意味着后端没能回答，此时日志是否存在是**未知**，删除直接拒绝并说明"nothing was removed"，且不做任何部分清理（detach、投影缓存、归档集合都不动），用户可以重试；`stat` **返回 undefined** 才是"后端没有这个会话"这种合法空操作。此前前者被吞掉、后者照常返回 `{deleted}`——一次没发生的删除被报成成功，而日志还在盘上。
- **`fsAdmin/reveal` 是唯一一个把浏览器字符串原样交给 OS 的 RPC**，因此过一道门（`assertRevealablePath`）：必须**已存在**的**绝对**路径（相对路径会按宿主的 cwd 解析、不存在的只会换来一个资源管理器报错框）；**拒绝 UNC**——`\\server\share`（含 `//server/share` 写法）会让本机向调用方指定的主机做**外发 SMB 认证**，这是这里唯一会泄露凭据而非仅仅开窗的形状；**拒绝 Win32 命名空间前缀**（`\\?\`、`\.\`，绕过常规路径解析）；**拒绝控制字符与双引号**（Windows 提窗助手用 `-File` + argv 调 PowerShell，其引号规则比 CreateProcess 粗，一个双引号能把路径变成脚本的参数）。**刻意不做工作区包含性校验**：`assertTrustedWorkspacePath` 管的是插件要**写**的路径，`assertTrustedCliPaths` 管的是**决定跑哪个可执行文件**的路径——那些场景里路径就是权限本身；`reveal` 只是在操作者自己同样能导航到的位置开一个只读文件管理器窗口，加包含性会是纯粹的形式主义且有实际代价：该 RPC 不带会话上下文，不挂注册表的 CLI 部署（基础 CLI bundle）里会话在本目录之外时，每一次 reveal 都会被拒。
- **会话删除的活跃判据查两个注册表**：`sessionIsLive` 同时问 `agents` 与 `sessions`（dsh 自己的 drain 等待就是 `agents.get(id) === undefined && sessions.get(id) === undefined`）。只查 `sessions` 不是活跃判据——`resume()` 先取写租约与目录内的 `session.lock`，之后才 `setupAndPublish` 插入会话表，中间那段窗口里活跃写入者尚不可见；此时删除会毁掉它的日志目录（连带租约文件，POSIX 上 flock 按 inode 绑定 → 排他性失效，且租约的 `mkdir` 会把空目录重新建出来）。该判据在 `rm` 前**重新取值**，`deleteSession`/`closeSession` 由一把模块内互斥锁串行（**刻意不用共享补丁队列**：删除内部的台账写入本身就入该队列，重入会死锁），重复删除幂等——第二次看到"目录已不在"是实现目标而非失败，真实的布局漂移（SQLite 后端/自定义根）仍 fail-loud。
- **工作流 `shell()` 与项目 `.agents` hooks 执行命令时，都按调用会话解析出的沙箱策略围栏**（`ctx.sandboxPolicy.resolve({ session })`，与同会话的 bash 工具同一套解析），因此会话被切到 `read-only` / `workspace-write` 时这两条路径同样受约束；`danger-full-access` 下与宿主一致不受围栏。宿主没有挂 `ctx.sandboxPolicy` 而执行器又是围栏型时，两条路径都**拒绝执行**而不是无围栏跑（项目 hooks 记一条告警后跳过，工作流 `shell()` 抛给脚本）。
- **审批（`ctx.approval`）刻意不在这两条路径上**：dsh 只在调用方要**放宽**既定策略时才问审批（bash 工具的 `sandbox_permissions` 升级通道），普通受限命令不问；而审批服务的 `never` 策略——`danger-full-access` 部署下的默认值——会确定性地答 `rejected`，逐次询审批只会让恰好授权了全权的部署反而跑不动。本插件没有"放宽沙箱"的通道，所以也没有审批入口。workflow 的 `node:vm` realm 不是安全边界（脚本体与宿主同进程同信任级）。

## 6. 测试与接缝契约

```sh
npm test   # 6 道静态闸门 + 36 个脚本（self-check / host-check / 35 个 verify-* / integration-check），共 42 步；数字以 npm test 输出为准
```

静态闸门（`npm test` 先跑，任一失败即中止）：

- `check:types`：`tsc --noEmit`（`checkJs`）覆盖 `lib/**` 与 `src/client/**`；`lib/client.js` 作为产物被排除。**`strictNullChecks` 已是这里的默认值**——那条 `strict-null` 轨道在 lib 层 39/39 全量清完后折进了 `tsconfig.json`（2026-09，见 CHANGELOG），`src/client` 也随之清完，这个开关现在是全仓约束。
- `check:types-strict`：`tsconfig.strict.json` 的 `noImplicitAny` 覆盖一个**只增不减**的入口文件清单（**注意 `tsc` 会顺 import 往下走**，因此一个文件要等它整条传递闭包清零才能纳入）；当前覆盖 39 个宿主文件中的 24 个，其余需要真正的类型建模而非 `any` 注解，见 CONTRIBUTING 的 strict 轨道一节。清单覆盖全量后并入 `tsconfig.json` 并删掉该文件。
- `check:lint`：oxlint（error 为闸门，warning 记录在案）。
- `build:client --check`：`lib/client.js` 与 `src/client/**` 不一致即失败，防"改了源码忘重建"。
- `verify-doc-claims`：**文档里可机械校验的声明必须与仓库一致**——步数 / 静态闸门数 / verify-* 脚本数、文档点名的脚本与模块路径是否存在、最新 CHANGELOG 各节的 `N → M checks` 是否自洽且不超出该套件声明的用例数、config 键数是否等于 `lib/index.js` 导出的两张表。它守的是整条链**自己的数字**，所以排在链首。
- `verify-line-anchors`：**文档里的 `path:line` 锚点必须落在文件内**。行号锚点的失效方式比路径更隐蔽——重构把代码挪走后，文件与路径都还在，所以"路径存在"检查照旧全绿，而行号已经指向无关函数甚至越过文件末尾。本闸门就是为两个真实案例写的：`CHANGELOG.md` 与 `docs/COMPAT.md` 都曾引用 ~~`lib/index.js:1756-1795`（用量台账观察器），而 v1.26.2 的拆分把 `index.js` 从 3648 行减到 936 行，该行号早已不存在。三类分别处理：**本仓锚点**（`lib|src|scripts|types|docs/`）必须落在文件内；**上游锚点**（`packages/…`，指向未 vendored 的 dsh checkout）只校验形态，并在输出里**如实报告"未核对"**而不是假装通过——设 `DSH_CHECKOUT` 后按真实 checkout 核对；**反例引用**（在反引号前加 `~~`）不算声明，闸门跳过。锚点形态本身也有断言（只认已知顶层目录，裸文件名不算声明）。

- `integration-check.mjs` 对真实 dsh checkout 做源码级契约探针（**142 条断言**，覆盖全部管理 RPC 命名空间与 workflow 引擎接缝；条数以 `npm test` 输出为准）。
- **`npm run smoke:real-host`** —— 唯一会**启动真实 dsh** 的检查（**28 项断言**，实测约 11–30 秒）：用一次性 `DSH_HOME` 从 dsh 自带模板生成 profile、把本插件装进去、boot 起来，依次断言 loader 组出了我们的行、客户端 bundle 进了模块表并被真实 web 服务端出来、**21 次只读调用覆盖 13/14 个管理命名空间**、**写路径真的落盘**（cron 存储 + profile patch 的 `disabled` 行 + `admin-audit.jsonl` 留痕，并用 `pluginAdmin/list` 的 `disabled` 字段做往返），最后在**真实 headless Chromium** 里点开设置、断言我们自己的面板文案出现在 DOM 中且页面无未捕获异常。不碰你真实的 `$DSH_HOME`；CI 里是独立的 `host-smoke` 作业（无浏览器即失败）。
- `verify-service-injects.mjs` 静态扫描 `lib/**`，断言每一处直接的 `ctx.<service>` 读取都在 `inject` 声明里 —— 少了这一条，真实宿主会抛 `cannot get property … without inject`，而所有替身 ctx 的检查都看不见（`projectAdmin/list` 就是这样在 v1.25.3 前一直坏着）。
- `verify-i18n.mjs` 断言英文文案表与全部 `dshT()` 调用点互为覆盖（防新增文案漏翻）、英文值不得残留中文。
- `self-check.mjs` 末尾包含 **en 模式冒烟**：以英文 locale 重新物化一份客户端，断言导航/工具栏 chrome 翻译与语言切换控件。
- `verify-cron-panel.mjs` 在 jsdom 里真实挂载「自动化」页并驱动定时任务页签（列表 / 开关 / 手填编辑器：id + 每小时频率 → `0 * * * *` → 保存）；模板卡片路径由 `self-check` 用例 15y1 覆盖，两者互补。
- 诊断工具（不在 npm test 内）：`node scripts/repro-delete-session.mjs` 复现会话删除路径的全部失败模式（在线未捕获 / 布局漂移 / 并发竞态），用于把面板报错对号入座。

RPC 契约同源：`lib/rpc-manifest.js` 是唯一真相表（**91 方法 / 14 命名空间**；以 `host-check` 输出为准），模块描述符从表生成（`invocationsFor`），87 个参数 wire 挂 `mode: 'strict'` 由网关在边界校验（零依赖手写校验器 `lib/rpc-schema.js`）；host-check 双向闸门（表↔描述符、表↔客户端调用点、必填/可选线名）。

多版本矩阵：`npm run test:matrix` 对 pin 住的 dsh release 与 master 两档 checkout 跑同一套探针（无 checkout 记 SKIP；CI 的 `seam-matrix` 作业显式列出目录，让"无可探测"变成失败而不是绿色静默）。
