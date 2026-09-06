# dsh-plugin-admin

Admin web UI for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — manage plugins, MCP servers, subagents, commands & hooks, webhooks, credentials, and sessions from dsh's built-in settings UI, instead of hand-editing `cordis.patch.yml`.

> 🇨🇳 完整中文文档（本文件为同步摘要）: [README.md](./README.md)

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.8.0 · MIT
**CI:** test matrix Node 22/24 on every push; tagged releases publish to npm with provenance.

## Why

dsh's everything-is-a-plugin architecture is powerful — but day-to-day administration means editing YAML rows by hand, restarting, and hoping. This plugin moves those operations into the official settings UI with validation, atomic writes, live reload, and fail-loud errors.

## What you get

**Settings pages** (standalone sections in the settings dialog, each lazy-mounted):

- **🔌 Extensions** — a third tab inside the shell's Plugins page: install from npm or a local path, fuzzy search + source filters (built-in / package / local), one-click uninstall with inline confirmation, **batch "update all"** with per-item progress, and automatic remote update detection (registry-aware, exact-version pinning so pnpm never silently no-ops). "Update available" reminders **persist in localStorage** until the upgrade actually happens or a recheck confirms you're current.
- **📊 Usage Dashboard** — a VibeUsage-style page: date-range pills (today/24H/7D/30D/90D/all) + project filter, KPI cards with vs-previous-period deltas, a stacked daily token trend, a weekday×hour activity heatmap, and conditional local insights (cache hit rate, output ratio, concentration). All slicing happens client-side over per-session rows — range changes never re-fetch.
- **🛰️ MCP Servers** — CRUD for stdio / streamable-http instances with **real handshake probes** (`initialize → tools/list`, tool counts & names, process-tree kill on timeout), split-command detection with actionable warnings, per-entry probe results cached to localStorage (failures stay session-only), and a **🧪 try-call console** that runs a genuine `tools/call` (MCP Inspector posture, 60s budget, 16KB result cap).
- **🤖 Subagents** — managed `@deepseek-ai/dsh-tool-subagent` rows (name, persona, tool allow/deny, model routing, depth, background mode) plus a **Running** tab (live elapsed timers, interrupt with parent-session recheck) and **CLI backends** (codex / claude-code provider packages, or any agent CLI on PATH — gemini, qwen, opencode, custom).
- **⌨️ Commands & Hooks** — file-backed prompt commands (`$DSH_HOME/commands/*.json`, live `ctx.commands` registration, fs.watch hot reload, JSON export/import with same-name skip), Claude-Code-format hooks with dual storage + disable sidecar, bridge hot-restart, one-click `@deepseek-ai/dsh-hooks-claude-code` install/uninstall, and a read-only `.agents/` project inspector.
- **💬 Session History** — title/summary cards with online/archived/ended status lights, multi-dimensional search & filters, per-card token usage tags (`↑in ↓out · cache`) with a whole-page totals strip, **📌 local pinning** (localStorage + pinned filter), **🔎 full-text search** across all sessions' message content, **🩺 health reports** (per-tool call/error counts via callId pairing, turn-end reasons, retries, compactions), **⬇ Markdown export** (human-readable transcript download), archive/restore, and permanent delete that works on **online sessions without restarting dsh** (transparent `AgentHandle` capture → official dispose chain, then log removal).
- **🪝 Webhook Triggers** — inbound `POST /webhook-triggers/<ruleId>` endpoints with timing-safe shared-secret verification, event filtering, delivery idempotency IDs, and a 1MiB body cap. Actions steer an existing live session (steer/followup) or create a new one (via the one-click `@deepseek-ai/dsh-webhook` runtime mount). Rules live in `$DSH_HOME/webhook-triggers.json` (atomic writes + fs.watch), with CRUD, **trigger tests**, and delivery history in the panel. Note: the inbound endpoint intentionally bypasses the browser-trust fence for external callbacks — the secret is the only line of defense, always set one.
- **🔑 Credentials** — the host's `ctx.credentials` seam finally gets a web surface: list every credential ref the composition declares (configured badge, source, read-only hints), set/update (secret input, **values never echo back**), and clear. POSIX-name whitelist on every write.

**Conversation surfaces** (mounted into the chat skeleton's slots):

- **✅ Todo Dock** — a live todo panel above the composer (`useProjection('todos')`, zero polling): three-state items, completion progress bar, per-item live timers, collapsible done section, and a git-based file-change footer (status letters M/A/D/R/C/? with per-file ±lines, branch badge, **copy full diff**, click-to-reveal in the system explorer). Desktop notification when backgrounded work completes.
- **⏰ Schedule Dock + Bell** — the agent's durable reminders (`after` / `at` / `every` from the official schedule runtime) projected into **two always-on entry points**: a compact dock card above the composer (due-first ordering, kind badges, second-ticking relative times, overdue highlighting, vanishes when empty) and a harvested **empty slot** — `conversation.input.right`, officially rendered but never occupied by any built-in — carrying a bell + count next to the submit button with a click-out popover. Both read `useProjection('schedule')`: zero polling, zero host state.
- **Sidebar context menus** — sessions get *Copy session ID* / *Delete session* (exact-title match, same-name refusal, double-click confirm); workspaces get *Reveal in explorer*.
- **Settings nav icon identity** — the generic gear the shell paints for unknown section ids is re-painted per page with semantic 16×16 outline icons (server rack, org tree, terminal prompt, clock, chart, bolt, key), riding the shell's own css classes.

## Install

```sh
# add to a profile (web used as the example)
pnpm dsh plugin --profile web add dsh-plugin-admin

# restart dsh to load
pnpm dsh --profile web
```

Or from inside the dsh web UI: **Plugins → Extensions tab → type `dsh-plugin-admin`**.

> Upgrading from the retired `dsh-plugin-subagents` or `dsh-command-hook-admin`? v0.5.0+ absorbed both, including byte-level compatibility with their managed config rows and data files. See the Chinese README migration notes.

## Architecture (in brief)

- **Host** (`lib/index.js` + `patch-utils.js`, `subagent-admin.js`, `command-hook-admin.js`, `project-*.js`, `webhook-triggers.js`, `credential-admin.js`, `session-export.js`, `health-report.js` — zero dsh imports): registers **nine RPC namespaces** through one unified typert descriptor — `pluginAdmin`, `sessionAdmin` (list/archive/delete/close/fileStats/gitDiff/searchSessions/healthReport/exportSession/usageReport), `fsAdmin`, `mcpAdmin` (incl. `callTool`), `subagentAdmin`, `commandHookAdmin`, `projectAdmin`, `webhookAdmin`, `credentialAdmin`. Line-level YAML editing for `cordis.patch.yml` (managed blocks, byte-level preservation of foreign rows), atomic writes (temp + rename) everywhere, bounded LRU caches, and a shared **serialized operation queue** across everything that read-modify-writes the same files. Agent handles are captured by transparently wrapping `ctx.agents.create/resume` (ctx.effect-scoped teardown, 200-entry LRU cap) so online sessions can be disposed through dsh's official chain.
- **Client** (`lib/client.js`): React shared with the shell via the module table, official `--dsw-*` design tokens (dark/light adaptive), and **eleven slot contributions**: the Extensions tab (`settings.plugins.tab`), seven standalone `settings.section` pages, two `conversation.input.dock` entries (todo + schedule), and the harvested `conversation.input.right` bell. Dock components consume the framework's `useProjection` standard-kit hook directly — open key space, no type registration needed.

## Security posture

- Shell-metacharacter **whitelist** on every pnpm operand (`assertPnpmOperand`) — no `& | > < %` injection surface.
- Atomic writes (temp + rename) for `package.json` / `cordis.patch.yml` / all JSON state; crash-safe.
- Timeout process-tree kill (`taskkill /T /F`) on package and MCP-probe operations.
- Webhook inbound: **timing-safe secret compare** (SHA-256 both sides), empty secret **rejects all** (at save *and* at request time), secret verified **before** the body is read, bounded 1MiB payloads.
- Credential values **never cross to the browser** — presence/source/writability only.
- Dangerous deletes require double confirmation; same-name session deletion is refused by design.
- Host-side validation fails loud; the client pre-checks and explains (reserved names, duplicates, unknown tools, invalid regex).

## Development

```sh
npm ci
npm test
```

The suite runs twelve scripts: bundle load + slot registration + full panel interactions (`self-check`), host contracts (`host-check`), MCP probe cache, update-reminder persistence, subagents host+client, command hooks, project commands/hooks, the todo dock (git pure functions against a real temp repo), webhook triggers (validation matrix + full HTTP handler paths), and the schedule dock + harvested bell.

Release: `npm version patch && git push --tags` → GitHub Actions verifies tag/version parity and publishes with `--provenance`.

## License

MIT
