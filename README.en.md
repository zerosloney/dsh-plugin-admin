# dsh-plugin-admin

Admin web UI for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — 11 management panels inside dsh's built-in settings UI: extensions, session history, workspaces, skills, MCP servers, subagents, commands & hooks, webhook triggers, web search, usage dashboard, and a todo dock. Zero dsh imports — everything rides the live Cordis Context; all writes are atomic + serialized, and missing services degrade per-panel instead of failing the plugin mount.

> 🇨🇳 完整中文文档（本文件为同步摘要）: [README.md](./README.md)

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.17.5 · MIT
**CI:** test matrix Node 22/24 on every push; tagged releases publish to npm with provenance.

## Feature overview

| Panel | Focus |
|---|---|
| 🔌 Extensions | install / uninstall / update / disable-enable profile plugins (pnpm orchestration + bundles sync), Loader runtime snapshot |
| 💬 Session History | list / search / archive / pin / Markdown export / health reports / full-text search; online sessions delete without restart |
| 📁 Workspaces | workspace CRUD + ordering + archive set (dsh has no official management surface) |
| 📚 Skills | full skill roster (global layer + per-session scope merge), strictly read-only |
| 🔌 MCP Servers | row-level CRUD + real handshake probes + try-call console |
| 🛰️ Subagents | managed subagent rows CRUD + running monitor / follow-up + CLI backends |
| ⌨️ Commands & Hooks | file-backed prompt commands (live) + Claude / Codex hooks bridges + read-only `.agents/` inspector |
| 🪝 Webhook Triggers | inbound endpoint → steer a live session / create a session; signature check + idempotent dedup |
| 🔍 Web Search | provider switching + config editor (Exa / Perplexity have no official UI) |
| 📊 Usage Dashboard | client-side real-time token usage / activity aggregation |
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

### 💬 Session History
1. Open: Settings → Session History.
2. Search/filter: the search box matches title/summary/cwd/session ID at once; the status pills are All / Online / Archived / Ended.
3. Pin: the card's **📌** (localStorage-persisted); the **📌 Pinned** pill jumps straight there.
4. Archive/unarchive: card buttons; the sidebar updates immediately.
5. Delete: the card's **Delete** → double confirm; an online session shows **Close & delete** (dispose first, then remove the log — no restart).
6. Export: the card's **⬇ Export** → downloads a Markdown transcript.
7. Health report: the card's **🩺 Health** → folded tool call/failure/retry report.
8. Full-text search: toggle **Full-text search** and type a query; if the deployment ships it off (`openAt: never`), click **⚡ One-click enable** → restart dsh.

### 📁 Workspaces
1. Open: Settings → Workspaces.
2. Create: the toolbar's **➕ New workspace** → pick a directory natively or type an absolute path (optional title) → submit; an existing path returns that workspace.
3. Rename/order/status: inline **✎** to rename, **⬆/⬇** to reorder, **🔎 Check status** (surfaces `missing-dir`).
4. Delete: 🗑 double confirm — registry only; the directory and its sessions stay.
5. Unarchive all: **📦 Unarchive all (N)** at the top when the archive set is non-empty.

### 📚 Skills
1. Open: Settings → Skills.
2. Browse: cards carry `/<name>`, independent 🤖 model-invocable / 👤 human-invocable badges, a source label, and scope details.
3. Filter: text (name/description/whenToUse/path), source, scope — all client-side, zero extra requests.
4. Copy/open: 📋 copies `/name`; when `resourceBase` is a directory, **📂 Open directory** reveals it in the system file manager.

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
3. Project tab: type a project path to inspect its `.agents/` commands / hooks / skills and per-file load errors.

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

### ✅ Todo Dock
1. Location: a floating panel above the chat composer, projecting the session live.
2. Use: check items off (strikethrough + progress bar), per-item live timers, collapse the done section; the bell (top-right) fires a desktop notification when backgrounded work completes.
3. Git file-change footer: branch badge + per-file ±lines; **⧉ Copy diff**; click a file row to reveal it in the system file manager.

## Version compatibility (pinned)

| Plugin | dsh | Status |
|---|---|---|
| v1.17.5 | **0.1.5-rc.2** (`latest` tag, verified baseline) | ✅ full; unarchive degraded (below) |
| v1.17.5 | **0.1.6-alpha.2** (`alpha` tag, newest published) | ✅ full (includes `unarchiveSession`) |

- **Newest dsh release: 0.1.6-alpha.2** (alpha pre-release; the `latest` tag is still 0.1.5-rc.2). Upgrade: `npm i -g @deepseek-ai/dsh@0.1.6-alpha.2`.
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
npm test   # 18 scripts: self-check / host-check / verify-* / integration-check
```

- `integration-check.mjs` probes real dsh checkout source for contract drift (thirteen unified RPC namespaces).
- Diagnostics (not in npm test): `node scripts/repro-delete-session.mjs` reproduces every session-delete failure mode (uncaptured live handle / layout drift / concurrent resume) to match panel errors.

## Security posture

- Shell-metacharacter **whitelist** on every pnpm operand — no `& | > < %` injection surface.
- Atomic writes (temp + rename) for `package.json` / `cordis.patch.yml` / all JSON state, with a rolling `.bak` of the replaced patch revision.
- Timeout process-tree kill (`taskkill /T /F`) on package and MCP-probe operations.
- Webhook inbound: timing-safe secret compare (SHA-256 both sides), empty secret rejects all, secret verified **before** the body is read, bounded 1MiB payloads, uniform 401 (no rule enumeration).
- Provider secrets are write-only — never echoed back to the browser.
- Dangerous deletes require double confirmation; same-name session deletion is refused by design.

## License

MIT
