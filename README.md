# dsh-plugin-admin

dsh web UI 插件：把管理能力拆进设置界面的既有结构——在官方**插件**设置页新增**扩展插件**页签，并在设置栏新增 **MCP服务器**、**子智能体**、**命令与钩子** 与 **历史会话** 四个独立设置页，按需加载当前面板。v0.5.0 起吸收了原独立插件 `dsh-plugin-subagents` 的全部能力（子智能体管理 + CLI 后端挂载），v0.7.0 起吸收了原独立插件 `dsh-command-hook-admin` 的全部能力（提示词命令 + 钩子管理 + hooks 桥一键安装）。

- **🔌 扩展插件**（插件设置页第三个页签，位于「插件配置」「插件列表」之后）：
  - 顶部输入框支持 npm 包名（如 `dsh-xxx`）或本地绝对路径安装插件（回车或点击提交）；
  - 列表展示当前 profile 下的全部 bundle 层（名称、版本，以及**内置 / 包安装 / 本地安装**标记；本地安装的插件额外显示其源路径，依据 profile 依赖清单中的 `link:` / `file:` / 绝对路径 spec 判定），按 **内置 → 包安装 → 本地安装** 排序，卡片以一行两列栅格展示（窄屏回落单列）；名称过长时单行省略显示，悬停可见完整名称；
  - **名称模糊搜索**：列表上方搜索框支持按插件名 / 版本号 / 本地路径模糊过滤（大小写不敏感子串匹配），可叠加「全部 / 扩展插件 / 系统内置」筛选胶囊，无结果时给出专属空状态提示；
  - 支持扩展插件一键卸载（带有优雅的行内二次确认）；
  - **远程更新检测（自动）**：打开「扩展插件」页签即自动按 profile 实际使用的 npm registry（`npm_config_registry` → 项目/用户 `.npmrc` → 官方源）查询每个 **registry 安装**的插件（跳过内置与本地路径安装）的 `latest` 版本，与本地版本比对——有新版时卡片显示琥珀色「⬆ 有新版本 vX.Y.Z」徽标并出现一键「⬆ 更新」按钮（升级时优先用 checkUpdates 已探测到的精确版本号 `npm install <name>@<version>`；host 端对 `@latest` 会先查 registry 解析为精确版本再安装，避免 pnpm 在已有范围约束下误判 "Already up to date" 而静默不更新）；工具栏「⬆ 检查更新」是唯一的手动重查入口，**强制绕过 5 分钟缓存直接重查 registry 并刷新缓存内容**（自动检查走缓存，手动检查才是真查）；查询带超时与 5 分钟缓存（host 侧缓存，**缓存命中时按当前安装版本重算 `updateAvailable`**，重启 dsh 后首次打开自动重查），网络失败按条目提示而非报错；**「有新版本」提醒会保存下来（浏览器 localStorage 持久化）**——关闭再进入页签、甚至重启 dsh 后依然显示（含本次检查网络失败时），**只有点「更新」真正升级、或后续检查确认已是最新版本后，提醒才自动消除并同步清掉持久化记录；更新其中一个插件不会影响其余插件的提醒；升级完成后的自动复核同样**强制绕过缓存**重新查询，registry 在 TTL 窗口内刚发布更新的情况下也不会把刚升完级的插件误标回「有新版本」，检查与升级并发交错时，检查刚发现的提醒也不会被升级提交用旧快照覆盖（合并一律基于当前 state 的函数式更新，持久化由统一的镜像 effect 收口）；
  - 安装/卸载在 host 侧编排 profile 目录下的 pnpm 并自动同步 `package.json` 的 `dsh.profile.bundles` 清单（变更在重启 dsh 后生效）。
- **💬 历史会话**（设置栏独立页）：
  - **标题与内容摘要**：自动解析会话标题（`session/title` 或首条用户提问）并渲染首条消息的文本摘要气泡预览（带折行省略与多行保护）；
  - **元信息直观展示**：显示对话消息计数（如 `5 条消息`）、工作目录路径（`📁 项目名 (完整路径)`）、创建时间及短 Session ID；
  - **状态呼吸灯与徽标**：绿色呼吸光晕（**会话在线**，悬停提示说明"在线 = 仍挂载于 dsh host 内存，非正在运行"）、琥珀色标签（**已归档**）、灰色默认点（**已结束**）；
  - **多维快捷搜索与筛选**：输入框支持同时模糊匹配标题、对话摘要、工作目录或 Session ID；支持按状态胶囊筛选（全部、在线、已归档、已结束）；
  - **会话清理与恢复**：支持会话永久物理删除（行内二次防误触确认，彻底清理磁盘日志、工作区记账与归档集合）；**在线会话不再需要重启 dsh**——「关停并删除」通过插件在 host 侧透明捕获的 `AgentHandle` 走 dsh 官方 dispose 链（停止 agent 运行、等待静止、注销 agent、从内存 SessionStore 移除并触发 `session/disposed`，持久化层随即 flush 缓冲事件并释放写路径），然后才删除日志，因此日志不会在下次 flush 复活；支持已归档会话一键取消归档，侧边栏即时联动刷新。
  - **🔌 MCP服务器**（设置栏独立页）：列出 profile 的 `cordis.patch.yml` 中所有 `@deepseek-ai/dsh-mcp-client` 实例，支持添加（stdio 子进程 / streamable-http）、编辑与移除，配置写回后重启 dsh 生效；新增**连通性检测**（🔌 测试）——host 侧按条目配置发起一次真实的 MCP 握手（`initialize` → `notifications/initialized` → `tools/list`），stdio 走新行分隔 JSON-RPC 子进程（Windows 下与 real 插件同样经 `cmd.exe` 解析 `.cmd` shim，超时强杀进程树、捕获 stderr 尾部便于诊断），streamable-http 走 `initialize` POST（兼容 SSE / 纯 JSON 响应）；成功后行内显示服务器标识、**工具数量与工具名列表**，失败给出可诊断错误（命令不存在 / 连接被拒 / 超时等）；若 `command` 写成整行调用（如 `npx -y fetcher-mcp`），探测会自动拆分执行并给出**警告**提示需拆分为 `command` + `args`（否则 dsh 启动该 MCP 服务器会失败）；结果经 typert 边界 JSON 安全清洗，绝无 `undefined` 字段；
  - **测试结果的缓存边界**：只有**成功**的探测结果持久化到 localStorage（重开面板/重启后恢复上次状态并标注「缓存于」时刻）；**失败（❌ 不通）只在当前会话内显示、不落盘**——瞬时故障不会变成跨会话的过期 ❌，旧版本遗留的失败记录会在载入时自动清除；新增表单中手输与既有条目相同的 id 会被**直接拒绝并提示换名**——host 的 upsert 按 id 原位覆盖，不拦截就是静默毁掉该条目的既有配置。
- **🛰️ 子智能体**（设置栏独立页，order 26，融合自原 dsh-plugin-subagents 插件）：
  - **运行中**标签页：列出当前 dsh 进程正在执行的子智能体（后端、模式、委托深度、父/子会话）；可续接子智能体提供二次确认的中断入口，一次性任务明确标为不可中断；
  - 对 profile `cordis.patch.yml` 中全部受管子代理（`@deepseek-ai/dsh-tool-subagent` 实例行）做**新建 / 编辑 / 删除**：子代理名称（`toolName`，模型可见的委托工具名）、提示词（`persona`，支持 `{{model}}` / `{{cwd}}` 模板变量）、工具约束（`toolFilter.allow` / `deny`，候选来自运行中工具 ∪ 内置名录，未知工具名保存时拒绝）、模型指定（`agentOptions.provider` / `model` / `maxTokens`，留空继承父代理路由）；另有执行后端（按运行中实例枚举能力矩阵）、最大委托深度、后台模式、run_in_background 开关与**变更记录**（配置台账 `subagent-admin.history.jsonl`，超 512KB 自动轮转）；
  - **CLI 后端**标签页：内置 CLI 后端（codex / claude-code provider 包）检测 → 挂载 → 配置（providerName / permissionMode / disposeGraceMs / env）→ 卸载，provider 包缺失时提供「安装依赖包」（`npm install -g`）；**通用命令行后端**扫描 PATH 上的其他 agent CLI（gemini / qwen / opencode 等）一键挂载或手填自定义命令，配置持久化在 profile 目录 `subagent-admin.cli.json` 并即时注册 one-shot 命令 provider（`{prompt}` 占位符替换、stdout 即结果、非零退出记失败）；providerName 改名/卸载受子智能体实例引用守卫保护；
  - 校验 host 端 fail loud、客户端同步预检（保留名、实例间重名、行 id 冲突、provider 能力矩阵、allow/deny 交集等）；卡片带 live 状态灯（工具已挂载 / 后端在线）；
  - 表单默认只展示身份、执行后端与提示词；工具权限、模型、递归和后台策略收进可展开的高级设置，保存操作固定在表单底部。切换执行后端会立即清除不支持的提示词/工具约束并收敛深度与后台模式；工具约束允许搜索或手动输入，但仅当前候选工具可保存；
  - **向后兼容**：受管块标记注释（`# >>> dsh-plugin-subagents managed rows ... <<<` 与 cli backends 标记）字节级保留，原独立插件写入的既有配置、台账与 `subagent-admin.cli.json` 继续被识别与管理；从旧插件迁移只需 `pnpm dsh plugin --profile web remove dsh-plugin-subagents` 后重启（受管行无需改动）。
- **⌨️ 命令与钩子**（设置栏独立页，order 27，融合自原 dsh-command-hook-admin 插件，三页签；**迁移注意**：与本插件并存会让两个插件同时注册 `commandHookAdmin` 服务——先 `pnpm dsh plugin --profile web remove dsh-command-hook-admin` 再重启，数据文件（`commands/`、`hooks.json`、`hooks.disabled.json`）无需任何改动）：
  - **命令（提示词命令，实时生效）**：为纯内存的 slash 命令注册表（`ctx.commands`）补上文件后端——存储于 `$DSH_HOME/commands/*.json`（默认 `~/.dsh/commands/`，`DSH_HOME` 可整体迁移），每个文件一条命令（name / description / inputHint / prompt / images / enabled）。会话中输入 `/名称 <输入>` 时，宿主把提示词（`$ARGUMENTS` 替换为输入；未写占位符则追加到末尾）作为一条用户消息 steer 进当前 agent——与官方 `/plan` 相同的注入通道；勾选「接受图片附件」的命令可携带图片。**实时生效**：插件以 `ctx.commands.register()` 动态注册，`fs.watch` 防抖监听目录——面板保存或任何编辑器直接改文件都即时重新注册，无需重启；与内置命令重名的文件跳过注册并在列表中标记「注册失败」（悬停看原因）。面板支持新建 / 编辑（含改名）/ 启停 / 删除（行内二次确认）。
  - **钩子（Claude Code 格式，写文件 + 桥热重启）**：沿用 stock 桥 `@deepseek-ai/dsh-hooks-claude-code` 的配置格式与执行语义（本插件不执行钩子）。存储于 `$DSH_HOME/hooks.json`（裸事件表与 `{ "hooks": {...} }` 包裹格式都可读，保存时保持原有格式、外来键不动）；「停用」的条目移入旁车文件 `$DSH_HOME/hooks.disabled.json`（桥会执行文件里的每一条、没有 enabled 标记，移出文件才能保证停用真正生效）。每次保存 / 启停 / 删除后，插件通过 `fiber.update(config, true)` **热重启已挂载的桥条目**（宿主 loader 在条目 config 变更时用的同一重启通道），即时生效（重启瞬间钩子有约一秒空窗）；缺少该 API 或重启失败时面板如实回退提示「重启 dsh 后生效」。支持事件与匹配器校验与桥一致：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` / `SubagentStart` / `SubagentStop`，仅 `PreToolUse`/`PostToolUse` 有匹配对象（工具名字面量 `A|B` 或正则；非法正则保存时被拒绝，避免桥在加载时拒绝整个配置）。
  - **hooks 桥一键安装/卸载（桥接包固化）**：不再需要手改 profile 配置——面板检测桥的三态（已挂载 / 已安装未挂载 / 未安装）并给出对应横幅：未安装时一键「⚡ 安装并挂载 hooks 桥」在 profile 目录执行 `pnpm add @deepseek-ai/dsh-hooks-claude-code` 并向 `cordis.patch.yml` 写入挂载行（`configPath` 自动指向本面板管理的 hooks.json 绝对路径，`[]` 占位符场景正确替换），随后提示重启 dsh 生效；卸载走两击确认，移除挂载行与依赖包。安装/卸载与插件安装、MCP、子智能体共享同一**串行操作队列**（都写 `package.json` 与 `cordis.patch.yml`，互不交错），写回均为原子写。
  - **项目（`.agents`，只读视图，v0.8.0）**：按会话或任意项目内路径，查看该项目 `.agents/` 的识别情况——`commands/*.md`（Claude Code 格式 markdown 命令，文件名 stem 即命令名，frontmatter `description` + 正文 prompt，`$ARGUMENTS` 替换）、`hooks.json` 或 `settings.json` 的 `hooks` 键（事件 / 匹配器 / 命令 / 超时）、`skills/`（dsh 原生发现，模型经 skill 工具调用）；每个文件 / 条目的加载失败原因（名称不合法、缺 frontmatter、空提示词、name 与文件名不一致、配置解析失败）就地展示。命令在会话创建时**按项目注册进该会话的作用域层**（同名命令项目版遮蔽全局版，会话结束自动卸载）；hooks 由插件内建的**按会话项目桥**在五个扩展点执行（语义与 stock 桥一致：exit 2 阻断、JSON `permissionDecision`、additionalContext、`${CLAUDE_PROJECT_DIR}` 替换），与全局桥独立叠加。配置开关：cordis 配置行 `projectCommands: false` / `projectHooks: false` 可分别停用。
- **侧边栏右键菜单（会话 & 工作区）**：
  - **会话行右键**：在原生菜单末尾追加**复制会话 ID**与**删除会话**（危险操作）；删除按标题**精确匹配**解析目标，存在同名会话时拒绝执行并引导到历史会话按 ID 删除，且菜单项需**4 秒内两次点击**确认；删除复用 `sessionAdmin` 的安全语义——在线会话走 `closeSession`（先 dispose 捕获的 agent handle 再删日志，不再要求重启），非在线会话走 `deleteSession`，均定向 detach。
  - **工作区行右键**：新增**在资源管理器打开**——调用 `fsAdmin.reveal` 在系统文件管理器中定位该工作区目录（Windows `explorer /select`、macOS `open -R`、Linux `xdg-open`）。

---

## 架构

- **Host 端（`lib/index.js`，零 dsh 依赖）**：
  - 注入 `['typert', 'workspaceRegistry', 'sessionPersistence', 'tools', 'subagents', 'commands', 'shell']`；
  - 提供并注册六个 RPC 命名空间：
    - `pluginAdmin`（`list` / `install` / `remove` / `checkUpdates`）：异步 `spawn` pnpm（Windows 走 shell 解析 .cmd shim，5 分钟超时且**进程树强杀**（`taskkill /T /F`，避免超时后残留 pnpm/node 子进程继续写盘），Promise 尾链串行化防并发），镜像 CLI `reconcileBundles` 同步清单，清单写回为**原子写**（临时文件 + rename，崩溃不截断 profile 的 package.json）；安装/卸载参数经**字符白名单**校验（`assertPnpmOperand`），从根上排除 `&` `|` `>` `<` `%` 引号等 cmd 元字符注入向量；`install` 收到以 `@latest` 结尾的 spec 时，先查 registry 解析为**精确版本**再 `pnpm add`（避免 pnpm 在 manifest 已有满足版本的范围约束时误判 "Already up to date" 而静默不更新——这正是旧版「点更新无反应」的根因），registry 不可达时退回原 spec 让 pnpm 显式报错；`install` / `remove` 返回真实 pnpm 输出尾部（`output` 字段），前端作为提示气泡的悬浮诊断信息展示；`checkUpdates` 对 registry 安装的 bundle 并发查询 npm registry 的 `latest`（registry 解析：`npm_config_registry` env → 项目/用户 `.npmrc` → 官方源；有界并发 4 路、8s 超时、5 分钟缓存；`force` 参数为 true 时**绕过缓存强制重查并刷新缓存内容**），返回 `updateAvailable` / `latest` / `error`，本地路径与内置插件跳过；
    - `sessionAdmin` (`list` / `archive` / `unarchive` / `deleteSession` / `closeSession`)：直接对接 `workspaceRegistry` 与 `sessionPersistence`，提供安全幂等的持久化日志清理与归档状态流转；`list` 采用**修订号驱动的摘要缓存**（`listSnapshots` 的 revision token，未变化会话不重读事件日志）与**有界并发**（最多 4 路并行 inspect），并设单会话事件扫描上限兜底；`archive` 校验会话真实存在，拒绝向归档集写入垃圾 id；对 registry 软私有写路径（`requireState` / `setState` / `enqueueOperation`）在 `apply()` 挂载时即做**兼容性探测**，dsh 版本变更会明确报出缺失成员，而不是首次归档时才静默失败。`closeSession` 使**在线会话免重启删除**成为可能：`installAgentHandleCapture` 在挂载时透明包装公开的 `ctx.agents.create` / `resume`（原样调用并返回，仅把返回的 `AgentHandle` 按 session id 存入插件私有 Map），删除在线会话时先 `handle.dispose()` 走 dsh 官方 teardown 链（停止 loop → 等待静止 → 注销 agent → 从 SessionStore 移除 → 触发 `session/disposed` → 持久化层 `retire()` flush 缓冲事件并释放写路径），再删日志——日志不会被下次 flush 复活；未被捕获 handle 的在线会话（如插件挂载前已创建）会明确报错并引导重启，绝不误删。
    - `fsAdmin` (`reveal`)：跨平台在系统文件管理器中定位一个绝对路径（Windows `explorer /select`、macOS `open -R`、Linux `xdg-open`），供工作区右键菜单「在资源管理器打开」使用；
    - `mcpAdmin` (`list` / `upsert` / `remove` / `test`)：管理 profile 的 `cordis.patch.yml` 中的 MCP 客户端实例（`@deepseek-ai/dsh-mcp-client`）。**依赖自装（v0.8.1）**：`upsert` 在写入行之前先确保 `@deepseek-ai/dsh-mcp-client` 是 profile 的直接依赖（缺失则走宿主 pnpm 安装并同步 bundles 清单，即 `bridgeInstall` 的模式——组合后的行从 profile 根导入该包，没装包的行会让整棵树起不来；安装失败则不写行；安装按 profile 已有 `@deepseek-ai/dsh-*` 依赖的**锁步版本**钉版——registry 的 `latest` 标签严重滞后；装完主包还会补全其 `@deepseek-ai/dsh-*` peerDependencies——dsh profile 固定 `autoInstallPeers: false`，peer 不会自动装，缺了运行时 import 会在启动时炸整棵插件树，present 路径同样补全以自愈旧装残留）。基于行级 YAML 块编辑（零依赖）：条目一律写成 loader 认的 `- insert:` 包装块（裸 `- id:` 行是对既有条目的覆盖，基树无此 id 时被 loader 静默丢弃——旧版写出的死行仍可列出，标记 `legacy: true`，下次保存自动升级）；同一 insert 块内手工并列的多条目在替换/删除单条时保留其余；`upsert` 按 id 原位替换或追加，`remove` 整块删除，写回走**原子写**；校验 id / serverName / transport / command / url，拒绝畸形输入；文件变更与插件安装共用同一**串行操作队列**（读-改-写不交错）。`test` 按条目 id 发起**连通性探测**：stdio 子进程（newline JSON-RPC，`initialize` → `initialized` → `tools/list`，超时 `taskkill /T /F` 强杀进程树，捕获 stderr 尾部）或 streamable-http（`fetch` POST `initialize`，兼容 SSE 与纯 JSON，超时 AbortController），返回服务器标识 / 工具数量 / 耗时，或失败原因（命令不存在、连接拒绝、超时等），全程不抛异常。
    - `subagentAdmin`（`list` / `runtimeList` / `runtimeInterrupt` / `upsert` / `remove` / `history` / `cliList` / `cliUpsert` / `cliRemove` / `cliInstall`，实现于 `lib/subagent-admin.js` + `lib/tool-seed.js`）：管理 `@deepseek-ai/dsh-tool-subagent` 受管行与 CLI 后端；`runtimeList` 仅枚举当前进程实际运行的子智能体，`runtimeInterrupt` 在中断前复核子会话的父会话归属；行级 YAML 编辑与 mcpAdmin 同源思路（只动标记块内受管行，其余字节级保留，原子写 + 首次修改自动备份）；与 mcpAdmin / 插件安装**共用同一串行操作队列**——两个命名空间都读-改-写同一份 `cordis.patch.yml`，队列共享保证互不交错；typert 注册表对每个 package 名只允许一次注册，故其 invocations（`dsh-plugin-admin/subagent/*` id）**并入宿主的统一描述符**（单一注册承载全部六个命名空间）。
	    - `commandHookAdmin`（`listCommands` / `saveCommand` / `deleteCommand` / `listHooks` / `saveHook` / `deleteHook` / `setHookEnabled` / `bridgeInstall` / `bridgeRemove`，实现于 `lib/command-hook-admin.js`，融合自原 dsh-command-hook-admin 插件）：命令文件 CRUD + `ctx.commands` 实时注册 + `fs.watch` 防抖监听外部编辑；hooks.json / hooks.disabled.json 双存储读写（保持既有 JSON 格式与外来键，原子写）+ 桥热重启（`fiber.update(config, true)`，无桥时如实报告）；`bridgeInstall` / `bridgeRemove` 固化桥包生命周期——pnpm add/remove `@deepseek-ai/dsh-hooks-claude-code` + `cordis.patch.yml` 挂载行（`configPath` 指向面板的 hooksPath 绝对路径），与插件安装共享串行队列与 pnpm runner，invocations（`dsh-plugin-admin/commands/*`、`dsh-plugin-admin/hooks/*` id）同样并入统一描述符。
    - `projectAdmin`（`list`，实现于 `lib/project-hooks.js`，复用 `lib/project-agents.js` 的命令扫描与项目根解析）：只读视图——给定 cwd 解析项目根（向上找 `.git`，无则 cwd 本身），返回该 `.agents/` 的命令（含每文件加载错误）、hooks（来源文件 / 事件 / 匹配器 / 命令 / 超时 / 解析错误）与技能名列表；面板「项目」页签的数据源。
- **浏览器前端（`lib/client.js`）**：
  - 注入 `slots` + `connection`，注册五个界面贡献：向官方插件设置页的 `settings.plugins.tab` 注册「扩展插件」页签（id `extensions`，order 20，排在「插件配置」0 与「插件列表」10 之后）；向设置弹窗注册四个 `settings.section`：`mcp-servers`（MCP服务器, order 25，紧跟「Agent 预设」）、`subagent-admin`（子智能体, order 26，样式以 `data-dsh-sa-section` 作用域隔离）、`command-hook-admin`（命令与钩子, order 27，样式以 `data-cha-section` 作用域隔离）与 `session-history`（历史会话, order 100）；面板随官方页签/分区按需挂载；
  - 采用模块表平台词 `require('react')` 与 Shell 共享同一 React 实例；
  - 深度利用 `--dsw-*` design tokens，自适应浅色/深色主题，支持卡片式布局、状态呼吸灯、加载动效（Spinner）、危险操作防误触确认条与空状态提示；
  - 经 `/api` RPC Gateway 调用 Host 对应服务的 Remote 方法；
  - 新增**侧边栏菜单注入**（纯 DOM，无需 dsh 源码改造）：MutationObserver 监听原生三点菜单弹层的出现，识别会话/工作区菜单并在末尾追加自定义项；会话行按标题解析身份（复制 ID 允许模糊匹配，删除仅**精确匹配**且同名拒绝、两次点击确认），工作区行按标题解析路径后调 `fsAdmin/reveal`。

---

## 安装与启用

```sh
# 将本插件添加到 profile（以 web 为例）
pnpm dsh plugin --profile web add E:/Demo/cli-tools/dsh-plugin-admin

# 重启 dsh 生效
pnpm dsh --profile web
```

---

## 发布到 npm（CI/CD）

该仓库已配置 GitHub Actions：**CI** 在每次 push / PR 上跑 `npm ci && npm test`（Node 22/24 矩阵）；**发布**在推送 `v*` tag 时触发，校验 tag 与 `package.json` 版本一致后 `npm publish --provenance`。

```sh
# 1. 本地发版：bump 版本并打 tag（同时更新 package.json）
npm version patch -m "chore: release v%s"
git push origin master --tags

# 2. GitHub Actions 自动：测试 → 校验版本一致 → 发布到 npm
```

前提：
- 仓库需配置 npm 发布密钥：**Settings → Secrets and variables → Actions**，添加 `NPM_TOKEN`（npmjs.com 的自动化 token，`--provenance` 需要 npm ≥9.5 且发布 job 具备 OIDC `id-token: write`，工作流已声明）。
- 首次发布若包名被占用，需先在 npmjs.com 认领。

---

## 自动化自检

```sh
node scripts/self-check.mjs
node scripts/host-check.mjs
node scripts/verify-subagents-host.mjs
node scripts/verify-subagents-client.mjs
node scripts/verify-command-hooks.mjs
```

自检套件覆盖：
1. Bundle 工厂加载与模块导出校验；
2. 五个 slot 注册（`settings.plugins.tab`「扩展插件」+ `settings.section`「MCP服务器」/「子智能体」/「命令与钩子」/「历史会话」），以及各面板的按需挂载；
3. 现代化统一样式注入（`<style>` 挂载与动画定义）；
4. React 组件真实挂载（JSDOM + React 18）；
5. 扩展插件页签渲染、过滤统计与卸载二次确认交互；**失败反馈可见性**：安装 / 更新 / 卸载的 RPC 返回 `{ok:false}` 时，错误文案渲染后**不被同批次触发的静默列表刷新清除**（旧实现在同一微任务里先写 error 再 reload，React 18 批处理把错误吞掉，失败表现为「点击没反应」），并同步弹出顶部浮动错误 toast（双通道：面板红条持久显示细节 + toast 醒目提示；toast 为**单例**——新提示原位替换旧提示并重启倒计时，同屏至多一条，快速连续失败不会重叠遮挡）；
6. 历史会话设置页渲染、列表与状态渲染；
7. 会话删除二次确认交互；
8. **侧边栏菜单注入**：验证会话菜单追加「复制会话 ID / 删除会话」，删除项为**两次点击确认**（首击改写标签、二击才触发 RPC）且对**同名会话拒绝删除**；工作区菜单追加「在资源管理器打开」；
9. **MCP 配置面板渲染与保存流**：独立 MCP 设置页展示服务器列表、添加/编辑/移除入口与空状态；打开添加表单填写 id / serverName / command 后保存，断言 `mcpAdmin/upsert` 收到正确载荷、表单关闭且新服务器入列；**连通性测试按钮**（🔌 测试）触发 `mcpAdmin/test` 并在行内渲染 ✅ 连通（含服务器名与工具数量）。
10. `verify-mcp-cache.mjs`：MCP 连通性测试缓存的 localStorage 往返（预置缓存渲染 / 新探测持久化 + 重挂载恢复 / 配置保存失效缓存 / **失败探测 `{ok:false}` 只存于会话不落盘、重挂载不复活 ❌**）；
11. `verify-update-reminders.mjs`：插件**更新提醒持久化**（保存下来、更新完删除提醒）——① 已保存的提醒在重开面板且本次检查网络失败时依然渲染且不被抹除；② 检查确认已是最新版本 → 徽标与 localStorage 记录同时清除；③ 点击卡片「⬆ 更新」→ 安装后提醒立即消失（含回调确认后仍不复活）；④ 某个插件查询出错时不丢失已有提醒；⑤ 同时有两个过时插件时**只更新其中一个**，另一个的提醒在重挂载（刷新）后依然保留、localStorage 也只留未更新那条；⑥ **首开即全量查询失败**时逐条渲染「⚠ 更新检查失败」标签并给出失败计数，绝不显示「全部为最新版本」——瞬时错误不写入 localStorage，下一次成功检查自动消退（混合轮次只对确实验证过的条目说「其余均为最新版本」）；⑦ 自动检查在飞期间点击「⬆ 更新」，检查刚发现的其他插件提醒**不会被升级提交用旧快照覆盖**（deferred 桩脚本化交错：先放行检查、再放行安装，中间断言提醒与 localStorage 均在；旧实现在此处会丢失提醒且跳过升级后的强制复核）。
12. `verify-subagents-host.mjs`：子智能体 host 契约——patch 编辑器往返（序列化 → 解析、原位替换、删除清块、遗留行迁移）、校验矩阵（保留名 / 能力缺口 / 未知工具 / allow-deny 交集）、apply() 挂载后的 CRUD + 台账 + 备份 + 原子写、CLI 后端块生命周期与检测矩阵（stub 探针）、真实 PATH 探测的存在性/版本分离语义（缺失名与绝对路径报 ✗，在位命令无论 `--version` 是否成功都报 ✓）、通用 CLI 后端校验与命令 provider 的 argv/退出码映射、`cli.json` 持久化与 live 注册；
13. `verify-subagents-client.mjs`：子智能体浏览器端——统一 bundle 内五个 slot 注册、「运行中」页签列出运行中子智能体并经二次确认中断、子智能体列表/空态渲染、新建表单四类字段保存载荷、客户端预检拦截保留名、编辑预填、两击删除、高级设置折叠与切换后端的能力收敛、变更记录页、LLM 目录下拉、CLI 后端检测卡片 / 挂载 / 两击卸载 / 通用后端挂载卸载 / 安装依赖包流；
14. `verify-command-hooks.mjs`：命令与钩子 host 契约——统一描述符的九个 invocation（namespace/service/id 形状）、命令文件 CRUD + `ctx.commands` 实时注册（`$ARGUMENTS` 处理器 steer 断言、改名、停用不注册、删除、输入校验 fail loud）、hooks.json 双格式读写（裸事件表与 `{hooks:…}` 包裹各自保持、外来键字节不动）、停用旁车文件进出（条目 id 随存储切换）、匹配器/超时校验矩阵、经 `fiber.update(config, true)` 的桥热重启断言、桥包生命周期（stub pnpm：安装写入挂载行且 `configPath` 指向面板 hooks.json、`[]` 占位符替换、幂等不重复装、既有 MCP 行保留、卸载移除行与依赖、未安装时卸载为 no-op）、全 stub 幂等 teardown。

「命令与钩子」浏览器端（并入 self-check.mjs）：五个 slot 注册断言（order 27）、命令/钩子两页签切换与列表渲染（活动/停用徽标、存储路径）、桥三态横幅（未安装 → 一键安装按钮、已安装未挂载 → 重启提示）、安装后提示文案不被 reload 报告覆盖、卸载两击确认（首击只布防、二击才发 RPC）。

Host 侧自检（`scripts/host-check.mjs`）覆盖下列契约：
1. `sessionAdmin.deleteSession` 的**定向 detach 契约**：删除会话只允许触碰实际记账该会话的那一个工作区，绝不允许批量遍历（dsh 的 `detachSession` 写入带剪枝语义——记录中所有不在 registry 内存头索引里的会话会被永久剥离；批量调用在索引不完整时会把无关工作区的记账整体清空，表现为所有会话落入"未分组"）；
2. **`closeSession` 免重启删除**：`installAgentHandleCapture` 透明包装 `ctx.agents.resume` 捕获返回的 `AgentHandle`，`closeSession` 对在线会话先 `dispose()`（断言恰好一次）再删日志与 detach；未被捕获 handle 的在线会话**失败闭合**（明确报错、日志目录完好）；非在线会话经 `closeSession` 与 `deleteSession` 行为一致；
2. **安装/卸载参数白名单**：`&` `|` `>` `<` `%` `!` 引号、前导 `-`（flag 伪装）等注入向量一律在 spawn 前拒绝，合法包名/作用域/版本/本地路径照常放行；
3. **本地安装判定**：远程 git/tarball URL（`https://`、`git+ssh://`、`github:` 简写）不再误标为本地安装，`link:`/`file:`/盘符/UNC/POSIX 路径仍正确解析；
4. **共享日志目录拒删**：删除会话前若发现其他持久化会话解析到同一目录，则拒绝递归删除，避免平铺布局下连带清掉邻居日志；
5. **registry 写路径挂载探测**：`workspaceRegistry` 缺失 `requireState` / `setState` / `enqueueOperation` 任一成员时，`apply()` 在挂载即抛错并指明缺失项；
6. **mcpAdmin 配置往返**：对临时 profile 的 `cordis.patch.yml` 做 list / upsert（新增、原位更新）/ remove，验证条目 id、serverName 与最终文件内容正确且仍是合法 YAML；同时校验畸形输入（非法 id / transport / 缺 command）被拒绝；`fsAdmin.reveal` 校验路径参数；
7. **mcpAdmin 写操作串行化**：并发 `upsert` 经与插件安装共享的操作队列后全部落盘，读-改-写不交错；
8. **mcpAdmin.test 连通性探测**：对真实 stdio MCP 服务器（newline JSON-RPC 握手）与 streamable-http 服务器（`initialize` POST）分别断言 `ok:true` 且携带 serverInfo / toolCount；对不存在的命令（`not found`）、静默子进程（超时）、死 HTTP 端点（连接失败）断言 `ok:false` 且错误可诊断；未知 id 被拒绝；
9. **checkUpdates 缓存命中回归**：5 分钟 TTL 内第二次查询命中缓存时，`updateAvailable` 按**当前安装版本**重算——仍落后版本 → 提醒保留（修复了缓存只存 latest 导致重开面板提醒丢失）；把安装版本抬到 latest 模拟升级完成 → 提醒自动消除（更新完删除提醒）；
10. **checkUpdates 强制刷新（force）**：「⬆ 检查更新」传入 `force` 时**绕过 TTL 真正重查 registry**（stub 请求计数递增），返回值立即反映 registry 新版本，且**下一个 TTL 内的普通查询直接吃到 force 刷新后的缓存内容**（检查更新强制更新缓存内容）；升级到刷新后的 latest → 提醒消除。

---

## 信任边界说明

该插件允许浏览器端触发本地 pnpm 安装（含 package prepare 脚本）、hooks 桥（`@deepseek-ai/dsh-hooks-claude-code`）的一键安装与挂载（桥会在宿主本地执行钩子命令）以及会话日志物理删除，与 `dsh plugin` CLI 及本地管理同属最高本地信任级（loopback 默认信任面）。提示词命令只是把文本 steer 进会话（与手打消息同级）；本插件管理 hooks 配置文件、不改变桥自身的信任级别——能改配置的人本来就能在宿主上执行命令。暴露到非本机前请务必评估权限范围。
