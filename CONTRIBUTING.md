# 贡献指南

## 验证怎么跑：三条路

| 路径 | 命令 | 适用 |
|---|---|---|
| 最快（秒级～分钟级） | `node scripts/verify-<模块>.mjs` | 只改了一个模块，直接跑对应脚本；无静态闸门 |
| 定向 | `npm test -- --filter <子串>` | 静态三闸门 + 名字含子串的全部步骤（例：`--filter cron` → `verify-cron-admin` + `verify-cron-panel`；`--filter workflow` → 工作流 6 步） |
| 全量 | `npm test` | 提交前兜底；本地与 CI 是同一条命令 |

- 步骤清单与每步职责：`node scripts/run-gate.mjs --list`（步骤表在 `scripts/run-gate.mjs` 顶部，新脚本加进表里即入链）。
- 静态三闸门（`check:types` / `check:lint` / `build:client --check`）在任何 `--filter` 下都会先跑——合计约 2 秒，抓的是单个 verify 脚本看不见的全局性破坏（类型漂移、产物忘重建）。

## 改了什么 → 最小验证集

映射来自各 verify 脚本实际引用的模块（脚本 banner 里写明了自己验什么）。「建议加跑」不是可选项的场景会注明。

### 宿主半 `lib/`

| 改动 | 最小验证集 | 建议加跑 |
|---|---|---|
| `lib/index.js`（apply / config / RPC 装配） | `host-check` + `verify-service-injects` + `verify-rpc-schema` | `self-check`；行为改动加 `smoke:real-host` |
| `lib/patch-utils.js`（原子写 / 文件锁） | `verify-file-lock` | `verify-command-hooks`、`verify-overlays`（同样走 writePatch） |
| `lib/rpc-manifest.js` / `lib/rpc-schema.js` | `verify-rpc-schema` + `host-check` | — |
| `lib/cron-admin.js` | `verify-cron-admin` + `verify-store-version` | `verify-cron-panel`（面板联动时） |
| `lib/webhook-triggers.js` | `verify-webhook-triggers` + `verify-webhook-hardening` + `verify-store-version` | — |
| `lib/usage-ledger.js` | `verify-usage-ledger` + `verify-store-version` | — |
| `lib/subagent-admin.js` / `lib/tool-seed.js` | `verify-subagents-host` | `verify-subagents-client`（面板联动时） |
| `lib/command-hook-admin.js` | `verify-command-hooks` + `verify-hooks-codex-bridge` | — |
| `lib/project-hooks.js` / `lib/shell-policy.js` | `verify-project-hooks` | — |
| `lib/project-agents.js` | `verify-project-commands` | — |
| `lib/skills-admin.js` | `verify-skills-admin` | — |
| `lib/web-search-admin.js` | `verify-web-search-admin` | — |
| `lib/workspace-admin.js` | `verify-workspace-admin` | — |
| `lib/overlay-admin.js` | `verify-overlays` | — |
| `lib/peer-compat.js` | `verify-peer-compat` | — |
| `lib/audit-log.js` | `verify-audit-log` | `host-check`（AUDITED_METHODS 钉死表） |
| `lib/run-command.js` / `lib/mcp-probe.js` | `verify-run-command` + `verify-mcp-cache` | — |
| `lib/workflow-engine.js` | `verify-workflow-engine` | — |
| `lib/workflow-runs.js` | `verify-workflow-runs` | — |
| `lib/workflow-admin.js` / `lib/workflow-library.js` / `lib/workspace-path.js` | `verify-workflow-admin` | — |
| `lib/workflow-tools.js` | `verify-workflow-tools` | — |
| `lib/workflow-command.js` | `verify-workflow-command` | — |
| `lib/health-report.js` / `lib/session-export.js` | `verify-todo-panel` | — |
| `lib/store-version.js` | `verify-store-version` | — |
| `lib/panel-ids.js` | `host-check` | `self-check`（面板注册对账） |
| `lib/client.js` / `lib/client.panels.js` | **不要手改**——`npm run build:client` 的产物，`build:client --check` 会拦 | — |

### 浏览器半 `src/client/`

任何 `src/client/**` 改动：先 `npm run build:client` 重建产物（忘重建会被 `build:client --check` 拦下），然后 `self-check`（jsdom 真实挂载全部面板）+ `verify-i18n`。面板特定补充：

| 改动 | 额外跑 |
|---|---|
| 自动化面板（cron / webhook 页签） | `verify-cron-panel` / `verify-webhook-triggers` |
| 待办浮层 | `verify-todo-panel` |
| 子智能体面板 | `verify-subagents-client` |
| 工作流面板 | `verify-workflow-client` |
| MCP 连通缓存 / 更新提醒 | `verify-mcp-cache` / `verify-update-reminders` |
| `impl.js` / `native-coverage.js`（slot 装配 / 让位策略） | `self-check` + `integration-check` |
| `i18n.js` / `styles.js` | `self-check` + `verify-i18n` |

### `scripts/` 与文档

- `scripts/verify-*.mjs`：直接跑它自己，再过一遍 `npm run check:lint`。
- **新增 `scripts/*.mjs` 必须同时加进 `run-gate.mjs` 的 `STEPS` 表**——否则它永远不会跑，而"文件在那儿"会让人以为它跑了。`verify-doc-claims` 会红着告诉你（它断言 `verify-*` 的磁盘数量与闸门里引用的数量相等）。
- `docs/*.md` 里的计数（探针条数 / 脚本个数 / RPC 方法数）：改数字前先跑对应命令实测——文档口径以命令输出为准（CHANGELOG 头部的约定）。**这一类现在已经不是靠自觉**：`verify-doc-claims` 把关（见下）。

### 文档声明不得与仓库脱节（`verify-doc-claims`）

历史上出过至少四次"文档说得像真的、实际不是"：`ARCHITECTURE.md` 写"3 道静态闸门 / 共 38 步"（实际 4 / 39）、`COMPAT.md` 写"34 个脚本"（实际 35）、CHANGELOG 把某套件的用例数写成"33 → 35"（实测 32 → 34）、`projectWorkflowsDir` 的注释声称两道包含性守卫而实现只有一道。

**"注意保持同步"不是一条人能可靠执行的规则，承诺自己会小心也一文不值。** 能可靠的是：这些声明是可数的，那就去数。`scripts/verify-doc-claims.mjs` 把每一类变成一条会红的断言，已挂进静态闸门段：

| 检查 | 抓的是 |
|---|---|
| 步数 / 静态闸门数 / verify-* 数量 | 改了 `run-gate.mjs` 的表却没改文档（或反过来） |
| 文档点名的 `scripts/*.mjs`、CHANGELOG 点名的 `lib|src/*` 是否存在 | 重命名/删除文件后留下指向空气的文档 |
| 最新 CHANGELOG 各节的 `N → M checks` | 算术不自洽（M ≤ N）、跳变异常、或 **M 超出该套件自身声明的用例数** |
| config 键数（受校验 / 直通 / 总数） | 增删 config 键后文档表格未更新 |

范围**刻意收窄**：只查"文档里有、且不靠判断就能从仓库推出来"的声明。关于意图、设计与行为取舍的叙述**不在此列**——一个靠猜的闸门比没有闸门更糟。

只查**最新三个 CHANGELOG 节**（`[Unreleased]` + 最近两个已发布版本）：更早的节按文件头部约定是**冻结快照**，回溯修改它们才是错的。

### 行号锚点（`verify-line-anchors`）

写 `` `<path>:<起>-<止>` `` 这类锚点时（例：指向 `lib/index.js` 里用量台账观察器的那一条），行号**由闸门守着**。它失效的方式和路径不同——重构把代码挪走后文件还在、路径还对，于是"路径存在"检查照旧全绿，而行号已经指向无关函数、甚至越过文件末尾（真实案例：~~`lib/index.js:1756-1795` 曾同时出现在两个文档里，而 v1.26.2 把该文件从 3648 行拆到 936 行）。

规则：

- **锚点必须写在反引号里，且带已知顶层目录前缀**（`lib/` `src/` `scripts/` `types/` `docs/` `packages/`）。这是机器识别的唯一依据，也让正文可以随意提到"index.js 第 12 行"而不被当成声明。
- **引用失效的旧锚点当反例时，在反引号前加 `~~`**（即 `~~` + 反引号 + 锚点）。被标记的不算声明，闸门跳过它。没有这个出口，"把这个闸门当初为什么存在写进文档"本身就会让闸门变红。
- **指向上游 dsh 的锚点**（`packages/…`）本地无法核对，闸门会**如实打印"未核对"**而不是假装通过；设 `DSH_CHECKOUT=<dsh 源码目录>` 后按真实 checkout 核对。
- 重构搬走代码后，**把锚点改指新位置**，不要留下一个能通过"行号在文件内"、却指向错误函数的锚点。这条闸门只能证明行号没越界，**证明不了语义仍对**——后者仍靠人。

## 什么时候跑全量 / 冒烟 / 矩阵

- **提交前兜底**：`npm test`（CI 跑的就是这条，本地绿了 CI 才有意义）。
- **宿主半行为改动**：`npm run smoke:real-host` —— 启动真实 dsh、装插件、21 次只读 RPC + 写路径落盘 + 真实 Chromium 渲染（约 11–30 秒；需要 dsh CLI 与 pnpm，CI 的 `host-smoke` 作业是强制版）。
- **接缝相关改动**（宿主服务用法 / RPC 形状）：`integration-check` 只有在能读到 dsh 源码 checkout 时才是强制的——设 `DSH_CHECKOUT=<dsh 源码目录>`，或把 checkout 放在仓库旁的 `../deepseek-harness`（会被自动发现）；多版本用 `npm run test:matrix`。
- **性能相关改动 / 判断某项优化值不值得做**：`node scripts/bench-journal.mjs` 与 `node scripts/bench-client-render.mjs`。这两个**测量而非断言**，因此不进 `npm test`（数字依赖机器）；结论与实测数据记在 [docs/BENCHMARKS.md](docs/BENCHMARKS.md)。写这类脚本时当心"假成功"：两者各自都被量到过"什么都没做"的漂亮数字（mock 缺 `dispose()` 使每步抛错、`dispatchEvent` 打不到 React 的 `onChange`），所以现在都带哨兵——基准必须能证明它测的东西真的发生了。

## 测试是怎么写的

零测试框架：每个 verify 脚本是独立 node 进程，`mkdtempSync` 临时目录自清理，断言用 `node:assert`，时间相关用例用固定时间戳或全局 stub 保证确定性。新脚本写好后加进 `scripts/run-gate.mjs` 的 `STEPS` 表（保持「静态闸门 → self/host-check → verify 链 → integration-check」的段序），`npm test` 自动带上。

Hooks 纪律靠人工：客户端源码是手写 `createElement` 的纯 `.js`，oxlint 的 `react/hooks` / `react/rules-of-hooks` 只在 `.jsx`/`.tsx` 上触发（实测），自动闸门覆盖不到——新增组件请保持「hook 调用顶层无条件、`useState` 经 `var` 解构自 React」的既有模式。

## strict 轨道（渐进类型收紧）

`npm run check:types-strict`（run-gate 的常驻静态步）跑 `tsconfig.strict.json`：在主配置之上开 `noImplicitAny`，`include` 是一个**只增不减**的文件清单，从并发正确性核心（patch-utils / usage-ledger）开始。把新文件纳入的方式：先在本地把它的隐式 any 清零（给缺类型的参数补 `@param {T}`），再把文件加进 include——纳入即受闸门保护，回退 = 从清单删除。

**`include` 列的是入口文件，但 `tsc` 会顺着 import 往下走**：一个文件只有在**它和它整条传递 import 闭包**都清零之后才能纳入，否则清单里加一行就带进来别人的一堆错误。所以优先纳入**独立叶子**（无 import，如 `panel-ids.js`）与小而自洽的模块；`patch-utils.js` 之所以能作为第一个入口，正是因为它的闭包只有它自己。想知道某个入口会带进哪些文件、以及还差多少，先量一遍再动手——写一行小脚本走一遍 `from './x.js'` 构图即可，比试错快得多。

当前覆盖 **39 个宿主文件中的 39 个**（**全量**——主机半场（`lib/**`）已全部纳入）。这个数字由 `scripts/verify-strict-track.mjs` 从配置与真实 import 图**重算**并断言，所以改入口清单必须同步这句散文、反之亦然——它同时守住"清单只增不减"（地板值随新增上调）。这条轨道上"开关真的抓到东西"的历史记录：① 给 `health-report.js` 补 `HealthReport`/`ToolHealth` typedef 时，开关当场抓出**文档注释本身写错**的 `errorCodes` 形状（实际是 `{code,count}[]` 而非 `string[]`）；② 给 `peer-compat.js` 补 `ParsedVersion` 时，"只缓存正结果"的契约才被写成显式类型（`string|null|undefined`）而不是隐式 any；③ 给 `skills-admin.js` 的 `scopeInfoFor` 补返回类型时，发现注释声明 `cwd: string` 而实现实际返回 `string|null`——类型一写下来就露了；④ `mcp-probe.js` 的 `{ ok: probe.ok, … spread …probe }` 被 `TS2783` 点名（展开在后覆盖掉调用点算出的显式字段）；⑤ `makeSerialQueue` 声明的 `() => Promise<T>` 契约比真实（宽松）契约窄，`subagent-admin` 有 3 处传同步回调，按 Promise 标注立刻暴露。

**`include` 列的是入口文件，但 `tsc` 会顺着 import 往下走**：一个文件只有在**它和它整条传递 import 闭包**都清零之后才能纳入，否则清单里加一行就带进来别人的一堆错误。所以优先纳入**独立叶子**（无 import，如 `panel-ids.js`）与小而自洽的模块；`patch-utils.js` 之所以能作为第一个入口，正是因为它的闭包只有它自己。想知道某个入口会带进哪些文件、以及还差多少，先量一遍再动手——写一行小脚本走一遍 `from './x.js'` 构图即可，比试错快得多。

剩下的不是被政策排除，而是**需要真正的类型建模**：全量开 `noImplicitAny` 目前约 1900 条，其中 ~72% 是 `TS7006`（回调参数缺类型），其余多是把 `{}` 字面量逐步加属性（`TS2339`）、用 `string` 索引一个无索引签名的对象（`TS7053`）。这些要补的是接口/typedef，**不是** `@param {any}`——补 `any` 只是把错误挪走，同时废掉这个开关的意义。

### 浏览器半场轨道（`src/client/**`）

主机半场走完后，`noImplicitAny` 想真正"折回 `tsconfig.json` 成为全仓默认"，还差浏览器半场——主配置同时管着 `lib/**` 与 `src/client/**`，任一半不清完都不能开。因此有了第二条同机制轨道：`npm run check:types-strict-client` 跑 `tsconfig.strict-client.json`（同样 extends 主配置、同样只增不减），当前覆盖 **20 个浏览器文件中的 15 个**。它与主机轨道**共用同一个守卫**（`verify-strict-track.mjs` 同时重算并断言两条的覆盖数与地板值），机制、纪律、先例完全相同。

浏览器侧的两个外部模块不是本仓代码，类型由 `types/react.d.ts` 接缝声明——沿用 `dsh-seams.d.ts` 的"零依赖接缝"立场，不引入 `@types/react`；签名**刻意保持松**：React 的 hook 是泛型的，而面板按动态方式调用（`useState(null)` 的 setter 后来收对象、`useRef(null)` 后来存 Timeout），严格泛型接缝会把状态字面量钉死、点亮四个面板约 90 条主配置必须保持全绿的错误。接缝只负责让 `import React from 'react'` 可解析（修 TS7016），严格 client 轨道检查的是面板**自己**的代码。客户端第一个入口 `panels/context.js` 的 TS7016 就是这样清零的。实测全量还有 **962 条 / 17 个文件**（最大 `panels/subagents.js` 160 条）；按闭包排序，`styles.js` / `context.js` / `i18n.js` / `native-coverage.js` 四个叶子已先纳入。

**`strictNullChecks` 已是主配置默认**（2026-09 折回，见 CHANGELOG）：判别布尔字面量联合时仍优先写 `x.ok === false` 而不是 `!x.ok`——后者在 `strictNullChecks` 关闭时实测**不能**收窄（左 `ok: true` 成员仍在作用域内、`x.message` 报 TS2339），而显式 `=== false` 无论开关状态都直接。给 `catch` 里构造的失败对象加 `@type` 断言也是必需的（catch 绑定是 `any`，不注释会推出 `ok: boolean` 从而毁掉整个联合类型的判别）。

### 开 `strictNullChecks` 的可行性（已实测，2026-09）

**结论：可行，量级只有 `noImplicitAny` 的 1/14，应当优先于继续刷 `noImplicitAny` 覆盖率。** 全量开它是 **139 条**（对照 `noImplicitAny` 约 1900 条），影响 26/50 个文件，且分布平坦——最大的 `impl.js` 也只有 18 条，没有尾部。原因是这个开关只检查「可能为空的值有没有被直接用」，而本仓库的空值来源集中在少数几个模式上。

按成因分四类（实测计数）：

| 类别 | 条数 | 性质 |
|---|---|---|
| `let x = null` / `const xs = []` 后赋值 | 44 + 20 | **机械**：补一个 `@type` 即可，不动逻辑 |
| 「possibly null/undefined」解引用 | 25 | 多为**已有运行时守卫但类型证不出**（如 `if (derived === null) derived = …` 之后再赋值） |
| null/undefined 作为实参传入 | 8 | 多数也是守卫已存在 |
| 其余 | 42 | 逐个看，含少量**真问题** |

**已实测的机械性**：`patch-utils.js` 原本 6 条，加 5 处注解（三个 `let quote = null` → `@type {'"'|"'"|null}`、锁句柄 `number|null`、`keyIndent` `string|null`）后**归零**，且 `verify-file-lock` / `verify-store-version` / 全量 `npm test` 均无回归。照此推算，约六成的 139 条属同一手感。

**它确实抓到了真问题（这正是它比 `noImplicitAny` 更值的地方）**：`mcp-probe.js:348/351` 的
`outcome = { ok: probe.ok, transport: 'stdio', ms: ms(), ...probe }` —— `...probe` 展开在**后面**，而 `probe` 自己的 docblock 就写着它会返回 `ok` / `transport` / `ms`，于是前面那三个显式字段**全部被覆盖**：调用点算出的 `ms` 被丢弃，`transport` 的硬编码值也失效。`TS2783`（"specified more than once, so this usage will be overwritten"）把这类「写了但没生效」的字段直接点名——这是 `noImplicitAny` 看不见的一类缺陷。同一类还有 `mcp-admin.js` / `subagent-admin.js` 里几处 `never[]` 推断（`const steps = []` 这类，空数组字面量在无注解时推成 `never[]`，后续 `push` 才炸）。

**注意区分「真 bug」与「类型证不出」**：`session-admin.js:1003` 的 `derived` 在 `if (derived === null) derived = deriveSessionSummary(events)` 之后使用，运行时是安全的，报错只是 TS 无法穿过那个分支证明它非空。修法是补注解让证明成立，**不是**改逻辑——把这类当成 bug 去"修"反而会引入真 bug。

**这条路已经走完了（2026-09）**：`strictNullChecks` 作为默认值写进 `tsconfig.json`，`tsconfig.strict-null.json` 与 `npm run check:types-strict-null` 随之删除（run-gate 回到 **42 步 / 6 道静态闸门**）。折回前按同一套"先量 import 闭包、再逐个补注解"的清单机制把 lib 层 **39/39** 全部清完，并额外清掉 `src/client/**` 的 **32 条**（`impl.js` 18 / `i18n.js` 6 / 四个 panel 8）——所以这个开关现在对全仓是常开的，不再有"轨道"文件。`verify-strict-track.mjs` 现在只守 `noImplicitAny` 一条轨道（flag 是否为真、入口是否存在、清单只增不减、文档覆盖数等于重算结果）。

**这段历史里最值得记住的发现，是 `noImplicitAny` 会屏蔽 `strictNullChecks`**（所以当初两条轨道必须独立，各自直接 extends `tsconfig.json`）：最小复现——`let q = null; q = '"'` 在 `strictNullChecks` 单独开启时报错（`q` 被钉成字面量类型 `null`），**同时**打开 `noImplicitAny` 后不再报错（该 flag 让声明推成更宽的联合类型）。在 `patch-utils.js` 上实测：`strictNullChecks` 单独开是 **3 条**，两个 flag 一起开是 **0 条**。现在两条 flag 在 lib 上叠加之所以没有新发现，正因为 lib 已在两条轨道各自独立检查时全部清零——这就是当初规划的"全部折回"的终点。另一个继承下来的经验是**清单扩容的方式**：先量传递 import 闭包、再逐个补注解，已清文件在另一条轨道上多数是**零改动**纳入（那 21 个里有 14 个如此）。

**`strictNullChecks` 单独开着时能抓到 `noImplicitAny` 看不见的真缺陷**（这也是当时优先做它的原因）：最典型的是 `TS2783` 把"写了但没生效"的展开点名——`mcp-probe.js` 的 `{ ok: probe.ok, transport: 'stdio', ms: ms(), ...probe }` 里 `...probe` 展开在后，probe 自带 `ok`/`transport`/`ms`，于是调用点实时算出的 `ms` 被丢弃、硬编码 `transport` 也失效；同一类还出现在 `webhook-triggers.js` 的三处返回值里。

**补注解时的一个 JSDoc 陷阱（实测踩到）**：`let x = null` 在 `strictNullChecks` 下的类型是**字面量 `null`**，于是「在 Promise 执行器里赋值」报 `TS2322`，之后每次读取都收窄成 `never`：`error TS2349: Type 'never' has no call signatures`。**给这个 `let` 加 `@type {((r?: unknown) => void)|null}` 注解没有用**——实测带注解与不带注解都失败；用 `const` 别名转发同样失败。唯一有效的是把初始化写成 `/** @type {any} */ (null)`（或把可空值放在对象属性上）。看到「`never` 没有调用签名」基本就是这个成因。

## 环境

Node ≥ 22.19（或 ≥ 24）；`npm ci` 后即可跑全部门禁（`smoke:real-host` 例外，另需 dsh CLI + pnpm）。
