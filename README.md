# dsh-plugin-admin

dsh（DeepSeek Harness）Web UI 管理插件：在官方设置界面内补齐 dsh 缺失的管理能力——**扩展插件**、**技能**、**MCP 服务器**、**子智能体**、**命令**、**钩子**、**自动化（定时任务 + Webhook + 工作流）**、**Web 与会话（历史会话 + Web 搜索）**、**用量仪表盘**、**待办清单**——十个管理入口（3 个独立设置页：Web 与会话 27 / 用量仪表盘 28 / 自动化 29；6 个页签：扩展插件在「插件」页内，技能、MCP 服务器、子智能体、命令、钩子 在「内置插件」页内；1 个输入框上方浮层：待办清单）。零 dsh 导入，全部骑运行时 Cordis Context；写回统一原子写 + 串行队列，缺服务一律降级不挂死。

> 面板文案内置简体/English 双语（扩展插件面板工具栏 🌐 切换，跟随浏览器语言，回退中文原文，永不出坏）。

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.24.1 · MIT

## 功能总览

| 面板 | 重点 |
|---|---|
| 🔌 扩展插件 | 安装 / 卸载 / 更新 / 启停 profile 插件（pnpm 编排 + bundles 清单同步） |
| 📚 技能 | 全量技能清单（全局层 + 每个 Agent 预设的 standing 作用域 + 会话作用域合并），严格只读、不加载正文 |
| 🔌 MCP 服务器 | 行级 CRUD + 真实握手探测 + 工具试调用台；**已挂载条目的配置修改热应用至运行中的 server（无需重启）** |
| 🛰️ 子智能体 | 受管子代理 CRUD + 运行中监控 / 续接 + CLI 后端挂载 |
| 🧵 工作流 | 动态工作流控制台：agent 写 TS/JS 脚本并行编排子代理（amend/resume 步骤缓存、ask 问答回路、saved 库双作用域）+ 模型侧 `workflow_admin` 工具 |
| ⌨️ 命令与钩子 | 提示词命令（实时生效）+ Claude / Codex hooks 桥 + 项目 `.agents` 只读视图 |
| 🤖 自动化 | 定时任务 + Webhook + 工作流 一页三页签：宿主级 cron 到点 steer/create；Webhook 端点触发同款动作（交付历史 + 幂等去重）；工作流脚本编排子智能体（见上） |
| 🌐 Web 与会话 | 一页双页签：「历史会话」（目录折叠 + 批量删除 + 全文搜索 + 体检/导出）+ 「Web 搜索」provider 切换 + 配置编辑（Exa / Perplexity 无官方 UI）；排序在用量仪表盘之前 |
| 📊 用量仪表盘 | 浏览器端实时聚合的 token 用量 / 活跃度分析，本地台账持久化：实时事件观察 + 每小时快照 + 删除前快照（删会话不丢用量）|
| ✅ 待办清单 | 输入框上方实时待办 + git 文件变更区 |

共同特性：所有写回（插件启停 / MCP / 子智能体 / 钩子桥 / Web 搜索 / Webhook 运行时 / overlay）收敛到 `lib/patch-utils.js` 的 `writePatch()`——原子写（temp + rename）+ 改写前把上一版留为 `cordis.patch.yml.dsh-admin.bak`（滚动一版），写坏用 `.bak` 覆盖重启；全部走共享串行操作队列，读-改-写不交错；依赖的 dsh 服务缺失时逐面板降级提示，绝不整插件不加载。

## 使用说明

所有面板入口：dsh 设置弹窗 → 对应导航项（各面板按需挂载）。改动 profile 配置的操作（插件安装/卸载/启停、MCP、Web 搜索、Webhook 运行时、overlay 启用）需**重启 dsh 生效**，面板内会提示。

### 🔌 扩展插件
1. 打开：设置 → 插件 → 「扩展插件」页签。
2. 安装：顶部输入框填 npm 包名（如 `dsh-xxx`）或本地绝对路径 → 回车提交 → 重启 dsh。
   - **dsh peer 兼容预检**：安装/更新完成后自动比对新装包的 `@deepseek-ai/dsh*` peerDependencies 与运行中的 dsh 版本（dsh 0.1.7 起宿主启动时会跳过不兼容 bundle）——不兼容时面板给出警示与 `dsh plugin allow-version` 豁免指引。解析不到运行版本时跳过检查（静默降级）。
3. 更新：卡片「⬆ 更新」单升，或工具栏「⬆⬆ 全部更新」批量（实时进度）；「⬆ 检查更新」强制重查 registry。
4. 启停：卡片「⏸ 停用 / ▶ 启用」（仅自带 bundle patch 的扩展插件）→ 重启生效；已停用插件跳过更新检测。
5. 卸载：卡片「卸载」→ 行内二次确认。
6. 搜索/筛选：搜索框按名称/版本/路径模糊过滤 + 「全部 / 扩展插件 / 系统内置」胶囊。

### 🕘 历史会话（Web 与会话 · 默认页签）
历史会话面板挂在设置 → **Web 与会话** 的第一个页签里，与「Web 搜索」共用一个侧边栏入口、页内双页签，在所有 dsh 版本下行为一致。「工作区」面板已退役，插件不再为它注册任何入口——各版本 dsh 均原生覆盖工作区管理（客户端那份 Web 工作区实现仅作为测试接缝保留）；宿主侧的 `workspaceAdmin` 命名空间仍随插件注册（历史兼容的 RPC 面，不是面板入口）。

1. 打开：设置 → Web 与会话（默认落在「历史会话」页签，点「Web 搜索」页签切换）。
2. 历史会话：搜索框同时匹配标题/摘要/工作目录/会话 ID；状态胶囊「全部 / 在线 / 已归档 / 已结束 / 已置顶」；卡片「📌 置顶」（localStorage 持久化）；「删除」二次确认（在线会话显示「关停并删除」，先 dispose 再删日志，免重启）；「⬇ 导出」下载 Markdown 对话稿；「🩺 体检」折叠工具调用/失败/重试报告；切换「全文搜索」检索全部会话内容（部署默认关闭时点「⚡ 一键启用」→ 重启 dsh）。
4. **目录折叠**：会话按工作目录分组，每个目录头是一行可点标题——点击整行折叠/展开该目录的会话（箭头 ▾/▸ + 「已折叠」提示），折叠状态存 localStorage 跨刷新保留；筛选栏尾部「▴ 全部折叠 / ▾ 全部展开」一键折叠所有目录。
5. **批量删除**（省去一个个点）：
   - 筛选栏尾部「🗑 删除当前 (N)」——删除当前筛选/搜索下的**全部** N 个会话；
   - 每个目录头的「🗑 整个目录」——删除该目录下的全部会话；
   - 两者都先弹确认条（「确认删除 当前筛选的 N 个会话？/ 目录「X」的 N 个会话？」）→「确认删除」才执行，执行中显示进度「删除中 x / N」；在线会话自动先关停（closeSession）再删日志，其余直接删除（deleteSession）；单个失败不阻塞其余，结束后汇总失败数。
6. 排序：Web 与会话（order 27）在用量仪表盘（28）与自动化（29）之前。

### 📚 技能
1. 打开：设置 → 内置插件 → 「技能」页签（排在「扩展插件」之后）。
2. 浏览：卡片含 `/<name>`、🤖 模型可调用 / 👤 人类可调用旗标、来源标签、作用域明细。列表在弹窗高度内独立滚动（30+ 技能不再被裁掉），工具栏只留「刷新 + 搜索框」。
3. 作用域：三层合并——**全局层**、**每个 Agent 预设的 standing 作用域**、**每个已知会话的 (cwd, 预设) 作用域**。Web 部署（`dsh-web-app`）会把宿主层 `skill-filesystem` 行禁用、改由预设挂载本地发现，所以那里全局层为 0 属正常，用户目录（`~/.agents/skills`、`~/.dsh/skills`）由预设作用域列出。读取预设作用域会经 `agentPresets.acquireScope`（dsh 0.1.7 租约式，读毕即释放；旧宿主回退 `standingKeyFor`）确保该预设的 standing 挂载（只组合插件，不启动 agent / 会话 / 轮次），这是宿主侧读取预设层的唯一入口。
4. 筛选：仅文本（名称/描述/whenToUse/路径）——浏览器端过滤，零额外请求。来源与作用域不做下拉筛选：每张卡片已印出来源标签与「可见于」作用域，下拉只是重复卡片上的信息。
5. 复制/打开：📋 复制 `/name`；resourceBase 为目录时「📂 打开目录」在系统文件管理器中定位。

### 🔌 MCP 服务器
1. 打开：设置 → 内置插件 → 「MCP服务器」页签（排在「技能」之后）。
2. 添加：表单填 id / serverName / command（+args；整行命令如 `npx -y fetcher-mcp` 会被提示拆分）→ 保存 → 重启 dsh。
3. 测试：🔌 测试——真实握手（initialize → tools/list），成功显示服务器标识与工具列表；成功结果缓存到 localStorage（失败仅会话内）。
4. 试调用：🧪 试调用——选工具、粘贴 JSON 参数、真实执行一次 tools/call（60s 预算，16KB 截断）。
5. 编辑/移除：行内操作；与既有条目同 id 直接拒绝。
6. 热生效：**修改已挂载条目**保存即通过 loader 同款 `fiber.update` 通道热重启对应 server（按 serverName 匹配，改名也生效；noSave 保证 patch 文件不被宿主改写），面板提示「无需重启」；**新增条目**与**删除**仍需重启（新 fiber 挂载是 loader 启动期职责）。热应用失败时面板显示具体原因并回退到重启提示。

### 🛰️ 子智能体
1. 打开：设置 → 内置插件 → 「子智能体」页签（排在「MCP服务器」之后）。
2. 新建：表单填名称（toolName）/ 提示词（persona，支持 `{{model}}`/`{{cwd}}`）/ 工具约束（allow/deny）/ 模型 / 执行后端 / 委托深度 / 后台模式；高级设置可展开。
3. CLI 后端：页签——检测 codex / claude-code provider 包 → 挂载 → 配置 → 卸载；「通用命令行后端」扫描 PATH 上其他 agent CLI（gemini / qwen / opencode 等）一键挂载或手填自定义命令。

### 🧵 工作流
1. 打开：设置 → 自动化 → 「工作流」页签（排在「Webhook」之后）。页首有通俗说明与三步引导；**「从模板开始」**提供三个开箱即用的模板卡片（主题总结 / 并行双角度分析 / 分步润色流水线）——点卡片自动填好脚本、名称与参数，改改参数点「🚀 启动」即可，不会写代码也能跑。
2. 新建：脚本（TypeScript / JavaScript，**顶层 `return` 即运行结果**）+ 名称（可选）+ args（JSON）→ 🚀 启动。父会话：工作流的子代理从某个在线会话派生——恰有一个在线会话时自动选中不出控件，多个时下拉选择（标题 · 工作目录），零个时提示先开会话。
3. 脚本 facade：`agent(prompt, opts?)` 委派一个子代理（失败返回 `null` 不拖垮整体；`opts` 支持 `{ provider, model, schema }`，`schema` 命中时该步返回结构化值）；`parallel(thunks)` 信号量限流并行；`pipeline(items, ...stages)` 逐项流水线（任一 stage 抛出该 item 记 null）；`phase / log / report` 记进度；`ask(question)` 阻塞等回答（详情页行内作答，停止运行即拒答）；`shell(cmd, opts?)` 走宿主 shell（`opts` 支持 `workdir` / `timeoutMs`），返回 `{ exitCode, stdout, stderr, timedOut }`——**非零退出码是数据不是异常**，只有宿主 `ctx.shell` 不可用或运行被中止才抛出（脚本自行 try/catch）。脚本跑在 **node:vm 独立 realm**：require / import / fs / network / process 均不可达——只编排，重活交给 `agent()` / `shell()`；realm 防的是意外访问，不是硬安全边界（与宿主同进程、同信任级别）。**顶层 `return` 必须是 JSON 值**（循环引用 / BigInt 会让运行判 errored 而不是产出损坏记录）。
4. 生命周期：运行中「⏹ 停止」；stopped / errored 可「▶ 续跑」「✏️ 改建」（改脚本重跑，已完成步骤按 fingerprint 命中缓存，不重花调用；**缓存键只含 `站点序号:kind:sha256(prompt)`——只改 `opts`/`args` 而脚本不变时该步仍命中缓存**）；详情 2s 轮询实时刷新。停止对忽略取消信号的卡死脚本有 10s 落定预算——超时回报 `abandoned` 并写 journal，此时「改建」会被拒绝（防新旧双跑），等运行真正结束后用「续跑」。续跑/改建默认回**原会话**（已下线时报错并给出会话 id，可换其他在线会话 override）；宿主重启后 stopped / errored 的运行仍可列出并续跑（「孤儿」标记 `orphaned` 是**读取时按父会话是否在线派生的**，不落盘）。
5. 工作库：「保存」脚本入库——全局 `$DSH_HOME/workflows/saved/` 或项目 `<workspace>/.dsh/workflows/`（随仓库走，项目覆盖全局同名）；卡片「🚀 运行」一键启动。
6. agent 工具：模型可调用 `workflow_admin`（单工具 + action 枚举）——create / amend / resume / stop / list / get / answer / eval / save / run_saved / list_saved / delete_saved；`eval` 干跑（同一次工具调用内 await 完成、**不起后台运行**，`agent()` 桩化、`shell()` 直接报错，零子代理成本）供模型先验证语法与控制流；`wait: true` 阻塞到落定再回结果摘要。名字刻意避开 dsh 内置 `workflow` 工具（全局层同名注册会抛错）。
7. 保存作用域自动识别（对齐 ZCode SaveWorkflow）：会话内经工具保存且未指定 scope 时，调用会话有 cwd → 存**项目** `.dsh/workflows/`；识别不了（无调用会话 / 会话无 cwd）→ 工具回 `needsScopeChoice`，由模型转问用户「存项目还是全局」，带选择重调。`delete_saved` 对称识别（项目优先、回退全局并回报实际删除的一级）。
8. 斜杠命令：`/workflow` 随插件挂载**自动注册**（无需配置；与既有命令重名时只降级告警）——
   - `/workflow create <任务描述>`：**按描述自动创建**——任务 steer 给当前会话的模型，经 `workflow_admin` 生成工作流脚本 → `eval` 干跑验证 → `create` 后台启动并回报 run id（值得复用再 `save`，scope 自动识别）；并行编排由脚本内的 `parallel()` 承担；
   - `/workflow`（或 `list`）：列出工作库（当前会话的项目 `.dsh` 优先，其次全局）与活跃运行；
   - `/workflow run <名称> [argsJSON]`：在当前会话启动一个已保存的工作流（后台运行，`/workflow runs` 查进度）；
   - `/workflow runs`：列出运行（最新在前）；`/workflow stop <runId>`：停止。
9. 依赖与安全：TS 脚本需要 esbuild（已声明 peerDependencies，随插件安装；纯 JS 无需）。运行与工作库落 `$DSH_HOME/workflows/{runs,saved}/`。

### ⌨️ 命令 & 钩子
1. 打开：设置 → 内置插件 → 「命令」「钩子」两个页签（命令 60、钩子 70，排在「子智能体」之后，先命令后钩子）。
2. 命令页签：新建/编辑（含改名）/启停/删除；保存即实时注册（fs.watch），会话里输入 `/名称 <输入>` 使用；「⬇ 导出 / ⬆ 导入」JSON 批量迁移（同名跳过）。
3. 钩子页签：编辑 hooks.json（事件 / 匹配器 / 命令 / 超时）→ 保存即热重启桥；「停用」移入 hooks.disabled.json；桥三态横幅——未安装点「⚡ 安装并挂载」→ 重启；Codex 兄弟桥同页第二条状态条。项目 hooks 与官方 hooks 桥共用同一默认超时（单钩子 10 分钟，即 dsh 官方 hook 协议默认值；可用 hooks 配置里的 `timeout` 按钩子覆盖）——若干挂起的钩子会串行拖慢当前轮次，可用轮次取消中断。原「项目」页签已删除。

### 🤖 自动化（定时任务 + Webhook）
1. 打开：设置 → 自动化——侧边栏一个入口，页内三个页签「定时任务」「Webhook」「工作流」。
2. **模板与新手引导**：三个页签顶部都有一句话说明 + 三步上手引导；「定时任务」「Webhook」各带 3 张模板卡片，点卡片自动填好编辑器（含 cron / 提示词 / 动作），改改参数就能用——定时任务：工作日早报（`0 9 * * 1-5`）/ 每周周报（`0 17 * * 5`）/ 每小时巡检（`0 * * * *`）；Webhook：CI 失败自动处理 / GitHub Issue 分诊 / 报警新建会话处理。
3. 新建任务：id（小写字母开头）+ **结构化频率编辑器**（每小时 / 每天 / 每周 / 自定义——每小时选分钟、每天与每周点时间与星期，自定义模式直接写五字段表达式）+ 动作——与 Webhook 同一套词：steer（选目标在线会话，插队/排队）或 create（workspacePath + agentPreset + permissionPreset）。编辑器下方实时回显合成后的表达式（本地时区，如 `0 * * * *`）与「进程重启期间到期的任务不补投」提示；五字段语法支持 `*` / 逗号列表 / 短横范围 / 斜杠步长，周接受 `0-7` 与 `SUN-SAT`（任务文件被外部直接编辑或沿用旧格式时按同一套解析器读入）。
4. 语义：**宿主级**——dsh 进程存活期间到点即触发，与任何会话无关（区别于 `dsh-schedule` 的会话级 every 语义与 300s 下限）。行内显示下次触发的实时倒计时与本地时刻；steer 目标不在线时标记「⚠ 目标会话离线」。
5. 手动：「▶ 立即触发」走与定时触发完全相同的路径（注入消息 / 新建会话 + 记录历史）。
6. 持久化与调度：任务存 `~/.dsh/cron-tasks.json`（原子写 + fs.watch 镜像，面板外的编辑在 300ms 防抖窗口内进入镜像）；调度器每任务一个 timer，触发前重读的是**内存镜像**（面板写入即时刷新它，外部文件编辑则等一次防抖），并复核到点时刻（timer 有上限 clamp，稀疏计划可能被提前唤醒，此时只重新挂表不执行）；插件卸载 / dsh 退出清理全部 timer。**进程停止期间到期的任务不补投**，恢复后重算下一个未来时刻。
7. 注意：cron 的 create 模式与 Webhook 共用 `@deepseek-ai/dsh-webhook` 运行时，需先在「Webhook」页签安装并挂载 → 重启。
8. Webhook 规则：id（小写字母开头）+ secret（新建规则自动生成 16 位随机密钥，「🎲 换一个」可重摇；编辑时留空=保持已存值）+ 可选事件名 + 动作——steer：选目标在线会话（插队/排队）；create：填 workspacePath（绝对路径）+ agentPreset + permissionPreset + 可选 model。
9. 触发：`POST /webhook-triggers/<规则ID>`，头 `x-webhook-secret`（必填），可选 `x-webhook-event` / `x-webhook-delivery`（幂等去重）；create 模式需先一键安装并挂载 `@deepseek-ai/dsh-webhook` 运行时 → 重启。
10. 测试：🧪 触发测试——注入测试消息并记录交付历史；面板底部查看历史（含失败原因）。
11. 持久化：交付历史（默认 200 条）与 `x-webhook-delivery` 去重集合落盘 `$DSH_HOME/webhook-history.json`（原子写），**重启 dsh 后历史保留、重发的同 delivery id 依旧去重**；容量可用插件 config 行 `webhookHistoryCap` 调整。
12. 注意：端点与 Web UI 同端口、绕过浏览器认证，secret 是唯一防线；默认 127.0.0.1 绑定时外部 SaaS 需隧道。

### 🔍 Web 搜索（Web 与会话 · 第二页签）
1. 打开：设置 → Web 与会话 → 「Web 搜索」页签。
2. 切换：radio 选 provider（deepseek-official / exa / perplexity）→ 重启 dsh。
3. 安装/卸载：仅 exa / perplexity 可装卸（deepseek-official 为 dsh 默认，不可卸）；卸载活动 provider 自动回落默认。
4. 配置：⚙ 编辑器按 provider 字段表（apiKey / baseURL / model / maxTokens 等）保存；密钥只写不回显。

### 📊 用量仪表盘
1. 打开：设置 → 用量仪表盘。
2. 日期范围胶囊（今天 / 24H / 7D / 30D / 90D / 全部）+ 项目筛选下拉。
3. 阅读：KPI 卡（token/会话/消息/活跃天数 + 环比）、每日趋势堆叠柱图、分时活跃热力图、本地洞察（缓存命中率/输出比异常等）。
4. 持久化：dsh 自身的 token 记账只存在于会话日志里——删掉会话，用量跟着消失。本插件三层兜底，删会话不再丢用量：
   - **实时事件观察**：订阅 `session/event` 事件流（每次 append 都触发），对**本进程从 seq 0 就开始观察**的会话按绝对量累计，2 秒防抖落盘，并在 `session/disposed` / `session/flush` 时立即落盘——会话在扫描间隔内被创建、用完、删掉也不会漏。
   - **后台定时快照**：每 60 分钟扫一遍整张会话表（`config.usageSnapshotIntervalMs`，毫秒；`0` 关闭，工具栏「⏱ 自动快照」显示状态与最近一次时间），覆盖**上次进程启动前就存在**的会话。
   - **删除前快照**：本插件自己的 `deleteSession` / `closeSession` 在删日志**之前**先把该会话的用量写进台账。
   台账在 `$DSH_HOME/usage-ledger.json`（每会话一行，原子写 + 串行队列；上限默认 2000 行、插件 config 行 `usageLedgerCap` 可调（100–100000），按最后见到时间淘汰）；被删会话以 `deleted: true` 留在数据里（不再单独打标记，只并入 KPI 与会话数）。空转不读日志（revision 缓存）也不写盘（无变化即跳过）；读取路径不会覆盖实时观察器掌握的数字。
   > 为什么不是 `fs.watch` 盯 `$DSH_HOME/sessions`：文件监听只能告诉你「目录/文件变了」，压缩日志要重新整份解析，而且删除事件和防抖窗口会互相抢跑；`session/event` 是 append 时刻的同步火线，更准也更省。

### ✅ 待办清单
1. 位置：聊天输入框正上方浮动面板，随会话实时投影。
2. 操作：勾选完成（删除线 + 进度条）、进行中项实时计时、已完成折叠为一行；右上角通知铃（后台完成时桌面通知）。
3. git 文件变更区：分支徽标 + 每文件 ±行数；「⧉ 复制 diff」；点击文件行在系统文件管理器中定位。

## 安装与启用

```sh
# 将本插件添加到 profile（以 web 为例）
pnpm dsh plugin --profile web add dsh-plugin-admin

# 或本地路径安装（开发场景）
# pnpm dsh plugin --profile web add ~/dsh-plugin-admin

# 重启 dsh 生效
pnpm dsh --profile web
```


## 自动化自检

```sh
npm test   # 28 个脚本：self-check / host-check / verify-* / integration-check
```

- `integration-check.mjs` 对真实 dsh checkout 做源码级契约探针（78 条断言，覆盖全部管理 RPC 命名空间与 workflow 引擎接缝）。
- `verify-i18n.mjs` 断言英文文案表与全部 `dshT()` 调用点互为覆盖（防新增文案漏翻）、英文值不得残留中文。
- `self-check.mjs` 末尾包含 **en 模式冒烟**：以英文 locale 重新物化一份客户端，断言导航/工具栏 chrome 翻译与语言切换控件。
- `verify-cron-panel.mjs` 在 jsdom 里真实挂载「自动化」页并驱动定时任务页签（列表 / 开关 / 手填编辑器：id + 每小时频率 → `0 * * * *` → 保存）；模板卡片路径由 `self-check` 用例 15y1 覆盖，两者互补。
- 诊断工具（不在 npm test 内）：`node scripts/repro-delete-session.mjs` 复现会话删除路径的全部失败模式（在线未捕获 / 布局漂移 / 并发竞态），用于把面板报错对号入座。

## 可调配置键（插件 config 行）

`resolvePluginConfig` 认 **14 个受校验的键**（下面第一张表）与 **11 个直通键**（第二张表）。前者写错类型 / 范围会在**挂载期直接报错**（fail-loud，不会静默降级）；后者**不做任何校验**、也不在导出的 `Config` schema 里，写错类型会被静默忽略并回落默认值（例如 `commandsDir: 5` 不报错，只是不起作用）——这是已知的不对称。

**受校验（14）**——`resolvePluginConfig`（`lib/index.js`）解析，`Config` schema 走同一个函数：

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

**直通（11）**——同一 config 行原样透传，由各子模块读；缺省即用下表默认值：

| 键 | 默认 | 说明 |
|---|---|---|
| `commandsDir` | `$DSH_HOME/commands` | 命令目录（缺失自动创建） |
| `hooksPath` | `$DSH_HOME/hooks.json` | hooks 存储 |
| `disabledPath` | `$DSH_HOME/hooks.disabled.json` | 停用钩子 sidecar |
| `codexHooksPath` | `$DSH_HOME/hooks.codex.json` | Codex 兄弟桥（手改文件） |
| `cronTasksPath` | `$DSH_HOME/cron-tasks.json` | 定时任务存储 |
| `webhookTriggersPath` | `$DSH_HOME/webhook-triggers.json` | Webhook 规则存储 |
| `webhookHistoryPath` | `$DSH_HOME/webhook-history.json` | 交付历史存储（与去重集合同文件） |
| `webhookHistoryCap` | 200 | 交付历史条数（1–10000，越界回落默认） |
| `projectCommands` | 启用 | `false` 关闭项目 `.agents` 命令注册 |
| `projectHooks` | 启用 | `false` 关闭项目 hooks 拦截 |
| `projectHooksTrust` | `confirm` | 仅 `allow-all` 启用自动放行，其余值一律 `confirm` |

> 路径类键（`commandsDir` / `hooksPath` / … / `cronTasksPath`）是测试与特殊部署用的覆盖点；只有 `usageLedgerCap` 额外受 `lib/usage-ledger.js` 自身预算钳制。

## 信任边界

浏览器端可触发本地 pnpm 安装（含 package prepare 脚本）、hooks 桥一键安装与挂载（桥会在宿主本地执行钩子命令）、会话日志物理删除——与 `dsh plugin` CLI 及本地管理同属最高本地信任级（loopback 默认信任面）。工作流脚本体来自模型或面板，可经 `shell()` 在宿主执行命令（走宿主 `ctx.shell`，受宿主审批与沙箱策略约束）——暴露到非本机前请务必评估权限范围。
