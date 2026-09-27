# Changelog

结构参考 Keep a Changelog，版本号遵循 SemVer。v1.20.0 之前的条目见 git tag（本文件自 v1.20.0 起补记）。

> 各节里的数量（探针条数 / 脚本个数 / RPC 方法数 / warning 数）是**该轮的快照**，不会随之后的工作回溯修改；要当前值请跑对应命令（`npm test` 的输出逐条列出）。唯一例外是最新一轮（`[Unreleased]` 与最新版本节）的数字，它们应与 HEAD 一致。

## [Unreleased]

### Fixed

- **`verify-cron-admin` 的分钟边界等待预算过紧**（70s → 150s）：该断言在 `check()` 开始真正 `await` 之后才被强制执行，而 70s 只给"下一分钟边界（≤60s）+ 定时器延迟"留了 10s 余量 —— 负载高的 2 核 runner 上会偶发红（1.25.0 发布后 master 上出现过一次）。同一脚本的第二处等待一并放宽。

### Changed

- **CI 失败现在会自报是哪个脚本、哪条断言**：发布任务的日志需要 admin 权限才能读（REST 日志接口无权限返回 403），而 `::error::` 行会被 GitHub 变成**注解**、公开仓库可匿名读取。`ci.yml` / `release.yml` 的门禁步骤加上 `NODE_OPTIONS=--import=./scripts/lib/ci-failure-annotation.mjs`：该预载保留 stderr 尾部，进程非零退出时把"脚本路径 + 最后几行"重新发成注解。这样"exit code 1"会直接变成 `::error::scripts/verify-cron-admin.mjs exited 1` + 失败断言原文（30 多个脚本零改动；本地只是多几行文本）。

## [1.25.0] - 2026-09-27

### Added（收尾批次：审计、并发写与质量门）

- **`.oxlintrc.json`（lint 策略落地）**：两个**生成产物**（`lib/client.js` / `lib/client.panels.js`）不再被 lint；`lib/**`（随包发布的宿主半）把 `no-unused-vars` / `no-useless-escape` 提为 **error**，`src/client/**` 与 `scripts/**` 保持 warning（客户端是 9k 行 React 树、改它要重建 470KB 产物；验证脚本保留可读性辅助）。首次收紧即清掉宿主半的真实死代码：4 个未用导入、`jobs`、3 个死常量 `RUN_*_PARAMS`、未用的 `stepFingerprint` / `SERVICE_KEY`、死函数 `lastDayOfMonth`、`toolCount`（含 2 处赋值）、3 处多余转义。lint 从 207 warning 降到 **145 warning / 0 error**。
- **CI 接缝探测新增一条**：读 dsh 的 `packages/client/ui-primitives/src/index.ts` 导出表，断言**浏览器半真正 import 的每个官方原子**都在其中（93 → 95 条契约）。这是替身桩看不到的一类漂移：原子改名后 bundle 会在加载时 "missed the module table" 整包失败。
- **`workflowAdmin` 纳入审计**（Phase F3 收口）：`startRun` / `stopRun` / `amendRun` / `resumeRun` / `answerRun` / `saveSaved` / `deleteSaved` / `runSaved` 进 trail —— 工作流能执行 `shell` 步骤，"谁启动的、什么时候"值得留痕。`listRuns` / `getRun` / `listSaved` / `getSaved` 是读路径，不进。
  这些动词**没有 `ok` 字段**（失败形态分别是 `{ id: null, error }`、非空 `diagnostics`、`{ answered: false }`、`{ stopped: false }`），通用"非 `ok:false` 即成功"的读法会把失败的启动记成成功，因此 `auditService` 新增可选的 `okOf`，由 `workflowAuditOk` 提供这个命名空间的读法。agent 侧入口（`workflow_admin` 工具、`/workflow` 命令）直接走 registry/library、不经过 RPC 服务面，仍由 run journal 记录。
- **`cron-tasks.json` 与 `webhook-triggers.json` 的读-改-写进锁**（F1/F2 扩展）：两个 dsh 实例同写一个 profile 时不再"各读、各改、各写"（后写者覆盖前者的任务/规则）。`mutateTasksStore` / `mutateRulesStore` 把「守卫读 + 校验 + 原子写」放进同一个跨进程锁，校验看到的 id 集/规则集就是写入替换的那一份。`docs/COMPAT.md` 新增「已知边界（并发写）」把仍有 ⚠️ 的存储逐条列清。
- **`LICENSE`（MIT 正文）**：此前 `package.json` 声明 MIT 但仓库没有许可文件，发布出去的 tarball 也就没有正文。

### Changed（收尾批次）

- **`esbuild` 改为可选 peer**（`peerDependenciesMeta.optional: true`）：代码本来就是"缺 peer 时给出明确诊断"的降级路径，声明为必需会让 npm 7+/pnpm 为每个消费者自动安装约 10MB。README 中英同步改成"可选；CI 用 `^0.28` 验证"。
- **`types/` 的两处准确性**：`dsh-client-ui-primitives.d.ts` 不再 `import type { ComponentType } from 'react'`（react 无类型，那行等于 `any` 却看着像真契约），改用本地结构类型并注明"启用 `@types/react` 是全客户端树的独立迁移"；`dsh-seams.d.ts` 的 `DshAgentPresets` 补上实际调用的 `list` / `resolve` / `serviceFor` / `defaultId` / `selectionPolicy`（原声明描述的是一个不存在的服务），文件头写明**哪些是强制的**（host-check / integration-check 探针）**哪些只是文档**。
- **`docs/COMPAT.md`「已知边界（并发写）」补齐两条易误判项**：交付历史一次投递最多整文件重写两次（先落去重集、再落历史行，都是有意为之，因此 `webhookHistoryCap` 建议 ≤ 1000）；`withFileLock` 是**失败开放**的（等 3 秒拿不到锁就照写，宁丢一次更新也不拒绝用户操作，原子 rename 仍保证不撕裂）。

### Fixed（收尾批次）

- **换行规则与产物校验的冲突（本版引入、CI 上必现）**：`.gitattributes` 的 `*.js text eol=crlf` 也命中了两个**生成的 bundle**，而 `build-client --check` 是拿磁盘上的文件与 esbuild 输出**逐字节**比对（esbuild 恒输出 LF）——于是**每一次全新 clone**（即 CI 的每一腿）都判定 "STALE" 并中断整个门禁；开发机上因为工作副本还是旧的 LF 反而看不出来。修法是两处：`.gitattributes` 把 `lib/client.js` / `lib/client.panels.js` 显式钉成 `eol=lf`（后出现的规则胜出），`build-client --check` 再把 CRLF 归一化后比对（这样编辑器重写文件也不会因换行而误报 STALE）。已用"删掉文件 → `git checkout` 重新物化"复现原故障、并验证两处修法各自生效。
- **Release 工作流缺少接缝探针的 checkout**：`integration-check` 在 CI 里没有 checkout 时**拒绝静默跳过**（第一档的改动），而 `release.yml` 从未取过 dsh 源码 —— 于是打 tag 后发布任务在 `npm test` 处就失败，**版本号校验与 `npm publish` 都没轮到**（v1.25.0 首次打 tag 的结果）。现在它和 `ci.yml` 一样先 checkout 固定版本 dsh 并设 `DSH_CHECKOUT`。
- **两处跨进程断言与锁的"失败开放"契约相矛盾**（测试自身的问题，非实现变更）：`withFileLock` 等 3 秒拿不到锁就照写是**有意设计**，而新加的并发写用例却断言"一个都不能丢"，在慢的 CI 机器上（windows-latest / Node 22 一腿）会因此偶发失败。改为允许 ≤2 / ≤1 的损耗并注明理由 —— 去掉锁的对照组仍会丢约一半，检测力不受影响（已重新伪证）。
- **`webhook-history.json` 的 `version` 此前只写不读**：来自更新版本的 sidecar 会被当成空 v1 读入、随后被覆写；`seen` 形状一变，已投递过的 delivery id 会被重新执行。现在读到更高的 `version` 就标记 `newer`：进程内历史环与去重仍工作（best-effort 不变），但**绝不回写**该文件，并告警一次。
- **`looksLikeTs` 的两个漏检**（esbuild 缺失时的降级路径）：`agent<Result>("x")` 与 `const rows: Row[] = []` 此前会被当成纯 JS交给 `new Function()`，报的是难懂语法错误而不是"esbuild 不可用"。补了泛型**调用**与类型注解两条模式（泛型要求首字母大写且后随调用，避免把 `a < B > c` 当类型实参）；该函数已导出并配 19 例断言，其中两个已知误报（注释/字符串里出现 `interface X`）也写进用例 —— 方向保持"保守拒绝、失败可见"。
- **`withFileLock` 的抢占路径不再空转**：抢到（unlink）过期锁后原本**立即**重试，两个进程可以互相抢对方的锁文件打满 CPU；现在退避 5ms + 随机抖动，并把「预算耗尽」的判断挪到抢占**之前**，失败开放照旧生效。另外**半写锁**（`open(…, 'wx')` 与写入 pid 之间的窗口）不再被当作过期锁抢占：250ms 内无主的锁一律等待，避免两个写者同时进入临界区。
- **`verify-cron-admin.mjs` 的异步断言此前在「最后一个注册」时会被静默吞掉**：`check()` 用 `chain.then(body, fail)`，rejected promise 只由**下一个**链节处理，末位失败被 `settle()` 的拒绝处理吞掉 —— 去掉存储锁的伪证因此"通过"了。现在 `check()` 自己 `await` 并计数，异步断言失败必定进 `failures`。
- `lib/webhook-triggers.js` 删除已无调用者的 `persist()`（`saveRule` / `deleteRule` 改走锁内的 `mutateRulesStore`）；`lib/index.js` 删掉 4 个未用导入。

### Changed (breaking)

- **不再支持 dsh 0.1.6**：支持范围收紧为 **dsh ≥ 0.1.7-rc.2**（决策与依据见 `docs/COMPAT.md` 的「版本策略」）。客户端静态引用平台共享模块（`@deepseek-ai/dsh-client-ui-primitives` / `-ui-slots` / `-client-store`）与 `ctx.locale`，0.1.6 的宿主模块表里没有这些 seed —— 缺一项就是**整包加载失败**而非降级。实现里已经没有 0.1.6 的回落分支，本次把口径改成事实。**升级前请先把 dsh 升到 ≥ 0.1.7-rc.2**；CI 也按该范围跑（pin `dsh-v0.1.7-rc.2` + `master` 预警）。
- **Webhook 入站默认只接受本机投递**（Phase F4 引入，本版明确为破坏性默认）：非 loopback 来源、以及**传输层报不出对端地址**的请求一律 403；要收远程投递必须显式开启 `webhookAllowRemote`。README 的端点步骤与 `docs/COMPAT.md` 均已注明。
- **部分管理动作的「拒绝」从返回 `ok:false` 载荷改为抛错**：`webSearchAdmin/uninstall`（`pnpm remove` 失败）、`webSearchAdmin/saveConfig`（未安装的 provider、非标量字段值）。原因是面板把 **RPC 信封**的 `ok` 当成功标志，载荷里的 `ok:false` 过去会被显示成成功 —— 现在这些拒绝会真正报失败。（对直接调 RPC 的调用方，失败形态从载荷变为错误，语义仍是失败。）

### Changed

- `webSearchAdmin/saveConfig.expectedRevision` 由必填改为可选：服务本就把非数字当作「不做版本守卫」，要求必填会让「未来宿主不再回传 revision」变成一个费解的边界错误。契约表随之变为 **87 = 81 必填 + 6 可选**。
- 换行规则写进仓库（新增 `.gitattributes`）：blob 存 LF、检出为 CRLF，并把此前 6 个 CRLF blob（`lib/command-hook-admin|cron-admin|overlay-admin|skills-admin|web-search-admin|webhook-triggers.js`）一次性归一化为 LF —— 纯换行改动，`git diff --ignore-cr-at-eol` 无内容差异。此后普通 `git add` 即可，不再依赖 `core.autocrlf` 的取值。

### Fixed（审查修复：F1 锁的作用域、审计写失败、版本拒读的爆炸半径）

三条都是本次改动**自己引入或声称已解决**的问题，独立复现后修复：

- **F1 的锁没盖住「读」**（`lib/patch-utils.js`）：锁只包住「备份 + rename」，读-改-写整体仍在锁外，两个实例照样各读、各改、各写 —— 正是它声称解决的那个丢失更新。新增 `mutatePatch(patchPath, mutate)` / `mutateProfilePatch(profileDir, mutate)`：**锁住 读 → 变换 → 写**（`mutate` 契约为同步 —— 持跨进程锁时不能 await）。6 个文件、21 处 patch 写入点（index / command-hook / web-search / subagent / webhook / overlay）全部迁到它；`writePatch` 保留给"内容不是读来的"场景，并在文档里写明它保护不了读。
- **固定临时文件名**（新增 `tempPathFor`）：`<目标>.dsh-admin.tmp` 是所有写入共享的，实例 A 的 rename 会把实例 B 刚写的载荷装进去，B 自己的 rename 再抛 `ENOENT`（已复现：`# A-edit` 落成 `# B-edit`，B 报错）。现在每次写入用 `pid.计数器` 唯一名，且临时文件写在**锁内**；同类的固定名（cron/webhook 的 `.wt-tmp`/`.wh-tmp`、台账 `.ul-tmp`、审计与 `package.json` 的 `.dsh-admin.tmp`、subagent 的 `.tmp-subagent-admin`、命令钩子的 `.cha-tmp`、引擎的 `.tmp`）一并换成 `tempPathFor`。
- **rename 的瞬时共享冲突**（新增 `atomicRename`）：Windows 会在文件刚落地时（杀毒/索引器/监视器仍持有句柄）短暂拒绝 rename，随后同一句 rename 立刻成功 —— 本次跑闸门时就撞到过一次（`EPERM ... rename '<patch>.3388.7.dsh-admin.tmp' -> '<patch>'`，同一份代码随后连跑三次全绿）。所有原子替换改走 `atomicRename`：对 `EPERM`/`EACCES`/`EBUSY` 最多重试 5 次（10ms 递增退避），其余 errno 立即上抛（重试是安全的：rename 失败时源文件仍在原地）。
- **审计写失败会改变动作结果**（`lib/audit-log.js`）：`await audit.record(...)` 没有兜错，而 `auditLogPath` 只校验「非空字符串」—— 指向不存在的目录时 `appendFileSync` 抛 ENOENT。已复现「动作已执行、RPC 却报失败」（`cronAdmin/runNow` 会让用户重点一次、任务跑两遍），`.catch` 分支还会再记一次并把原始错误换成审计错误。现在两个分支都吞掉审计自身的失败（动作结果不受影响、原始错误保留），并在写入前 `mkdirSync(dirname, { recursive: true })`。
- **版本拒读在挂载期抛出 → 整个插件挂不上**（`lib/cron-admin.js` / `lib/webhook-triggers.js`）：拒绝读发生在 `readTasksFile`/`readRulesFile` 里，而挂载读路径也走它们，`apply()` 末尾才是 typert 注册 —— 一个 `{"version":2}` 的文件会让 14 个命名空间与所有面板一起消失。现在**写路径的守卫保持 fail-loud**（绝不改写读不懂的文件），挂载 / 文件监听 / 入站请求的读路径降级为空集 + 一条 warn（`isStoreVersionRefusal` 按 `code` 判定，重复的模块实例也能分类）；webhook 端点因此对每次投递回 401，属 fail-closed。
- 回归覆盖：`verify-file-lock` 增 **两个真实子进程并发 mutate 同一 patch 零丢失**（对旧实现会失败，已验证可伪证）与临时文件卫生；`verify-audit-log` 增 **审计写失败不改动作结果**（同样可伪证）与目录自动创建；`verify-store-version` 把「挂载必抛」的旧契约改为「挂载降级 + 写路径仍拒」，并新增 webhook 挂载降级与 `code` 分类断言。

### Fixed（审查第一档：webhook 加固收口、web-search/skills 拒绝语义、参数可选化）

- **入站闸门改为 fail-closed**（`lib/webhook-triggers.js`）：原判定 `caller !== null && !isLoopbackAddress(caller)` 在**传输层报不出对端地址时直接放行** —— 仓库自带的 28 条老测试 `mockReq` 没有 `socket`，全程走的正是这条放行路径。现在只有**证实的 loopback** 才放行（`caller === null` 同样 403），`webhookAllowRemote: true` 是文档化的逃生口；闸门同时挪到方法/Content-Type 检查**之前**，远端扫描器不再拿到 405/415 这种路由存在性信号。老测试的 mock 补上真实 socket（并支持 `remote: null` 复现拒绝路径）。
- **`retry-after` 改为两条预算里更晚的那个**：调用方被请求预算与认证失败预算**同时**约束，而原实现取两个桶里最早的时间戳 —— 一次新请求 + 两次旧失败会告诉客户端"再等 5 秒"，实际封锁还有 55 秒。
- **限速表不再无界增长**：`prune` 排空的桶直接 `delete`（原实现 `set(key, [])` 让每个见过的地址永久留两条），并在跟踪数超过 512 时清扫整窗已排空的键；两个 push 调用点改为重新挂回数组（否则时间戳会推进一个已脱离表外的数组）。新增只读 `trackedCallers()` 供测试钉住回收行为。
- **401/429/封锁留痕**：此前 10 次错密钥投递产生**零日志零历史** —— 封锁要防的攻击在系统里不可观测。现在每个来源、每个窗口**一条日志 + 一条交付历史**（不是每请求一条，否则攻击者能刷爆它触发的日志），认证成功后才重置去重，于是下一次失败会重新上报。
- **`secretMatches` 两个尖角**：`secretMatches('', '')` 不再返回 `true`（"空 secret 授权空猜测"这条只能靠 HTTP 处理器里的一次判断挡住，而 provider 路由不经过它）；非字符串返回 `false` 而不是抛 `TypeError`。
- **runtime 规则回调也拒绝空 secret**：`rule.secret === ''` 原本只在 HTTP 处理器里成立，provider 路由（如 GitHub 桥）直达该回调，旧版本存下的空 secret 规则会照样执行。
- **web-search 三个拒绝语义**：`pnpm remove` 失败不再被吞成 `{ok:true, state:'row-stripped-only'}`（挂载行已删、依赖仍在，面板却报成功）；`patch.size === 0` 的早返回改为**同样受"先安装"前置约束**（此前未挂载的 opt-in provider 空提交也报成功）；非标量字段值被拒（原先 `String({})` 会把字面量 `"[object Object]"` 存成 API key —— RPC 的 `entry` schema 刻意不枚举字段类型，这里是唯一防线）。
- **skills 的完整性语义**：预设作用域"组合不可用"或读失败时返回 `complete: false`（原先返回 `true`，导致"名册完整"与"整层没读到"同时成立；同文件的会话作用域分支早已翻 false）。
- **一个 wire 从必填改回可选**：`webSearchAdmin/saveConfig.expectedRevision`（服务把它当可选：非数字即"不做版本守卫"）。契约表随之变为 **87 = 81 必填 + 6 可选**，`verify-rpc-schema` 的独立期望表同步。
- 四个新增 verify 脚本注册 `process.on('exit')` 清理：断言抛错时不再把临时目录留在 `%TEMP%`。

### Fixed（审查修复：审计覆盖面、D2 闸门、矩阵 SKIP）

- **审计覆盖面与声明不符**：`AUDITED_METHODS` 缺 `webSearchAdmin` 行 —— 该模块已把 recorder 交给 `auditService`，但包装器在缺行时**静默原样返回**，于是 `install`/`uninstall`/`setActive`/`saveConfig`（含 API key 写入）一条都不落盘，而 CHANGELOG 声称已接入。反向也有一处：`workspaceAdmin` / `subagentAdmin` 两行是**死配置**（`apply*` 从未收到 recorder），`overlayAdmin/searchEnable`（改写启动关键的 profile patch）根本没接。现在：补 `webSearchAdmin` / `overlayAdmin` 两行、把 recorder 传给 workspace / subagent / overlay、删掉从未存在的 `pluginAdmin:'update'` 行，并让**未知 namespace 直接抛错**而不是空转。
- **D2 的必填闸门此前不可能失败**：`verify-rpc-schema` 的「必填 vs 可选」断言把描述符（由 `RPC_OPTIONAL_WIRES` 派生）与同一张表比较 —— 往表里加一条 wire 仍然通过。改为对着**独立的字面量契约**（5 条可选 wire + 82 必填计数）断言；任一侧漂移即失败。
- **运行时载荷的盲区变成显式清单**：`host-check` 只能逐键校验字面量载荷，动态拼接的载荷此前只校验 target 就放弃了必填检查。新增 `RPC_DYNAMIC_CLIENT_PAYLOADS`（3 条，各带理由）：**新的运行时载荷会让 host-check 失败**，直到有人把它列出（或改写字面量），而已失效的豁免也会失败。
- **多版本矩阵的 SKIP 不再等同于成功**：`check-matrix` 现在分别报告 probed / skipped；当清单是显式给出的（`DSH_CHECKOUTS`/`DSH_CHECKOUT`）或运行在 CI 下时，**探测到 0 个 checkout 即失败**（此前打印 `OK: N checkout(s) probed` 并退出 0，路径写错也看不出来）。
- **CI 里接缝探针不再空转**（`.github/workflows/ci.yml` + `integration-check`）：`test` 作业先 `actions/checkout` 一个 pin 住的 dsh（`deepseek-ai/deepseek-harness@dsh-v0.1.7-rc.2`，公开仓库、`fetch-depth: 1`、不安装不构建）并把路径交给 `DSH_CHECKOUT`；**CI 下找不到 checkout 直接失败**（本地仍按 SKIP，保持无 checkout 的机器可跑）。新增 `seam-matrix` 作业：同一 pin 与 `master` 两档跑 `npm run test:matrix`，`master` 作为上游漂移的预警行。`.gitignore` 随之忽略 `.dsh-checkout/`/`.dsh-release/`/`.dsh-main/`。
- 回归覆盖：`verify-audit-log` 新增**双向覆盖扫描**（"接了 recorder 却没行" 与 "有行却没接线" 都会失败 —— 两个方向都已伪证）；`host-check` 新增**受审方法存在性断言**（`pluginAdmin:'update'` 这类死行会被点名，已伪证）。

### Changed（剩余两项收口：可迁移的原生控件 + 参数必填化）

**1. 还能迁移的原生控件都迁了；不能迁的有了确凿依据。**

- **Picker 的输入框改用官方 `Input`**（此前因"需要 ref 管焦点"刻意保留原生）。`Input` 不转发 ref，而它需要的是**按键时的实时值**：改从事件自身读取（`e.target.value`，事件无 target 时回落草案状态），ref 因此不再必要。官方原子不回退。
- **workflow 面板的 4 个输入框改用官方 `Input`**，原先靠 `inputStyle()` 内联模拟共享外观；原子的包裹层是 `inline-flex`，所以宽度与间距改由 `.wf-input` 一条 CSS 承担（布局不丢）。
- **剩下的 30 处原生控件是"官方没有对应原子"，不是偏好**：对照 `ui-primitives` 的全部 **42 个** 导出（无 `Select`、无 `Textarea`、无 `Radio`）—— 18 个 `select`、11 个 `textarea`、1 个 `radio` 全部保留原生；它们的 `select.input` / `textarea.input` 样式继续由插件 CSS 承担。

**2. 参数从"一律可省"收紧为"默认必填"。**

- 判定权交给 `RPC_OPTIONAL_WIRES` 一张表：**87 个 wire 里 82 个必填、5 个显式可选**。必填项在网关上被真正强制（缺参数 → `gateway/input-invalid`），不再是"谁都能省"。
- 新增的两条可选 wire 都有具体出处：`workspaceAdmin/create.title`（无标题的工作区）与 `workspaceAdmin/insertBefore.beforeWorkspaceId`（移到列表最前）—— 面板按字段构造载荷，没内容就**不发这个键**，写成必填会拒掉合法调用。
- 静态证明：host-check 扫描浏览器半的每个字面量载荷，**必填 wire 缺一个就报错**（本次收紧后零告警，说明前端一直在发全量字段）；`verify-rpc-schema.mjs` 另断言**描述符**的 `acceptsUndefined` 与可选表逐条一致（对着描述符断言，而不是再读一遍同一张表）。

### Verified（本轮）

- `npm test` 全绿：`host-check D2: 87 parameters validated by strict codecs`、`91 methods / 73 client call targets`、`verify-rpc-schema` 6 项、93 条接缝契约。
- 迁移原生控件时抓到一处真实回归：Picker 的 Enter 处理器只读 React 状态会在"DOM 值已变但渲染未跟上"时读到空值（测试用它驱动出 `deny: ['bash','glob']` 而非 `['write','edit']`）。改成读事件 target 的实时值后修复 —— 这也是去掉 ref 的正确替代。
### Added（D2 边界校验 + E3 面板开关，用户点名实现）

**D2 — 每个 RPC 参数由网关做严格校验。** 参数此前一律 `codec: { mode: 'src-json' }`，网关原样透传：**类型错的载荷能直接进服务**。现在 87 个参数全部改挂 `mode: 'strict'`，网关按 `codec.create().parse(value)` 在边界校验（`packages/api/gateway/src/index.ts` 的 `decode()`），失败即 `gateway/input-invalid`。

- 校验器是**手写的、零依赖**（`lib/rpc-schema.js`，7 个 schema：`text` / `scalar` / `number` / `boolean` / `textList` / `entry` / `json`）。注册表只要求 `typeSymbol` 非空 + `create()` 返回带 `parse` 的对象，所以不必引入 zod，也不必生成类型。
- **刻意不比服务更严**：id 是字符串、entry 是对象、sessionIds 是字符串数组 —— **不枚举 entry 的字段**。服务本来就接受调用方形状的 draft，猜一个字段集只会拒掉合法载荷。
- **省略语义随后收紧了**（见上文"参数从「一律可省」收紧为「默认必填」"）：本节当时的结论是「所有参数仍 `acceptsUndefined: true`」，最终提交把 82 条改成了必填 —— 本节保留为当时的记录，**以最终一节为准**。
- 单一真相表多一列：`RPC_PARAM_SCHEMAS`（66 个带参方法），host-check 断言它**完整**（每个 wire 都有 schema）且**忠实**（无孤儿行、wire 顺序一致）；`scripts/verify-rpc-schema.mjs` 另证每个 schema 接受自身样本、拒绝错误类型。

**E3 — 面板级开关走 profile 配置行。** 新增 `config.panels`：`{ <面板 id>: 'auto' | 'on' | 'off' }`。

- 键名与取值都 fail-loud（写错面板 id 或状态**挂载期报错**，不做静默失效的开关）。面板 id 单一来源 `lib/panel-ids.js`（11 个），宿主校验与浏览器半的覆盖表共用一份，两边不一致会在导入时直接抛错。
- **浏览器半读不到 config 行**，所以挂载时经新增只读 RPC `pluginAdmin/panels` 问宿主一次；**注册是立即的**（用上次答案的 localStorage 缓存 `dsh-admin-panels-policy`，常见情况下无闪烁），新答案到达后再对账：`off` 的注销、`on` 的补注册。宿主没答（或没有连接）时按缓存、再退回自动让位。
- 优先级（从高到低）：`config.panels.<id> = 'off'` → `= 'on'` → `dsh-admin-panels`（浏览器强制开启）→ 官方覆盖自动让位。
- 注册表从十段内联 `ctx.slots.inject(...)` 改成 `SLOT_SPECS` 表 + `reconcileSlots()`，顺带让"晚到的配置"可以安装/卸载。

### Verified（D2 + E3）

- `npm test` 全绿：host-check 报 `87 parameters validated by strict codecs`、`91 methods / 73 client call targets`、`93 contracts probed`；verify-rpc-schema 5 项；self-check 的 E3 用例覆盖 自动让位 / localStorage 强制 / config off（压过强制）/ config on（压过官方覆盖）/ 缓存经失败询问仍生效 / 无缓存无宿主退回自动让位。
### Changed（Phase B3e：复选框换官方 Checkbox）

- **11 个复选框全部改为官方 `Checkbox`**（面板源码里 `type: 'checkbox'` 归零，`UiCheckbox` 12 处）。官方原子要求一个 `label` 字符串（可见且可访问），所以每处都把**文案提升为原子的 label**：`label.check` / `label.checkbox-row` 包裹被原子取代，布局类改由 `className` 传给原子（`.check`、`.checkbox-row` 继续生效）。
- **原子没有 `style` / `onClick` / `id` 属性**，三处因此用 `<span>` 包一层保留原有行为：`maxDepthManaged`（`flex:none`）、任务卡片上的启用开关（`title` + `onClick` 阻止冒泡到卡片）、cron 编辑器的启用（内联 flex 布局）。这不是妥协 —— 原子的 API 就是这六个属性，包裹层是它给的组合方式。
- 顺带补上一个**原本没有可见标签**的复选框（Webhook 编辑器的启用开关），现在是「启用」并进入 i18n 词典。
- 测试同步：`#reconnect-toggle` 不再存在（原子不转发 `id`），改为按 label 文案定位；harness 的 `Checkbox` 桩改成与真实原子同构（label 包 input + 文案 span）—— 原先的通用桩把 label 当 `<input>` 的子节点渲染，React 直接报 "void element"，这个报错正是本次迁移的哨兵。
- i18n 门槛照旧抓到一条失去调用点的词条（`" 启用"`，带前导空格的老文案），已删除。

### Phase B4b（输入类样式）结论

- **不需要再删任何规则**：复选框迁移后，剩下的控件样式只剩 `select.input` / `textarea.input` —— 这两类**刻意保留原生**（官方没有 select/textarea 原子），规则仍在服役。原子化的控件通过 `className` 继续拿到布局类（`.check` / `.checkbox-row` / `.danger` / `.pin-active` …）。
- 因此 B4 以"**按理由收口**"结束而非"删干净"：退役的是自绘控件外观（.btn/.pill 共 17 条已删），保留的是**非原子控件**与**布局语义**两类，且各自有明确归属。

### Verified（Phase B3e + B4b）

- `npm test` 全绿（tsc / oxlint / 产物一致性 / 33 个脚本 / 88 条接缝契约）。
### Added（Phase G：接缝断言与多版本矩阵）

- **接缝探测 78 → 88 条**：补上插件最新能力实际依赖的三条接缝 —— `slots.entries(key)`（Phase E 的官方优先自动让位靠它判断，读不到条目就不让位）、客户端 locale 运行时 `register/bind/subscribe/setLocale`（Phase C）、宿主 `WebRoute { kind: 'prefix' | 'exact', path, handler(req,res) }`（Webhook 入站，F4 的加固还要读 `req.socket.remoteAddress`）。探测仍只读 dsh 的 TypeScript 源码，无需构建。
- **`scripts/check-matrix.mjs` + `npm run test:matrix`**：把同一份探测跑在多个 checkout 上（`DSH_CHECKOUTS`，逗号/分号分隔），逐个给出裁决 —— 没有 dsh 的目录记 SKIP 不算失败（与单版本探测的契约一致），**任何一个存在的 checkout 契约漂移则整体失败**。"支持哪些 dsh 版本"因此从文档承诺变成可执行事实。
- `docs/COMPAT.md` 新增「接缝矩阵」：用法、以及三条承重接缝各自的来源文件与使用者。

### Fixed

- **修掉 F2 引入的一处真实回归**：cron 的写路径守卫当时用了 `loadTasks`（会**替换内存镜像**），多出来的镜像交换让调度器多arm 了一次定时器 —— 边界到点时任务**多触发一次**。因为该检查是时序敏感的，F2 那轮的绿灯掩盖了它，本轮重跑才炸出来（3/4 !== 2）。现在守卫换成**只读**的 `readTasksFile`：保护不变（更新文件依旧拒写），镜像与定时器的既有语义完全保留，`verify-cron-admin` 29/29。

### Verified（Phase G）

- 矩阵实测三个目录：真实 checkout ✅ 88 条契约；合成目录（只有 package.json）❌ 43 条漂移并逐条列出探测名；不存在的目录 ➖ SKIP。
### Added（Phase F4：Webhook 入站加固）

- **默认只收本机投递**：入站端点是本机集成能力，非 loopback 来源一律 403 并说明如何显式开启（新增 `webhookAllowRemote`，默认 `false`）。`::ffff:127.0.0.1` 这类 IPv4 映射地址按本机处理；传输层不暴露来源地址时**不拒绝**（判断不了就不诬告），但仍计入限速。
- **限速与暴力破解封锁**：每个来源一个滑动窗口 —— 默认 60 请求/分钟（`webhookRateLimit` 可覆盖），超出答 **429 + `retry-after`**；**认证失败单独记账**，同一来源 10 次失败/分钟即封锁该窗口。这直接补上了模块自己注释里承认的空缺："端点没有按来源限速，所以密钥长度是唯一的暴力破解成本"。
- **常量时间比较本来就已存在**（`secretMatches`：两侧各做 SHA-256 再 `timingSafeEqual`）。我没有重新实现它，而是**核实它是模块里唯一的真实比较**（其余 `===` 都只是判空），并用回归测试把它钉住（等长错误、变长错误都不抛异常）。
- 配置直通键 **12 → 14**（`webhookAllowRemote` / `webhookRateLimit`），README 双语更新。
- `scripts/verify-webhook-hardening.mjs`（6 项）：地址判定（127/8 全段、`::1`、IPv4 映射、传输层隐藏）、密钥比较的等长/变长行为、限速窗口滑动与按来源隔离、**非本机 403 / 显式开启后放行 / loopback 正常投递**、**连续失败封锁后即使密钥正确也 429**、请求预算封顶。

### Fixed

- `webhookRateLimit` 的校验一开始漏了"缺省即直通"的约定（`positiveInteger` 需要 fallback），导致**配置里没写这个键就挂载失败** —— 被 host-check 当场拦住，改为与其它直通键一致的 `if (cfg.x !== undefined)` 守卫。
### Added（Phase F2：落盘文件版本化）

- **`lib/store-version.js`**：每个存储本来就**写** `version`，但从来不**读**它 —— 于是更新版本插件写的文件会被当成当前格式解析，下一次保存再把误读的数据写回去，**静默丢数据**。现在读侧有契约：缺省版本按 v1（版本化之前写的所有文件）、更旧的文件按声明的迁移链逐级迁移并盖上新版本、**更新的文件大声拒绝**（`StoreVersionError`，带 code/实际版本/支持版本）、无法解析的文件报 `invalid` 让调用方保留自己的尽力策略（历史副作用是尽力而为，规则不是）。
- 接入三个权威存储：`usage-ledger.json`、`webhook-triggers.json`、`cron-tasks.json`。**校验放在 JSON 解析的 try/catch 之外** —— 第一版塞在里面，拒绝被吞成"文件为空"，等于没做（这条是被测试逼出来的）。
- **顺带修掉一个真实的数据丢失口子**：cron 的 `upsert`/`remove`/`toggle` 是**先写内存镜像、再回读文件** —— 覆盖发生时校验才触发，那边数据已经被抹掉了。现在统一改成 **先读并校验 → 再改 → 再写**；webhook 的 `persist` 与用量台账的 `persist` 也补上了"替换前先校验"。
- `scripts/verify-store-version.mjs`（7 项）：分类（v1/相等/更新/非法）、迁移链顺序与盖版本、缺环报 `unmigratable`、三类错误类型化，以及**三条写路径各自的拒绝**（cron 挂载点与写入、webhook 保存、台账落盘）。脚本按仓库既有做法在结尾硬退出（webhook 挂载的 `fs.watch` 会吊住事件循环）。
### Added（Phase F1：跨进程写保护）

- **`withFileLock` + `mutatePatch` / `mutateProfilePatch`（`lib/patch-utils.js`）**：跨进程建议锁现在盖住 **读 → 变换 → 写**（第一版只包住「备份 + rename」，读在锁外，等于没防住丢失更新 —— 见上方 Fixed）。在此之前，同一 profile 上的两个 dsh 实例会各自读 patch、各自改、各自 rename —— 后写者胜，另一处修改**静默丢失**。
- 三条刻意的性质：**失败开放**（等 3 秒后照写：原子 rename 仍保证文件不撕裂，而拒绝写入比丢一次更新更糟）；**过期可回收**（锁超过 30 秒、或持有者 pid 已死 → 抢占，崩溃的实例不会让 profile 卡死）；**同步**（用 `Atomics.wait` 真睡眠，不空转 CPU）。
- `scripts/verify-file-lock.mjs`（7 项）：正常段落返回值不被吞、锁必被释放、过期锁被回收、**活锁只延迟不拒绝**（用父进程 pid 造锁，断言等待 ≥2.5s 后仍然写入），以及**两个真实子进程并发 mutate 同一 patch 零丢失**（F1 的验收场景）、"每次写入独立临时名、写完不留残file"、`atomicRename` 搬家成功且对非瞬时错误（ENOENT）立即上抛。

### Added（Phase F3：特权动作审计日志）

- **`lib/audit-log.js`**：每次特权 RPC 追加一行 JSON（`$DSH_HOME/admin-audit.jsonl`）。设计要点：**只追加不改写**（崩溃最多丢在途那一行）；**按参数键名脱敏**（`secret`/`token`/`apiKey`/`password`… 的值永不落盘，但留下 `[redacted]` 让"确实有敏感字段"这件事也可查）；超过 2000 行时压缩到一半（走同一条串行队列）；`AUDITED_METHODS` 只列**变更类**方法 —— 读路径不进日志，审计才是信号。
- 接入：`pluginAdmin` / `mcpAdmin` / `sessionAdmin`（index.js 内联服务）+ `commandHookAdmin` / `webhookAdmin` / `cronAdmin` / `webSearchAdmin`（options.audit）。**记录是 await 的**：动作返回时日志里已经有它，读者不会和写者赛跑（这一点是先写成 fire-and-forget 后被 host-check 抓出来的）。
- 新增只读 RPC **`pluginAdmin/auditLog`**（最新在前 + 文件路径 + 条数），插件面板新增「操作审计」卡片按需加载并展示。RPC 门禁随之更新：**90 个方法 / 72 处客户端调用点**。
- `scripts/verify-audit-log.mjs`（5 项）：脱敏与长度上限、只记变更方法、失败调用也记为 `ok:false`、磁盘上是逐行 JSON、超过上限会压缩；host-check 追加**接线探针**（经真实 `apply()` 调 `cronAdmin/upsert`，验证成功与失败两条都进日志、条目带 pid、`pluginAdmin/auditLog` 能读回）。

### Changed

- 配置直通键 **+1：`auditLogPath`**（默认 `$DSH_HOME/admin-audit.jsonl`），fail-loud 校验列表 11 → 12 键，README/README.en 同步。
### Added（Phase E：官方优先，面板自动让位）

- **`src/client/native-coverage.js`**：一张探测表，逐面板写明"官方哪个界面覆盖了它"以及**客户端可见的探测信号**。策略是**自动让位**：探测命中的面板**根本不注册 slot**（不是隐藏、不是禁用），未命中的照常注册；`localStorage['dsh-admin-panels']`（逗号分隔面板 id）可强制要回某个面板。
- 当前唯一命中的是 **扩展插件**：官方 0.1.7 的「插件」侧边栏页（`ui-plugin-manager`）与「插件列表」页签（`ui-settings-plugin-inventory`）已覆盖装/停/卸 —— 探测 `sidebar.panellist` 的 `plugins` 或 `settings.plugins.tab` 的 `all`，命中即让位。
- **其余面板刻意保留**：MCP 管理、hooks 管理、文件化命令、子代理编写侧、批删/导出/体检、provider 切换、用量台账、宿主级 cron 与 Webhook 入站 —— 官方仍无对应界面（表里连"官方对应 = 无"也写清楚）。**探测不到就不让位**是硬规则：把看不见的东西当作已覆盖，会让功能凭空消失。
- **宿主半无配置行可读**：浏览器半拿不到 profile 的 config，所以探测只用壳层在客户端 Context 上暴露的信号（slot 条目 / 服务）。这也意味着"面板级开关"目前是客户端 override（localStorage）而非 config 行 —— 见计划里的 E3 备注。
- `docs/COMPAT.md` 新增「官方覆盖与让位」表，与该模块同源。

### Verified（Phase E）

- `self-check` 新增三个用例：无官方面板列表 → 扩展插件注册；`sidebar.panellist` 出现官方 `plugins` → 扩展插件**不注册**（其余 9 个照常注册，总数恰好 −1）；写入 `dsh-admin-panels=extensions` → 该面板被强制要回。
### Changed（Phase B3d：文本框换官方 Input）

- **47 个文本框改为官方 `Input`**：删除自绘 `input` 类（原子的 `className` 会落在包裹 span 上，不再是输入框自身的类），保留带语义的额外类名。
- 三类保持原生，各有明确理由：**10 个 checkbox + 1 个 radio**（官方只有 `Checkbox`，需要 `label` 语义，属另一轮）；**5 个 workflow 面板的无类输入**（它们用面板自己的 `inputStyle()` 内联样式，从未使用共享 `.input` 外观）；**1 个 Picker 组合控件内的输入**——官方 `Input` 的 props 被解构，**不转发 `ref`**，而这个控件靠 ref 管理键盘与焦点，改用原子会让它失去 ref 能力。
- 测试的选择器随之收敛：3 处 `input.input` → `input`（后续仍按 placeholder/value 过滤）。

### 事故与恢复（Phase B3d）

- 批量转换里"className 独占一行就整行删除"的规则，把**与 className 同行的其它属性一起删掉了**：12 个受控输入丢了 `value`（其中 MCP/子智能体表单的 id 还丢了 `disabled`），skills 过滤框丢了 `placeholder`。
- 检出方式分三层，缺一不可：(1) 行为测试（子智能体编辑流断言"id 输入框在编辑时禁用"）；(2) **i18n 覆盖闸门**（丢弃的 placeholder 让词条变成孤儿，`verify-i18n` 直接点名 `按名称 / 描述 / 路径过滤…`）；(3) 结构化审计（扫描所有原子，比对 `value:` / `placeholder:` 是否成对存在）。
- 丢失的属性按语义逐一还原：`value` 从各自的 `onChange` 键名与所在表单的 draft 字段推出（`onPatch({ id })` + draft 形状 → `value: draft.id`），`disabled` 从表单的 `form.editing` 推出，placeholder 从词条表取回。**教训与上一轮同源：批量改写的删除边界必须是"单个属性表达式"，不能用"整行"。**
### Changed（Phase B4a：删除已退役的控件样式）

- **17 条 `.btn*` / `.pill*` 纯外观规则删除**：官方原子的 `variant`/`size` 已覆盖基座、悬停、按下、焦点环、禁用态与主色填充 —— 插件侧再定义一遍就是"等着分叉的第二份定义"。
- **承载布局/语义意图的规则改挂到原子的 `className` 上**（不是简单删除）：`.btn.pin-active` → `.pin-active`；`.group-header .btn` → `.group-header .group-action`（分组删除按钮改传 `className: 'group-action danger'`）；`.update-strip .btn.sm` → `.update-strip button`；`.cli-scan-card .btn` → `.cli-scan-card button`。另外删掉一条已死的 `[data-dsh-sa-section] .btn.sm.active`。
- **测试里的 CSS 覆盖断言同步**："CH 按钮用统一蓝色主色"换成**回归守卫**——任一 sheet 若重新定义 `[scope] .btn` / `.pill` 就失败；共享类覆盖清单里去掉 `.btn` / `.btn.primary` / `.btn.sm`。

### Verified（Phase B4a）

- `npm test` 全绿；chunk 472.4 → 468.7 KB（控件样式退役带来的净减，剩余体积是面板逻辑与尚未迁移的 input/select 样式）。
### Changed（Phase B3c：胶囊与剩余按钮换官方原子）

- **9 个筛选胶囊改为官方 `Pill`**：用量页的日期范围（今天/24H/7D/30D/90D/全部）、会话页的状态筛选（在线/已归档/已结束/已置顶）、Webhook 与任务的「动作模式」二选一 —— 全部改为 `active` + `onClick` 属性，`pill`/`pill active` 类名与 `type: 'button'` 一并删除（原子自带）。
- 最后 2 处 `btn` 也在全文检索面板里换掉了；`grep "className: 'btn"` 与 `"className: 'pill"` 现在都是 **0**，`UiButton`/`UiPill` 共 148 处。
- 测试改为按语义识别胶囊：`.usage-toolbar .pill` → `.usage-toolbar button`，`className.includes('active')` → `aria-pressed === 'true'`（官方 `Pill` 的选中态是 CSS Modules 类名，测试断言不该依赖哈希类名）。

### Verified（Phase B3c）

- `npm test` 全绿。
- **未做**：B4 的 CSS 清理。盘点后发现它不只是"删死规则"——`.group-header .btn { margin-left: auto }`、`.update-strip .btn.sm`、`.list.grid2 .card .btn.sm` 这类规则承载的是**布局意图**，删掉 `.btn` 会让按钮失去定位；`variant`/`size` 已覆盖纯外观规则（可删），布局与语义规则需要改挂到传给原子的 `className` 上。这一批（约 6 条规则）留到下一轮连同 CSS 覆盖断言一起改。
### Changed（Phase B3b：按钮批量换官方 Button）

- **127 个自绘按钮改为官方 `Button`**：按类名词表机械映射 —— `btn primary` → `variant: 'primary'`，`btn`/`btn sm`/`btn xs` → `variant: 'outline'`（`sm` 取 `size: 'sm'`），`danger` / `danger-solid` 作为语义类保留下来，CSS 选择器同步从 `.btn.danger` 改为 `.danger`（17 处规则），配色不失。
- 变体补全：39 处按钮在转换中只剩 `size`，按标签语义回填（保存/创建/挂载/安装等确认动作 → `primary`，其余 → `outline`）。
- 测试改为**按标签识别**控件而不是按类名：`button.btn`、`classList.contains('primary')` 这类断言在官方原子上不成立（CSS Modules 的类名是哈希的）。共改 5 处（self-check 的置顶按钮、verify-workspace-admin 的重命名/删除/保存/确认）。

### 过程中的一次真实事故（记录在案）

- 批量转换脚本用「行首到 className 之间」作为替换区，**对 className 与其它属性同行的内联写法会误删行首代码**；另有若干站点残留 `+ (...)`、双逗号、丢失的 `{`/`?`/`:` 与 `actionChildren.push(` 前缀。共有 100+ 处站点受损。
- 恢复方式：以 `lib/client.panels.js`（转换前最后一次成功构建的产物）为**参照物**核对原始类名与属性，再逐类修复（缺失的 props 起始括号、孤立属性行、三元分支错位、粘在标识符上的残留字符），最后以 esbuild 的语法错误 + 28 个自检脚本收敛。**教训**：批量改写必须以「括号配平 + 逐站点验证」为边界，不能用行首做替换锚点；产物在关键时刻充当了最后一份可核对的快照。

### Verified（Phase B3b）

- `npm test` 全绿（tsc / oxlint / 产物一致性 / 28 个脚本），其中 `verify-workspace-admin` 的 7 个场景端到端跑通了新建/重命名/排序/两步删除的按钮路径。
- 仍未迁移：9 个 pill、58 个 input、16 个 select（下一轮）。
### Changed（Phase B3a：接入官方控件原子）

- **平台基线保持 external**：`scripts/build-client.mjs` 现在把壳层种子表（`PLATFORM_MODULES`：react / cordis / client-store / ui-slots / **ui-primitives** / dockkit）整体列为 esbuild external，两个产物里因此只留 `require("@deepseek-ai/dsh-client-ui-primitives")` 一行，由加载器从种子表回答。**没有**写进 `dsh.client.external` —— 这是 package/client/AGENTS.md 明确禁止的：基线对所有动态 bundle 都是隐式的，重复声明等于把依赖边写错。
- **`types/dsh-client-ui-primitives.d.ts`**：该包是本仓之外的构建输入，类型检查期无法解析，故用环境声明补齐插件用到/可能用到的原子（权限宽松，权威 props 在上游 catalog）。
- **首批控件替换（插件面板 + 会话面板的同款控件）**：搜索框改官方 `Input`（自带前置图标），清空/安装/检查更新/全部更新改官方 `Button`（`toolbar` / `primary` / `outline` 三种 variant，`size` 取 `sm`），三个筛选胶囊改官方 `Pill`（`active` + `onClick`）。共 9 处；`btn`/`input`/`pill` 自绘类在这 9 处不再参与渲染。
- 夹具补 `@deepseek-ai/dsh-client-ui-primitives` 替身：按名字**记忆化**每个原子（Proxy 每次返回新函数会让 React 每帧重挂 DOM，测试里表现为“同一个节点在两次断言之间被换掉”），并剥掉 `active`/`variant`/`size` 等非 DOM 属性。

### 未完（B3b / B4）

- 仍有约 148 个 `createElement('button')`、58 个 input、16 个 select、11 个 pill 未迁移（其余面板）。
- B4 待办：迁移完成后删除随之失效的自绘 CSS（当前 chunk 里仍有约 76 KB 样式，其中一部分已是死规则）。

### Verified（Phase B3a）

- `npm test` 全绿；`self-check` 的两处搜索框选择器改为定位原子内部的原生 `input`（原子的包裹元素是 span，类名不再是 `input`）。
### Changed（Phase B2：面板改懒加载 chunk）

- **入口 bundle 与面板代码分家**：`src/client/impl.js` 现在只做三件事——注册 10 个 slot、注入样式、按需拉取面板；所有面板实现移到 `src/client/panels.js`，构建成包内 chunk `lib/client.panels.js`，由 `require.async('./client.panels.js')` 在**首次渲染**时加载。
  - 体积：`lib/client.js` **592 KB → 116 KB（−80%）**，面板 + 样式 chunk 468 KB 只在真正打开管理面板时才下载/解析（目标 ≤150 KB 达成）；
  - 协议：chunk 文件名必须匹配加载器的包内 chunk 文法（`client.<名>.js`）且与 `client.js` 同目录——加载器由 bundle URL 推导 chunk URL；`lib/client.panels.js` 因此与 `lib/client.js` 并列，随包发布；
  - 跨包共享：chunk 是独立 bundle（不能引用主 bundle 的模块），locale 表与共享辅助函数（`dshT`/`sectionState`/`showToast`/剪贴板等 12 个）通过 `configure(env)` 一次性注入；四组注入样式也随 chunk 走——`configure()` 里注入，既让面板一定有样式，又把 76 KB CSS 挪出关键路径；
  - 每个 slot 组件用 `lazyPanel(exportName)` 包装：首帧渲染一个小占位（“加载面板…”），chunk 到位后渲染真组件；宿主机不支持 chunk 时显示明确错误而不是空白面板。
- **构建产物结构断言**：`build-client --check` 现在除了比对产物与源码，还断言面板代码**不在**入口产物里（`PluginsSection` 等标记不得出现）、入口保留了 chunk 加载器与 chunk 名、chunk 里确实有面板代码——防止一次误改把懒加载悄悄还原成 eager。
- **测试夹具补上 chunk 面**：新增 `scripts/lib/harness-client.mjs`，给 11 处 `factory(...)` 提供带 `require.async` 的 loader 形 require（它按需评估 `lib/<chunk>`，与加载器同款注册再物化）；三个直接挂载面板的脚本改为先 `await loadPanels()`。
- **两处扫描器改为枚举源文件**：`host-check` 的客户端调用点扫描与 `verify-i18n` 的文案扫描原先写死了 `['index.js','impl.js','i18n.js','styles.js']`；面板搬到 `panels.js` 后它们会**静默漏掉 800+ 个调用点**——现在改为读取 `src/client/*.js` 全集。这正是闸门存在的意义：`host-check` 当场以“workflowAdmin 等 4 个方法无人调用”报红。

### Verified（Phase B2）

- `npm test` 全绿：面板脚本全部经由 chunk 路径运行（栈里能看到 `req.async`），`self-check` 的 18 个面板用例、`verify-workflow-client`、`verify-workspace-admin` 直接挂载 chunk 组件。
- 自查过程中被自己的闸门拦下两次：一次是改了源码忘了 `npm run build:client`（`--check` 报 stale），一次是上面那个写死的扫描清单——两条都不是“测试太严”，而是它们本来就要抓的东西。
### Changed（Phase C：文案表接回 dsh 的语言服务）

- **面板文案不再自成一岛**：`installLocaleRuntime(ctx)` 把中英对照表注册为 shell locale 服务的 `dshAdmin` 命名空间（`{ zh, en }`）并 bind，`dshT()` 改为在调用点读取绑定后的翻译函数 —— 生效语言就是 shell 的当前语言，切换语言**即时重绘、不再刷新页面**。
- 注册的 zh 字典是**从 en 表的键派生**的恒等映射（`I18N_ZH[key] = key`），不是第二份手写表：locale 运行时按 fallback 链查找，只注册 `en` 会让中文读者读到英文。`verify-i18n` 现在断言这份派生关系，`self-check` 在运行时断言两份字典的键集完全一致。
- 🌐 语言开关改为驱动 shell 的 `setLocale`（原来写 localStorage + `location.reload()`），标题从「面板语言（所有管理面板）」改为「界面语言 / Interface language」，`value` 读 shell 的当前语言而不是本地回退值。
- slot 标签改为 **thunk**（`label: () => dshT('…')`）——这是 ui-slots 官方的 `SlotLabel` 形态，壳层每次读取都重新求值，因此导航行/页签标题跟随语言而不需要重新注册；各 panel 组件用一层 `withLocale()` 包裹，订阅语言变更后重绘整棵子树。
- **软化依赖**：`locale` 不放进 `inject`（硬依赖会让没有该服务的宿主整个插件挂不上），改为 `ctx.get('locale')` + 能力探测，服务缺失时自动回落到原有的「localStorage / 浏览器语言 + 中文原文兜底」路径 —— 这正是测试环境走的路径。

### Verified（Phase C）

- `self-check` 新增 ctx.locale 用例：假 locale 服务 → 断言注册命名空间与键集一致 → zh 渲染中文 → `setLocale('en')` 后**同一个挂载**重绘为英文且无中文残留 → 🌐 开关只调用 `setLocale`（无刷新路径）。
- `verify-todo-panel` / `self-check` 里所有 `options.label` 断言改为经 `slotLabel()` 解析 thunk。
- 另外两处读 `declaration.label` 的断言（`verify-subagents-client` / `verify-cron-panel`）同样改为解析 thunk —— 全仓 18 处 label 断言现在都不假设标签是字符串。
- 语言表注册加了**重复注册兜底**：同一页面第二次物化本 bundle（HMR、测试多次挂载）会命中 locale 的 "already has locale"，此时退化为直接 bind 已注册的同内容表，而不是让挂载失败。
### Changed（Phase D1b：模块从表生成描述符）

- **十四个命名空间的描述符全部改为 `invocationsFor(namespace)` 生成**，模块里的手写 `descriptor()`/`desc()`/内联对象清单（共 89 条）全部删除，`lib/rpc-manifest.js` 成为唯一真相：端点不可能只存在于模块而不在表里。
- 顺带清掉随之失效的死代码：4 处 `DESCRIPTOR_PACKAGE` 与各模块的 `descriptor`/`param` 辅助函数。
- 把描述符搬进表之后，两处"读 `lib/index.js` 源码文本找 id"的断言失效（`verify-todo-panel.mjs` 的 fileStats / exportSession / gitDiff）：这类断言现在改为直接读 `RPC_MANIFEST`，检查对象从"某个文件的字节"变成"线上契约"。这正是 D1b 想要的连带收益——测试不再把实现细节当契约。
- `npm test` 全绿（含 tsc / oxlint / 产物一致性 / 28 个自检脚本）。

- 迁移过程中的一次失误值得记录：用"非贪婪匹配到第一个 `\n}\n`"批量删除辅助函数声明时，正则跨过了函数边界，把 6 个模块的 `*Invocations()` 函数一起删掉了（webhook-triggers 还留下半截对象字面量）。host-check 的挂载断言立刻以 `ReferenceError` / 语法错误拦下，逐文件按行修复后恢复。教训：删除代码块要用括号配平，不能用"最近的花括号"——这也是为什么要先有闸门再重构。

### Added（Phase D1：RPC 单一真相表 + 双向闸门）

- **`lib/rpc-manifest.js`**：把 14 个命名空间、**89 个方法**及其线序参数名收进一张表（由挂载后的真实描述符导出，不再与模块里的 `*Invocations()` 手工并行维护）。表里同时登记：
  - `RPC_DYNAMIC_CLIENT_TARGETS`——浏览器半用变量/字符串拼接调用的目标（`'sessionAdmin/' + method`、`'commandHookAdmin/' + verb`），静态扫描看不见，必须显式登记；
  - `RPC_HOST_ONLY_TARGETS`——无 UI 入口的端点（CLI/SDK/兼容面），登记后新增一个"悄悄失去入口"的端点就会让闸门失败；
  - `RPC_OPTIONAL_WIRES`——服务自己已用 `spec && …` 兜住的参数（amend/resume/listSaved 的 `spec`），客户端省略它们不再算漂移，但省略**未登记**的必填参数会失败。
- `scripts/host-check.mjs` 新增契约块：挂载后的 89 条描述符必须与表逐条相等（命名空间/方法/参数线序/服务键/调用类型），同时扫描 `src/client/**` 的每个 `call('ns/method', …)` 调用点——目标必须已声明、字面量载荷的键必须是声明的线名、必填线名不得缺失。
- 调试钩子：`DSH_ADMIN_DUMP_RPC=<file> node scripts/host-check.mjs` 导出挂载后的真实表面（表就是由它导出的，便于下次增量核对）。

### Verified

- 负向验证：把表里 `pluginAdmin/install` 的参数改成空数组，host-check 立即以 `pluginAdmin/install parameter wires` 失败——闸门不是空转。
- 正向结果：89 条挂载描述符 ↔ 71 个客户端字面量调用点 ↔ 6 个动态目标 ↔ 12 个 host-only 端点，四者闭合，无未声明调用、无未达端点。

### Changed（Phase B1：浏览器半源码化）

- **`lib/client.js` 从手写入库改为构建产物**：源码拆到 `src/client/`（`index.js` 入口 / `impl.js` 面板与 slot 装配 / `i18n.js` 文案表 / `styles.js` 四组注入样式），`scripts/build-client.mjs` 用 esbuild 打包并保留加载器要求的 `window.__ModuleLoader__.load({ id, factory })` 外壳与 `require('react')` 外部化（React 必须仍是壳层那个实例）。
- `npm test` 新增 `node scripts/build-client.mjs --check`：产物与源码不一致即失败，"改了源码忘重建"再也发不出去。
- `verify-i18n.mjs` 改为读 `src/client/**` 源码（原先读产物），检查对象与人工编辑的对象一致。
- `tsconfig.json` 纳入 `src/client/**`（补 DOM lib）：浏览器半首次进入 `checkJs` 覆盖。

### Fixed（Phase B1 期间由静态检查抓出）

- **`inputStyle()` 丢弃调用方的覆盖对象**：它声明无参，但两处调用传了 `{ flex: '1' }`，该覆盖在运行时被静默忽略（同文件的 `textareaStyle`/`preStyle` 都会合并覆盖）。已按兄弟函数的契约补上合并。
- **文案表 5 组重复键**：`" 步"` 同时映射 " of the plan" 与 " steps"（后者胜出，前者是死条目），另有 4 组完全重复的条目；已删除先出现的死条目（行为不变），并消除 esbuild / oxlint 的重复键告警。

### Added

- 导出 `VALIDATED_CONFIG_KEYS` / `PASSTHROUGH_CONFIG_KEYS`：25 个文档化配置键的代码形态；`host-check` 断言前者与 `resolvePluginConfig` 实际填出的键集完全一致，新增旋钮若忘记登记会在测试里失败，而不是在挂载期被读成"未知键"。
- 导出 `warnUnknownConfigKeys()`：未文档化的 config 键每进程告警一次（HMR 重复 apply 不会刷屏），日志形如 `plugin-admin: unknown config key(s) ignored: xxx — see README 可调配置键`。
- 导出 `WEBHOOK_HISTORY_CAP_MIN` / `WEBHOOK_HISTORY_CAP_MAX`：挂载期校验与 `lib/webhook-triggers.js` 运行时钳制共用同一组边界。

### Changed

- **11 个直通配置键纳入 fail-loud 校验**（配置写错的行会挂载失败，属于有意的破坏性收紧）：`commandsDir` / `hooksPath` / `disabledPath` / `codexHooksPath` / `cronTasksPath` / `webhookTriggersPath` / `webhookHistoryPath` 须为非空字符串；`projectCommands` / `projectHooks` 须为布尔；`projectHooksTrust` 只接受 `confirm` / `allow-all`；`webhookHistoryCap` 须为 1–10000 的整数。此前这些键写错类型会被静默忽略（例如 `commandsDir: 5` 不报错也不生效）。
- 缺省的直通键在解析结果里仍保持 undefined，各子模块继续沿用自身历史默认值，行为不变。
- README / README.en.md 的配置键章节与实现对齐，去掉"已知的不对称"说明。

### Fixed

- **真实缺陷**：`lib/index.js` 的用量台账后台快照与实时事件观察在 catch 分支调用 `messageOf(error)`，但该标识符从未从 `lib/patch-utils.js` 导入 —— 一旦落盘失败，catch 自身会抛 `ReferenceError` 并掩盖原始错误。已补导入。
- `lib/index.js` 的 `runGit()` 给 `child_process.spawn()` 传了 `encoding: 'utf8'` —— spawn 没有这个选项（那是 exec/execFile 的），运行时被忽略、类型上非法，已删除。
- `lib/index.js` 工作区注册表告警一段的缩进（单空格 → 两空格）。
- 大量 JSDoc 类型表达式修成合法 TS：`@returns { ok, action }` 这类解构式简写、`object[]`/`object|null`、缺 `Promise<>` 包裹的 async 返回类型、单花括号对象类型（应为双花括号）等 —— 它们此前从未被任何工具校验过。

### Added（承上）

- **静态检查闸门**：`tsconfig.json`（`allowJs` + `checkJs`，`lib/client.js` 与 Phase B1 的产物暂排除）、`types/dsh-seams.d.ts`（插件 duck-type 的宿主接缝声明）、`@types/node`、oxlint；`npm test` 现在先跑 `npm run check:types` 与 `npm run check:lint`。
- 首次运行的收获：tsc 从 677 条错误降到 0，其中至少两条是真实缺陷（见上）；oxlint 0 error / 155 warning（warning 多为 `lib/client.js` 字典重复键与风格项，留待 Phase C 的 i18n 迁移一并处理）。

## [1.24.1] - 2026-09-26

### Changed

- 注释与 README 对齐实现事实；`host-check` 补 workflowAdmin 面；cron 冒烟用例转正为 `verify-cron-panel`。
- README 去掉版本兼容性（钳制）章节与版本沿革注记，徽章更新至 v1.24.0。

### Fixed

- 同步 `package-lock.json` 补齐 esbuild@0.28.2 依赖树（修复 v1.23.x / v1.24.0 `npm ci` 发布失败）。

## [1.24.0] - 2026-09-25

### Added

- 自动化页签模板与新手引导；Webhook 规则密钥自动生成。
- 适配 dsh 0.1.7-rc.2，设置侧边栏重组（自动化 / Web 与会话）。

### Removed

- 移除 Loader 运行时相关代码路径。

## [1.23.1] - 2026-09-24

### Fixed

- 待办面板首行右对齐内容与悬浮铃铛重叠。

## [1.23.0] - 2026-09-24

### Added

- 动态工作流模块（引擎 / 运行库 / RPC / agent 工具 / 面板）。
- `/workflow` 斜杠命令（挂载自动注入）与保存作用域自动识别。
- `/workflow create <任务描述>`：按描述自动创建工作流。

### Fixed

- 全插件审查整改：安全、边界与契约修复。

## [1.22.0] - 2026-09-22

### Added

- 面板中英双语切换；MCP 已挂载条目热应用；容量可配与交付历史持久化。
- 已归档会话注入面板美化。

## [1.21.0] - 2026-09-22

### Changed

- 定时任务结构化调度编辑器；插件卡片分行排版；下拉统一样式；技能作用域摘要收敛。

## [1.20.0] - 2026-09-22

### Added

- 技能预设作用域；用量台账持久化；统一 UI 设计系统；宿主级定时任务。
- 归档会话面板：目录折叠 + 批量删除；原「工作区」面板合并进官方面板。
