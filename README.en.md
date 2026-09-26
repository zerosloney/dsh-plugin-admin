# dsh-plugin-admin

Admin web UI for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — ten management surfaces inside dsh's built-in settings UI: **Extensions**, **Skills**, **MCP Servers**, **Subagents**, **Commands**, **Hooks**, **Automation (Cron Tasks + Webhook Triggers + Workflows)**, **Web & Sessions (Session History + Web Search)**, **Usage Dashboard** and **Todo Dock** — that is three standalone settings pages (Web & Sessions 27 / Usage Dashboard 28 / Automation 29), six tabs inside the shell's own plugin pages (Extensions inside **Plugins**; Skills, MCP Servers, Subagents, Commands and Hooks inside **Built-in Plugins**), and one floating panel above the composer (Todo Dock). Zero dsh imports — everything rides the live Cordis Context; every write is atomic + serialized, and a missing dsh service degrades that one panel instead of failing the mount.

> Panel copy ships in Simplified Chinese and English (the 🌐 button in the Extensions toolbar; it follows the browser language and falls back to the Chinese source text, so it never renders a broken string).

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.24.0 · MIT
**CI:** test matrix Node 22/24 on every push; tagged releases publish to npm with provenance.
**🇨🇳 Full Chinese documentation (this file is the synchronized English mirror):** [README.md](./README.md)

## Feature overview

| Surface | Focus |
|---|---|
| 🔌 Extensions | install / uninstall / update / enable-disable profile plugins (pnpm orchestration + bundles-list sync) |
| 📚 Skills | full skill roster (global layer + every agent preset's standing scope + per-session scope merge), strictly read-only, never loads skill bodies |
| 🔌 MCP Servers | row-level CRUD + real handshake probes + tool try-call console; **edits to a mounted entry hot-apply to the running server (no restart)** |
| 🛰️ Subagents | managed subagent CRUD + live monitor / follow-up + CLI backends |
| 🧵 Workflows | dynamic-workflow console: agent-written TS/JS scripts orchestrate subagents in parallel (amend/resume step cache, ask/answer loop, dual-scope script library) + the model-side `workflow_admin` tool |
| ⌨️ Commands & Hooks | prompt commands (live) + Claude / Codex hooks bridges + read-only project `.agents` view |
| 🤖 Automation | Cron Tasks + Webhook Triggers + Workflows in one page, three tabs: host-level cron steers / creates at fire time; webhook endpoints fire the same actions (delivery history + idempotent dedup); workflow scripts orchestrate subagents |
| 🌐 Web & Sessions | one page, two tabs: **Session History** (collapsible directories + bulk delete + full-text search + health check / export) and **Web Search** (provider switch + config editor for Exa / Perplexity, which ship no official UI); ordered before the Usage Dashboard |
| 📊 Usage Dashboard | browser-side token usage / activity aggregation persisted to a local ledger: live event observer + hourly sweep + pre-delete snapshot (deleting a session keeps its usage) |
| ✅ Todo Dock | live todo panel above the composer + git file-change footer |

Common: every write (plugin enable/disable, MCP, subagents, hooks bridges, web search, webhook runtime, overlays) converges on `lib/patch-utils.js` `writePatch()` — atomic (temp + rename) with the replaced revision kept beside the file as `cordis.patch.yml.dsh-admin.bak` (one rolling revision; copy it back to roll a bad write off); all writes share one serial operation queue so a read-modify-write never interleaves; a missing dsh service degrades that panel with a hint, never the whole plugin.

## Usage

All surfaces live in the dsh settings dialog → the matching nav item (each lazy-mounts). Operations that change profile config (plugin install/uninstall/enable-disable, MCP, web search, webhook runtime, overlay enablement) need a **dsh restart**; the panel says so.

### 🔌 Extensions
1. Open: Settings → Plugins → the **Extensions** tab.
2. Install: type an npm package name (`dsh-xxx`) or a local absolute path in the top box → Enter → restart dsh.
   - **dsh peer compatibility pre-check**: after an install/update the panel compares the new package's `@deepseek-ai/dsh*` peerDependencies against the running dsh version (dsh 0.1.7+ skips incompatible bundles at startup) — a mismatch surfaces a warning plus the `dsh plugin allow-version` escape hatch. When the running version cannot be resolved the check is skipped silently.
3. Update: the card's **⬆ Update**, or **⬆⬆ Update all** in the toolbar (live progress); **⬆ Check for updates** force-rechecks the registry.
4. Enable/disable: the card's **⏸ Disable / ▶ Enable** (only for extensions that ship their own bundle patch) → restart; disabled plugins are skipped by the update checker.
5. Uninstall: the card's **Uninstall** → inline double confirm.
6. Search/filter: the search box fuzzy-matches name/version/path, plus the All / Extensions / Built-in pills.

### 🕘 Session History (Web & Sessions · default tab)
The session-history panel is the first tab of Settings → **Web & Sessions**, sharing one sidebar row with **Web Search** (two tabs inside the page) and behaving identically on every dsh version. The **Workspaces** panel is retired and the plugin registers no entry for it — every dsh version manages workspaces natively (the client-side web-workspace implementation survives only as a test seam); the host-side `workspaceAdmin` namespace is still registered as a historical-compatibility RPC surface, not a panel entry.

1. Open: Settings → Web & Sessions (it lands on Session History; click the Web Search tab to switch).
2. Session history: the search box matches title/summary/working directory/session ID at once; status pills All / Online / Archived / Ended / Pinned; the card's **📌 Pin** (localStorage-persisted); **Delete** with a double confirm (an online session shows **Close & delete** — dispose first, then remove the log, no restart); **⬇ Export** downloads a Markdown transcript; **🩺 Health** folds tool call/failure/retry reports; **Full-text search** queries every session's content (one-click enable when the deployment ships it off → restart dsh).
3. **Collapsible directories**: sessions group by working directory, and each directory header is a clickable row — click it to fold/unfold that directory (caret ▾/▸ plus a **Collapsed** note); the folded set persists in localStorage across reloads. The filter bar's tail carries **▴ Collapse all / ▾ Expand all**.
4. **Bulk delete** (no more one-by-one):
   - the filter bar's **🗑 Delete current (N)** — deletes **all** N sessions the current filter/search shows;
   - each directory header's **🗑 Delete directory** — deletes every session under that directory;
   - both raise a confirm bar first ("Delete the N sessions in the current filter? / in directory X?") and only run on **Confirm**; progress shows "Deleting x / N…". Online sessions are closed first (closeSession) before their log goes, the rest delete directly (deleteSession); one failure never blocks the rest, and the run ends with a failure count.
5. Ordering: Web & Sessions (order 27) before the Usage Dashboard (28) and Automation (29).

### 📚 Skills
1. Open: Settings → Built-in Plugins → the **Skills** tab (right after Extensions).
2. Browse: cards carry `/<name>`, independent 🤖 model-invocable / 👤 human-invocable flags, a source label and scope details. The list scrolls inside the dialog height (30+ skills are no longer clipped) behind a refresh + search toolbar.
3. Scopes: three layers merge — the **global layer**, **every agent preset's standing scope**, and **every known session's (cwd, preset) scope**. A web deployment (`dsh-web-app`) disables the host-plane `skill-filesystem` row and lets presets own local discovery, so an empty global layer there is normal: the user directories (`~/.agents/skills`, `~/.dsh/skills`) are listed through preset scopes. Reading a preset scope goes through `agentPresets.acquireScope` (the dsh 0.1.7 lease-style API, released as soon as the read finishes; older hosts fall back to `standingKeyFor`), which ensures that preset's standing mount (it composes plugins only — no agent, session or turn starts); it is the only host-side route into a preset layer.
4. Filter: text only (name/description/whenToUse/path), client-side, zero extra requests. There is no source/scope dropdown: every card already prints its source label and its "visible in" scopes, so a dropdown would only restate the card.
5. Copy/open: 📋 copies `/name`; when `resourceBase` is a directory, **📂 Open directory** reveals it in the system file manager.

### 🔌 MCP Servers
1. Open: Settings → Built-in Plugins → the **MCP Servers** tab (after Skills).
2. Add: fill in id / serverName / command (+args; a whole-line command like `npx -y fetcher-mcp` is flagged for splitting) → save → restart dsh.
3. Test: **🔌 Test** — a real handshake (initialize → tools/list) showing server identity and tool list; successes cache to localStorage (failures stay session-only).
4. Try-call: **🧪 Try call** — pick a tool, paste JSON args, run a genuine `tools/call` (60s budget, 16KB cap).
5. Edit/remove: inline actions; an id matching an existing entry is refused.
6. Hot apply: **editing a mounted entry** hot-restarts that server through the loader's own `fiber.update` channel on save (matched by serverName, so a rename works too; `noSave` keeps the host from rewriting the patch file) and the panel says "no restart needed"; **adding** or **removing** an entry still needs a restart (new fibers are the loader's startup job). A failed hot apply shows the reason and falls back to the restart hint.

### 🛰️ Subagents
1. Open: Settings → Built-in Plugins → the **Subagents** tab (after MCP Servers).
2. Create: fill in name (`toolName`) / persona (supports `{{model}}`/`{{cwd}}`) / tool allow-deny / model / execution backend / delegation depth / background mode; advanced settings expand.
3. CLI backends: the tab detects the codex / claude-code provider packages → mount → configure → unmount; **generic CLI backends** scan PATH for other agent CLIs (gemini / qwen / opencode, …) for one-click mounting or a hand-written custom command.

### 🧵 Workflows
1. Open: Settings → Automation → the **Workflows** tab (after Webhook Triggers). The page head carries a plain-language explanation and a three-step guide; **"Start from a template"** offers three ready-made cards (topic digest / two-angle parallel analysis / staged polish pipeline) — clicking one fills in the script, name and args, so you only tweak parameters and hit **🚀 Start** (no coding required).
2. New run: a script (TypeScript / JavaScript — **a top-level `return` is the run result**) + optional name + JSON args → 🚀 Start. Parent session: workflow subagents derive from one live session — auto-selected when exactly one is live (no control shown), a dropdown when several (title · working directory), a hint to open a session when none.
3. Script facade: `agent(prompt, opts?)` delegates one subagent (returns `null` on failure without killing the run; `opts` takes `{ provider, model, schema }`, and with `schema` that step returns structured data); `parallel(thunks)` runs behind a semaphore; `pipeline(items, ...stages)` streams items through stages (a throwing stage records `null` for that item); `phase / log / report` record progress; `ask(question)` blocks until answered (inline answer box in the run detail; stopping the run rejects it); `shell(cmd, opts?)` rides the host shell (`opts` takes `workdir` / `timeoutMs`) and returns `{ exitCode, stdout, stderr, timedOut }` — **a non-zero exit code is data, not an exception** (it throws only when the host `ctx.shell` is unavailable or the run is aborted, so catch it in the script if you care). Scripts run inside a **`node:vm` realm**: require / import / fs / network / process are unreachable — orchestration only, heavy work goes through `agent()` / `shell()`; the realm defends against accidental access, it is **not** a hard security boundary (same process, same trust level as the host). **The top-level `return` must be a JSON value** (a circular ref / BigInt marks the run errored instead of producing a corrupt record).
4. Lifecycle: **⏹ Stop** a running card; stopped / errored runs offer **▶ Resume** and **✏️ Rebuild** (rewrite the script and re-run — finished steps hit the fingerprint cache and cost no subagent calls; **the cache key is only `site:kind:sha256(prompt)`, so changing `opts`/`args` without touching the script still hits the cached step**); run details poll live (2s). Stopping a wedged script that ignores cancellation has a 10s settle budget — past it the run reports `abandoned` and journals it, and **Rebuild** is refused while that stands (no double-running); wait for it to truly finish, then **Resume**. Resume/Rebuild default to the run's **original session** (a clear error names the session id when it is offline; pass another live session to override); after a host restart stopped / errored runs stay listed and resumable (the "orphan" flag `orphaned` is **derived at read time** from whether the parent session is live — it is not persisted).
5. Library: **Save** scripts to the library — global `$DSH_HOME/workflows/saved/` or per-project `<workspace>/.dsh/workflows/` (travels with the repo; project overrides global on a name clash); **🚀 Run** launches a saved script in one click.
6. Agent tool: the model-invocable `workflow_admin` (one tool + an action enum) — create / amend / resume / stop / list / get / answer / eval / save / run_saved / list_saved / delete_saved; `eval` is a dry run (awaited inside the same tool call, **no background run**; `agent()` is stubbed and `shell()` errors outright, so it costs no subagent calls) that lets the model validate syntax and control flow first; `wait: true` blocks until the run settles and returns a summary. The name deliberately avoids dsh's builtin `workflow` tool (a same-name registration in the global layer throws).
7. Save-scope auto-detection (mirrors ZCode's SaveWorkflow): when a session saves through the tool without an explicit scope, a calling session with a cwd saves to the **project** `.dsh/workflows/`; when undetectable (no calling session / no cwd) the tool replies `needsScopeChoice` so the model relays the question — project or global — and retries with the user's choice. `delete_saved` mirrors the same detection (project first, then global) and reports which scope it actually deleted.
8. Slash command: `/workflow` registers **automatically on plugin mount** (zero config; a name clash only degrades with a warning) —
   - `/workflow create <task description>`: **create from a description** — the task is steered to the current session's model, which generates the workflow script via `workflow_admin` → `eval` dry-runs it → `create` starts it in the background and reports the run id (`save` for reuse when it earns it, scope auto-detected); parallel orchestration rides the script's own `parallel()`;
   - `/workflow` (or `list`): list the library (the current session's project `.dsh` first, then global) and live runs;
   - `/workflow run <name> [argsJSON]`: start a saved workflow in the current session (background; check `/workflow runs`);
   - `/workflow runs`: list runs (newest first); `/workflow stop <runId>`: stop one.
9. Dependency & persistence: TS scripts need esbuild (declared as a peer dependency, installed with the plugin; plain JS needs nothing). Runs and the library live under `$DSH_HOME/workflows/{runs,saved}/`.

### ⌨️ Commands & Hooks
1. Open: Settings → Built-in Plugins → the **Commands** and **Hooks** tabs (orders 60 / 70, after Subagents, commands first).
2. Commands tab: create/edit (incl. rename) / enable-disable / delete; saving registers live (fs.watch) — use it in a session as `/name <input>`; **⬇ Export / ⬆ Import** migrates JSON in bulk (same-name entries skipped).
3. Hooks tab: edit hooks.json (event / matcher / command / timeout) → saving hot-restarts the bridge; **Disable** moves an entry to hooks.disabled.json; the three-state bridge banner — when not installed, **⚡ Install & mount** → restart; the Codex sibling bridge is a second status strip on the same tab. Project hooks share the stock bridge's default timeout (10 minutes per hook — the dsh hook-protocol default; override per hook with `timeout` in the hooks config): several hung hooks slow the current turn serially, and aborting the turn cancels the chain. The old **Project** tab has been removed.

### 🤖 Automation (Cron Tasks + Webhook Triggers)
1. Open: Settings → Automation — one sidebar entry, three tabs in the page: **Cron Tasks**, **Webhook Triggers**, **Workflows**.
2. **Templates and onboarding**: every tab carries a one-line explanation and a three-step guide; Cron Tasks and Webhook Triggers each ship three template cards that fill the editor in (cron / prompt / action) so you only tweak parameters — Cron: weekday digest (`0 9 * * 1-5`) / weekly report (`0 17 * * 5`) / hourly patrol (`0 * * * *`); Webhook: auto-handle CI failures / triage GitHub issues / turn alerts into a new session.
3. New task: id (lowercase first letter) + a **structured frequency editor** (hourly / daily / weekly / custom — pick the minute for hourly, a time plus weekday for daily and weekly, or type the five-field expression directly in custom mode) + action — the same vocabulary as Webhook Triggers: steer (pick a target live session, steer or queue) or create (workspacePath + agentPreset + permissionPreset). Below the editor the panel live-echoes the composed expression (local timezone, e.g. `0 * * * *`) and the "fires missed while the process was down are not backfilled" hint; the five-field grammar supports `*` / comma lists / hyphen ranges / slash steps, and the weekday field accepts `0-7` and `SUN-SAT` (a task file edited outside the panel goes through the same parser).
4. Semantics: **host-level** — it fires while the dsh process is alive, independent of any session (unlike `dsh-schedule`'s session-local every semantics and 300s floor). Each row shows a live countdown plus the local time of the next fire; a steer target that is not live is flagged "⚠ target offline".
5. Manual: **▶ Run now** takes the exact same path as a timed fire (inject a message / create a session + record history).
6. Persistence & scheduling: tasks live in `~/.dsh/cron-tasks.json` (atomic writes + an fs.watch mirror, so an edit made outside the panel enters the mirror within the 300ms debounce window); one timer per task, and before firing the scheduler re-reads the **in-memory mirror** (panel writes refresh it immediately, an external file edit waits for one debounce) and re-checks that the scheduled moment really arrived (timers are clamped, so a sparse schedule can wake early — then it only re-arms without executing); all timers are cleared on plugin unload / dsh exit. **Missed fires while the process was down are not backfilled** — the next future occurrence is recomputed on restart.
7. Note: cron's create mode shares the `@deepseek-ai/dsh-webhook` runtime with Webhook Triggers — install and mount it on the Webhook tab first → restart.
8. Webhook rules: id (lowercase first letter) + secret (a new rule generates a 16-char random secret; **🎲 Reroll** regenerates it; leave it empty while editing to keep the stored value) + optional event name + action — steer: pick a target live session (steer/queue); create: workspacePath (absolute) + agentPreset + permissionPreset + optional model.
9. Trigger: `POST /webhook-triggers/<ruleId>` with the `x-webhook-secret` header (required), optional `x-webhook-event` / `x-webhook-delivery` (idempotent dedup); create mode needs the one-click `@deepseek-ai/dsh-webhook` runtime mount → restart.
10. Test: **🧪 Trigger test** injects a test message and records delivery history; the bottom of the panel shows that history (including failure reasons).
11. Persistence: delivery history (200 entries by default) and the `x-webhook-delivery` dedup set are written to `$DSH_HOME/webhook-history.json` (atomic write) — **history survives a dsh restart and a replayed delivery id is still deduped**; the size is tunable with the `webhookHistoryCap` config key.
12. Note: the endpoint shares the Web UI port and bypasses browser auth — the secret is the only gate; with the default 127.0.0.1 binding, external SaaS needs a tunnel.

### 🔍 Web Search (Web & Sessions · second tab)
1. Open: Settings → Web & Sessions → the **Web Search** tab.
2. Switch: radio-select a provider (deepseek-official / exa / perplexity) → restart dsh.
3. Install/uninstall: only exa / perplexity are removable (deepseek-official is dsh's bundled default); removing the active provider falls back to the default.
4. Configure: the ⚙ editor saves the provider's own field table (apiKey / baseURL / model / maxTokens, …); secrets are write-only, never echoed back.

### 📊 Usage Dashboard
1. Open: Settings → Usage Dashboard.
2. Date-range pills (Today / 24H / 7D / 30D / 90D / All) + the project filter dropdown.
3. Read: KPI cards (tokens / sessions / messages / active days + vs-previous deltas), a stacked daily token trend, a weekday×hour activity heatmap, and local insights (cache hit rate, output-ratio anomalies, …).
4. Persistence: dsh's own token accounting lives in the session log, so deleting a session used to delete its usage with it. Three layers keep it instead:
   - **Live event observer** — subscribes to the `session/event` firehose (fired on every append), accumulates absolute totals for sessions this process watched from seq 0, debounces 2s to disk, and flushes immediately on `session/disposed` / `session/flush`. A session created, used and deleted inside one sweep interval is still recorded.
   - **Background sweep** — folds the whole session table every 60 minutes (`config.usageSnapshotIntervalMs`, milliseconds; `0` disables it — the toolbar's **⏱ Auto snapshot** shows the state and the last sweep time), covering sessions that already existed before this process started.
   - **Pre-delete snapshot** — this plugin's own `deleteSession` / `closeSession` write the session's usage into the ledger BEFORE the log is removed.
   The ledger is `$DSH_HOME/usage-ledger.json` (one row per session, atomic write + serial queue; 2000 rows by default, tunable with the `usageLedgerCap` config key (100–100000), evicting the oldest `lastSeenAt` first); deleted sessions stay in the data as `deleted: true` (no separate badge — they simply join the KPI and session counts). An idle sweep re-reads nothing (revision-cached) and writes nothing (`changed: false`), and a read never overwrites numbers the live observer owns.
   > Why not `fs.watch` on `$DSH_HOME/sessions`: a file watcher only tells you *something changed* — a compressed log still has to be re-parsed whole, and the deletion event races the debounce window. `session/event` is the synchronous firehose at append time: more exact, and cheaper.

### ✅ Todo Dock
1. Location: a floating panel directly above the chat composer, projecting the session live.
2. Use: check items off (strikethrough + progress bar), per-item live timers, collapse the done section into one row; the bell (top-right) fires a desktop notification when backgrounded work completes.
3. Git file-change footer: branch badge + per-file ±lines; **⧉ Copy diff**; click a file row to reveal it in the system file manager.

## Install

```sh
# add the plugin to a profile (web shown)
pnpm dsh plugin --profile web add dsh-plugin-admin

# or install from a local path (development)
# pnpm dsh plugin --profile web add ~/dsh-plugin-admin

# restart dsh to load it
pnpm dsh --profile web
```

## Tests

```sh
npm test   # 28 scripts: self-check / host-check / verify-* / integration-check
```

- `integration-check.mjs` probes the real dsh checkout source for contract drift (78 assertions across every admin RPC namespace and the workflow engine seams).
- `verify-i18n.mjs` asserts that the English copy table and every `dshT()` call site cover each other (so a new string cannot ship untranslated) and that no English value keeps Chinese text.
- `self-check.mjs` ends with an **en-mode smoke**: it materializes a second client under the English locale and asserts the nav/toolbar chrome translations plus the language switch.
- `verify-cron-panel.mjs` really mounts the Automation page in jsdom and drives its Cron Tasks tab (list / toggle / manual editor: typed id + hourly frequency → `0 * * * *` → save); the template-card path is covered by self-check case 15y1, so the two are complementary.
- Diagnostics (not in npm test): `node scripts/repro-delete-session.mjs` reproduces every session-delete failure mode (uncaptured live handle / layout drift / concurrent resume) to match panel errors.

## Adjustable config keys (plugin config row)

`resolvePluginConfig` recognizes **14 validated keys** (first table) and **11 pass-through keys** (second table). A mistyped validated key **throws at mount** (fail-loud — it never silently degrades); the pass-through keys are **not validated at all** and are not described by the exported `Config` schema, so a wrong type is silently ignored and the default applies (e.g. `commandsDir: 5` neither errors nor works) — a known asymmetry.

**Validated (14)** — resolved by `resolvePluginConfig` (`lib/index.js`); the `Config` schema runs through the same function:

| Group | Key | Default | Meaning |
|---|---|---|---|
| Plugin & updates | `pnpmTimeoutMs` | 300000 | pnpm operation budget (ms; the process tree is killed on expiry) |
| Plugin & updates | `updateCheckTimeoutMs` | 8000 | Single registry check budget (ms) |
| Plugin & updates | `updateCheckConcurrency` | 4 | Concurrent update checks (positive integer) |
| Plugin & updates | `updateCheckCacheTtlMs` | 300000 | Update-check result cache TTL (ms) |
| Git & todo | `gitTimeoutMs` | 5000 | One git command budget (ms) |
| Git & todo | `gitStatsCacheTtlMs` | 3000 | File-change stats cache TTL (ms) |
| Git & todo | `gitDiffMaxChars` | 524288 | Max diff characters; past it the diff ships truncated + a marker |
| Sessions | `sessionSummaryCacheTtlMs` | 60000 | Session-summary cache TTL (ms) |
| Sessions | `sessionListConcurrency` | 4 | Concurrent session-table reads (positive integer) |
| Sessions | `sessionEventScanCap` | 20000 | Event cap for the summary replay (positive integer) |
| Sessions | `sessionSearchLimit` | 30 | Full-text search hit limit (positive integer) |
| Sessions | `sessionExportEventCap` | 200000 | Event cap for whole-log reads (export / health check); past it truncation is flagged |
| Usage ledger | `usageSnapshotIntervalMs` | 3600000 | Background snapshot interval (ms); `0` disables the sweep |
| Usage ledger | `usageLedgerCap` | 2000 | Ledger rows kept (100–100000; above 100000 the mount throws), evicting the oldest `lastSeenAt` first |

**Pass-through (11)** — spread through the same config row untouched and read by each sub-module; absent means the default below:

| Key | Default | Meaning |
|---|---|---|
| `commandsDir` | `$DSH_HOME/commands` | Commands directory (created when missing) |
| `hooksPath` | `$DSH_HOME/hooks.json` | Hooks store |
| `disabledPath` | `$DSH_HOME/hooks.disabled.json` | Disabled-hooks sidecar |
| `codexHooksPath` | `$DSH_HOME/hooks.codex.json` | Codex sibling bridge (hand-edited file) |
| `cronTasksPath` | `$DSH_HOME/cron-tasks.json` | Cron task store |
| `webhookTriggersPath` | `$DSH_HOME/webhook-triggers.json` | Webhook rule store |
| `webhookHistoryPath` | `$DSH_HOME/webhook-history.json` | Delivery history (shares the file with the dedup set) |
| `webhookHistoryCap` | 200 | Delivery-history entries (1–10000; out of range falls back to the default) |
| `projectCommands` | enabled | `false` disables per-project `.agents` command registration |
| `projectHooks` | enabled | `false` disables project hook interception |
| `projectHooksTrust` | `confirm` | Only `allow-all` auto-allows; anything else means `confirm` |

> The path keys (`commandsDir` / `hooksPath` / … / `cronTasksPath`) are override points for tests and unusual deployments; only `usageLedgerCap` is additionally clamped by `lib/usage-ledger.js`'s own budget.

## Security posture

- Shell-metacharacter **whitelist** on every pnpm operand — no `& | > < %` injection surface.
- Atomic writes (temp + rename) for `package.json` / `cordis.patch.yml` / all JSON state, with a rolling `.bak` of the replaced patch revision.
- Timeout process-tree kill (`taskkill /T /F`) on package and MCP-probe operations.
- Webhook inbound: timing-safe secret compare (SHA-256 both sides), empty secret rejects all, secret verified **before** the body is read, bounded 1MiB payloads, uniform 401 (no rule enumeration).
- Provider secrets are write-only — never echoed back to the browser.
- Dangerous deletes require double confirmation; same-name session deletion is refused by design.
- Workflow script bodies come from the model or the panel and can run host commands through `shell()` (via the host's `ctx.shell`, subject to its approval and sandbox policy) — operators should be aware of this surface.

## License

MIT
