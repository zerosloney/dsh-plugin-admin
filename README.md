# dsh-plugin-admin

dsh（DeepSeek Harness）Web UI 管理插件：在官方设置界面内补齐 dsh 缺失的 11 个管理面板——扩展插件、历史会话、工作区、技能、MCP 服务器、子智能体、命令与钩子、Webhook 触发、Web 搜索、用量仪表盘、待办清单。零 dsh 导入，全部骑运行时 Cordis Context；写回统一原子写 + 串行队列，缺服务一律降级不挂死。

> 面板文案为简体中文硬编码（宿主 locale 体系不覆盖外部插件）。

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.17.5 · MIT

## 功能总览

| 面板 | 重点 |
|---|---|
| 🔌 扩展插件 | 安装 / 卸载 / 更新 / 启停 profile 插件（pnpm 编排 + bundles 清单同步），Loader 运行时快照 |
| 💬 历史会话 | 列表 / 搜索 / 归档 / 置顶 / 导出 Markdown / 体检报告 / 全文检索；在线会话免重启删除 |
| 📁 工作区 | workspace CRUD + 排序 + 归档集管理（dsh 无官方管理面） |
| 📚 技能 | 全量技能清单（全局层 + 会话作用域合并），严格只读、不加载正文 |
| 🔌 MCP 服务器 | 行级 CRUD + 真实握手探测 + 工具试调用台 |
| 🛰️ 子智能体 | 受管子代理 CRUD + 运行中监控 / 续接 + CLI 后端挂载 |
| ⌨️ 命令与钩子 | 提示词命令（实时生效）+ Claude / Codex hooks 桥 + 项目 `.agents` 只读视图 |
| 🪝 Webhook 触发 | 入站端点 → steer 在线会话 / 新建会话；验签 + 幂等去重 |
| 🔍 Web 搜索 | provider 切换 + 配置编辑（Exa / Perplexity 无官方 UI） |
| 📊 用量仪表盘 | 浏览器端实时聚合的 token 用量 / 活跃度分析 |
| ✅ 待办清单 | 输入框上方实时待办 + git 文件变更区 |

共同特性：所有写回（插件启停 / MCP / 子智能体 / 钩子桥 / Web 搜索 / Webhook 运行时 / overlay）收敛到 `lib/patch-utils.js` 的 `writePatch()`——原子写（temp + rename）+ 改写前把上一版留为 `cordis.patch.yml.dsh-admin.bak`（滚动一版），写坏用 `.bak` 覆盖重启；全部走共享串行操作队列，读-改-写不交错；依赖的 dsh 服务缺失时逐面板降级提示，绝不整插件不加载。

## 使用说明

所有面板入口：dsh 设置弹窗 → 对应导航项（各面板按需挂载）。改动 profile 配置的操作（插件安装/卸载/启停、MCP、Web 搜索、Webhook 运行时、overlay 启用）需**重启 dsh 生效**，面板内会提示。

### 🔌 扩展插件
1. 打开：设置 → 插件 → 「扩展插件」页签。
2. 安装：顶部输入框填 npm 包名（如 `dsh-xxx`）或本地绝对路径 → 回车提交 → 重启 dsh。
3. 更新：卡片「⬆ 更新」单升，或工具栏「⬆⬆ 全部更新」批量（实时进度）；「⬆ 检查更新」强制重查 registry。
4. 启停：卡片「⏸ 停用 / ▶ 启用」（仅自带 bundle patch 的扩展插件）→ 重启生效；已停用插件跳过更新检测。
5. 卸载：卡片「卸载」→ 行内二次确认。
6. 搜索/筛选：搜索框按名称/版本/路径模糊过滤 + 「全部 / 扩展插件 / 系统内置」胶囊。
7. Loader 快照：页底只读子面板，展开看各条目 fiber 阶段与 Agent 预设。

### 💬 历史会话
1. 打开：设置 → 历史会话。
2. 搜索/筛选：搜索框同时匹配标题/摘要/工作目录/会话 ID；状态胶囊「全部 / 在线 / 已归档 / 已结束」。
3. 置顶：卡片「📌」（localStorage 持久化），「📌 已置顶」胶囊直达。
4. 归档/取消归档：卡片按钮，侧边栏即时联动。
5. 删除：卡片「删除」→ 二次确认；在线会话显示「关停并删除」（先 dispose 再删日志，免重启）。
6. 导出：卡片「⬇ 导出」→ 下载 Markdown 对话稿。
7. 体检：卡片「🩺 体检」→ 工具调用/失败/重试折叠报告。
8. 全文检索：切换「全文搜索」输入关键词；若部署默认关闭（`openAt: never`），点「⚡ 一键启用」→ 重启 dsh。

### 📁 工作区
1. 打开：设置 → 工作区。
2. 新建：工具栏「➕ 新建工作区」→ 原生选择器选目录或手输绝对路径（可选标题）→ 提交；同名目录返回既有工作区。
3. 重命名/排序/状态：行内「✎」改名、「⬆/⬇」重排、「🔎 检查状态」（missing-dir 提示）。
4. 删除：🗑 双击确认——仅删注册，目录与会话本体保留。
5. 取消全部归档：归档集非空时顶部「📦 取消全部归档 (N)」。

### 📚 技能
1. 打开：设置 → 技能。
2. 浏览：卡片含 `/<name>`、🤖 模型可调用 / 👤 人类可调用旗标、来源标签、作用域明细。
3. 筛选：文本（名称/描述/whenToUse/路径）、来源、作用域——浏览器端过滤，零额外请求。
4. 复制/打开：📋 复制 `/name`；resourceBase 为目录时「📂 打开目录」在系统文件管理器中定位。

### 🔌 MCP 服务器
1. 打开：设置 → MCP服务器。
2. 添加：表单填 id / serverName / command（+args；整行命令如 `npx -y fetcher-mcp` 会被提示拆分）→ 保存 → 重启 dsh。
3. 测试：🔌 测试——真实握手（initialize → tools/list），成功显示服务器标识与工具列表；成功结果缓存到 localStorage（失败仅会话内）。
4. 试调用：🧪 试调用——选工具、粘贴 JSON 参数、真实执行一次 tools/call（60s 预算，16KB 截断）。
5. 编辑/移除：行内操作；与既有条目同 id 直接拒绝。

### 🛰️ 子智能体
1. 打开：设置 → 子智能体。
2. 新建：表单填名称（toolName）/ 提示词（persona，支持 `{{model}}`/`{{cwd}}`）/ 工具约束（allow/deny）/ 模型 / 执行后端 / 委托深度 / 后台模式；高级设置可展开。
3. 运行中：页签列出当前进程运行中的子智能体（实时计时 + 事件数）；「中断」二次确认；可续接的卡片行内输入消息，「排队」进下一轮 /「插队」在最近步骤边界进入。
4. CLI 后端：页签——检测 codex / claude-code provider 包 → 挂载 → 配置 → 卸载；「通用命令行后端」扫描 PATH 上其他 agent CLI（gemini / qwen / opencode 等）一键挂载或手填自定义命令。

### ⌨️ 命令与钩子
1. 命令页签：新建/编辑（含改名）/启停/删除；保存即实时注册（fs.watch），会话里输入 `/名称 <输入>` 使用；「⬇ 导出 / ⬆ 导入」JSON 批量迁移（同名跳过）。
2. 钩子页签：编辑 hooks.json（事件 / 匹配器 / 命令 / 超时）→ 保存即热重启桥；「停用」移入 hooks.disabled.json；桥三态横幅——未安装点「⚡ 安装并挂载」→ 重启；Codex 兄弟桥同页第二条状态条。
3. 项目页签：输入项目路径，查看 `.agents/` 的命令 / hooks / 技能识别情况与逐文件加载错误。

### 🪝 Webhook 触发
1. 打开：设置 → Webhook 触发。
2. 新建规则：id（小写字母开头）+ secret（≥16 字符，留空=保持已存值）+ 可选事件名 + 动作——steer：选目标在线会话（插队/排队）；create：填 workspacePath（绝对路径）+ agentPreset + permissionPreset + 可选 model。
3. 触发：`POST /webhook-triggers/<规则ID>`，头 `x-webhook-secret`（必填），可选 `x-webhook-event` / `x-webhook-delivery`（幂等去重）；create 模式需先一键安装并挂载 `@deepseek-ai/dsh-webhook` 运行时 → 重启。
4. 测试：🧪 触发测试——注入测试消息并记录交付历史；面板底部查看历史（含失败原因）。
5. 注意：端点与 Web UI 同端口、绕过浏览器认证，secret 是唯一防线；默认 127.0.0.1 绑定时外部 SaaS 需隧道。

### 🔍 Web 搜索
1. 打开：设置 → Web 搜索。
2. 切换：radio 选 provider（deepseek-official / exa / perplexity）→ 重启 dsh。
3. 安装/卸载：仅 exa / perplexity 可装卸（deepseek-official 为 dsh 默认，不可卸）；卸载活动 provider 自动回落默认。
4. 配置：⚙ 编辑器按 provider 字段表（apiKey / baseURL / model / maxTokens 等）保存；密钥只写不回显。

### 📊 用量仪表盘
1. 打开：设置 → 用量仪表盘。
2. 日期范围胶囊（今天 / 24H / 7D / 30D / 90D / 全部）+ 项目筛选下拉。
3. 阅读：KPI 卡（token/会话/消息/活跃天数 + 环比）、每日趋势堆叠柱图、分时活跃热力图、本地洞察（缓存命中率/输出比异常等）。

### ✅ 待办清单
1. 位置：聊天输入框正上方浮动面板，随会话实时投影。
2. 操作：勾选完成（删除线 + 进度条）、进行中项实时计时、已完成折叠为一行；右上角通知铃（后台完成时桌面通知）。
3. git 文件变更区：分支徽标 + 每文件 ±行数；「⧉ 复制 diff」；点击文件行在系统文件管理器中定位。

## 版本兼容性（钳制）

| 插件版本 | dsh 版本 | 状态 |
|---|---|---|
| v1.17.5 | **0.1.5-rc.2**（`latest` 标签，验证基线） | ✅ 全功能；取消归档降级（见下） |
| v1.17.5 | **0.1.6-alpha.2**（`alpha` 标签，最新发布） | ✅ 全功能（含 `unarchiveSession`） |

- **dsh 最新发布：0.1.6-alpha.2**（alpha 预发布；`latest` 标签仍为 0.1.5-rc.2）。升级命令：`npm i -g @deepseek-ai/dsh@0.1.6-alpha.2`。
- **0.1.5-rc.2 的 `dsh-workspace` 没有 `unarchiveSession`**（0.1.6-alpha.2 补上）：插件照常挂载（挂载时告警），删除已归档会话跳过归档清理、显式取消归档报清晰错误；升级到 0.1.6-alpha.2 后恢复完整。
- 版本敏感接缝（升级 dsh / cordis 后重跑 `npm test` 验证，各 verify 脚本对下述接缝做真实契约断言）：
  1. **workspaceRegistry 动词面**——`archiveSession` / `unarchiveSession` / `archivedSessionIds`（只走公开动词，不碰 TS-private `requireState` / `setState`）；
  2. **会话日志物理布局**——删除路径按 `dsh-session-persistence-jsonl` 的 `projectKey` / `encodeSegment` 推导目录，布局漂移或自定义后端时**拒绝删除并报错**；
  3. **hooks 桥热重启**——`fiber.update(config, true)`（cordis 内部 API），失败降级「已保存，需重启 dsh 生效」；
  4. **`ctx.agents.create/resume` 透明包装**——在线会话删除依赖捕获的 AgentHandle，包装不可写时降级「重启后再删」；
  5. **私有读取器**——`locate()` / `snapshotEvents()` / 投影缓存表名，漂移降级为空值 / 空列表。

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
npm test   # 18 个脚本：self-check / host-check / verify-* / integration-check
```

- `integration-check.mjs` 对真实 dsh checkout 做源码级契约探针（含统一描述符的十三个命名空间）。
- 诊断工具（不在 npm test 内）：`node scripts/repro-delete-session.mjs` 复现会话删除路径的全部失败模式（在线未捕获 / 布局漂移 / 并发竞态），用于把面板报错对号入座。

## 信任边界

浏览器端可触发本地 pnpm 安装（含 package prepare 脚本）、hooks 桥一键安装与挂载（桥会在宿主本地执行钩子命令）、会话日志物理删除——与 `dsh plugin` CLI 及本地管理同属最高本地信任级（loopback 默认信任面）。暴露到非本机前请务必评估权限范围。
