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
- `docs/*.md` 里的计数（探针条数 / 脚本个数 / RPC 方法数）：改数字前先跑对应命令实测——文档口径以命令输出为准（CHANGELOG 头部的约定）。

## 什么时候跑全量 / 冒烟 / 矩阵

- **提交前兜底**：`npm test`（CI 跑的就是这条，本地绿了 CI 才有意义）。
- **宿主半行为改动**：`npm run smoke:real-host` —— 启动真实 dsh、装插件、21 次只读 RPC + 写路径落盘 + 真实 Chromium 渲染（约 11–30 秒；需要 dsh CLI 与 pnpm，CI 的 `host-smoke` 作业是强制版）。
- **接缝相关改动**（宿主服务用法 / RPC 形状）：`integration-check` 只有在能读到 dsh 源码 checkout 时才是强制的——设 `DSH_CHECKOUT=<dsh 源码目录>`，或把 checkout 放在仓库旁的 `../deepseek-harness`（会被自动发现）；多版本用 `npm run test:matrix`。

## 测试是怎么写的

零测试框架：每个 verify 脚本是独立 node 进程，`mkdtempSync` 临时目录自清理，断言用 `node:assert`，时间相关用例用固定时间戳或全局 stub 保证确定性。新脚本写好后加进 `scripts/run-gate.mjs` 的 `STEPS` 表（保持「静态闸门 → self/host-check → verify 链 → integration-check」的段序），`npm test` 自动带上。

Hooks 纪律靠人工：客户端源码是手写 `createElement` 的纯 `.js`，oxlint 的 `react/hooks` / `react/rules-of-hooks` 只在 `.jsx`/`.tsx` 上触发（实测），自动闸门覆盖不到——新增组件请保持「hook 调用顶层无条件、`useState` 经 `var` 解构自 React」的既有模式。

## strict 轨道（渐进类型收紧）

`npm run check:types-strict`（run-gate 的常驻静态步）跑 `tsconfig.strict.json`：在主配置之上开 `noImplicitAny`，`include` 是一个**只增不减**的文件清单，从并发正确性核心（patch-utils / usage-ledger）开始。把新文件纳入的方式：先在本地把它的隐式 any 清零（给缺类型的参数补 `@param {T}`），再把文件加进 include——纳入即受闸门保护，回退 = 从清单删除。

## 环境

Node ≥ 22.19（或 ≥ 24）；`npm ci` 后即可跑全部门禁（`smoke:real-host` 例外，另需 dsh CLI + pnpm）。
