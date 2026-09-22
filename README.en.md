# dsh-plugin-admin

Admin web UI for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — ten standalone panels (**Extensions**, **Skills**, **MCP Servers**, **Subagents**, **Commands & Hooks**, **Cron Tasks**, **Webhook Triggers**, **Web Search**, **Usage Dashboard**, **Todo Dock**) inside dsh's built-in settings UI, plus the **session-history** panel injected into dsh's own **已归档会话 (Archived Sessions)** page (collapsible directories + bulk delete) instead of occupying another sidebar row. Zero dsh imports — everything rides the live Cordis Context; all writes are atomic + serialized, and missing services degrade per-panel instead of failing the plugin mount.

> 🇨🇳 完整中文文档（本文件为同步摘要）: [README.md](./README.md)

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.19.0 · MIT
**CI:** test matrix Node 22/24 on every push; tagged releases publish to npm with provenance.

## Feature overview

| Panel | Focus |
|---|---|
| 🔌 Extensions | install / uninstall / update / disable-enable profile plugins (pnpm orchestration + bundles sync), Loader runtime snapshot |
| 🗂️ Archived Sessions | **dsh's own page**; the plugin injects its session-history panel into it (collapsible directories + bulk delete, below) |
| 📚 Skills | full skill roster (global layer + every agent preset's standing scope + per-session scope merge), strictly read-only |
| 🔌 MCP Servers | row-level CRUD + real handshake probes + try-call console |
| 🛰️ Subagents | managed subagent rows CRUD + running monitor / follow-up + CLI backends |
| ⌨️ Commands & Hooks | file-backed prompt commands (live) + Claude / Codex hooks bridges + read-only `.agents/` inspector |
| ⏰ Cron Tasks | host-level cron (`*/5 * * * *` five-field expressions) → steer a live session / create a session at fire time; local timezone, runs while the dsh process is alive |
| 🪝 Webhook Triggers | inbound endpoint → steer a live session / create a session; signature check + idempotent dedup |
| 🔍 Web Search | provider switching + config editor (Exa / Perplexity have no official UI) |
| 📊 Usage Dashboard | client-side token usage / activity aggregation, persisted to a local ledger: live event observer + hourly sweep + pre-delete snapshot (deleting a session keeps its usage) |
| ✅ Todo Dock | live todo panel above the composer + git file-change footer |

Common: every write (plugin toggles / MCP / subagents / hooks bridges / web search / webhook runtime / overlays) goes through `lib/patch-utils.js` `writePatch()` — atomic (temp + rename) with the replaced revision kept beside the file as `cordis.patch.yml.dsh-admin.bak`; all writes share one serial operation queue; missing dsh services degrade per-panel with a hint, never a full plugin mount failure.

## Usage

All panels live in the dsh settings dialog → the matching nav item (each panel lazy-mounts). Operations that change profile config (plugin install/uninstall/disable-enable, MCP, web search, webhook runtime, overlay enablement) require a **dsh restart** to take effect — the panel says so.

### 🔌 Extensions
1. Open: Settings → Plugins → the **Extensions** tab.
2. Install: type an npm package name (`dsh-xxx`) or a local absolute path in the top box → Enter → restart dsh.
3. Update: the card's **⬆ Update** button, or **⬆⬆ Update all** in the toolbar (live progress); **⬆ Check for updates** force-rechecks the registry.
4. Disable/enable: the card's **⏸ Disable / ▶ Enable** (only for extensions shipping their own bundle patch) → restart; disabled plugins are skipped by the update checker.
5. Uninstall: the card's **Uninstall** → inline double confirm.
6. Search/filter: the search box fuzzy-matches name/version/path, plus the All / Extensions / Built-in pills.
7. Loader snapshot: the read-only sub-panel at the bottom — expand for per-entry fiber phase and Agent presets.

### 🗂️ Archived Sessions (dsh's own page + plugin injection)
**已归档会话** is dsh's OWN settings page (the archived-session list with per-row unarchive). The plugin no longer registers a 历史会话 row of its own — it injects that panel **into this page**: the official archived list, then the plugin's session-history panel below it. (The workspace panel is no longer injected — removed in v1.19.0.)

1. Open: Settings → 已归档会话.
2. Official area (top): archived sessions (title · owning workspace · time), a search box filtering by title/workspace, one **Unarchive** per row.
3. Plugin area · session history: the search box matches title/summary/cwd/session ID at once; status pills All / Online / Archived / Ended / Pinned; the card's **📌 Pin** (localStorage-persisted); **Delete** with a double confirm (an online session shows **Close & delete** — dispose first, then remove the log, no restart); **⬇ Export** downloads a Markdown transcript; **🩺 Health** folds tool call/failure/retry reports; **Full-text search** queries every session's content (one-click enable when the deployment ships it off → restart dsh).
4. **Collapsible directories**: sessions group by working directory, and each directory header is a clickable row — click it to fold/unfold that directory's sessions (caret ▾/▸ plus a 已折叠 note); the folded set persists in localStorage across reloads. The filter bar's tail carries **▴ Collapse all / ▾ Expand all**.
5. **Bulk delete** (no more one-by-one):
   - The filter bar's **🗑 Delete current (N)** — deletes **all** N sessions the current filter/search shows;
   - Each directory header's **🗑 Delete directory** — deletes every session under that directory;
   - Both raise a confirm bar first ("Delete the N sessions in the current filter? / in directory X?") and only run on **Confirm**; progress shows "Deleting x / N…". Online sessions are closed first (closeSession) before their log goes, the rest delete directly (deleteSession); one failure never blocks the rest, and the run ends with a failure count.
6. How it merges: a MutationObserver detects whether that official section is the active one, then mounts the panel into the section's own scroll container — the same container the shell mounts plugin sections into, so scoped CSS and internal scrolling are unchanged. Switching away or closing the dialog unmounts it.

### 📚 Skills
1. Open: Settings → Skills.
2. Browse: cards carry `/<name>`, independent 🤖 model-invocable / 👤 human-invocable badges, a source label, and scope details. The list scrolls inside the dialog height (30+ skills are no longer clipped) behind a refresh + search toolbar.
3. Scopes: three layers merge — the **global layer**, **every agent preset's standing scope**, and **every known session's (cwd, preset) scope**. A web deployment (`dsh-web-app`) disables the host-plane `skill-filesystem` row and lets presets own local discovery, so an empty global layer there is normal: the user directories (`~/.agents/skills`, `~/.dsh/skills`) are listed through preset scopes. Reading a preset scope goes through `agentPresets.standingKeyFor`, which ensures that preset's standing mount (it composes plugins only — no agent, session, or turn starts); it is the only host-side route into a preset layer.
4. Filter: text only (name/description/whenToUse/path), client-side, zero extra requests. There is no source/scope dropdown: every card already prints its source label and its "visible in" scopes, so a dropdown would only restate the card.
5. Copy/open: 📋 copies `/name`; when `resourceBase` is a directory, **📂 Open directory** reveals it in the system file manager.

### 🔌 MCP Servers
1. Open: Settings → MCP Servers.
2. Add: fill in id / serverName / command (+args; a whole-line command like `npx -y fetcher-mcp` is flagged for splitting) → save → restart dsh.
3. Test: **🔌 Test** — a real handshake (initialize → tools/list) showing server identity and tool list; successes cache to localStorage (failures stay session-only).
4. Try-call: **🧪 Try call** — pick a tool, paste JSON args, run a genuine `tools/call` (60s budget, 16KB cap).
5. Edit/remove: inline actions; an id matching an existing entry is refused.

### 🛰️ Subagents
1. Open: Settings → Subagents.
2. Create: fill in name (`toolName`) / persona (supports `{{model}}`/`{{cwd}}`) / tool allow-deny / model / backend / delegation depth / background mode; advanced settings expand.
3. Running: the tab lists children live in this process (live timers + event counts); **Interrupt** needs a double confirm; continuable cards take an inline message — **Queue** for the next turn, **Steer** at the nearest step boundary.
4. CLI backends: the tab detects the codex / claude-code provider packages → mount → configure → unmount; **generic CLI backends** scan PATH for other agent CLIs (gemini / qwen / opencode, …) for one-click mounting or a custom command.

### ⌨️ Commands & Hooks
1. Commands tab: create/edit (incl. rename) / enable-disable / delete; saving registers live (fs.watch) — use it in a session as `/name <input>`; **⬇ Export / ⬆ Import** migrates JSON in bulk (same-name entries skipped).
2. Hooks tab: edit hooks.json (event / matcher / command / timeout) → saving hot-restarts the bridge; **Disable** moves an entry to hooks.disabled.json; the three-state bridge banner — when not installed, **⚡ Install & mount** → restart; the Codex sibling bridge is a second status strip on the same tab.
3. Project tab: type a project path to inspect its `.agents/` commands / hooks / skills and per-file load errors. Project hooks share the stock bridge's default timeout (10 minutes per hook — the dsh hook-protocol default; override per hook with `timeout` in the hooks config). Several hung hooks slow the current turn serially; aborting the turn cancels the chain.

### ⏰ Cron Tasks
1. Open: Settings → Cron Tasks (定时任务).
2. Create a task: id (lowercase start) + a cron expression (standard five fields "minute hour day month weekday", local timezone; supports `*`, comma lists, hyphen ranges, slash steps; weekday accepts `0-7` and `SUN-SAT`) + a built-in preset dropdown (every 5 min / hourly / daily 09:00 / weekdays 09:00 / Sunday 00:00) + action — the same vocabulary as Webhook Triggers: steer (pick a target live session, steer/queue) or create (workspacePath + agentPreset + permissionPreset).
3. Semantics: **host-level** — fires while the dsh process is alive, independent of any session (unlike `dsh-schedule`'s session-local every semantics and 300s floor). Each row shows a live countdown plus the local time of the next fire; a steer target that is not live is flagged "⚠ target offline".
4. Manual: **▶ Run now** takes the exact same path as a timed fire (inject a message / create a session + record history).
5. Persistence & scheduling: tasks live in `~/.dsh/cron-tasks.json` (atomic writes + fs.watch mirror, so edits outside the panel apply instantly); one timer per task, re-reading storage before firing so it never races a panel edit; all timers are cleared on plugin unload / dsh exit. **Missed fires while the process was down are not backfilled** — the next future occurrence is recomputed on restart.
6. Note: create mode shares the `@deepseek-ai/dsh-webhook` runtime with Webhook Triggers — install and mount it there first → restart.

### 🪝 Webhook Triggers
1. Open: Settings → Webhook Triggers.
2. Create a rule: id (lowercase start) + secret (≥16 chars; empty = keep the stored one) + optional event name + action — steer: pick a target live session (steer/queue); create: fill workspacePath (absolute) + agentPreset + permissionPreset + optional model.
3. Trigger: `POST /webhook-triggers/<ruleId>` with the `x-webhook-secret` header (required), optional `x-webhook-event` / `x-webhook-delivery` (idempotent dedup); create mode needs the one-click `@deepseek-ai/dsh-webhook` runtime mount → restart.
4. Test: **🧪 Trigger test** injects a test message and records delivery history; the panel's bottom section shows history (including failure reasons).
5. Note: the endpoint shares the Web UI port and bypasses browser auth — the secret is the only gate; with the default 127.0.0.1 binding, external SaaS needs a tunnel.

### 🔍 Web Search
1. Open: Settings → Web Search.
2. Switch: radio-select a provider (deepseek-official / exa / perplexity) → restart dsh.
3. Install/uninstall: only exa / perplexity are removable (deepseek-official is dsh's bundled default); removing the active provider falls back to the default.
4. Configure: the ⚙ editor saves the provider's own field table (apiKey / baseURL / model / maxTokens, …); secrets are write-only, never echoed back.

### 📊 Usage Dashboard
1. Open: Settings → Usage Dashboard.
2. Date-range pills (Today / 24H / 7D / 30D / 90D / All) + the project filter dropdown.
3. Read: KPI cards (tokens / sessions / messages / active days + vs-previous deltas), a stacked daily token trend, a weekday×hour activity heatmap, and local insights (cache hit rate, output-ratio anomalies, …).
4. Persistence: dsh's own token accounting lives in the session log, so deleting a session deleted its usage with it. Three layers keep it instead:
   - **Live event observer** — subscribes to the `session/event` firehose (fired on every append), accumulates absolute totals for sessions this process watched from seq 0, debounces 2s to disk, and flushes immediately on `session/disposed` / `session/flush`. A session created, used, and deleted inside one sweep interval is still recorded.
   - **Background sweep** — folds the whole session table every 60 minutes (`config.usageSnapshotIntervalMs`, milliseconds; `0` disables it — the toolbar's 「⏱ 自动快照」 shows the state and the last sweep time), covering sessions that already existed before this process started.
   - **Pre-delete snapshot** — this plugin's own `deleteSession` / `closeSession` write the session's usage into the ledger BEFORE the log is removed.
   The ledger is `$DSH_HOME/usage-ledger.json` (one row per session, atomic write + serial queue, capped at 2000 rows, oldest `lastSeenAt` first); deleted sessions stay in the data as `deleted: true` (no separate badge — they simply join the KPI and session counts). An idle sweep re-reads nothing (revision-cached) and writes nothing (`changed: false`), and a read never overwrites numbers the live observer owns.
   > Why not `fs.watch` on `$DSH_HOME/sessions`: a file watcher only tells you *something changed* — a compressed log still has to be re-parsed whole, and the deletion event races the debounce window. `session/event` is the synchronous firehose at append time: more exact, and cheaper.

### ✅ Todo Dock
1. Location: a floating panel above the chat composer, projecting the session live.
2. Use: check items off (strikethrough + progress bar), per-item live timers, collapse the done section; the bell (top-right) fires a desktop notification when backgrounded work completes.
3. Git file-change footer: branch badge + per-file ±lines; **⧉ Copy diff**; click a file row to reveal it in the system file manager.

## Version compatibility (pinned)

| Plugin | dsh | Status |
|---|---|---|
| v1.19.0 | **0.1.5-rc.2** (`latest` tag, verified baseline) | ✅ full; no official 已归档会话 page → 历史会话 / 工作区 fall back to their own rows |
| v1.19.0 | **0.1.6-alpha.2** (`alpha` tag, newest published) | ✅ full (`unarchiveSession` + the official 已归档会话 page the session-history panel merges into) |

- **Newest dsh release: 0.1.6-alpha.2** (alpha pre-release; the `latest` tag is still 0.1.5-rc.2). Upgrade: `npm i -g @deepseek-ai/dsh@0.1.6-alpha.2`.
- **The official 已归档会话 page needs dsh ≥ 0.1.6-alpha.2** (it arrived with `dsh-client-ui-settings-unarchive-sessions`): 0.1.5-rc.2 and earlier ship no such page, so the plugin detects that and falls back — registering 历史会话 / 工作区 as their own sidebar sections again, keeping both panels reachable.
- **dsh-workspace in 0.1.5-rc.2 lacks `unarchiveSession`** (added in 0.1.6-alpha.2): the plugin still mounts (mount-time warning), deleting an archived session skips the archived-set cleanup, and the explicit unarchive gesture reports a clear error; upgrading to 0.1.6-alpha.2 restores full behavior.
- Version-sensitive seams (re-run `npm test` after upgrading dsh/cordis — the verify scripts assert these against real contracts):
  1. **workspaceRegistry verb surface** — `archiveSession` / `unarchiveSession` / `archivedSessionIds` (public verbs only, never the TS-private `requireState` / `setState`);
  2. **Physical session-log layout** — the delete path derives the JSONL backend's directory (`projectKey` / `encodeSegment`); layout drift or a custom backend **refuses the delete** with a loud error;
  3. **Hooks-bridge hot restart** — `fiber.update(config, true)` (cordis-internal); on failure the panel reports "saved — restart dsh to apply";
  4. **Transparent wrap of `ctx.agents.create/resume`** — online-session delete needs the captured AgentHandle; an unwrappable member degrades to "restart dsh, then delete";
  5. **Private readers** — `locate()` / `snapshotEvents()` / projection-cache table name; drift degrades to empty values / lists.

## Install

```sh
pnpm dsh plugin --profile web add dsh-plugin-admin   # or a local path
pnpm dsh --profile web                               # restart to load
```

## Tests

```sh
npm test   # 19 scripts: self-check / host-check / verify-* / integration-check
```

- `integration-check.mjs` probes real dsh checkout source for contract drift (thirteen unified RPC namespaces).
- Diagnostics (not in npm test): `node scripts/repro-delete-session.mjs` reproduces every session-delete failure mode (uncaptured live handle / layout drift / concurrent resume) to match panel errors; `node scripts/smoke-cron-panel.mjs` really mounts the Cron Tasks panel in jsdom (list / toggle / editor / preset / save).

## Security posture

- Shell-metacharacter **whitelist** on every pnpm operand — no `& | > < %` injection surface.
- Atomic writes (temp + rename) for `package.json` / `cordis.patch.yml` / all JSON state, with a rolling `.bak` of the replaced patch revision.
- Timeout process-tree kill (`taskkill /T /F`) on package and MCP-probe operations.
- Webhook inbound: timing-safe secret compare (SHA-256 both sides), empty secret rejects all, secret verified **before** the body is read, bounded 1MiB payloads, uniform 401 (no rule enumeration).
- Provider secrets are write-only — never echoed back to the browser.
- Dangerous deletes require double confirmation; same-name session deletion is refused by design.

## License

MIT
