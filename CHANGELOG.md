# Changelog

结构参考 Keep a Changelog，版本号遵循 SemVer。v1.20.0 之前的条目见 git tag（本文件自 v1.20.0 起补记）。

> 各节里的数量（探针条数 / 脚本个数 / RPC 方法数 / warning 数）是**该轮的快照**，不会随之后的工作回溯修改；要当前值请跑对应命令（`npm test` 的输出逐条列出）。唯一例外是最新一轮（`[Unreleased]` 与最新版本节）的数字，它们应与 HEAD 一致。

## [Unreleased]

### Fixed

- **微任务自旋的工作流脚本会永久冻结整个 dsh 宿主，且一切预算全部失效**（`lib/workflow-engine.js` + 新增 `lib/workflow-realm-worker.js` / `lib/workflow-realm-shared.js`）：`while (true) { await 0 }` 在首个 `await` 处挂起后靠微任务自续，微任务队列永不清空、定时器（宏任务）永远排不上——主线程上**没有**任何用户态手段能插进微任务清排，于是 `stop()` 的 10s 落定预算、eval 的硬超时（全是定时器）全部饿死，整个 dsh 进程挂死到 SIGKILL；而 `workflow_admin` 的工具描述当时正向模型承诺相反的保护（"a runaway loop cannot freeze the host"），`eval` 这个"先验证再 create"的防线自身也会被同一形状挂死。修复：**脚本执行整体移入 worker 线程**——vm realm 与 realm 侧 facade（含 `parallel`/`pipeline` 的 realm 内实现，thunk 是 realm 闭包跨不了线程，并发上限由宿主注入逐行对齐宿主侧语义）跑在 worker 里，主线程只留 facade 分发（`invokeFacade`，envelope 与同进程旧桥同构，脚本视角是同一条纯文本桥）；微任务自旋只冻住 worker 自己，主线程的预算照常醒来，`stop()` 预算到点与 eval 超时都 `terminate()` 把卡死 isolate 连脚本一起回收——**"abandoned" 语义随之收窄**：不可抢占的运行被确定性回收落定为 stopped，不再有"仍在执行"的僵尸句柄（amend 对已回收运行的旧拒绝随之撤销，双跑防线改由互斥锁 + 派生活动检查承担，见下条）。realm 源码/安全化助手迁入 `workflow-realm-shared.js` 供两线程共享同一份定义。回归 3 项进 `verify-workflow-engine`（微任务自旋的 eval 超时照常落地 / `run()` 自旋被 `terminate()` 回收且 runner 可复用 / 同步死循环用例改判快速拒绝），38 → 40 checks。
- **amend/resume/stop 无每运行互斥，并发操作双开运行**（`lib/workflow-runs.js`）：两个并发 amend（或 amend 与 stop/resume 赛跑）都能通过"handle 还在 / journal 已落定"检查然后各自 `start` 一份新运行——双跑、子代理花费翻倍。修复：同一 runId 的生命周期操作过一把进程内 `withRunLock`（amend 内部走未加锁的 `stopInner` 防自锁），并新增 `hasDerivedActiveRun` 守卫——同一份 journal 已有派生中的 amend/resume 运行时再开一律拒绝（锁管赛跑，守卫管重放）。回归 3 项进 `verify-workflow-runs`（abandoned 运行被回收后 amend 安全继续 / 派生活动期间的二次 amend 与 resume 被拒 / 并发双 amend 恰好一份落地），27 → 29 checks。
- **工作流步骤缓存可服务陈旧结果，且缓存传递性断代**（`lib/workflow-runs.js` + `lib/workflow-tools.js`）：三处收敛——① 命中缓存的步骤现在也作为本 run 自己的 after 步骤进 journal（此前命中不落盘，链式 amend/resume 只从上一代取缓存，隔代重花已付费步骤、`stepCount` 少计）；② amend/resume 换绑到不同 parent 会话时**缓存整体弃用**并落一条 `cache-skipped`（指纹不绑定会话，跨会话命中会把旧会话语境下算出的 shell/agent 结果当命中；`amendedFrom` 血缘仍保留）；③ `args` 不进键的行为保留（这是"改 args 只重跑受影响步骤"的特性），但工具描述改为明示其边界——某步产出可能依赖 args 时必须把差异写进该步 prompt/opts，否则会拿到旧 args 的缓存值；`cwd` 选项的注释同步改为如实陈述（当前 dsh 不消费 `request.cwd`，进键是防宿主将来支持时的陈旧缓存）。
- **`mcpAdmin/test` / `callTool` 探测跑在掩码后的配置上，凭据型 server 必然失败**（`lib/mcp-admin.js`）：`listMcpEntries()` 把 `env`/`headers` 值掩成 `''`（读投影），而 `test`/`callTool` 直接把这份掩码条目喂给 `probeMcpServer`——任何需要 `Authorization`/API key 的 MCP server（最常见形态）在面板上测试必失败、诊断误导。修复：新增 `findStoredMcpEntryConfig()` 返回未掩码的存储配置供探测使用（探测必须等价于真实挂载），掩码仍只是读投影，跨 RPC 的探测结果不含秘密。
- **MCP HTTP 探测的两个 SSE 读循环无字节上限，恶意/异常 server 可把宿主 OOM**（`lib/mcp-probe.js`）：`httpToolCall`/`httpToolList` 的 `text/event-stream` 分支 `acc += …` 无 cap——server 只要不发带匹配 id 的帧，累积串一直涨到 `AbortSignal` 超时，本地快速端点足以吃掉数 GB（同文件其他所有读路径都有 `MCP_PROBE_MAX_RESPONSE_BYTES`，唯独这两处漏了）。修复：两处循环同上限，超限取消 reader 并按各自形状返回错误。
- **内建 CLI 后端把明文 env 值（API key）回传浏览器，破坏「只写不回显」契约**（`lib/subagent-admin.js` + `src/client/panels/subagents.js`）：`cliList` 的内建 codex/claude-code 分支原样返回存储 `config.env`（通用后端同文件处显式 `maskSecretMap` 并注释 write-only）；浏览器侧值输入框恰好漏写 `value` prop（非受控）才没把密钥渲染出来——纯属侥幸，且 `key: index` 下删除中间行时 DOM 残留文本与底层草稿错位、保存写入与屏幕不符的值。修复成对：主机侧 `cliList` 掩码内建 `env`（投影副本，不动共享常量）、`cliUpsert` 内建分支补 `inheritSecretFields(effective, previous, ['env'])`（掩码不配继承 = 首次保存清空全部凭据——`secret-fields.js` 头注释警告的正是这对坑；appendJournal 仍记掩码版，不把继承来的明文抄进第三个文件）；客户端值输入框改受控（宿主只投影空值，草稿即唯一真相）。
- **用量台账：串行队列上的后写入者用入场镜像覆盖刚落盘的新数据**（`lib/usage-ledger.js`）：`persist()` 入场捕获 `mirror`，队列槽内 `unionUsageEntries(磁盘, mirror)` 让 mirror 按 id 优先——两个并发 persist 的入场镜像同源，先写者（如删前快照的最终用量）落盘后，后写者（后台扫描）仍拿入场快照当 merge base，把刚落盘的新行用旧值盖回去，且已删会话再无来源刷新：「删了会话，用量还在」的核心保证被打穿。修复：队列槽内读**当前**内存镜像（`entries ?? mirror`）——串行队列保证槽内 `entries` 就是最近一次已提交的内存状态，入场快照仅剩预检用途。
- **MCP 面板探测序号守卫是全局单计数器，先后探测两台 server 第一台永远卡「检测中…」**（`src/client/panels/mcp.js`）：单个 `testSeq` 被所有条目共享，"点 A 再点 B"会把 A 的（完全现行有效的）响应整体丢弃——busy 复位也被跳过，该行永久转圈。修复：序号按条目分键。
- **工作流详情卡无竞态守卫，快速切换显示错 run、回答路由到错误运行**（`src/client/panels/workflow.js`）：`openRun` 无序号裁决，点 A 再快点 B 时 A 的慢回复覆盖 B 的详情，而作答按 `state.runDetail.id` 提交——提交给显示中的错误运行。修复：`detailSeq` 按最后点击裁决，慢响应整体丢弃（与 sessions 的 `searchSeq`、web-search 的 `configRequest` 同款守卫）。
- **`config.panels.webSearch: 'off'` 是无效旋钮**（`src/client/impl.js` + `src/client/panels/sessions.js` + `src/client/panels/context.js`）：`webSearch` 在 11 个合法面板 id 里（挂载期 fail-loud 校验、文档承诺"off 不注册，优先级最高"），但它与历史会话共用一条 nav 入口、没有独立 slot——`reconcileSlots` 只遍历 10 个 slot spec，页签也无条件渲染，旋钮静默失效。修复：主 bundle 把三态决策解析器（`yielded`，含 localStorage 强制与自动让位）经 `configure()` 注入面板 chunk，Web 与会话页按它摘除/保留 Web 搜索页签。
- **顺手**：`jsonSafeValue` 的 `toISOString` 鸭子命中现在对**返回值**递归安全化——冒充 Date 的普通对象不能借它把 realm 对象/循环引用种进宿主记录（`lib/workflow-realm-shared.js`）。
- **文档对齐**（`docs/ARCHITECTURE.md`）：webhook §3/§5 的限速描述改为与实现一致（按来源地址分桶、无地址调用方才共享刹车、`webhookAllowRemote` 下无全局刹车；401/429 与封锁每来源每窗口至多一条 + 全局 10 条/窗口预算）；MCP 探测、工作流 realm/生命周期/缓存各节同步上文修复。

## [1.27.0] - 2026-09-29

### Added

- **`smoke:real-host` 步骤 8：真实 Chromium 里的会话面板渲染计时（O-1 的判决数据）**。结论：**O-1 不建议做**——重建 400 张会话卡片在真实浏览器里的**净开销低于测量噪声**（100 / 400 / 800 会话分别为 −0.40 / −0.30 / −0.10 ms）。探针自带**对照组**（同样的双 rAF 等待但不调 `onChange`），并在语料未真正渲染时**拒绝报告数字**。三个被推翻的假数据全是"量到了漂亮数字但量错了对象"：①jsdom 的 170 ms/按键 → CPU profile 显示自耗时分散在 jsdom 的 DOM/CSS 路径、无我方热点，同一份 400 卡片在裸 React+jsdom 里只要 2.7 ms；②第一版真实浏览器探针报 `median 0.00 ms` → React 18 批处理 setState，`onChange` 立即返回、渲染尚未发生；③第二版报"稳定 33 ms 且 100→800 会话完全一样" → 33 ms 正好是 60 Hz 两帧的节拍，加上无 onChange 的对照后净开销变成 −0.3 ms。另有一次"DOM 从 9 374 崩到 572"看似面板重挂载，实为探针查询 `perf-0` 只匹配 400 行里的 1 行；现固定用"匹配全部"的查询并逐次打印节点数当哨兵。顺带排除：插件 bundle 内**没有 `fetch(` 也没有 `XMLHttpRequest`**，RPC 走 shell 注入的 `ctx.connection.rpc`；用 CDP 对 fetch/XHR/WebSocket/EventSource/sendBeacon 全部埋点后确认 shell 自身用 fetch，但对它打桩并不能截获面板的 RPC。保留的结构性结论：`SESSION_RENDER_CAP = 400` 是**截断而非虚拟化**（产品取舍，非性能问题）；`sectionState` 的 `patch` 每次渲染都是新函数且作为 prop 传给每张卡片——**将来若要加 `React.memo` 必须先用 `useCallback` 固定它**，否则浅比较永远失败、memo 等于没加。
- **`scripts/verify-line-anchors.mjs` —— 文档行号锚点门禁**（静态闸门，`npm test` 40 → 41 步 / 静态闸门 5 → 6）。行号锚点的失效方式比路径更隐蔽：重构把代码挪走后**文件还在、路径还对**，"路径存在"检查照旧全绿，而行号已指向无关函数甚至越过文件末尾。**上线即抓到两条真实失效**：`CHANGELOG.md` 与 `docs/COMPAT.md` 都引用 ~~`lib/index.js:1756-1795`（用量台账观察器），而 v1.26.2 的拆分把 `index.js` 从 3648 行减到 936 行——该行号早已不存在；已改指真实范围 `610-763`（区块起止经人工核对：`Usage ledger live event observer` 注释头 → `session/flush` 监听）。三类分别处理：**本仓锚点**（`lib|src|scripts|types|docs/`）必须落在文件内；**上游锚点**（`packages/…`，指向未 vendored 的 dsh checkout）只校验形态并在输出里**如实报告"未核对"**而非假装通过——设 `DSH_CHECKOUT` 后按真实 checkout 核对（本机实测：有 checkout 时 3 条上游锚点全部真实通过）；**反例引用**用 `~~` 前缀标记、闸门跳过——没有这个出口，"把闸门当初为什么存在写进文档"本身就会让闸门变红。另有锚点形态断言（只认已知顶层目录，裸文件名与未知目录不算声明）。负样本 4 条：锚点越界、指向不存在的文件、移除反例标记、真锚点越界，各自都会红。
- **`scripts/verify-doc-claims.mjs` —— 把"文档不得与仓库脱节"从自觉变成会红的闸门**（新增静态闸门，`npm test` 39 → 40 步 / 静态闸门 4 → 5）。起因是这轮评审里查出**四类同源事故**：`ARCHITECTURE.md` 写"3 道静态闸门 / 共 38 步"（实际 4 / 39）、`COMPAT.md` 写"34 个脚本"（实际 35）、CHANGELOG 把 `verify-webhook-triggers` 的用例数写成"33 → 35"（实测 32 → 34）、`projectWorkflowsDir` 注释声称两道包含性守卫而实现只有一道。这四处的共同点是：**都是机器能数出来的声明**。"注意保持同步"不是人能可靠执行的规则，承诺小心也一文不值；可数就去数。闸门检查：步数 / 静态闸门数 / `verify-*` 磁盘数量 vs `run-gate.mjs` 表、文档点名的 `scripts/*.mjs` 与最新 CHANGELOG 点名的 `lib|src/*` 是否存在、最新三节 CHANGELOG 的 `N → M checks` 是否自洽且不超出该套件自身声明的用例数、config 键数（受校验 / 直通 / 总数）是否等于 `lib/index.js` 的两张表。范围**刻意收窄**到"文档里有且不靠判断即可从仓库推出"的声明——意图与设计取舍不查，靠猜的闸门比没有更糟。只查最新三节（更早的是冻结快照）。**闸门上线即抓到两条真问题**：它自己没被加进 `run-gate.mjs` 的 `STEPS` 表（磁盘 33 个 `verify-*` vs 闸门只引用 32 个），以及因它入列而使刚修好的步数/闸门数文档再次过期。三条检查均经负样本验证（改错步数、点名不存在的脚本、把 checks 数写成超出套件声明值，各自都会红）。
- **两个基准脚本 + `docs/BENCHMARKS.md`（O-1 / O-2 的决策依据，不进 `npm test`）**：`scripts/bench-journal.mjs` 与 `scripts/bench-client-render.mjs` 测量而非断言，存在目的是让"要不要做 O-1/O-2"由实测决定。实测（Windows / Node 24.12 / jsdom）：**500 步 / 8KB 回复的工作流最终落盘 4.36 MB，但为写出它一共写了 4.36 GB**（`persist()` 每步重写整份 record，写入量平方增长）；`list()` 随运行数线性增长——100 → 52 ms、500 → 260 ms、2000 → **1.04 s**，且是宿主线程上的同步整目录读取。客户端侧：按键代价随渲染出的卡片数**线性增长**（20/50/100/200/400 会话 = 8.1/17.5/26.3/115.9/170.3 ms/jsdom），`SESSION_RENDER_CAP = 400` 是**截断而非虚拟化**。**注意：这些绝对毫秒数不可当作"用户可感延迟"**——CPU profile 显示自耗时高度分散（GC 5.5%、jsdom CSS 解析 8.5% 分散在 4 个条目、`installInterfaces`/`NamedNodeMap` 等 jsdom 内部），没有单一热点，即代价由 jsdom 的 DOM/CSS 开销摊薄而来；同一份 400 卡片在裸 React + jsdom 里只要 2.7 ms（0.67 µs/节点）而真实面板 ~20 µs/节点。**初版"O-1 先做、修法是纯局部 useMemo"的结论因此被撤回**（过滤+分组是纯计算，远不到 1 ms，改动它省不下什么）。修正后的顺序：①先用 `useCallback` 让回调稳定（`sectionState` 的 `patch` 每渲染都是新函数，不固定它 `React.memo` 的浅比较永远失败），②再 memo 卡片，③必要时虚拟化（唯一能改变线性曲线的手段），④**每层都在真实浏览器复测**。结论：**O-2 数据充分可直接动手**（Node 侧测量，与渲染环境无关）；**O-1 经真实浏览器实测后退回——不建议做**（见下条）。踩坑记录：两个基准各自都被"假成功"骗过一次——journal 基准的 mock 缺 `run.dispose()` 使每步抛错、量到的是空 record（943 KB → 修正前 189 KB）；渲染基准用 `dispatchEvent` 打不到 React 的 `onChange`（value tracker 认为值没变），量到的是"什么都没做"（0.5 ms vs 真实 62.9 ms）。两处都加了断言/哨兵防止再次静默退化。

### Fixed

- **工作流 journal 每步重写整份 record，写入量是步骤数的平方**（`lib/workflow-runs.js`）：`steps` 数组占 record 载荷的 **96.7%**（实测 120 步：531 KB 里 513 KB），而旧 `persist()` 每步把它连同整个 record 重新序列化并重写全文件——**200 步 / 8KB 回复的单次运行写出 697 MB**（最终文件才 1.7 MB，写放大 400×）。修复：`steps` 挪到 `<runId>.steps.jsonl` **只追加**，journal 只保留就地改写的字段。**journal 格式本身没变**，所以 `get()` / `amend()` / `resume()` 的读取契约不变——`loadRecord()` 读 journal 后把 JSONL 拼回 `steps`，调用方看不出差别（回归用例逐字段对照）。实测同一形状：journal 1742.9 KB → **37.1 KB**，每步序列化 1.88 ms → **0.08 ms**，**整轮写入量 697 MB → 5.28 MB**，写放大 400× → **3.2×**；按步数缩放（50/200/500 步）确认总写入量**由平方降为线性**。**数据安全**：追加非原子，但尾部半行可容忍——读到解析失败的行即停止，最多丢掉被中断的那一行，而该行对应的步骤在它的 `after` 事件落盘前本就未算完成；相比旧实现"整份重写被中断即丢整个文件"，损坏面更小（回归用例把最后一行截半，断言之前所有完整行都还在）。**升级兼容**：旧版本的 journal 把 steps 内联、且没有 JSONL，`loadRecord()` 与 `list()` 的回落分支都能正确读取，且**不在读路径迁移**（`list()`/`get()` 是读路径，读者不该改存储）。**顺带修掉一个由此暴露的缺陷**：`list()` 的回落分支直接 `summarize(rawJournal)`，而 journal 已不再含 steps，`stepCount` 会恒为 0——是我自己写的"侧车路径与回落路径逐字段等价"用例抓到的（断言 `stepCount: 2` vs `0`）。回归 5 项进 `verify-workflow-runs`（steps 落在 JSONL 且 journal 不含它 / `loadRecord` 拼回后 `get()` 与 amend 正常且 `stepCount` 一致 / 截断行只丢该行 / 旧格式内联 steps 仍可读且不迁移 / 原有 parity 用例），2 条负样本验证（截断时抛错而非停在坏行、`loadRecord` 不拼回 steps，各自都会红）。`scripts/bench-journal.mjs` 各节改为测量新格式（新增写入量实测、per-persist 前后对照、按步数缩放的线性表）。
- **`workflowAdmin/listRuns` 在宿主线程上整读每个 journal，2000 个运行时阻塞 1.2 秒**（`lib/workflow-runs.js`）：`list()` 把每个 `<runId>.json` **整份读进来再 `JSON.parse`**——而 journal 装着每一步的 prompt 与完整 outcome。它是**同步**读，且面板轮询与 `/workflow runs` 都会反复调用。实测（120 个 40 步运行、42 MB journals）：**75.3 ms → 10.9 ms（6.9×）**；外推 2000 个运行 **1245 ms → 180 ms**。修复：`persist()` 在**同一个串行队列槽位**里顺带原子写一份**摘要侧车** `<runId>.summary.json`（只含 `summarize()` 需要的 13 个标量字段，**不含** steps / log / script / result 正文），`list()` 优先读侧车。同槽位写入意味着读者永远看不到"摘要描述的版本与旁边 journal 不一致"的状态。**升级兼容**：旧版本留下的运行没有侧车，`list()` 回落到整读该 journal——只会慢一次，之后仍无侧车（停掉的运行不会再 persist），刻意**不在读路径补写**侧车：`list()` 是读路径（面板与 `/workflow runs` 都调它），读者不该改存储。侧车损坏时同样回落。回归 4 项进 `verify-workflow-runs`（侧车真的写了且不含重字段 / 侧车路径与回落到整读**逐字段等价** / 状态变更后侧车不残留旧状态 / 侧车损坏仍能列出），并经 2 条负样本验证（不写侧车、侧车写死 status 为 running，各自都会红）。`scripts/bench-journal.mjs` 增加两条路径的对照测量。
- **`stop()` 的落定预算定时器不清除（每次 stop/amend 泄漏一个被引用的 Timeout）**（`lib/workflow-runs.js`）：`Promise.race([handle.done, setTimeout(…, stopSettleTimeoutMs)])` 里的定时器在 `handle.done` 抢先时从不 `clearTimeout`——注释说明它刻意不 `unref`（裸进程里 unref 会让预算永不触发），于是竞速赢了之后它仍被事件循环引用满一个预算，裸进程还会被它多撑住。**实测**：12 次瞬时落定的 `stop()` 在修复前留下 **12 个** 活跃 `Timeout`（`process.getActiveResourcesInfo()`），修复后 **0 个**。修复：`.finally()` 中 `clearTimeout`。回归用例进 `verify-workflow-runs`，负样本实测移除修复后 `was 4, now 14`（10 次 stop 泄漏 10 个）。

- **审计日志的压实计数是进程内缓存，外部写入会让它永久漂移**（`lib/audit-log.js`）：`count` 只在首次 append 时从文件重算，之后仅内存自增。任何本进程之外的写入——同一 `$DSH_HOME` 上的第二个 dsh 实例（仓库其余部分用跨进程文件锁明确支持的部署形态），或手工编辑——都会让它漂移：**少计**时 `cap` 形同虚设、文件无界增长；**多计**时触发一次压实，把从未计入的最新条目丢掉。附带的退化分支：`Math.floor(cap / 2)` 在 `cap === 1` 时得 `slice(-0)` = `slice(0)`，即**全部保留**，于是 cap-1 的日志每次 append 都重写整个文件且永不收缩。修复：计数改为**每次从文件读取**（不再持有共享可变状态的缓存），压实保留数改 `Math.max(1, Math.min(Math.floor(cap / 2), cap - 1))`——半数是稳态目标（约每 cap/2 次 append 重写一次，摊还 O(1)），`cap - 1` 是硬上限（压实发生在 append **之前**，必须为即将写入的那条留位）。回归 3 项进 `verify-audit-log`（跨实例写入不越界、cap-1 有界、`size()` 跟随外部截断），11 → 14 checks。
- **工作流 `amend`/`resume` 丢弃模型传入的 `args`/`provider`/`label`**（`lib/workflow-tools.js`）：工具 schema 明确为 amend/resume 声明了 `args`（`workflow-tools.js:65`），实现只透传 `{ parent }`，于是 registry 回落 `opts.args || old.args` —— **用上一次运行的输入**。后果不是省一次调用而是**报出旧文件的结果**：模型以 `args: {file:'b.csv'}` amend 一个 `agent('process ' + args.file)` 的脚本时，prompt 哈希"未变"从而命中缓存，返回值属于旧文件。修复：amend 透传 `args`/`provider`/`label`，resume 透传 `args`/`provider`；缺省时保持 `undefined`，让 registry 的"继承旧记录"语义继续生效。回归 1 项进 `verify-workflow-tools`。
- **`run_saved` 存了 `argsSchema` 却从不校验**（`lib/workflow-tools.js`）：保存的 workflow 记录带 `argsSchema`（`workflow-library.js:127`），启动路径完全忽略它——调用方可以违反该 workflow 保存时的契约启动，唯一症状是脚本深处一个难以对号入座的失败。修复：新增 `describeArgsProblem()`，在启动前校验 `args`，命中即回 `{ok:false,error}`。刻意只实现 JSON Schema 的**小子集**（type / required / properties / enum / items），**未识别的关键字一律忽略而非拒绝**——未来版本存的更丰富 schema 退化为"无意见"，而不是卡死每一次运行。回归 1 项进 `verify-workflow-tools`（合规放行 / 缺必填 / 类型不符 / 无 schema 不受限 / 未知关键字不拦截）。
- **工作流步骤指纹漏 `cwd`，且材料用字符分隔符拼装、哈希截断到 64 位**（`lib/workflow-engine.js`）：`agent()` 的"语义 opts"是硬编码 3 字段数组，`opts.cwd` 既不入键也**从未传给** `SubagentStartRequest`（`runAgent` 只处理 schema/provider/model）。修复：`cwd` 同时进键**并**进请求——只改缓存不改调用的键比两者都不做更糟；指纹材料由 `payload + '\0' + k=v` 拼接改为**规范 JSON 数组**（边界由结构而非字符保证；payload 是脚本提供的裸字符串，理论上可携带真 NUL，而 canonical 化的值经 JSON 引号转义不会），哈希去掉截断改为**全 64 hex**。回归 3 项进 `verify-workflow-engine`（cwd 进键 / 结构定界 / 全宽哈希）。
- **`projectWorkflowsDir` 只实现了两道包含性守卫中的一道**（`lib/workspace-path.js`）：注释声称 `.dsh` 与 `.dsh/workflows` 各查一次，实现只查了 `.dsh`。**这不是漏洞**——调用方 `ensureDir`（`workflow-library.js`）在 `mkdir` 之后已经 realpath 复检并拒绝同一逃逸，端到端测试（`.dsh` junction 用例）一直覆盖着。补上第二道是让**该函数自身的判定为真**，不依赖调用方是否记得复检；注释同步改写为如实描述"已存在的链接在此拒绝、两步之间新出现的链接由调用方的创建后复检兜住"。新增直接单元断言 `projectWorkflowsDir refuses an existing .dsh/workflows link itself`——刻意做成**直接调用该函数**的形式：端到端用例在移除第二道守卫后依然全绿（调用方兜住了），只有直接断言才能把这道守卫钉住。
- **浏览器半：面板卸载后不释放 slot inject 订阅**（`src/client/impl.js`）：`uninstallOne` 只调用 register disposer，`injectDisposers[panel]` 从不清除。**面板可见行为其实是对的**——残留的 inject thunk 仍活着，而它正是 `installOne` 守卫的键，所以 shell 下一次触发 slot 时那个 thunk 又把面板注册回来（"off→on 需要刷新页面"的说法经实测证伪）。真正的缺陷是簿记不一致：被"卸载"的面板仍持有活跃订阅，每次 off/on 循环都让订阅集合增长。修复：`uninstallOne` 一并释放 inject 订阅，注册权归 `installOne` 独占。新增断言进 `self-check`，用**已安装→off**这一唯一能暴露泄漏的顺序（eager 阶段就判 off 的面板根本不会订阅）；负样本实测移除修复后计数 10 vs 10（泄漏）对比修复后 9 vs 10。

### Security

- **webhook 去重 claim 在动作失败后不回滚，瞬时故障会永久丢投递**（`lib/webhook-triggers.js`）：`claimDelivery.claim()` 在动作**执行前**把 `(ruleId, deliveryId)` 写入 `.seen.json`，动作抛错时只记 `ok:false` + 回 503，**claim 不释放**。占位先于动作是崩溃安全的设计（重试型 provider 不得重复执行），但把它同样套用到**上报失败**就反了：目标会话离线这类可重试错误会永久烧掉该 delivery id，provider 用同一 `x-webhook-delivery` 重试时收到 `202 {duplicate:true}`，steer 静默永久丢失——**且跨重启**（claim 落盘）。运维只看到一次 503。修复：`makeDeliveryClaimer` 新增 `release()`（删 key + 经既有 `flushSeen` 落盘，故释放同样跨重启存活）；HTTP 直连路径在 catch 中释放；runtime 路径用 `claimed`/`claimSettled` 两个标志**只释放"已 claim 且动作未完成"**的那一个，claim 之前的守卫（未知规则 / 空 secret / 事件名不匹配）绝不释放别人的 id。崩溃中途仍保留 claim——崩溃根本走不到 release。回归用例两条进 `verify-webhook-triggers`（失败后可重投、且**跨 remount** 仍可重投），32 → 34 checks。
- **`isLoopbackAddress()` 用字符串前缀匹配判定本机来源**（`lib/webhook-triggers.js`）：原实现末尾是裸 `ipv4.startsWith('127.')`，于是**任何以 `127.` 开头的文本**都被判为本机——实测 `'127.evil.com'`、`'127.0.0.1.evil.com'`、`'127.0.0.1:8080'` 全部返回 `true`。原生 http 下 `req.socket.remoteAddress` 由内核填数字字面量，故不可经常规 transport 触发；但该函数**被导出**、是「未认证调用方 → steer 一个在线会话」之间唯一的闸门，且模块自身已设想「传输层报不出地址」的非常规 transport（`verify-webhook-hardening` 就构造了 `socket: { remoteAddress: remote }`）。**闸门只值它的谓词那么多。** 修复：改为**解析**而非前缀匹配（严格 dotted-quad，四位 0–255，`::1` 与 `::ffff:` 映射分别处理），并去掉 `'localhost'` 分支——主机名不是本地性的证明，任何报得出真实对端的 transport 都不会报一个名字。回归用例 10 条断言进 `verify-webhook-hardening`，13 → 14 checks。
- **通用 CLI 子代理后端可持久化任意绝对可执行路径（信任栅门缺失）**（`lib/subagent-admin.js`）：`validateGenericCliBackend` 接受任意绝对路径 `command`，随后由 `createCliCommandProvider` 以 `spawn(<command>, args)` 执行，`cwd` 亦可为任意绝对路径。唯一准入检查是 provider 名唯一性——**缺少与 `workspacePath` 同级的信任栅门**（`assertTrustedWorkspacePath` 早已实现「只允许调用会话自身的树或已注册工作区」）。`spawn` 走 argv 数组、无 shell 插值，故**不存在命令注入**；这是「同源脚本可决定**跑哪个可执行文件**」的 confused deputy（把 `cmd.exe /c …` 存成后端，再当子代理跑起来）——正是仓库自身威胁模型为 `workspacePath` 写下的那条（"a same-origin script asking workflowAdmin to drop an arbitrary JSON file … or unlink one"）。修复：新增 `assertTrustedCliPaths`——裸命令名（PATH 解析）不动，绝对 `command`/`cwd` 必须落在本实例已知工作区内。刻意**不**复用 `assertTrustedWorkspacePath`：那个 helper 规范的是**项目目录**（拒绝文件、要求目录已存在），而 `command` 指的是可执行**文件**、`cwd` 允许尚未创建，所以这里复用同族的 `realpathIfExists` + `isInsidePath` 原语与同一批可信根；路径不存在时回落到最近的**已存在**祖先做 realpath，防符号链接父目录走私。**可判定才拦截**：宿主没有 `workspaceRegistry`（纯 CLI / headless profile）时无可比对的根，闸门**让位**而不是凭空拒绝——否则会打断这些部署手工配置的绝对路径后端（浏览器 RPC 场景下 registry 恒在，闸门在该存在的地方存在）。回归用例进 `verify-subagents-host`（已知工作区内放行 / 区外拒绝且不落盘 / 裸名不拦 / `cwd` 同规格 / 陈旧 registry 条目不致锁死 / 无 registry 时让位），20 → 21 checks。

## [1.26.4] - 2026-09-29

### Fixed

- **`evalSnippet` 的调用方取消在「编译窗口」内会失效**（`lib/workflow-engine.js`）：调用方信号（工具 `exec.signal`，即用户打断会话）的转发发生在 `await compileScript(...)` **之前**，而内部 abort 竞速的 `onSettleAbort` 监听挂在编译**之后**。当 abort 落在这段窗口内——测试里 `setTimeout(abort, 80)` 撞上一次冷启动 esbuild 编译就是这种竞态——内部 controller 早已 abort，监听永远收不到事件，`abortedPromise` 不 reject，`Promise.race` 只剩硬超时兜底：日志表现为断言期望 `/eval aborted/`、实得 `eval timeout after 10000ms`（`npm test` 首次全量运行在 `verify-workflow-engine` 的偶发红）。用户侧影响是打断会话后交互式 eval 干等满硬超时（默认 5s / 后台 30s）才返回，而非立即取消。修复：挂监听前先判 `controller.signal.aborted`，预取消直接拒绝，不再依赖「事件是否已错过」。回归用例（预取消信号必须立即以 `/eval aborted/` 拒绝、不得等待超时）已进 `verify-workflow-engine`，并经负样本验证——**旧实现下该用例 FAIL、新实现下全绿**。实测：预取消 1–76ms 返回，原 80ms 竞态路径 86ms 不受影响。其余计时敏感断言（vm 预算余量、`verify-cron-admin` 真实分钟边界、`verify-file-lock` 等待窗口）未纳入本次修复，登记为 GitHub issue #2 待评估。

## [1.26.3] - 2026-09-29

### Changed

- **验证基线升到 dsh 0.2.0-rc.1，支持下限 0.1.7-rc.2 保留为回归哨兵**：此前全仓 pin 在 0.1.7-rc.2（那是我方声明的**支持下限**，不是最新可用版本），而插件实际早已在 0.2.0-rc.1 上验证通过（`integration-check` 142 条接缝契约零漂移、`smoke:real-host` 28/28）——只是 CI 没跑它。现 CI 的 `test`/`host-smoke` 与之配套的 pinned checkout、`smoke-published` 的全局 dsh 安装、`seam-early-warning` 三处 pin 全部改指 `dsh-v0.2.0-rc.1`；`seam-matrix` 变**三档**（验证基线 0.2.0-rc.1 + 支持下限 0.1.7-rc.2 + master 预警行），下限档在声明承诺移动前不删。`check-matrix.mjs` 用法示例与 `docs/COMPAT.md`（基线段、矩阵表头、版本策略、实测行）、两个 README 的版本行同步更新。语义分工：**基线段证明插件在用户当前版本上可用，下限档证明它在承诺支持的最老版本上仍可用。** 实证：真实 dsh 0.2.0-rc.1 上 `smoke:real-host` 28/28、`test:matrix` 对 0.2.0-rc.1 checkout 142 契约零漂移、`npm test` 39 步全绿。

## [1.26.2] - 2026-09-29

### Changed

- **原子写配方收敛为 `writeTextAtomic` / `writeJsonAtomic`**（`lib/patch-utils.js`）：`tempPathFor + writeFileSync(0o600) + atomicRename` 三行配方此前在 9 处各写一遍、0600 的凭据理由只有 webhook 一处有注释——收敛后理由住进 helper 一处，cron / webhook×3 / usage-ledger / subagent / command-hook / workflow / plugin-admin manifest 全部改挂（行为逐字节等价）；audit-log 的 JSONL 压实与 writePatch 自身路径刻意不动。
- **克隆合一 + 错误格式化单点化**：`createHistoryRing` 采 webhook 版为规范实现（cap/seed/flush 参数化，flush 可选），cron 删除已漂移的本地克隆改导入；`nowISO` 同族合一；40 处 catch 直写 `String(error)` 改挂 patch-utils 的 `messageOf`（message 优先、String 兜底）——非 Error 抛出物不再渲染成 `[object Object]`。
- **verify-i18n 增设裸 CJK 扫描（第 8 节）+ 修「取消」漏网**：原闸门只校验「dshT 调用点 ↔ 词典」互覆盖，从未包装的裸中文字面量两侧都看不见（工作流保存库删除确认条的「取消」是现成反例，英文界面点出中文按钮）。新扫描先剥注释再枚举单引号字面量，含 CJK 必须是 dshT / 词典行 / 图标键 / 豁免表条目；豁免表 45 条逐条枚举并注明理由，刻意不提供整文件豁免（负样本实测整文件豁免会吞掉同文件新增的漏网串）。
- **panels.js 单文件拆为 `src/client/panels/` 十五个模块（纯机械重组，产物语义等价）**：14 个 banner 分区 + 声明级依赖解析落位——`context.js`（React hooks 解构 + configure() 注入面，经 ES 活绑定跨模块可见重赋值）、`shared.js`（ConfirmButton/tabKeyDown/Picker/样式工厂/浅合并）、十一个面板各一文件（plugins / sessions / mcp / usage / subagents / commands-hooks / todo / automation / workspaces / workflow / web-search / skills 中的面板簇）+ barrel `index.js` 保持 13 个命名导出与 configure 再导出。esbuild 内联相对 import，chunk 策略不变（`build-client.mjs` 入口改指 `panels/index.js`；结构断言原样通过）。三处消费方改为递归发现（verify-i18n / host-check 客户端调用面扫描 / integration-check 的 ui-primitives 导入探针——后者的「扫描不得为空」防呆在拆分后立即变红，防呆设计奏效）。验面：`npm test` 38 步全绿、`smoke:real-host` 28/28、verify-i18n 调用点计数与拆分前一致（881，源码零丢失）。
- **`react/hooks` 规则实测不可用于本仓库**（4e 条件项结论）：oxlint 内置该规则但按文件类型门控，只在 `.jsx`/`.tsx` 触发——客户端源码是手写 `createElement` 的纯 `.js`，规则永不生效（故意违规探针实测 0 命中，.jsx 同文件 1 error）。不引入 eslint-plugin-react-hooks（新依赖），hooks 纪律记入 CONTRIBUTING 人工条目。
- **类型网渐进 strict 化轨道落地（波次 5，第一梯次）**：新增 `tsconfig.strict.json`（extends 主配置，先开 `noImplicitAny`），`include` 从并发正确性核心 `lib/patch-utils.js` 与 `lib/usage-ledger.js` 起步——这是一个**只增不减**的清单，每纳入一个文件先清零它的隐式 any。以 `npm run check:types-strict` 挂进 run-gate 常驻静态段（39 步）。首轮清掉 9 处：patch-utils 的 `profileDirOf`/`installedVersion` 缺类型参数注解、顶层逗号切分的元组 push 补显式 cast、`ensureProfileDependency` 内嵌 add 箭头补参注解；usage-ledger 两处 `count` 辅助与 enqueue 回落补 `@param {unknown}`/`() => Promise<any>`。扩展方式记入 CONTRIBUTING（strict 轨道一节）。宿主接缝的 duck-type 声明保持现状（防线在 host-check 接缝探针，类型只是文档）——cron-admin / webhook-triggers 等后续逐个纳入。
- **发布后对 npm 包本体的真实冒烟（波次 6，修复计划收尾）**：`smoke-real-host.mjs` 新增包模式（`SMOKE_PACKAGE_SPEC=dsh-plugin-admin@<版本>` 时从 registry 安装已发布产物而非 link 本地 checkout，默认行为不变）——这是唯一能抓到 files 白名单缺口（v1.26.x 的「docs/ 漏出 tarball」对一切基于路径的检查不可见，因为 checkout 永远有这些文件）的检查形态；包模式下额外断言 6 个关键文件（package.json / cordis.patch.yml / docs×2 / README×2）确实随包落盘。`release.yml` 新增 `smoke-published` 作业（needs: publish，timeout 20 分钟）：装 pinned dsh + pnpm → 轮询 registry 传播（上限 5 分钟，缺失 fail loud）→ 以包模式跑完整冒烟（无浏览器段自动跳过）。冒烟脚本自身零 npm 依赖，该作业无需 `npm ci`。实证：包模式对真实 registry 的 v1.26.1 跑出 34/34（顺带确认 v1.26.1 的 files 修复确实已随包发布）；默认模式 28/28 无回归；`npm test` 39 步全绿。
- **apply() 巨函数按既有 applyXxx 委派模式拆为四个模块**（`lib/index.js` 3648 → 942 行纯装配，四个提交逐个命名空间落地）：fsAdmin → `lib/fs-admin.js`；pluginAdmin 连同包/pnpm 机器（pnpm 运行器与预算/生命周期脚本策略、manifest 协调器、停用行 upsert/remove、registry 更新检查、peer 兼容判定、semver 比较）→ `lib/plugin-admin.js`；mcpAdmin（双行形解析、密钥只写不回显、热应用、探测/试调用）→ `lib/mcp-admin.js`；sessionAdmin 连同 git porcelain/numstat 解析器、JSONL 布局编码器与可选 workspace 注册表辅助 → `lib/session-admin.js`。RPC 面不变（91 方法/14 命名空间仍由 manifest 单一真相表 + host-check 双向闸门钉死）；index.js 对测试的既有导出面经 re-export 原样保留（host-check / verify-todo-panel / repro-delete-session 的动态导入零改动）；预算随消费者走——各 applyXxx 从同一 cfg 校准自己模块的 let。用量台账接线（观察器/清扫）留在 index，经 deps 钩子跨界；顺带清除死状态 `usageSweepAt`（唯一读者已随 usageReport 迁走，只写不读）。每个提交 38 步门禁全绿；波末 `smoke:real-host` 28/28（真实 dsh + 真实 Chromium 渲染面板无未捕获异常）。开发中 checkJs 闸门抓到一处搬移残留（`flushObservedUsage` 对已删变量的赋值，运行时才会爆 ReferenceError）——tsc 在提交前拦下。
- **`npm test` 的 38 步长链收进 `scripts/run-gate.mjs`，新增 `CONTRIBUTING.md` 最小验证集映射**：`package.json` 里那条 38 命令 `&&` 串联改为一个执行器——步骤表（名称 + 一句职责）内聚在脚本里，逐步打印名称与耗时，失败点名步骤并以原退出码收场；与 `ci-failure-annotation.mjs` 兼容（子进程经 `NODE_OPTIONS` 继承 preload，各自仍会自注解）。支持 `--list` 与 `--filter <子串>`（静态三闸门始终前置，合计约 2s；例：`npm test -- --filter cron` = 三闸门 + `verify-cron-admin` + `verify-cron-panel`），步骤严格串行（多个脚本有真实分钟边界等待，交错输出会毁掉可读性）。CI 命令不变（仍是 `npm test`）；`ci.yml` 的门禁步骤名里过时的计数（34 scripts / 124 contracts）改为指向步骤表。`CONTRIBUTING.md`：三条验证路径（单脚本 / `--filter` 定向 / 全量）+「改了什么 → 最小验证集」映射表（verify 脚本与 lib 模块基本一一对应）+ 冒烟与接缝矩阵的适用时机。
- **CI 作业补超时兜底 + 宿主接缝预警从拉式改滚动**（`.github/workflows/`）：`ci.yml` 的三个作业与 `release.yml` 的 publish 补 `timeout-minutes`（test 30 / host-smoke 20 / seam-matrix 20 / release 30）——门禁内部的等待（cron 分钟边界轮询、真实宿主 boot 预算）只约束它们知道的那条路径，一次意外挂死不该烧掉 GitHub 默认的 6 小时 runner。新增 `seam-early-warning.yml`：每日 03:17 UTC 定时（+ `workflow_dispatch` 手动触发）对 pinned release 与 `dsh master` 双 checkout 跑同一套接缝探针（`npm run test:matrix`）——`ci.yml` 的 seam-matrix 只在本仓库有 push/PR 时才跑，预警是拉式的：插件静默期内的宿主漂移此前无人察觉（scheduled 运行失败 GitHub 默认邮件通知仓库所有者；该工作流不装依赖，与 seam-matrix 同为两个浅 checkout + 一次 node 运行）。

## [1.26.1] - 2026-09-29

安全修正一轮 + 对照 dsh 核心（0.1.6 / 0.2.0-rc.1 接缝）的审查收口 + 无障碍与竞态加固。本轮的快照：`npm test` 38 步全绿（`integration-check` 142 条探针）、oxlint 144 warnings / 0 errors、真实宿主冒烟 `smoke:real-host` 28/28（真实 Chromium 渲染本插件面板无未捕获异常）。

### Security

- **技能 `url` 只放行 http(s)**（`lib/skills-admin.js` 的 `projectSummary()`）：宿主投影此前对 `resourceBase.url` 只校验「非空字符串」，而技能卡片把它原样放进 `<a href>`（`src/client/panels.js` SkillsSection）。技能元数据是第三方可控的——本面板自己支持从 npm 安装插件（插件可携带技能），项目 `.agents/skills` 与用户目录也在扫描范围；React 18 对 `javascript:` href 只在开发模式警告、生产不阻断，点击即在 web UI 同源执行脚本，同源等于整个管理 RPC 面（pnpm 安装、会话删除、webhook secret）。修复落在 RPC 信任边界：url 须匹配 `^https?://` 否则投为 null（卡片不渲染该行）。这是全插件唯一的外部可控 HTML sink——其余全部插值走 React 文本通道。

### Fixed

- **CliPanel 保存不再重置其他卡片的草稿**（`src/client/panels.js`）：拆出 `adopt()`（只更新列表数据），保存/卸载/安装/挂载四条路径改用它并只清自己卡片的 busy；`absorb()` 的全量草稿重置留给（重）加载。此前 A 卡保存在途时编辑 B 卡，A 返回即静默重置 B 的草稿并提前解锁其按钮（与同文件 markBusy 注释自述的教训相悖）。
- **MCP headers/env 的无效行不再静默清除已存值**（`src/client/panels.js`）：解析统计缺「=」的行并计入保存提示；全部无效时整块视为未修改——清空整个输入框才是显式「全删」。此前一行手滑丢等号，宿主会按「字段缺省 = 删除」清掉全部已存键值（含密钥）。
- **模块级 `dshT()` 快照改函数化**（`src/client/panels.js`）：`LIVE_HINT` / `CRON_TEMPLATES` / `WEBHOOK_TEMPLATES` / `EXAMPLE_SCRIPT` / `WF_TEMPLATES` 改为渲染/点击时求值。接入宿主 locale 后切语言不刷新页面，这批文案曾固化在 chunk 首载时的语言。
- **长列表渲染上限 + 截断可见**（`src/client/panels.js`）：会话卡片（400）/ 全文命中（200）/ 技能卡片（400）三处加渲染上限并渲染可见提示行；数千会话的部署不再冻结设置页。
- **探测与搜索的请求序号**（`src/client/panels.js`）：`testMcpEntry` / `runFulltext` 加序号守卫，慢的旧响应不再覆盖新结果（沿用 WebSearchSection 的既有模式）。
- **`removeEntry` 在途防重**（`src/client/panels.js`）：确认按钮 3.2s 自解除后的双击不再发出第二个 remove RPC（根因在调用方守卫，ConfirmButton 未动）。
- **工作流轮询移入 effect**（`src/client/panels.js`）：`schedulePoll()` 从渲染体移入 `useEffect([state.runs])` 并在卸载清定时器——渲染体重排曾随每次按键重置 2s 轮询、可无限推迟下一次 listRuns，退避计数也随之真正生效。
- **命令启停的英文文案与 nullish 提示**（`src/client/panels.js`、`src/client/impl.js`、`i18n.js`）：启停提示重组为整句键，英文纠正为 "has been disabled/enabled."（原文渲染成 "Command /x is Disable."）；`messageOf` 对 nullish 返回空串，失败提示不再出现字面 "undefined"；i18n 表补 8 个新词条并删除孤儿键 `" 已"`。
- **profile `package.json` 的 pnpm override 写入补跨进程文件锁**（`lib/patch-utils.js`）：`writePnpmOverride` / `pruneStalePnpmOverride` 的读改写套上 `withFileLock`，与同模块其他 JSON 写入的纪律对齐（无同路径嵌套，无死锁面）。
- **最后 29 处未声明的伪令牌改挂真实语义令牌**（`src/client/panels.js`；产物同步重建）：`--accent` / `--accent-soft` / `--border` / `--code-bg` / `--muted` 全仓共 29 处、**全部集中在这一个文件**，且只属于两个从未做过字面色迁移的面板——工作流面板（`WorkflowSection` 的引导条、页签、模板卡、运行/工作库行）与 Webhook / 定时任务的模板区，另有 `btnStyle` / `inputStyle` / `textareaStyle` / `preStyle` 四个共享样式助手。它们全都只在吃浅色字面回退，深色下是另一套颜色。映射按语义就近：文本三级灰 → `--dsw-alias-label-tertiary`、二级灰 → `--dsw-alias-label-secondary`、引导蓝 → `--dsw-static-blue-500`、柔蓝底 → `--dsw-alias-interactive-bg-hover`、代码底 → `--dsw-alias-bg-base`、描边 → `--dsw-alias-border-l2`（与同面板内已迁移行的选法一致，浅色近似等价、深色不再错色）。
- **`btnStyle()` 的默认描边色被当成填充色**（`src/client/panels.js`）：`border: '1px solid ' + (bg || 'var(--border, #ddd)')` 与 `background: bg || 'transparent'` 是同一次求值，于是那个灰描边令牌**只进了 border**；`bg` 为空时 background 取 `transparent`。令牌换成真名后这处"名实不符"会读成 bug，故把注释与选法对齐（**渲染结果不变**，无需目视）。
- **`--dsh-alias-border-l2` 前缀笔误**（`src/client/styles.js`）：文档说用 `--dsw-`（dsh 主题令牌的 `--dsh-` 是壳层的另一族），全仓只有 `[data-dsh-admin-section] .session-panel` 这一处拼成了 `--dsh-`，于是这张卡片一直吃字面回退。改为 `--dsw-alias-border-l2`，与同族其余规则一致。

### Accessibility

- **ARIA tabs 完整支持**（`src/client/panels.js`）：新增共享 `tabKeyDown()`（←/→ 循环切换、Home/End、选中跟随焦点），三处 section 页签（Web 与会话 / 子智能体管理 / 自动化）补 `id` + `aria-controls` + tabpanel 关联 + roving tabindex（样式表全是后代选择器，tabpanel 包裹层无布局回归面）；Workflow 内部的「运行/工作库」页签此前连 role 都没有，现补 tablist/tab + roving tabindex + 方向键（面板内容非单个可寻址节点，不做 aria-controls 关联，注释已说明）；Picker 下拉补 `role="listbox"` 与 `role="option"` + `aria-selected`（按当前选中态，单/多选语义各自正确）。
- **PluginsSection 变更类动作加 ref 单飞守卫**（`src/client/panels.js`）：新增 `busyRef`（沿用 `checkingRef` 注释自述的 ref 模式），覆盖 install / upgrade / upgradeAll / removePlugin——remove 此前完全没有守卫；每条终止路径都释放标志。
- **导航图标扫描不再把宿主 DOM 文本插值进属性选择器**（`src/client/impl.js`）：改为扫描自有标记节点后比较属性值，消除「依赖固定键守卫才安全」的隐性前置条件。

### Changed

- **文档与元数据**：`docs/ARCHITECTURE.md` 补 `withFileLock` 的既定取舍（同步实现 `Atomics.wait`、争用时最多阻塞宿主事件循环约 3 秒后 fail-open、仅多实例并发写同一 profile 才发生）；「dsh-schedule every 下限 300s」加版本限定（旧 300s / 新 60s，`MIN_EVERY_INTERVAL_SECONDS`）；`lib/index.js` 的 validated-keys 注释 15→16；`package.json` description 计数 ten→eleven 并展开 automation 页签枚举（cron / webhook / workflow）。
- **README 中英收敛为一页式，架构与安全细节迁入 docs/ARCHITECTURE.md（内容搬家，非删除）**：README 只留「是什么 / 面板一览 / 三行安装 / 常见任务 + 文档导航」。源码结构（顺手补上 README 漏掉的 `src/client/panels.js` 与 `native-coverage.js`，职责描述按现状修正）、写回/降级机制、各面板机制细节（workflow facade 与 realm 边界、cron 调度语义、webhook 安全模型、用量台账三层兜底等）、30 个配置键两张表、信任边界与安全、测试与接缝契约全部迁入新文档 `docs/ARCHITECTURE.md`。安全节取中英并集（英文版 Security posture 此前比中文「信任边界」多出的条目——shell 元字符白名单、0600 权限收紧、进程树击杀、webhook 常量时间比较等——合并进同一节）；配置表以中文 16 键版本为准（英文表的"14 tunables"与缺失的 `installScripts` 行是过期内容，随迁退役）。`package.json` 的 description 压成一句话（keywords 不变）；未知配置键告警的指向文案 `— see README 可调配置键` 同步改为 `— see docs/ARCHITECTURE.md 可调配置键`（`lib/index.js` 两处；host-check 只断言键名部分，不受影响）。
- **`docs/` 随包发布**（`package.json` 的 `files`：`["lib", "cordis.patch.yml", "README.md"]` → 追加 `docs` 与 `README.en.md`）：搬家把配置键表与全部机制细节移进了 `docs/ARCHITECTURE.md`，但 `files` 白名单没跟上，于是**搬家后的两处指向在 npm 包里全是悬空的**——`lib/index.js` 的运行期告警让用户去看一个装不到的 `docs/ARCHITECTURE.md`（挂载即打印），两个 README 的相对链接在 npmjs 页面 404。`npm pack --dry-run` 实测：修前 tarball 41 个文件、`docs/` 一个都不含；修后 43 个，`docs/ARCHITECTURE.md` 与 `docs/COMPAT.md` 入包。顺带补上原本漏发的 `README.en.md`（英文文档此前只能从 npm 页面的 README 相互跳转拿到）。
- **文档里三处与代码不符的计数改正**：`docs/ARCHITECTURE.md` 的 RPC 真相表 **89 → 91 方法**（`host-check` 实测；搬来时即错）、`npm test` 的 **35 → 36 个脚本**（原文括号内的枚举 self-check + host-check + 32 个 `verify-*` + integration-check = 35，与"3 道静态闸门 + 35 个脚本"这句的 35 指向的是不同集合，现改为 35 个脚本 / 共 38 步并注明以输出为准）；README 中英的**「十个管理入口」→「十一个管理面板」**（表格列了 11 行，`PANEL_IDS` 也是 11 个；原文"3 + 6 + 1 = 10"的推导把「自动化」页内的第三个页签——工作流——漏在了外面，是该轮搬家新加的、HEAD 原文并没有这句推导）。三处都是"搬家时顺手改了数字反而改错"：HEAD 写的 28 个脚本是当时的真实口径。

## [1.26.0] - 2026-09-29

按契合度审查收口：**接缝动词**（`shell.run` → `execute`）、**沙箱策略**（按调用会话解析）、**realm 边界**（JSON 桥 + 同步前缀预算）、**密钥面**（env/headers 不回传、脱敏按值形态、自有存储 0600）、**进程管理**（不再同步阻塞宿主）、**webhook 限速/审计**、**删除与安装的护栏**，以及一批轻微项。本轮的快照：`integration-check` 142 条探针、`npm test` 38 步（3 道静态闸门 + 36 个脚本，其中 32 个 `verify-*`）、oxlint 144 warnings / 0 errors；真实宿主冒烟 `smoke:real-host` 28/28。

### Fixed

- **工作流 `shell()` 与项目 `.agents` hooks 在全部"受支持"的 dsh 上直接失效**（`lib/workflow-engine.js:runShell`、`lib/project-hooks.js:runEvent`）：两处都调用 `ctx.shell.run(spec)`，而 `ctx.shell`（`ShellExecutor`）自 0.1.7 起只有 `resolve()` + `execute()` —— `abstract run(spec)` 最后存在于 `0.1.5-rc.2`，而 `docs/COMPAT.md` 声明的基线正是 `0.1.7-rc.2`，所以这不是"上游刚改"的新伤，而是**一直坏着**。后果不对称：project-hooks 的守卫 `typeof shell.run !== 'function'` 每命中一次就 `warn` + `return empty`，于是整条项目 hooks 桥在 `projectHooks` **默认启用**的情况下静默空转；workflow 的 `shell()` 则把 `TypeError: shell.run is not a function` 抛进脚本。现在按官方接缝驱动：`handle = await shell.execute(shell.resolve(request))` → `result = await handle.result()`（`ShellRunResult` 的 `exitCode`/`stdout.text`/`stderr.text`/`timedOut`/`aborted` 读法不变），并在入口把 `resolve`/`execute` 缺失报成一句具名错误，而不是脚本里的一句 `is not a function`。
- **为什么四道闸门都没响，以及现在各自怎么变红**：两个行为套件的**替身 shell 自己实现了 `run`**（`scripts/verify-project-hooks.mjs`、`scripts/verify-workflow-engine.mjs`），把 bug 编码成了"期望" —— 替身改成 `execute()` → `handle.result()`，回退到 `shell.run()` 会立刻以 `shell.run is not a function` 失败。`integration-check` 的 "shell seam" 探针只 grep `packages/shell/shell/src/types.ts` 的**字段**（`workdir?/timeoutMs?/stdin?`），从不断言 `index.ts` 的**方法名**，漂移恰好发生在没被断言的那根轴上 —— 新增探针钉住 `abstract resolve(request)`、`abstract execute(spec) → Promise<ShellExecution>`、`run|start` 不复存在、`result(): Promise<ShellRunResult>`，以及 `ShellRunResult` 的 `exitCode: number | null`/`timedOut`/`aborted`/`stdout: CollectedOutput`/`stderr: CollectedOutput`。`scripts/verify-service-injects.mjs` 补上插件侧的那一半：`lib/**`（注释剥离后）出现 `shell.run(`/`shell.start(` 即失败并定位到行，同时断言扫描非空且确实存在 `shell.execute(` 调用点。负样本实测：把 `dsh-v0.1.5-rc.2` 的 `index.ts`/`types.ts` 当 `DSH_CHECKOUT` 时新探针逐条报红，临时插入一个 `shell.run(spec)` 文件时 `verify-service-injects` 报红。
- **两条 shell 路径的命令现在按"调用会话"的沙箱策略围栏**（新增 `lib/shell-policy.js`，`lib/workflow-engine.js:runShell`、`lib/project-hooks.js:runEvent` 共用）：此前 `shell.resolve({ command, workdir, timeoutMs, signal })` **不带 `sandboxPolicy`**，而围栏型执行器在缺省时会 `this.ctx.sandboxPolicy.resolve()`——**不带 session**（`packages/shell/pwsh-sandbox/src/index.ts:93`），也就是把**调用会话**的 `read-only`/`workspace-write` 覆盖丢掉、只剩部署默认：用户把会话切成只读，工作流脚本照样拿到 workspace-write。新的解析器照抄工具层（`packages/shell/tool-bash/src/index.ts:215-221`）的三条：围栏型执行器（`shell.sandboxMode !== undefined`）**必须有** `ctx.sandboxPolicy`，缺了就不是"无沙箱"而是"拒绝执行"（`docs/subsystems/sandbox.md` 的 "silent unconfined passthrough is never legal for a confined policy"）——项目 hooks 记一条告警后跳过本次事件（不让一个部署配置问题打断整个 turn），工作流 `shell()` 抛给脚本；非围栏型执行器不伪造 policy 字段；每次执行按 `{ session }` 现解析。
- **审批（`ctx.approval`）刻意不接在这两条路径上**，README 中英的"受宿主审批与沙箱策略约束"改成事实描述：dsh 只在调用方要**放宽**既定策略时问审批（bash 工具的 `sandbox_permissions` 升级通道），普通受限命令不问；而 `never` 策略——`danger-full-access` 部署下的默认——确定性地答 `rejected`，逐次询审批只会让恰好授权了全权的部署跑不动。本插件没有放宽沙箱的通道，所以也没有审批入口；顺带把 `node:vm` realm 不是安全边界这句写进 README（它本来就写在代码注释里）。这条同时补了 8 条接缝探针（`ShellExecRequest.sandboxPolicy`、`SandboxPolicyRequest` 的 `session?`、`resolve(request = {})` 的 agentless 回退、`session?.header.cwd ?? this.workspaceRoot`、工具层的按会话解析与"围栏型执行器缺 `ctx.sandboxPolicy` 就报错"、`pwsh-sandbox` 的 session-less 回退、`sandboxMode` getter；探针 127 → 142）与两个套件的 6 条行为断言（policy 确实带着 calling session 进 spec、缺服务时项目 hooks 跳过 / 工作流抛错、非围栏执行器不伪造字段）。沙箱这三条契约自 0.1.5-rc.2 起就稳定，所以负样本改用**合成漂移**：把上述 6 处逐一改坏后，6 条探针逐条报红并指名漂移行。
- **`smoke:real-host` 步骤 7 的 CDP 端口发现兼容 Edge**（`scripts/smoke-real-host.mjs:441-472`）：原来只从浏览器 stderr 抓 `DevTools listening on ws://…`，而这台机器上的 Edge 什么都不打印（实测 stderr 为空），只把端口写进 `<user-data-dir>/DevToolsActivePort`——浏览器完全健康，却让冒烟在 23/24 挂住。现在每次轮询回退读该文件首行，且只在**成功取到 page target 之后**才锁定端口，半写的行不会把错误端口钉到截止时间；抓到即回到 24/24。
- **realm 边界：宿主对象不再进 realm**（`lib/workflow-engine.js:REALM_FACADE_SOURCE` + `makeHostBridge`）：此前 realm 内每个值的**宿主原型链**都是通的——`args`、`agent()`/`shell()` 的返回值、`parallel()`/`pipeline()` 的数组、以及 rejection 里的宿主 `Error`，脚本用 `value.constructor.constructor('return process')()` 一步就能拿回宿主 `process`（`args.constructor` 是宿主 `Object`，`.constructor` 就是宿主 `Function`）。现在宿主侧只有**一个**对象进 realm（`host` 桥，只活在 realm 闭包里、脚本拿不到），它只回 **JSON 文本**，realm 内 `JSON.parse` 重建；业务错误也折进文本，桥自身的 rejection 在 realm 内重抛 realm 的 `Error`。负样本：用**同一段探针**跑旧接线（宿主对象直传）会打印 `{"fromArgs":"ESCAPED","fromAgent":"ESCAPED"}`，新接线则既不 `ESCAPED` 也不 `HOST-PROTOTYPE`，且 `args` / 结构化 `agent()` 结果 / `parallel()` 扇出仍是可用数据（`verify-workflow-engine` 的 3 组新断言）。
- **同步前缀有预算：一行 `while(true){}` 不再冻结宿主**（`lib/workflow-engine.js:run()` 的带超时调用 + `DEFAULT_SYNC_TIMEOUT_MS`）：async 函数体在首个 `await` 之前是同步执行的，那种死循环会占住唯一的事件循环——run 级 abort 与 eval 的 `Promise.race` 都靠定时器，永远排不上（`workflow-runs` 的 `stop()` 10s 预算同样落不了地）。现在**声明与调用都在 vm 内带 `timeout` 执行**（实测 V8 终止会抛 `ERR_SCRIPT_EXECUTION_TIMEOUT`，且 isolate 之后仍可用），并转成一句具名错误；`evalSnippet` 用调用方的 `timeoutMs` 作同一预算，后台运行取 30s（`createRunner` 的 `syncTimeoutMs` 可覆盖）。首个 `await` **之后**的挂起不受此保护——那时事件循环是自由的，仍由 abort / 硬超时负责，这点在注释与文档里写清楚。
- **对模型的工具描述与三份文档改成事实**（`lib/workflow-tools.js`、`README.md`、`README.en.md`、`docs/COMPAT.md`、`lib/index.js`）：`workflow_admin` 的描述原本写着 "require/import/fs/network/process globals are unreachable … it is not a hard security boundary"，前半句现在是**靠 JSON 桥兑现的**、不是 realm 全局的副作用，后半句留着但补上了真正的权力边界——脚本与宿主同进程同信任级、真正的能力是 `agent()`/`shell()`（后者跑真实宿主命令），"treat a workflow script exactly as you would treat shell access"。README 中英同步（`受限沙箱执行` 这类措辞一并去掉）。
- **项目作用域的 `workspacePath` 不再能指向任意目录**（新增 `lib/workspace-path.js`；`lib/workflow-library.js`、`lib/workflow-tools.js` 接线）：工作库把项目作用域落在 `<workspacePath>/.dsh/workflows/`，而 `workspacePath` 在两个入口是**不可信输入**——模型调 `workflow_admin` 时传的参数，以及浏览器 RPC 的 `spec.workspacePath`。此前 `join()` + `mkdirSync(recursive)` 直接照做，于是一句提示注入就能在任意目录建树并写入任意内容的 JSON，`delete_saved` 还能在任意路径 `unlink`。现在两层闸门：**形状**（必须是已存在的绝对目录、不能是文件系统根，返回 realpath）在库内每次项目作用域操作上强制；**信任**（只能是**调用会话自己的树**或**本 dsh 实例已知的工作区**，复用 `cwdInKnownWorkspaces`）在两个不可信入口上强制——来源决定信任，所以宿主给的 session cwd 照旧直接通过（CLI / headless 没有 workspace registry 也还能用）。另外 `<workspace>/.dsh` 若本身是指向项目外的符号链接/junction（克隆来的仓库可以带一个），`projectWorkflowsDir()` 在 `mkdir` 之前就拒绝，`ensureDir` 之后再按 realpath 复核一次。`workflow-command` 的斜杠命令传的是会话自己的 cwd，路径不变。
- **`jsonSafeValue` 不再把"共享但无环"当成循环引用**（`lib/workflow-engine.js`）：`seen` 从"访问过集合"改成**祖先栈**（递归返回时 `seen.delete(value)`）。此前 `const x = { a: 1 }; return { p: x, q: x }` 这种完全可 JSON 化的 DAG 结果会被判成 `circular reference` 让运行 errored；真环（`x.self = x`）照旧抛错，两种形状现在各有断言。

### Security（按契合度审查的收口：密钥面 / 进程 / webhook / 删除 / 安装）

- **密钥不再回传浏览器**（新增 `lib/secret-fields.js`；`lib/index.js` 的 MCP 编辑路径、`lib/subagent-admin.js` 的通用 CLI 后端）：`mcpAdmin/list` 此前把 MCP 条目的 `env` / `headers` **值**连同整段 YAML 原文（`raw`）一起发给浏览器——那里正是第三方 API Key 的位置，而同仓库的 webhook secret 与 web-search 的 `kind: 'secret'` 早就只回键名。现在两处都只回**键名 + 空值**（`raw` 直接删掉），写入侧按"空值即沿用已存值、缺键即删除"合并（`inheritSecretMap`），与 webhook 的既有契约一致。顺带修掉一个**数据丢失 bug**：通用 CLI 后端的面板从不发送 `env`，而旧代码 `env: rawConfig.env !== undefined ? … : {}` 于是在每次保存时静默清空已存的环境变量——现在缺字段即整体沿用。
- **审计脱敏改成"键名 + 值形态"双通道，并把台账收紧到 0600**（`lib/audit-log.js`）：旧的 `SENSITIVE_KEY` 匹配 `apikey`/`api_key` 却匹配不到 MCP header 实际使用的 **`x-api-key`**（DeepSeek 自家 web-search provider 就发这个头），于是真密钥明文入库；自由文本字段（`command` / `args` / `promptTemplate`）里的 `Bearer sk-…`、`ghp_…`、JWT、URL userinfo 也一样。现在密钥键正则覆盖连字符变体，且**每个字符串叶子**都过一遍值形态白名单（`redactSecretShapes`，导出供测试），rejection 的 `error` 文本同样过。落盘 `mode: 0o600`（父目录 `0o700`），并对已存在的旧文件做一次性收紧（`mode` 只在创建时生效）。
- **插件自有存储统一 0600**（`lib/patch-utils.js` 新增 `chmodPrivate()`）：profile patch 及其 `.dsh-admin.bak`、hooks.json、cron 存储、工作流 journal 与 saved 库、webhook 历史/去重 sidecar、subagent 自管的 patch 写入与备份、subagent journal——这些文件里都会出现操作者写进去的凭据或自由文本。rename 会把临时文件的 mode 带到目标，所以写临时文件时给 `mode: 0o600` 即可；`copyFileSync` 做的备份会继承源文件权限，故显式收紧。
- **进程管理不再阻塞宿主**（`lib/mcp-probe.js` 的 `killProcessTree`、`lib/subagent-admin.js` 的 npm 安装、新增 `lib/run-command.js`）：①`killProcessTree` 原来用 `spawnSync('taskkill', …, { timeout: 5000 })`，**同步冻结事件循环最长 5 秒**——恰好发生在"进程树卡死所以需要杀它"的场景；现在是异步 spawn（失败仍回落直接 SIGKILL），并且 `pid` 非法时绝不误杀。②`npm install -g` 原来用 `exec` 的内置 timeout，Windows 上只杀掉直接子进程，`npm`/`node` 孙进程继续写全局前缀；现在 `spawn` + 自己的预算 + `killProcessTree`，输出只留有界尾巴。③`runGit` 只读 stdout：git 往 stderr 写满管道缓冲时会阻塞到超时，表现为"文件变更小组件一直没有数据"；新的 `runCommandCaptured()` **两个流都排空**（stdout 有上限，stderr 只留尾巴）。
- **webhook 限速与审计同时收口**（`lib/webhook-triggers.js`）：限速桶此前是 `caller ?? 'unknown'`——传输层报不出对端地址时所有人共用一个桶，于是一个攻击者就能把别人的投递全部打成 429。现在**请求预算按连接**分桶（`WeakMap` 记连接身份），**认证失败预算**另加一个共享的匿名桶（否则"每次猜都用新连接"等于关掉暴力破解刹车）；封锁期内**出示正确 secret 仍然放行并解除封锁**（刹车针对猜测，不针对操作者自己的集成），错误 secret 在封锁期仍答 429（不给出可区分的信息）。两个上报 `Set` 随窗口滚动清空，每个窗口最多写 `WEBHOOK_AUTH_HISTORY_ROWS_PER_WINDOW = 10` 条拒绝历史（每条历史都是一次**整文件重写**），日志行照旧每来源一条。
- **会话日志的递归删除先验身**（`lib/index.js` 的 `assertRemovableSessionDir`）：删除路径是**推导**出来的（持久化 seam 没有 delete/path API），所以删之前必须确认它是**真实目录**且 realpath 仍在 sessions 根内——`lstat` 判符号链接/junction（递归删除会作用到链接目标）、非目录、或解析到根外，一律拒绝并给出原因。宿主侧不加 `ctx.approval`：审批只在打开的 turn 内合法，面板删除发生在 turn 之外，逐次询问只会把删除整体堵死；双层 UI 确认与这条路径校验是这里的门禁。
- **pnpm 安装的生命周期脚本由部署方决定**（`lib/index.js` 新增受校验键 `installScripts`）：`allow`（默认，与 `dsh plugin add` 行为一致，不让既有 profile 悄悄改变）/ `local-only`（只有本机路径与 `file:`/`link:` 规格可跑脚本，registry / git / URL 一律 `--ignore-scripts`）/ `deny`（一律忽略）；写错值挂载期报错。同时 pnpm 子进程剔除 `DSH_*`（宿主内部状态），其余环境**刻意保留**——私有 registry 可能就靠环境里的凭据，一并剔除会把"能装"变成看起来像网络故障的 401。README 的中英配置表同步补上这一行，并顺手修正了原来写错的键数（实际 16 可调 + 14 直通 = 30，文档一直写 25 / 14 / 11）。

### Fixed（轻微项：正确性 / 可读性 / 文案）

- **子智能体的样式表补上归属标记**（`src/client/styles.js:injectSaStyles`）：另外三个注入器都会写 `data-plugin` / `data-plugin-css`，只有它没写。客户端模块系统会**认领**任何未标记的 `<style>` 并归给下一个 materialize 的插件，那个插件卸载时把它删掉——而 `injectSaStyles()` 只在面板 chunk 加载时跑一次（语言切换也不会重跑 `configure()`），于是"子智能体"面板会**永久丢掉样式**，必须刷新页面。现在与其余三处一致。
- **深色模式白底白字**：`--dsw-alias-bg-elevated` **不是 dsh 主题里的令牌**（真实的是 `--dsw-alias-bg-layer-1/2/3`；全仓 grep 无声明），所以 16 处都在吃各自的字面回退——其中 `<select option>` 与 Picker 列表的回退是 `#fff`、提示条是 `rgba(245,245,250,0.5)`，而文字用的是深色下近白的 `--dsw-alias-label-primary`。改为真正的 raised-surface 令牌 `--dsw-alias-bg-layer-2`（浅色下与原来等价；深色下从"白底白字"变成正确的浮层面）。另有一处把令牌拼成了 `--dsh-alias-`，一并修掉。
- **英文界面不再漏中文标点**：批量失败摘要、工具列表、会话统计、目录提示等处把 `'，'`/`'；'`/`'、'`/`'（'`/`'）'` 当作**裸字面量**拼接，于是英文 locale 下会出现「，」「（…）」这类字符（`verify-i18n` 只看字典值里的 CJK，看不见调用点）。24 处改为 `dshT('，')` 之类的字典键，并在英文表里补上 `", "` / `"; "` / `", "` / `" ("` / `")"`。
- **面板 chunk 加载失败现在会说出来，并且能重试**（`src/client/impl.js:lazyPanel`）：失败只写在模块变量 `panelsError` 上，而没有任何 `setState`，所以 chunk 404（升级后命中 immutable 缓存的旧 `client.js`、dev server 重启、CSP 拦截）会让**所有面板永远停在「加载面板…」**，既没有错误也没有重试入口——注释里承诺的 "surface inside the placeholder" 从未成立。现在失败入 state（含"本宿主不提供 chunk"那条），并带一个「重试」按钮。
- **工作流运行列表的轮询会退避**（`src/client/panels.js:schedulePoll`）：成功与失败都按固定 2s 重排，接口不可用时就是每秒半次的永久重试；现在失败按 2s→4s→…→30s 封顶退避，成功即复位。顺带补上 `openRun` 的失败分支：`getRun` 传输失败时详情卡只在 `runDetail` 有值才渲染，此前表现为"点了没反应"+ 一个未处理的 rejection。
- **时区标签**（`src/client/panels.js:tzLabel`）：`-getTimezoneOffset()/60` 本身带符号，却又按符号再拼一次，于是纽约显示 `GMT--5`；半小时时区显示 `GMT+5.5`。现在输出 `GMT+8` / `GMT-5` / `GMT+5:30`。
- **计数进位**（`src/client/panels.js` 的 `formatCount`）：999999 走 `k` 分支四舍五入成 `1000k`；现在 ≥999950 进位到 `M`。
- **webhook 的 JSON ack 声明成 JSON**：`respond()` 一律发 `text/plain`，而四个 202 分支的 body 都是 `JSON.stringify(...)`——按 JSON 解析回执的投递方会失败，与处理函数自身要求请求必须是 `application/json` 的严格姿态也不一致。
- **MCP 探针的上限按字节而不是 UTF-16 code unit**（`lib/mcp-probe.js`）：`stdout.length` 数的是 code unit，含 CJK/emoji 的响应能放到约 1MB 才触发一个自称 "256 KiB" 的上限；现在按 chunk 累计 `Buffer.byteLength`。
- **死代码清理**：`usage-ledger` 里 `let changed = before !== byId.size`（两行之间没有任何可能改变 `byId` 的语句，恒为 false）；`workflow-engine` 的 `stepCache`（`createRunner` 导出、无人读写，上层 runs 有自己的缓存）；`session-export` 里在 `data === null` 分支上读 `data.text` 的不可达表达式（`data && data.text` 在同一分支恒为 null）。`cron-admin` 的 `lastFiredAt` 现在随任务删除一起清（此前反复 create/delete 会无界增长）。
- **`handleCapture` 的降级形状补齐**（`lib/index.js`）：文档承诺"没有 agents 服务时在线关闭优雅降级、绝不崩"，但降级对象没有 `delete`/`size`，而 `closeSession` 会调用它——`sessions` 在而 `agents` 缺失/变形的部署会在无关分支上抛 TypeError。现在两个分支形状一致。
- **peer-compat 只缓存正结果**：解析失败得到的 `null` 也被钉死在整个进程生命周期里，一次瞬时失败（checkout 还没构建、manifest 一时读不到）就会把装后兼容性检查永久变成"未检查"。现在只有真正解析出版本才置 `cacheResolved`。
- **`rpc-manifest` 的注释与实现对齐**：`jsonParam` 的文档块写着"任意参数都可缺省"（src-json 时代的语义），与同文件顶部的严格 arity 契约相反、也与实现相反；改为"`acceptsUndefined` 是唯一的缺省途径"。
- **出口形状**：`lib/index.js` 补上函数插件约定的命名导出 `name`（`apply`/`inject`/`Config` 本来就有；缺 `name` 会让 fiber 与日志前缀失去插件标识）。

> **本批明确不做**（都需要"看一眼"而不是机械改，留作后续）：
> - 那五个**未声明的伪令牌**已于 `[Unreleased]` 处理完（29 处，全在 `src/client/panels.js`；其中 `btnStyle` 的"填充位吃了描边令牌"一并按注释对齐，渲染不变）。当时判断为"各有 7–16 处、需要逐屏目视"，实测范围收窄到两个未迁移面板 + 四个共享样式助手，浅色近似等价。
> - 圆角/发丝线/阴影与 `docs/web-styling.md` 的偏差（26 处 `1px` 边框、8 处 `12px` 圆角、卡片阴影）属于一次视觉规约对齐，不是单点修复。**注：`docs/web-styling.md` 至今不在仓库里**（只有本条与 `IMPROVEMENT-PLAN.md` 引用它），当前测试全绿口径下 `styles.js` 的 `1px` 边框 30 处、`12px` 圆角 8 处，而字面色 `rgba()` 有 137 处 —— 真实待改面是"所有带字面色的边框与圆角"，且零视觉回归基建（无截图测试），改完无法自证。**先补规约文档/令牌对照表，再按它改**，否则这条只是换一批字面值。
> - **客户端 sourcemap 加不了**：宿主的 chunk 路由只服务 `client*.js`（`CLIENT_CHUNK` 文法），`.map` 取不回来；要它先得宿主支持，否则只是多发布一个没人能取的文件。（已核对真实 checkout：`packages/client/modules/src/index.ts` 与 `src/client/system.ts` 的 `CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` —— `.map` 不匹配。）
> - 设置弹窗导航图标的注入仍靠 `MutationObserver` + **按本地化标签文本反查**（`impl.js:setupSettingsNavIcons`）。原写"改成官方 slot 需要重做那段 UI 接线"，**这个说法不准**：宿主侧根本没有这条通道，不是接线方式问题。三个事实——`ui-settings-general` 的 `navIcon(id)` 是**硬编码 6 个官方 id 的 if 链**（其余一律回落齿轮 `IconSettingsOutlineMedium`）、行投影 `SettingsSectionRow` 只有 `id`/`order`/`label`、`ui-slots` 的 `ErasedOptions` **没有 `icon` 成员** —— 合起来说明：插件注册的 section 无论怎么写，导航行都只画齿轮。**这是上游依赖，本仓无解**；除非放弃自定义图标接受统一齿轮（那反而是"减少脆弱耦合"的正解，属产品取舍）。

### Changed（行为变化）

- **同步前缀超预算的脚本现在失败，而不是把宿主卡住**：默认 30s（`eval` 为调用方给的 `timeoutMs`，默认 5s）。真要在脚本里做大计算，就把它放到 `await` 之后（或交给 `agent()`/`shell()`）；错误信息直接这么写。旧行为不是"慢"，是**整个宿主停摆**（所有会话、面板、定时器一起卡死，只能杀进程）。
- **项目作用域的工作库要求项目根已经存在**：库不再为一个不存在的 `workspacePath` 造目录（那正是 S2 的写入原语）。真实调用里项目根就是会话的 cwd 或用户注册的工作区，永远存在；只有"指一个还没建的路径"会失败，错误信息里写明。
- `log()` / `phase()` / `report()` 现在返回一个 promise（此前返回 `undefined`）：它们经同一条 JSON 桥走，语义仍是"记进度、不阻塞"，只是不再同步返回。不 `await` 也不会有副作用。
- `<realm 桥>` 只为 JSON 值：一个脚本在 `parallel()` 的 thunk 里返回带环的对象时，桥会把它折成 `{ ok: false, error: 'Converting circular structure to JSON' }` 让脚本自己 catch，而不是把宿主拖进 `JSON.stringify` 的异常里。

## [1.25.5] - 2026-09-28

按契合度审查的优先级收口：文档与实现同源、G1 接缝收敛、交付历史去写放大、工作流缓存键、用量台账跨进程写。

### Fixed（先证伪再动手的：上一轮审查里有两条"扣分"其实不存在）

- **Phase D2 其实早已落地**，`docs/COMPAT.md` 却仍写着"无 schema / `schemas` 为空 / Phase D 待补"：实际是 87 个 wire 挂 `mode:strict`、`lib/rpc-schema.js` 零依赖手写 7 个 schema、`RPC_OPTIONAL_WIRES` 把 82/5 收紧为 81/6 必填。文档改成事实并补上校验现状（键集、schema 名、必填/可选拆分），基线从手抄的 `HEAD 477b4f4` 改为 CI 真正 pin 的 tag，探针条数改为"以 `integration-check` 实际输出为准"（93/112/124 是历史快照，写死必然与 HEAD 漂移）。

### Changed（行为变化）

- **工作流 step 缓存键纳入语义 opts**（`lib/workflow-engine.js:stepFingerprint`，`workflow-admin` 的 amend/resume 行为随之变化）：旧键只有 `站点:kind:sha256(prompt)`，于是"只把 `opts.provider` 从 A 换成 B、脚本一个字不改"的 amend 会命中缓存，把**上一个模型**的结果当成这次运行的结果报出来——那不是省一次调用，是给了错的值。新键为 `站点:kind:sha256(prompt + 语义 opts)`，其中语义 opts 只取 `agent()` 的 `provider`/`model`/`schema` 与 `shell()` 的 `workdir`/`timeoutMs`（`label` 之类展示字段不进键，改个显示名不该重花一次子代理调用；`args` 也不进键——脚本用它拼出的 prompt 变了哈希自然变）。比较材料走新增的 `canonicalJson()`（键排序，循环引用与 BigInt 有兜底），所以同一份 schema 换种写法仍是同一个键。**升级后第一次 amend 会从旧 journal 全部落空（步骤重跑）**，方向是多花调用而不是复用错值；README 中英 + `workflow_admin` 工具描述同步改成事实。`verify-workflow-engine.mjs` 补 3 组断言（语义 opts 进键、键序无关/展示字段忽略、非对象与 BigInt 不抛）。
- **交付历史与投递去重拆成两个 sidecar**（`lib/webhook-triggers.js`）：合并文件每次投递被**整份**重写两遍（先落去重集、动作后再落历史行），于是 200 条历史 + 512 条去重合成一份、约 1400 条 JSON 的同步 I/O 走两次，而 `webhookHistoryCap` 还会放大去重写的成本。现在 `webhook-history.json` 只装历史环，去重集搬到派生路径 `webhook-history.seen.json`（新导出 `seenPathFor()`；**派生而非新增 config 键**，25 键的配置面与 `host-check` 的键集断言不变，迁移 `webhookHistoryPath` 的部署自动一起搬）。每个"更新版本的文件"降级也各自独立（`readSeenFile` 带自己的 `newer`），老版本留下的合并文件仍可读：挂载时把内联的 `seen` 先写进新文件，在任何一次历史写丢掉那个键之前，升级不会遗忘已认领的投递 id。`verify-webhook-triggers.mjs` 补 3 项（拆分后的双文件内容、老文件迁移、路径派生规则）。
- **用量台账的读-改-写移进跨进程锁**（`lib/usage-ledger.js:persist`）：此前串行队列只管本进程，两个 dsh 实例共用一个 `$DSH_HOME` 时各自从自己的镜像合并、然后整份替换文件，后写的把先写的行静默抹掉。现在是**锁内读-合并-替换**：文件在临界区里重读，与本进程镜像取并集（新增导出 `unionUsageEntries()`，镜像优先——它是"文件 + 本进程读数"派生出来的更新一份）再合并写回，因此另一个实例的行得以保留、本进程还没落盘的行也不会被挤掉。锁是同步的（`Atomics.wait`），所以读/合并/写都在同一个同步回调里，合并基因此是"文件 ∪ 镜像"而不是一次 await 的实时读。"没学到新东西就不写"的短路保留在更外层：预判合并未变化时连 `enqueue` 都不进，2000 行的文件不会被一次无变化的刷新重写。`verify-usage-ledger.mjs` 补第 9 项（两个 ledger 共用一个文件 = 第二个写者不丢第一个的行 + 锁已释放）。

### Added（G1：接缝从"两处内联 try"收敛成一个可测的助手）

- **`lib/patch-utils.js:hotApplyFiberConfig(fiber, config)`**：MCP 条目热应用（`lib/index.js:hotApplyMcpEntry`）与 hooks 桥热重启（`lib/command-hook-admin.js:reloadBridge`）此前各写一份 `fiber.update(cfg, true)` + try/catch，能力探测和"需重启"回落文案都只存在于各自模块里。现在两处共用这一个助手，契约明确：**永不抛**，缺 fiber / 没有 `update` / update 拒绝都变成 `{applied:false, reason}`，面板因此不可能在没有接缝时谎报"无需重启/已生效"。`verify-file-lock.mjs` 补一组断言（noSave 恒为 true、配置确实是新配置、三种降级都带重启提示）。
- **`integration-check` 新增 3 条接缝探针**钉住这个仍属内部 API 的通道：`vendor/cordis/src/fiber.ts` 的 `update(config, noSave = false)` 签名、它的"validate→restart"文档语义、以及 **loader 侧消费 `noSave` 的 `internal/update` 钩子**（少了最后这条，`noSave` 会被忽略，一次热应用就会把插件自己写的 patch 行改写掉）。G1 的上游化（公开的 config-patch 热应用 API）仍未落地，但接缝消失现在会先在 `npm test` 里响，而不是静默退化成"每次都需重启"。

## [1.25.4] - 2026-09-27

冒烟再进两步：**写路径**与**真实浏览器**（14 → 28 项，dsh `0.1.7-rc.2` 上约 11–30 秒）。

### Added

- **写路径（步骤 6）**——此前冒烟只读，写入面（F1 锁、原子写、审计、HMR）只在替身 ctx 与假 `DSH_HOME` 上验证过：
  - `cronAdmin/upsert` + `remove` 真的写进一次性 `$DSH_HOME` 的 `cron-tasks.json`，断言磁盘内容加了又删；
  - `pluginAdmin/setEnabled` 在**真实 profile patch** 里写入 / 移除 `disabled: true` 行（走 `mutateProfilePatch` 的锁 + 原子 rename + hot-apply），并用**产品自己的读路径**（`pluginAdmin/list` 的 `disabled` 字段）做往返断言；
  - 两次写都由 `admin-audit.jsonl` 记录（断言两个 action 都在）；
  - 切换目标是**冒烟自己生成的 no-op 插件**（`smoke-toggle-target`，临时目录 + `dsh plugin add link:`）：切换我们自己的行会卸载正在服务这次调用的那个服务，所以不能拿它当靶子。顺带验证了 dsh 插件清单的一个细节——带 `exports` 映射时必须显式导出 `./package.json`，否则 `require.resolve('<name>/package.json')` 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，该插件的 bundle patch 就被当成"未声明 bundle patch"。
- **真实浏览器（步骤 7）**——headless Chromium（Edge/Chrome/Chromium 任一，`SMOKE_BROWSER` 可覆盖）+ **原生 CDP**（Node 内置 `WebSocket`，零新依赖）打开真实 shell：
  - 断言页面**无未捕获异常**、设置入口渲染并可点击；
  - 点开后断言**我们自己的 `settings.section` 面板文案**（`用量仪表盘` / `自动化`）出现在 DOM 里 —— 这些文案只存在于我们的 i18n 表，出现即证明客户端 bundle 被真实 shell 执行并挂载了插槽；
  - **踩过的坑写进注释**：侧栏的「插件 / 会话」是 **shell 自带** plugin manager 与会话列表的入口，拿它们当断言会在"我们的 bundle 什么都没渲染"时照样通过（第一版正是如此，已改正，并用改名的伪证锁住）；
  - 缺浏览器时这一步 SKIP；CI 的 `host-smoke` 作业设 `SMOKE_REQUIRE_BROWSER=1` 让缺失变成失败（ubuntu runner 自带 Chrome）。

## [1.25.3] - 2026-09-27

补丁版：把"真实宿主冒烟"从 1 条 RPC 扩到全命名空间，**它第一次跑就抓到一个生产 bug**，另一个静态闸门又抓出 4 处同类潜伏点。

### Fixed

- **`projectAdmin/list` 在真实宿主上必然失败**（1.25.0 起）：`lib/project-hooks.js` 直接读了 `ctx.workspaceRegistry`，而 `workspaceRegistry` **不在**插件的 `inject` 声明里（它是有意不硬依赖的可选服务）。Cordis 的 scope guard 会抛 `cannot get property "workspaceRegistry" without inject`，面板拿到的是 `gateway/internal`。改用 `ctx.get('workspaceRegistry')`（与其它模块一致，缺失时走既有的 fail-closed 分支）。**所有替身 ctx 的检查都看不见它** —— 假 ctx 没有 scope guard，`host-check` / `self-check` / 30 个 `verify-*` 全绿；是新的真实宿主冒烟在第一次调用该端点时抓到的（错误信息前后对比即为证据）。
- **同类的 4 处潜伏点**：`lib/subagent-admin.js` 的 `ctx.get('subprocess') ?? ctx.subprocess` 与三处 `ctx.get?.('agents') ?? ctx.agents` —— 这些回退本意是"服务缺失时降级"，但在 Cordis 下**恰好**在服务缺失/不在 scope 时抛 guard 错误（即回退分支自己想覆盖的那种情况）。现在只保留 `ctx.get(...)`；`typeof ctx.get === 'function'` 的能力守卫保留，因为测试桩可能根本没有 `get`。
- **测试夹具保真**：`verify-project-hooks.mjs` 的桩 ctx 原先把 `workspaceRegistry` 当**属性**暴露 —— 正是生产禁止的那条路径，所以它一直替真实宿主"背了锅"。现在通过 `get('workspaceRegistry')` 提供。

### Added

- **接缝扫描闸门 `verify-service-injects.mjs`**（已进 `npm test`）：静态扫描 `lib/*.js`（排除生成的 client bundle），断言每一处直接的 `ctx.<service>` 读取都在 `inject` 声明里。这类错误**任何替身检查都看不见**，只能靠真实宿主或静态规则；冒烟只覆盖它调用的路径，静态规则覆盖写入路径与冷分支。已双向伪证（把 `ctx.workspaceRegistry` 或 `ctx.agents` 放回去 → 立刻失败并点名文件与行号）。
- **真实宿主冒烟扩到全命名空间**：21 次**只读**调用覆盖 **13/14** 个命名空间（`fsAdmin` 是唯一豁免：它只有 `reveal`，会在宿主上打开文件管理器），并新增一条"没有任何端点撞上 Cordis inject guard"的显式断言。冒烟自身从 11 项增到 **14 项**，dsh `0.1.7-rc.2` 上约 6 秒跑完。
- **真实宿主冒烟（L3）：`npm run smoke:real-host`**（`scripts/smoke-real-host.mjs`，零依赖）。此前所有检查都在替身 ctx / jsdom / 只读源码这一层：能证明契约还在，但证明不了"loader 组出了我们的行、服务却没挂上"、"客户端 bundle 没进模块表"、"网关不认我们的描述符"。这个脚本用**一次性 `DSH_HOME`**（dsh 自带 web 模板生成 profile + `dsh plugin … add link:<repo>` 装本插件）把真实宿主机跑起来，断言四件事：
  1. `--dump-config` 里出现 `- id: plugin-admin / name: dsh-plugin-admin`（宿主读到了我们包里的 `dsh.bundle.patch`）；
  2. Host 打印带 token 的 URL（插件存在时能正常 boot）；
  3. shell 的模块表列出 `plugins/??dsh-plugin-admin/client.js`，且取回的是**我们的字节**（`PluginsSection` 等标记）；
  4. `POST /api/pluginAdmin/list` 经真实网关返回 `ok:true` 且列表里是本插件（服务挂上 + typert 描述符注册 + strict codec 校验都成立），另用畸形信封确认网关回 `gateway/bad-request`。

  实测 dsh `0.1.7-rc.2` 上 **11/11 通过、约 5 秒**；跑完 `finally` 杀进程树并删临时目录，**绝不碰真实 `$DSH_HOME`**（已在真机上核对：你的 `~/.dsh/profiles` 与实时实例不受影响）。它**不进 `npm test`**（需要真实 dsh + 起进程），CI 里作为独立 `host-smoke` 作业（装 pin 住的 dsh，`SMOKE_REQUIRE_DSH=1` 让"缺 CLI"变成失败而不是静默跳过）。`docs/COMPAT.md` 新增「真实宿主冒烟（L3）」一节，README 中英同步。

### Changed

- **补齐"钉得比用到的浅"的 5 条接缝探针**（接缝矩阵 112 → **124 条契约**）：这几条原本有探针或替身，但**没钉住插件真正调用的那个成员**：
  - `slots.inject(key, callback)` 的声明生命周期 —— 声明**不在 `packages/client/ui-slots` 包里**，而由 renderer 组合（`packages/client/ui-renderer/src/client/registry.ts`），所以此前只查 ui-slots 等于整条面板注入路径没人看着；现在钉住"已声明即同步运行、折叠后重跑、返回 disposer"三条语义。
  - `slots.register(options: ErasedOptions, component)` 的签名 + 插件实际传的四个选项键（`name` / `id` / `order` / `inject`）。
  - `commands.register(definition)` 的签名 + `CommandInvocation.agent/rawInput/attachments`（命令钩子的 handler 解构这三个字段，`/workflow` 读 `agent`/`rawInput`）。
  - `sessions.get(id)`（宿主侧的会话存活判定）与客户端 `ISessions.refresh()/refreshProjections()`（删除会话后刷新侧栏）。
  - 逐条伪证：7 个漂移用例全部被捕获（含"改掉 `ErasedOptions.order`"与"改掉 `CommandInvocation.agent`"这类成员级改动），随后 checkout 复原并核对干净。

  顺带确认两件此前只是推测的事：`slots.inject` **确实存在**（dsh 自家 40+ 个客户端插件都在用，只是声明在 renderer），客户端 `sessions.refresh()` **也确实在 `ISessions` 契约里**（`packages/api/session-controller/src/client/contract/sessions.ts:109`）—— 两处都不是"调了不存在的 API"。`docs/COMPAT.md` 接缝表补上这几行并把条数对齐 124。

### Changed

- **补上 7 条零覆盖接缝的探针**（接缝矩阵 95 → **112 条契约**）：这 7 条此前**既无上游探针、也无替身用例** —— 上游改名或挪走时不会有任何一条测试变红，表现为静默失效：
  - `session/created` / `disposed` / `event` / `flush` 四个事件，以及观察者真正读的 `Session.id` / `firstLiveSeq` / `header`（用量台账的实时观察与 drain 时机，`lib/index.js:610-763`）；
  - `llm.listProviders()` / `listModels(provider)` 与 `LlmProviderInfo` / `LlmModelInfo` 两个形状（子代理面板的 provider/model 下拉，缺了退化成空列表）；
  - `storageDomain.get(name)` → `table(name).delete(key)`（删除会话时清 projection cache，否则侧栏残留到刷新）；
  - `subagentModelSelection` 服务键（子代理入口校验里的"模型选择是否可用"）。

  六条新探针**逐条做了伪证**（把上游声明改坏 → 对应契约失败，6/6 捕获，随后 checkout 复原并核对干净），并确认在 pin 与上游 `master` 上都通过。`docs/COMPAT.md` 的接缝表补上这四行并把引用的条数对齐到 112（README 中英与 CI 步骤名一并同步）。

  顺带发现：上游目前**只有 `master` 一个分支，且正停在 pin 的那个提交**（`477b4f42`）—— 所以 CI 的「master 预警行」当下没有额外信号，一旦上游推进它会先响。

## [1.25.2] - 2026-09-27

补丁版：修复「最近一次触发被重复执行」——cron 定时器的重排会在提前 1ms 唤醒时选回**刚跑过的那一次**。

### Fixed

- **cron 任务可被同一个触发点执行两次**（1.25.0/1.25.1 均存在）：`nextOccurrence` 只在"到达或已过"某时刻后才是严格向后 —— 传 `at - 1` 它会返回 `at` 本身（实测：`* * * * *` 传 `at - 1` → `at`，传 `at` → `at + 60_000`）。而定时器提前 1ms 唤醒恰恰是 `FIRE_SLACK_MS` 有意容忍的情形，于是触发后的重排用 `Date.now()` 又把 `at` 选回来，得到一个 ~1ms 的定时器 → **同一个触发点执行两次**（例如同一条 steer 消息发两遍）。修法两层：
  1. `arm(task, firedAt)` 在触发后从"**严格晚于**刚跑过的 `at`"重排（`max(now, firedAt + 1)`），从源头消除重复重排；
  2. `fire()` 增加"每个触发点只执行一次"的守卫（按 taskId 记录已服务的 occurrence），任何残留的、指向同一触发点的定时器都不会再执行一次动作 —— 与既有的 orphan-timer 防护同一类问题的上一层。

  这是 1.25.1 在 windows-latest 上 `✗ runNow on an armed task leaves no orphan timer … 3 !== 2` 的真正原因（此前误判为等待预算过紧）。新增**确定性**回归用例：把时钟钉在 `at - 1` 唤醒定时器，断言重排指向下一个边界、且同一触发点的第二个定时器被抑制；两层各自都做了伪证。

## [1.25.1] - 2026-09-27

补丁版：修复 1.25.0 引入的锁缺陷（在 Windows 双实例争用同一存储锁时必现），并补上 CI 失败的可诊断性。

### Fixed

- **`withFileLock` 把 Windows 上的非 `EEXIST` 竞争误判成致命错误**（1.25.0 里就存在的真实缺陷，被新的跨进程用例触发）：`open(lock, 'wx')` 在另一个进程正创建/删除锁文件时，Windows 会报 `EPERM` / `EACCES` / `EBUSY`，而不只是 `EEXIST`；原实现只放行 `EEXIST`，其余直接抛出 —— 表现是 `scripts/verify-cron-admin.mjs exited 1`、异常带 `path: '…cron-tasks.json.dsh-admin.lock'`（windows-latest / Node 22 一腿）。现在四种码都视为"有人持锁"而继续等待（`ENOSPC` / `EISDIR` / `EROFS` 等仍照抛），判定抽成 `isLockContention()` 并有单测覆盖两个方向；顺带把"open 成功但写 pid 失败"留下的半锁自行清理，不再让下一个调用者白等一个 stale 窗口。
- **`verify-cron-admin` 的分钟边界等待预算过紧**（70s → 150s）：该断言在 `check()` 开始真正 `await` 异步体之后才被强制执行，而 70s 只给"下一分钟边界（≤60s）+ 定时器延迟"留 10s 余量，负载高的 2 核 runner 上偏紧。两处等待一并放宽（真正导致那次转红的是上面那条锁缺陷）。

### Changed

- **CI 失败现在会自报是哪个脚本、哪条断言**：发布任务的日志需要 admin 权限才能读（REST 日志接口无权限返回 403），而 `::error::` 行会被 GitHub 变成**注解**、公开仓库可匿名读取。`ci.yml` / `release.yml` 的门禁步骤加上 `NODE_OPTIONS=--import=./scripts/lib/ci-failure-annotation.mjs`：预载保留 stderr 尾部，进程非零退出时把"脚本路径 + 最后几行"重新发成注解。30 多个脚本零改动（19 个各有自己的失败输出形状），本地只是多几行文本 —— **上面那条锁缺陷正是靠它第一次跑就定位到脚本与锁文件路径的**。

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
