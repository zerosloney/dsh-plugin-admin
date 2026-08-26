# dsh-plugin-admin

dsh web UI 插件：在浏览器设置弹窗（侧边栏底部“设置”）中新增一个**管理中心**设置页，内含**插件管理**、**会话管理**、**MCP 配置**三个 Tab，按需加载当前面板。

- **🔌 插件管理**：
  - 顶部输入框支持 npm 包名（如 `dsh-xxx`）或本地绝对路径安装插件（回车或点击提交）；
  - 列表展示当前 profile 下的全部 bundle 层（名称、版本，以及**内置 / 包安装 / 本地安装**标记；本地安装的插件额外显示其源路径，依据 profile 依赖清单中的 `link:` / `file:` / 绝对路径 spec 判定）；
  - 支持扩展插件一键卸载（带有优雅的行内二次确认）；
  - **远程更新检测（自动）**：打开「插件管理」Tab 即自动按 profile 实际使用的 npm registry（`npm_config_registry` → 项目/用户 `.npmrc` → 官方源）查询每个 **registry 安装**的插件（跳过内置与本地路径安装）的 `latest` 版本，与本地版本比对——有新版时卡片显示琥珀色「⬆ 有新版本 vX.Y.Z」徽标并出现一键「⬆ 更新」按钮（`npm install <name>@latest`）；工具栏「⬆ 检查更新」可强制手动刷新；查询带超时与 5 分钟缓存（host 侧缓存，重启 dsh 后首次打开自动重查），网络失败按条目提示而非报错；
  - 安装/卸载在 host 侧编排 profile 目录下的 pnpm 并自动同步 `package.json` 的 `dsh.profile.bundles` 清单（变更在重启 dsh 后生效）。
- **💬 会话管理**：
  - **标题与内容摘要**：自动解析会话标题（`session/title` 或首条用户提问）并渲染首条消息的文本摘要气泡预览（带折行省略与多行保护）；
  - **元信息直观展示**：显示对话消息计数（如 `5 条消息`）、工作目录路径（`📁 项目名 (完整路径)`）、创建时间及短 Session ID；
  - **状态呼吸灯与徽标**：绿色呼吸光晕（**会话在线**，悬停提示说明"在线 = 仍挂载于 dsh host 内存，非正在运行"）、琥珀色标签（**已归档**）、灰色默认点（**已结束**）；
  - **多维快捷搜索与筛选**：输入框支持同时模糊匹配标题、对话摘要、工作目录或 Session ID；支持按状态胶囊筛选（全部、在线、已归档、已结束）；
  - **会话清理与恢复**：支持会话永久物理删除（行内二次防误触确认，彻底清理磁盘日志、工作区记账与归档集合）；**在线会话不再需要重启 dsh**——「关停并删除」通过插件在 host 侧透明捕获的 `AgentHandle` 走 dsh 官方 dispose 链（停止 agent 运行、等待静止、注销 agent、从内存 SessionStore 移除并触发 `session/disposed`，持久化层随即 flush 缓冲事件并释放写路径），然后才删除日志，因此日志不会在下次 flush 复活；支持已归档会话一键取消归档，侧边栏即时联动刷新。
- **🔌 MCP 配置**：管理中心中的独立 Tab——列出 profile 的 `cordis.patch.yml` 中所有 `@deepseek-ai/dsh-mcp-client` 实例，支持添加（stdio 子进程 / streamable-http）、编辑与移除，配置写回后重启 dsh 生效；新增**连通性检测**（🔌 测试）——host 侧按条目配置发起一次真实的 MCP 握手（`initialize` → `notifications/initialized` → `tools/list`），stdio 走新行分隔 JSON-RPC 子进程（Windows 下与 real 插件同样经 `cmd.exe` 解析 `.cmd` shim，超时强杀进程树、捕获 stderr 尾部便于诊断），streamable-http 走 `initialize` POST（兼容 SSE / 纯 JSON 响应）；成功后行内显示服务器标识、**工具数量与工具名列表**，失败给出可诊断错误（命令不存在 / 连接被拒 / 超时等）；若 `command` 写成整行调用（如 `npx -y fetcher-mcp`），探测会自动拆分执行并给出**警告**提示需拆分为 `command` + `args`（否则 dsh 启动该 MCP 服务器会失败）；结果经 typert 边界 JSON 安全清洗，绝无 `undefined` 字段。
- **侧边栏右键菜单（会话 & 工作区）**：
  - **会话行右键**：在原生菜单末尾追加**复制会话 ID**与**删除会话**（危险操作）；删除按标题**精确匹配**解析目标，存在同名会话时拒绝执行并引导到管理中心按 ID 删除，且菜单项需**4 秒内两次点击**确认；删除复用 `sessionAdmin` 的安全语义——在线会话走 `closeSession`（先 dispose 捕获的 agent handle 再删日志，不再要求重启），非在线会话走 `deleteSession`，均定向 detach。
  - **工作区行右键**：新增**在资源管理器打开**——调用 `fsAdmin.reveal` 在系统文件管理器中定位该工作区目录（Windows `explorer /select`、macOS `open -R`、Linux `xdg-open`）。

---

## 架构

- **Host 端（`lib/index.js`，零 dsh 依赖）**：
  - 注入 `['typert', 'workspaceRegistry', 'sessionPersistence']`；
  - 提供并注册四个 RPC 命名空间：
    - `pluginAdmin`（`list` / `install` / `remove` / `checkUpdates`）：异步 `spawn` pnpm（Windows 走 shell 解析 .cmd shim，5 分钟超时且**进程树强杀**（`taskkill /T /F`，避免超时后残留 pnpm/node 子进程继续写盘），Promise 尾链串行化防并发），镜像 CLI `reconcileBundles` 同步清单，清单写回为**原子写**（临时文件 + rename，崩溃不截断 profile 的 package.json）；安装/卸载参数经**字符白名单**校验（`assertPnpmOperand`），从根上排除 `&` `|` `>` `<` `%` 引号等 cmd 元字符注入向量；`install` / `remove` 返回真实 pnpm 输出尾部（`output` 字段），前端作为提示气泡的悬浮诊断信息展示；`checkUpdates` 对 registry 安装的 bundle 并发查询 npm registry 的 `latest`（registry 解析：`npm_config_registry` env → 项目/用户 `.npmrc` → 官方源；有界并发 4 路、8s 超时、5 分钟缓存），返回 `updateAvailable` / `latest` / `error`，本地路径与内置插件跳过；
    - `sessionAdmin` (`list` / `archive` / `unarchive` / `deleteSession` / `closeSession`)：直接对接 `workspaceRegistry` 与 `sessionPersistence`，提供安全幂等的持久化日志清理与归档状态流转；`list` 采用**修订号驱动的摘要缓存**（`listSnapshots` 的 revision token，未变化会话不重读事件日志）与**有界并发**（最多 4 路并行 inspect），并设单会话事件扫描上限兜底；`archive` 校验会话真实存在，拒绝向归档集写入垃圾 id；对 registry 软私有写路径（`requireState` / `setState` / `enqueueOperation`）在 `apply()` 挂载时即做**兼容性探测**，dsh 版本变更会明确报出缺失成员，而不是首次归档时才静默失败。`closeSession` 使**在线会话免重启删除**成为可能：`installAgentHandleCapture` 在挂载时透明包装公开的 `ctx.agents.create` / `resume`（原样调用并返回，仅把返回的 `AgentHandle` 按 session id 存入插件私有 Map），删除在线会话时先 `handle.dispose()` 走 dsh 官方 teardown 链（停止 loop → 等待静止 → 注销 agent → 从 SessionStore 移除 → 触发 `session/disposed` → 持久化层 `retire()` flush 缓冲事件并释放写路径），再删日志——日志不会被下次 flush 复活；未被捕获 handle 的在线会话（如插件挂载前已创建）会明确报错并引导重启，绝不误删。
    - `fsAdmin` (`reveal`)：跨平台在系统文件管理器中定位一个绝对路径（Windows `explorer /select`、macOS `open -R`、Linux `xdg-open`），供工作区右键菜单「在资源管理器打开」使用；
    - `mcpAdmin` (`list` / `upsert` / `remove` / `test`)：管理 profile 的 `cordis.patch.yml` 中的 MCP 客户端实例（`@deepseek-ai/dsh-mcp-client`）。基于行级 YAML 块编辑（零依赖）：识别顶层 `- id:` 块并仅改动 `name` 为 MCP 客户端插件的条目，`upsert` 按 id 原位替换或追加，`remove` 整块删除，写回走**原子写**；校验 id / serverName / transport / command / url，拒绝畸形输入；文件变更与插件安装共用同一**串行操作队列**（读-改-写不交错）。`test` 按条目 id 发起**连通性探测**：stdio 子进程（newline JSON-RPC，`initialize` → `initialized` → `tools/list`，超时 `taskkill /T /F` 强杀进程树，捕获 stderr 尾部）或 streamable-http（`fetch` POST `initialize`，兼容 SSE 与纯 JSON，超时 AbortController），返回服务器标识 / 工具数量 / 耗时，或失败原因（命令不存在、连接拒绝、超时等），全程不抛异常。
- **浏览器前端（`lib/client.js`）**：
  - 注入 `slots` + `connection`，向设置弹窗注册一个 `settings.section`：`plugin-admin`（管理中心, order 25）；页内 Tab 仅挂载当前面板；
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
```

自检套件覆盖：
1. Bundle 工厂加载与模块导出校验；
2. 单个“管理中心” `settings.section` 声明与注册，以及插件管理 / 会话管理 / MCP 配置 Tab 的按需切换；
3. 现代化统一样式注入（`<style>` 挂载与动画定义）；
4. React 组件真实挂载（JSDOM + React 18）；
5. 插件管理面板渲染、过滤统计与卸载二次确认交互；
6. 会话管理面板渲染（独立组件，无 Tab）、列表与状态渲染；
7. 会话删除二次确认交互；
8. **侧边栏菜单注入**：验证会话菜单追加「复制会话 ID / 删除会话」，删除项为**两次点击确认**（首击改写标签、二击才触发 RPC）且对**同名会话拒绝删除**；工作区菜单追加「在资源管理器打开」；
9. **MCP 配置面板渲染与保存流**：独立 MCP 设置页展示服务器列表、添加/编辑/移除入口与空状态；打开添加表单填写 id / serverName / command 后保存，断言 `mcpAdmin/upsert` 收到正确载荷、表单关闭且新服务器入列；**连通性测试按钮**（🔌 测试）触发 `mcpAdmin/test` 并在行内渲染 ✅ 连通（含服务器名与工具数量）。

Host 侧自检（`scripts/host-check.mjs`）覆盖六类契约：
1. `sessionAdmin.deleteSession` 的**定向 detach 契约**：删除会话只允许触碰实际记账该会话的那一个工作区，绝不允许批量遍历（dsh 的 `detachSession` 写入带剪枝语义——记录中所有不在 registry 内存头索引里的会话会被永久剥离；批量调用在索引不完整时会把无关工作区的记账整体清空，表现为所有会话落入"未分组"）；
2. **`closeSession` 免重启删除**：`installAgentHandleCapture` 透明包装 `ctx.agents.resume` 捕获返回的 `AgentHandle`，`closeSession` 对在线会话先 `dispose()`（断言恰好一次）再删日志与 detach；未被捕获 handle 的在线会话**失败闭合**（明确报错、日志目录完好）；非在线会话经 `closeSession` 与 `deleteSession` 行为一致；
2. **安装/卸载参数白名单**：`&` `|` `>` `<` `%` `!` 引号、前导 `-`（flag 伪装）等注入向量一律在 spawn 前拒绝，合法包名/作用域/版本/本地路径照常放行；
3. **本地安装判定**：远程 git/tarball URL（`https://`、`git+ssh://`、`github:` 简写）不再误标为本地安装，`link:`/`file:`/盘符/UNC/POSIX 路径仍正确解析；
4. **共享日志目录拒删**：删除会话前若发现其他持久化会话解析到同一目录，则拒绝递归删除，避免平铺布局下连带清掉邻居日志；
5. **registry 写路径挂载探测**：`workspaceRegistry` 缺失 `requireState` / `setState` / `enqueueOperation` 任一成员时，`apply()` 在挂载即抛错并指明缺失项；
6. **mcpAdmin 配置往返**：对临时 profile 的 `cordis.patch.yml` 做 list / upsert（新增、原位更新）/ remove，验证条目 id、serverName 与最终文件内容正确且仍是合法 YAML；同时校验畸形输入（非法 id / transport / 缺 command）被拒绝；`fsAdmin.reveal` 校验路径参数；
7. **mcpAdmin 写操作串行化**：并发 `upsert` 经与插件安装共享的操作队列后全部落盘，读-改-写不交错；
8. **mcpAdmin.test 连通性探测**：对真实 stdio MCP 服务器（newline JSON-RPC 握手）与 streamable-http 服务器（`initialize` POST）分别断言 `ok:true` 且携带 serverInfo / toolCount；对不存在的命令（`not found`）、静默子进程（超时）、死 HTTP 端点（连接失败）断言 `ok:false` 且错误可诊断；未知 id 被拒绝。

---

## 信任边界说明

该插件允许浏览器端触发本地 pnpm 安装（含 package prepare 脚本）以及会话日志物理删除，与 `dsh plugin` CLI 及本地管理同属最高本地信任级（loopback 默认信任面）。暴露到非本机前请务必评估权限范围。
