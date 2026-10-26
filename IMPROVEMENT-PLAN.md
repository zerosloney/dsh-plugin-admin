# dsh-plugin-admin 改进方案

> 状态：**已执行**——A→G 各阶段主体工作完成（16 轮推进，每轮 `npm test` 全绿）。剩余项见文末"仍开放"。
>
> **v1.30.0 追加（第二轮对照上游的收口）**：`analysis/00-SUMMARY.md` 的 28 条收口之后，再对照
> `deepseek-harness` HEAD（`22ddee3792`，rc.3 之后 1533 个提交）复核，处置了 A→G 阶段留下的 5 项与 2 项新发现。
> 逐条结论见 `CHANGELOG.md` 的 `[1.30.0]` 节；本节只记状态。
> 基线校验：`npm test` 全绿（exit 0，tsc / oxlint / 产物一致性 / 34 个脚本）；`integration-check` **93 条契约**探针通过；`npm run test:matrix` 支持多 checkout。

## 执行状态（滚动更新）

| 阶段 | 状态 | 说明 |
|---|---|---|
| A1 配置校验与未知键告警 | ✅ 完成 | 11 个直通键纳入 fail-loud；未知键每进程告警一次；`VALIDATED_CONFIG_KEYS` / `PASSTHROUGH_CONFIG_KEYS` 导出并由 host-check 断言与解析结果一致 |
| A2 tsconfig/checkJs + 接缝类型 + oxlint | ✅ 完成 | `npm test` 现在先跑 `check:types` 与 `check:lint`；tsc 从 677 条错误清零，oxlint 0 error / 155 warning（warning 留给 Phase C） |
| A3 CHANGELOG + COMPAT | ✅ 完成 | `CHANGELOG.md`（自 v1.20.0 起 + Unreleased）、`docs/COMPAT.md`（dsh 版本 × 面板 × 机制矩阵，Phase E 接管自动生成） |
| A4 CI | ✅ 完成 | `npm test` 串起 tsc / oxlint / `build:client --check`（产物一致性）/ 33 个验证脚本；`.github/workflows/ci.yml` 直接调用 `npm test`，本地与 CI 同一条命令 |

| B2 面板懒加载 chunk | ✅ 完成 | 入口 592→116 KB（−80%，达成 ≤150 KB）；面板+样式 468 KB 改为 `require.async` 按需 chunk；`configure(env)` 注入共享 helper；构建产物加结构断言；夹具补 `harness-client.mjs` |
| B3 复用平台共享模块 | ✅ 完成 | 基线整体 external（**不**写 `dsh.client.external`，AGENTS.md 明令禁止）；`ui-primitives` 环境声明补齐 tsc；夹具替身（记忆化）。控件迁移见 B3a-e 各行 |
| B3c 胶囊 + 收尾 | ✅ 完成 | 9 个 pill 改官方 `Pill`（日期范围 / 会话状态 / 动作模式）+ 最后 2 处 `btn`；面板源码里 `btn`/`pill` 类名归零（`UiButton`/`UiPill` 148 处）；测试改按标签与 `aria-pressed` 识别 |
| B4a 退役控件样式 | ✅ 完成 | 删 17 条 `.btn*`/`.pill*` 外观规则；4 条布局/语义规则改挂 `className`（`.group-action` / `.pin-active` / 结构性选择器）；self-check 增加"旧类名重现即失败"的回归守卫 |
| B3d 文本框迁移 | ✅ 完成 | 47 个 input 改官方 `Input`；17 个保持原生（checkbox/radio/无类 workflow 输入/需 ref 的 Picker）；事故：12 处丢 `value`、1 处丢 `placeholder`，已按语义还原（检出靠行为测试 + i18n 闸门 + 结构化审计三层） |
| B3e 复选框迁移 | ✅ 完成 | 11 个 checkbox 改官方 `Checkbox`（文案提升为 label；无 style/onClick/id 的三处用 span 包裹保留行为）；面板源码 checkbox 归零 |
| B4b 输入类样式 | ✅ 收口 | 无规则可删：剩余的 `select.input` / `textarea.input` 服务刻意保留原生的控件；布局语义类经 `className` 继续生效 |
| E1/E2 探测表 + 自动让位 | ✅ 完成 | `src/client/native-coverage.js`（11 行面板表 + 客户端信号探测）；命中即不注册；localStorage 强制开关；self-check 三用例覆盖 |
| E3 面板级开关 | ✅ 完成 | `config.panels` 三态开关（fail-loud：未知 id/状态挂载即报错）；id 单一来源 `lib/panel-ids.js`（11 个，两半共用）；浏览器半经新 RPC `pluginAdmin/panels` 问一次，缓存答案后**立即注册**，新答案到达再对账（off 注销 / on 补注册）；优先级 off → on → localStorage 强制 → 自动让位 |
| E4 COMPAT 同源 | ✅ 完成 | `docs/COMPAT.md` 的「官方覆盖与让位」表与探测表同源 |
| F1 跨进程写锁 | ✅ 完成 | `withFileLock` 包住 `writePatch` 的备份+rename；失败开放/过期回收/同步睡眠；`verify-file-lock.mjs` 4 项 |
| F3 审计日志 | ✅ 完成 | `lib/audit-log.js`（追加写 + 键名脱敏 + 上限压缩）+ 7 个命名空间接入 + `pluginAdmin/auditLog` RPC + 面板「操作审计」卡片 + 两个测试脚本 |
| F2 落盘 version + 迁移 | ✅ 完成 | `lib/store-version.js`（读侧契约：缺省 v1 / 迁移链 / 更新拒读 / 非法容忍）；接入 ledger+rules+cron；修掉"先写后读"的覆盖口子；`verify-store-version.mjs` 7 项 |
| F4 webhook 加固 | ✅ 完成 | 默认仅 loopback（403 + 显式开启）；滑动窗口限速 + 认证失败封锁（429 + retry-after）；核实并钉住常量时间比较；`verify-webhook-hardening.mjs` 6 项 |
| G1 接缝断言 | ✅ 完成 | 探测 78 → 88 条：补 `slots.entries`（E）、locale 运行时（C）、`WebRoute`（F4）；只读源码无需构建 |
| G2 多版本矩阵 | ✅ 完成 | `check-matrix.mjs` + `npm run test:matrix`：无 checkout 目录记 SKIP，任一存在者漂移即失败；COMPAT 记录用法与承重接缝 |

| D1 RPC 单一真相表 | ✅ 完成 | `lib/rpc-manifest.js`（91 方法/14 命名空间；D1 落地时为 89，方法面随面板增删演进，当前值以 `lib/rpc-manifest.js` 与 `verify-rpc-schema` 实测为准）由挂载表面导出；host-check 双向闸门（表↔描述符、表↔客户端调用点、必填/可选线名）；模块已改为从表生成（见 D1b），结构上不可能不一致 |
| D1b 模块从表生成描述符 | ✅ 完成 | 14 个命名空间全部改用 `invocationsFor(namespace)`；89 条手写描述符与 4 处死常量删除；host-check 的挂载等值断言逐轮把关 |
| D3 双向一致性测试 | ✅ 完成 | 见上；含负向验证 |
| D2 描述符补 schemas | ✅ 完成（用户点名实现） | **87 个参数**改挂 `mode: 'strict'`，网关按 `codec.create().parse(value)` 在边界校验。校验器手写零依赖（`lib/rpc-schema.js`，7 个 schema）—— 注册表只要求 `typeSymbol` 非空 + `create()` 返回带 `parse` 的对象，**不必引入 zod、不必生成类型**（原先判断为不采纳正是卡在"必须用生成器的 Zod 工厂"这个前提上，实测不成立）。刻意不比服务更严（不枚举 entry 字段）、省略语义不变（`acceptsUndefined`）。`RPC_PARAM_SCHEMAS` 由 host-check 断言完整且忠实，`verify-rpc-schema.mjs` 5 项 |
| C1 locale 运行时绑定 | ✅ 完成 | `installLocaleRuntime(ctx)`（软依赖 + 回落）；`dshT()` 读绑定翻译函数 |
| C2 slot 标签 thunk + 实时重绘 | ✅ 完成 | 9 个 slot 标签改 thunk；10 个组件经 `withLocale()` 订阅重绘；🌐 开关驱动 shell `setLocale`（无 reload） |
| C3 字典一致性 | ✅ 完成 | 运行时键集相等（self-check）+ zh 派生关系（verify-i18n） |

**执行期发现（值得单独记一笔）**：`lib/index.js` 的用量台账失败分支调用了一个从未导入的 `messageOf()`，落盘失败时会抛 `ReferenceError` 掩盖原始错误；`runGit()` 给 `spawn()` 传了不存在的 `encoding` 选项。两条都是 `checkJs` 首轮就抓到的。

---

## 0. 目标与约束

**目标**：在不牺牲"零 dsh 运行时依赖"和"跨 dsh 版本可活"这两项核心资产的前提下，把契约保真度、客户端工程质量、与官方新能力的共存策略各提升一个档位。

**硬约束**

- C1 不新增 @deepseek-ai/dsh-* 的**运行时**依赖（类型声明与平台共享模块例外，见 A2/B3）。
- C2 支持范围为 **dsh ≥ 0.1.7-rc.2**（v1.25.0 起不再支持 0.1.6，决策见 §8-1）：同范围内的新接缝仍必须"先探测、后降级"，不得硬用。
- C3 每个阶段结束时 npm test 必须保持绿（28 个脚本）。

**非目标**：重写为 TypeScript；立刻拆分为多包（先做面板开关，见 E3）；替换现有自研测试框架。

## 1. 现状基线（验收对照用）

| 指标 | 现值 |
|---|---|
| 宿主代码 | 24 文件 / 16,695 行 / 804KB |
| 客户端产物 | lib/client.js 单文件 10,525 行 / 605,432 B（**手写入库**） |
| 样式 | 内联全局 style 注入 + data-dsh-admin-* 属性选择器；字面色匹配 341 处；--dsw-* token 仅 20 个 |
| i18n | 自建 I18N_EN 字典 + localStorage(dsh-admin-lang)，切换语言需 reload |
| RPC | 22 条手写 typert 描述符（schemas 为空）+ 客户端裸调 ctx.connection.rpc.call('/api') |
| 静态检查 | 无 tsconfig / 无 lint；JSDoc @param 549 处 |
| config | 14 键强校验 + 11 键静默直通（未知键无告警） |
| 多版本验证 | 单宿主（DSH_CHECKOUT 默认取 sibling） |

## 2. 阶段计划

### Phase A — 护栏与可观测性（1–2 人日）

| # | 任务 | 落点 | 验收 |
|---|---|---|---|
| A1 | 未知 config 键 logger.warn 一次（去重）；把文档承诺的 11 个直通键纳入类型校验 | lib/index.js 的 resolvePluginConfig() | 新增用例：传 fooBar 产生 1 条 warn；commandsDir: 5 报错或 warn，结论写进 README |
| A2 | 加 tsconfig.json（allowJs + checkJs + noEmit）、types/dsh-seams.d.ts（声明 typert 描述符、workspaceRegistry、agentPresets.acquireScope、sessionPersistence、fiber.update 的形状）、.oxlintrc.json | 仓库根 | npx tsc --noEmit 与 npx oxlint 均 0 error，并纳入 npm test |
| A3 | 新增 CHANGELOG.md 与 docs/COMPAT.md（dsh 版本 × 面板 × 机制矩阵） | 新增文件 | 自 1.24.1 起条目补齐；矩阵与 Phase E 探测表同源 |
| A4 | CI 增补 tsc / oxlint 两步，为 B1 预埋"产物一致性"占位 | .github/workflows/ci.yml | CI 全绿 |

**风险与回退**：checkJs 首轮噪声可能掩盖真实问题 —— 分批开启（先 lib/，后客户端源码），噪声项一律带原因注释，并在 Phase D 清偿。

### Phase B — 客户端工程化（收益最大，5–8 人日）

| # | 任务 | 依据 | 验收 |
|---|---|---|---|
| B1 | 新增 src/client/（ESM + JSX）与 scripts/build-client.mjs（esbuild），产出 lib/client.js；CI 加"构建后 git diff --exit-code" | devDependencies 已有 esbuild | npm run build:client 幂等；产物与入库文件一致；源码可过 checkJs |
| B2 | 面板按 tab 懒加载：主 bundle 只注册 slot，面板实现用 require.async 拉取包内 chunk | 加载器 chunk 契约：相对 chunk 必须与 bundle 同包路径、文件名须匹配 client.<名>.js 形式（packages/client/modules/src/client/system.ts 的 makeRequire / importChunk） | 主 bundle 首屏不超过 150KB；打开设置才拉面板 chunk；冷启动解析开销下降一半以上 |
| B3 | 复用平台共享模块：dsh.client.external 声明 ui-primitives / ui-slots / client-store，并用 try-catch 包装 require 以兼容不提供该 seed 的旧宿主 | 种子表 PLATFORM_MODULES（packages/client/web/src/platform.ts）；缺项时抛可捕获 Error（system.ts:326） | 新宿主用官方控件渲染；旧宿主回落自绘；无 missed the module table 报错 |
| B4 | 控件换官方 primitives 后删除对应自绘 CSS；剩余样式全部改用 --dsw-alias-* / --dsw-static-* token，去字面色；菜单改 Menu / MenuSurface | docs/web-styling.md 的强制规则 | CSS 行数下降一半以上；字面色 0 处；亮暗色、0.5px 描边与 elevation 规则目视一致 |

**风险**：B3 在缺 seed 的宿主上会导致整包加载失败 —— 必须 try-catch 包装，并在 host-check 增补"无 seed 场景"用例。
**回退**：B2/B3 任一不稳，可只保留 B1（构建产物），其余回退到"单包 + 自绘"，功能不受影响。

### Phase C — i18n 接回官方 ctx.locale（2–3 人日）

| # | 任务 | 依据 | 验收 |
|---|---|---|---|
| C1 | inject 增加 locale；有服务则 ctx.locale.register(NS, 中英字典) + bind(NS) + ctx.effect 订阅，无服务回落现有 dshT() | locale 是客户端 Context 上 provide 的服务（packages/client/locale/src/client/index.ts:581）；官方 ui-approval / ui-plugin-manager 同款用法 | 跟随 shell 语言切换**无需 reload**；旧宿主行为不变 |
| C2 | slot 标签改传 locale key 并带 locale: NS，删除 🌐 自绘切换与 reload 逻辑 | 官方注册形态一致 | 面板标题随 shell 语言实时切换 |
| C3 | 保留 verify-i18n.mjs 作覆盖率闸门，扩展"两套字典 key 集一致"断言 | 现有脚本 | 覆盖率与一致性同时绿 |

### Phase D — 契约同源化（3–4 人日）

| # | 任务 | 依据 | 验收 |
|---|---|---|---|
| D1 | 抽出 lib/rpc-manifest.js 作唯一真相表（命名空间/方法/参数/结果），描述符与客户端调用点都从它生成 | 现 22 条描述符与客户端调用是两份手写真相 | 生成结果与现行为等价（host-check 全绿） |
| D2 | 描述符补真实 schemas（现值空数组），让网关校验入参 | ctx.typert.register 支持 schemas | 传错类型得到网关层错误，而非静默透传 |
| D3 | 双向一致性测试：每个描述符都有客户端调用点，反之亦然 | — | 新增用例；故意删一条调用即失败 |

**不做**：TypertRemoteService + @Remote + ctx.remote.*（违反 C1）。D1/D2 已覆盖其大部分收益。

### Phase E — 官方优先共存策略（4–6 人日）

| # | 任务 | 落点 | 验收 |
|---|---|---|---|
| E1 | 新增 lib/native-coverage.js：探测表 + auto / force / off 三态 | 新增文件 | 单测覆盖"宿主有无官方能力"两种注册结果 |
| E2 | 探测信号（示例，开工前用真实宿主逐个核对）：客户端看 remote.pluginManager 服务、slot 条目、locale；宿主看 ctx.get('tools') 是否已有 workflow 工具、schedule 等服务 | 客户端与宿主注册处 | 与官方能力同存时自动隐藏插件页签，并留一行"已被官方覆盖"说明 |
| E3 | 面板级开关：config.panels = { plugins: false, schedule: false, ... } | resolvePluginConfig + 客户端注册处 | 关掉某面板后不再注册该 slot，其 chunk 也不加载 |
| E4 | docs/COMPAT.md 增加"官方覆盖状态"一节，由探测表生成 | 与 A3 合并 | 文档与代码同源 |

**收益**：把"与上游赛跑"变成"上游补齐即自动让位"，这是决定项目两年后是否仍在的关键项。

### Phase F — 数据安全与审计（3–4 人日，可按需）

| # | 任务 | 依据 | 验收 |
|---|---|---|---|
| F1 | 跨进程写保护：cordis.patch.yml 与各 JSON 存储写入前加 advisory lock（独占创建 + pid/mtime 过期），或 rename 前做内容哈希 CAS | 现串行队列仅在进程内生效（lib/patch-utils.js） | 双进程并发写同一 profile 的用例无丢失更新 |
| F2 | 落盘文件加 version 字段与迁移函数（usage-ledger / webhook-triggers / webhook-history / cron-tasks） | 这些文件比插件版本活得久 | 旧格式可读并原地升级一次 |
| F3 | webhook secret 常量时间比较 + 速率限制 + 非 loopback 绑定默认拒绝并在面板警示；特权动作（pnpm add/remove、hooks 写入、批删、webhook 规则变更）写 append-only 审计日志 | 该端点绕过浏览器认证，secret 是唯一防线 | 面板可见最近 N 条审计记录 |

### Phase G — 上游化与多版本 CI（持续）

- G1 向 dsh 上游提"公开的 config-patch 热应用 API"，替代 loader 内部 fiber.update(config, true)；落地前先把该接缝纳入 host-check 断言（接缝消失即测试失败）。
- G2 CI 矩阵：**已落地**（`.github/workflows/ci.yml`）——`test` 作业对 pin 住的 `dsh-v0.1.7-rc.2` 跑完整 `npm test`（CI 下无 checkout 即失败），`seam-matrix` 作业对该 pin 与 `master` 两档跑 `npm run test:matrix`。0.1.6 已不在支持范围（见 §8-1）。
- G3 README 顶部补"测试过的 dsh 版本"徽章与兼容矩阵入口：**已补**（README/README.en 首屏标注支持 dsh ≥ 0.1.7-rc.2 并链到 `docs/COMPAT.md`）。

## 3. 顺序与依赖

    A1 ─┐
    A2 ─┼─→ B1 ─→ B2 ─→ B3/B4 ─→ C1/C2
    A4 ─┘         └─→ D1 ─→ D2 ─→ D3
    E1/E2 ───────────────→ E3 ─→ E4（依赖 C2 的 slot 注册改造）
    F1/F2/F3 与 G 可并行，不阻塞主链

理由：B1（构建产物）是 B2/B3/B4/C2 的前置；A2（checkJs + seam 类型）让 D1 生成的代码当天就有编译期校验；E3 依赖 C2 与 E1 的注册改造，故排在客户端改造之后。

## 4. 回归与验收策略

1. 每阶段闸门：npm test 全绿（28 脚本）+ tsc --noEmit + oxlint（Phase A 起）。
2. 新增专项：B2 首屏体积断言；B3 无 seed 降级用例；D3 描述符与调用双向一致；F1 双进程并发；G2 三版本矩阵。
3. 指标对照：主 bundle 不超过 150KB；CSS 行数下降一半以上；字面色 0；未知 config 键有告警；三版本 CI 全绿。
4. 回退设计：Phase B 以 B1 为最小可回退集；Phase C 必须保留 dshT() 回落；Phase E 探测异常一律按"无官方能力"处理（即照常显示插件面板）。

## 5. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 共享模块 seed 在旧宿主缺失 | 整包加载失败 | try-catch 包装 + 降级用例（B3） |
| 官方组件 API 随 dsh 迭代变更 | 面板渲染异常 | 只用稳定控件子集；G2 矩阵提前暴露 |
| checkJs 首轮噪声淹没真实问题 | 拖慢 A 阶段 | 分批开启、噪声项带原因注释、Phase D 清偿 |
| 源码与入库产物双真相 | 产物漂移 | CI 的 git diff --exit-code 强闸门（B1） |
| Phase E 探测误判隐藏了本该显示的面板 | 功能不可见 | 默认 auto 但提供强制开关与"被官方覆盖"提示；探测异常按无官方处理 |

## 6. 明确不做

- 不引入 @deepseek-ai/dsh-* 运行时依赖，不改用装饰器型 Remote。
- 不重写为 TypeScript（JSDoc + checkJs 足够）。
- 不立刻拆分为多包（先用 E3 面板开关观察真实使用分布）。
- 不再自制设计系统，改为删除自绘、复用官方控件。

## 7. 工作量与里程碑

| 阶段 | 人日 | 里程碑 |
|---|---|---|
| A 护栏 | 1–2 | tsc / oxlint 进 CI，CHANGELOG + COMPAT 建立 |
| B 客户端工程化 | 5–8 | 主 bundle 不超 150KB，产物受 CI 保护，样式 token 化 |
| C i18n | 2–3 | 跟随 shell 语言实时切换 |
| D 契约同源 | 3–4 | 单一 RPC 真相表 + schema 校验 |
| E 官方优先共存 | 4–6 | 面板自动让位 + 面板级开关 |
| F 数据安全与审计 | 3–4 | 跨进程安全 + 落盘版本迁移 + 审计日志 |
| **合计** | **18–27 人日** | 建议 6–8 周、每周 3–4 人日推进 |

## 8. 需要决策的三点

1. **目标宿主范围 —— 已决策：不保 0.1.6。** 支持范围定在 **dsh ≥ 0.1.7-rc.2**（v1.25.0 起生效，记录在 `docs/COMPAT.md` 的"版本策略"）。依据：客户端已经静态引用平台共享模块与 `ctx.locale`，0.1.6 上缺 seed 是整包加载失败而非降级 —— 保留回落分支的代价（约 +0.5 人日）换不回"可用"，只会让版本承诺与代码继续不符。CI 按该范围跑（pin `dsh-v0.1.7-rc.2` + `master` 预警）。
2. **面板配额默认值**：Phase E 默认"自动让位"还是"仅提示、不隐藏"？后者更保守、体验更可预期。
3. **是否启动 F3 审计日志**：这会把插件从"管理面板"推进为"带审计面的管理面板"，涉及产品定位，需你确认边界。

---

## v1.30.0 追加轮状态（对照上游 HEAD 的复核）

| 项 | 状态 | 落点 | 验证 |
|---|---|---|---|
| **N-1/N-2 让位粒度** | ✅ 完成 | `src/client/native-coverage.js` 加 `scope: 'panel' \| 'tabs' \| 'none'`；`automation` 改 `tabs:['cron']`，`subagents`/`webSearch` 改 `none`；`impl.js` 新增 `tabHiddenResolver`，`panels/context.js` 暴露 `tabHidden`，`panels/automation.js` 按它过滤页签 | `self-check` 新增 6 条（官方 schedule 在场时 automation 仍注册、`plugins.item` 命中不让位、per-row scope 不互相干扰）；`verify-i18n` 放行新日志文案 |
| **N-3 `engines.dsh` 上界** | ✅ 完成 | `>=0.1.7-rc.2 <0.3.0-0`；COMPAT 版本策略头与两份 README 同步声明上界 | `verify-peer-compat` 新增第 8 项：下界 + 上界 + **`-0` 围栏**，负向对照 `0.3.0-rc.1`/`0.3.0`/`1.0.0`/`0.1.7-rc.1` 必须被拒。实测裸 `<0.3.0` 在宿主 `includePrerelease` 下放行 `0.3.0-rc.1`，故围栏是必需的而非装饰 |
| **N-11 去掉 1200ms 盲等** | ✅ 完成 | `impl.js` 的 `preferredSettingsSlot()` + 双向 `slots.subscribe`；删 `TAB_SLOT_GRACE_MS`/`fallbackTimers`/`noteSlotMissing` | 全闸门（`self-check` 的 tab/fallback 用例） |
| **N-5 体积进闸门** | ✅ 完成 | `build-client.mjs` 的 `ENTRY_BUDGET_BYTES = 150 KB` 构建期断言；`ARCHITECTURE.md` 修正 `src/client/panels.js` → `src/client/panels/` 并写明断言 | `build-client --check` 输出带预算；实测 134.0 KB |
| **N-19 全文搜索错误码** | ✅ 完成 | `integration-check` 加 2 条探针（`service-boundary.ts` 声明 + `session-query-sqlite` 抛出点） | 148 → 150 |
| **P1-B 用量投影** | ✅ 完成 | `lib/session-admin.js` 新增 `projectionTokensOf()`，投影优先、日志折叠兜底；**全零投影不算测量** | `host-check` 3 条新断言（投影优先 / 全零回退 / 无缓存回退） |
| **P1-C cron 判断修正** | ✅ 完成 | `lib/cron-admin.js` 模块注释与 `docs/COMPAT.md` 矩阵改成「唯一差异是 create 必须绑定会话」 | 150 → 153；探针已用只读方式做负控（变异 `sessionId?` 后正则不再匹配） |
| **闸门自身健壮性** | ✅ 完成 | `host-check.mjs`：`clearJunction()`（junction 是 reparse point，非递归 `rmSync` 摘不掉 → 二次运行必红）、`removeTreeWithLinks()`、账本段改用 `mkdtempSync` 独立 home（不再依赖「删掉上一轮文件」） | 连续两次 `host-check` 均通过 |

### v1.30.1 自查轮（v1.30.0 自己引入的三处 + 两处文档）

| 项 | 状态 | 落点 | 验证 |
|---|---|---|---|
| **覆盖结论冻结在 apply()** | ✅ 完成 | `native-coverage.js` 每行加 `signals`，导出 `COVERAGE_SLOT_KEYS`；`impl.js` 的 `coverage` 改为 `recomputeCoverage()`，订阅 4 个 slot 键，`sameCoverageVerdict()` 避免无谓重规划 | `self-check` 夹具改可变 slot 表 + 可触发 `subscribe`，新增「panel 行晚到声明必须退场」「tabs 行晚到声明必须保面板」两条用例；**负控已做**（把订阅改回 no-op → 用例变红） |
| **导入期防复发闸门** | ✅ 完成 | 有真探测却无 `signals`、或 `signals` 键未被 `detect()` 读到 → 导入即抛错 | 导入期校验（`node -e` 实测 `COVERAGE_SLOT_KEYS` 为 4 个键） |
| **`notes` 未被消费** | ✅ 完成 | `impl.js` 新增 `reportCoverage()`，输出让位面板 / 让出页签 / 相近但不等价三类日志 | `self-check` 三条日志断言（`ctx.logger.info` 改为可捕获） |
| **两处「会话级」残留 + COMPAT 自相矛盾** | ✅ 完成 | `docs/ARCHITECTURE.md:76` 改写并标注「不要这么说」；`COMPAT.md` 的「两个让位」改为与新 `scope` 表一致，风险行标为「v1.30.1 起已收敛」 | `verify-doc-claims` + `verify-line-anchors` |

**v1.30.1 的教训（值得单独记）**：v1.30.0 把让位粒度从 panel 改成 tabs，**只改了一半**——粒度是新的，但结论仍是
`apply()` 时点的快照。对 `panel` 这无伤（多注册一轮、重载自愈），对 `tabs` 就等于「页签永不消失」。
**粒度细化会把「快照」这个既有缺陷的代价从良性放大成可见**，所以改粒度必须同时改求值时机。
这轮加的两道导入期闸门（`signals` 必须存在且被 `detect()` 真的读到）就是为了让同类「只改一半」在下次直接报错。

### v1.32：N-14/N-15 收口（量化后决定不批量 token 化）

| 项 | 状态 | 结论 |
|---|---|---|
| **截图基线** | ✅ 完成 | `scripts/screenshot-panels.mjs`（`npm run screenshots`）：真机 web profile + headless Chromium + 原生 CDP，逐面板 × 亮/暗截图到 `.screenshots/`。**采集器不是闸门**（无入库基准图，像素闸门会 flaky）。实现踩了三个坑并按 `smoke-real-host` 已记录的做法修：`dsh <profile> --port 0 --no-open`、必须用带 launch token 的 URL、设置对话框是「账号菜单 → 设置行」两次点击且要先关首启声明；另 CDP `sessionId` 必须在顶层而非 `params`。 |
| **N-14 裸色值 token 化** | ⛔ **实测后不做** | 普查口径校正：322 处十六进制里 **168 处是 `var(--token, fallback)` 的兜底位**（正确写法），真正无 token 的裸值 **161 处**。三条独立理由否掉批量替换：① 无语义正确的 token（裸值多是实心徽章的固定底+固定白字，上游只有文字色与浅填充，没有「状态容器底色」别名）；② 只换字色会让深色主题崩——`--dsw-alias-label-primary-foreground` 深色是 `rgb(15,17,21)`，WCAG 实测 7/7 对比度下降、5 处跌破 4.5（`#b91c1c` 6.47→2.92、`#991b1b` 8.31→2.27、`#1d4ed8` 6.70→2.82、`#6d28d9` 7.10→2.66），从可读变不可读；③ `#ef4444` 与 `state-error-primary`（浅色 `rgb(236,19,19)`）不等值，替换即改色相。 |
| **N-15 深色主题验收** | ✅ 完成（结论：非缺陷） | 实心徽章的「字/底」对比度两套主题下**相同**（6.47/8.31/5.02/6.70/7.10，全 ≥4.5），因为字与底都不随主题移动——自洽而非 bug。徽章与页面底色的对比度在深色下降到 1.89–3.13，但那是图形边界不是文字可读性，色块仍清晰。`--dsw-alias-*` 已自适应，插件只补 token 表达不了的两处，维持现状。 |

**将来重做的前提**（已写进 `docs/COMPAT.md`）：上游若提供「状态容器」别名（如 `state-error-container`），
才能把徽章底色 + 字色**成对**迁移；只改一半就是本轮算出来的那次对比度崩塌。

**清单已清空**：v1.31 的「仍开放」只剩 N-14/N-15，本轮收口后没有遗留项。

### v1.31 完成与「实测后不做」的决定

| 项 | 状态 | 结论 |
|---|---|---|
| **P1-A 委托 `ctx.pluginManager`** | ✅ 完成 | 新增 `lib/plugin-manager-bridge.js`：`install`/`remove`/`setEnabled` 三个写动词在 `pluginManager` 在场时委托，缺席时走原 pnpm 路径。**极性**是本轮最易错处：我方 RPC 说 `disabled`，宿主说 `enabled`，已用注释+测试双重钉住。`host-check` 新增 10 条断言（含 `failed` 抛出 / `overridden` 不抛 / 无 manager 回落），并做了**极性负控**（写反后测试变红）。 |
| **N-17 CI 审计** | ✅ 完成 | 发现并修掉三处真实不一致：`host-smoke`、`smoke-published`、`seam-early-warning` 仍钉 `0.2.0-rc.1`，而验证基线是 `0.2.1-rc.2`。新增 `verify-doc-claims` 第 14 项，把 **workflow 里的 dsh pin 与 COMPAT 基线绑定**（负控已验证：改回 rc.1 即红）。 |
| **N-17 预警行语义** | ✅ 完成 | `check-matrix` 原本对任何漂移都 hard fail，与 COMPAT 承诺的「master 是预警行」相反——这正是修复轮批评过的「恒红闸门」。新增 `DSH_EARLY_WARNING`（默认 `.dsh-main`）：预警档漂移**报告但不失败**，基线与下限仍决定成败。实测两种行为：`.dsh-main` 漂移 → exit 0；同样漂移放在非预警路径 → exit 1。 |
| **N-16 降级档** | ✅ 完成 | 新增 `scripts/smoke-degraded-host.mjs` + CI 步骤：在 **sdk-minimal**（真正缺 typert/subagents/commands/shell 的 bundle）上挂载本插件。11/11 通过。**关键是正控**：故意插一个坏行，证明宿主**会**报告未激活行，所以「我们的行没有这种报告」才算挂载证据。另外本机 `smoke:real-host` 实测 **32/32 通过**（dsh 0.2.1-rc.2）——这条路径此前被记为「从未跑通」，现已证实可用。 |
| **N-18 逐行读 `plugin-admin.js`** | ✅ 完成 | 1562 行读完：导出面 23 项、三个写动词（`:1376 install` / `:1446 remove` / `:1501 setEnabled`）、模块级预算（`PNPM_TIMEOUT_MS` 等）在 `applyPluginAdmin` 里 retune。这为 P1-A 提供了准确的替换点。 |
| **N-4 面板 chunk 拆分** | ⛔ **实测后不做** | 用 esbuild 实测：单 chunk 现在 **499.6 KB**；拆成 12 个 chunk 后**每个都要内联** `context.js`+`shared.js`，合计 **1201 KB**，重复 **701.5 KB**；即使抽出共享 chunk，12 个合计仍 **367.8 KB**。首次打开成本确实从 499.6 → 75.7 + 单面板（80–165 KB），但**总量上升**，且需要改 loader 契约（chunk 之间不能同步 `require` 兄弟 chunk，见 `system.ts:47/:328-338`）、构建脚本与全部测试夹具。**这是权衡不是纯收益**，应作为独立决策而非顺手做掉。 |
| **N-6 字典分片** | ⛔ **实测后不做（且原建议有误）** | 字典确实是入口包的主因：137 KB 里 **89.1 KB（65%）** 是 `I18N_EN`。但它**必须**在 `apply()` 时注册进 `ctx.locale`（`installLocaleRuntime` 调 `locale.register(ns, {zh, en})`），否则英文环境下**面板标题在启动时就会回退成中文源串**——这正是 v1.29.0 修掉的 B-2 竞态。因此它不能延迟加载；我上一轮「字典随 chunk 分片」的建议**在架构上不成立**。 |

---

## 收口记录（原"仍开放"两项，均已完成）

1. **可迁移的原生控件 → 已做尽。** Picker 的输入框改用官方 `Input`：`Input` 不转发 `ref`，而它需要的是按键时的实时值，于是改从事件自身读取（`e.target.value`，无 target 时回落草案状态），ref 因此不再必要。workflow 面板的 4 个输入框同样迁到官方 `Input`，宽度与间距由 `.wf-input` 一条 CSS 承担。**剩余的 18 个 `select` / 11 个 `textarea` / 1 个 `radio` 保留原生，是因为官方确实没有对应原子** —— 对照 `ui-primitives` 全部 42 个导出，没有 Select / Textarea / Radio。
2. **参数必填化 → 已完成。** `RPC_OPTIONAL_WIRES` 是唯一判定表：87 个 wire = **82 必填 + 5 显式可选**。必填项由网关真正强制（缺参数即 `gateway/input-invalid`）；host-check 扫描浏览器半的每个字面量载荷，缺必填项直接报错（收紧后零告警）；`verify-rpc-schema.mjs` 对着**描述符**断言 `acceptsUndefined` 与可选表一致。两条新增的可选 wire 各有出处：无标题的工作区、移到列表最前。
