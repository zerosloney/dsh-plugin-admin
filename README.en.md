# dsh-plugin-admin

Admin web UI for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness): eleven management panels inside dsh's built-in settings UI (three standalone settings pages — Web & Sessions 27 / Usage Dashboard 28 / Automation 29; six tabs — Extensions inside the Plugins page, and Skills / MCP Servers / Subagents / Commands / Hooks inside the Built-in Plugins page; one floating dock above the composer. The eleventh panel is the third tab inside the Automation page — Cron Tasks / Webhook / Workflows, three tabs in one page). Zero dsh imports — everything rides the live Cordis Context; a missing dsh service degrades that one panel instead of failing the mount.

Panel copy ships in Simplified Chinese and English and rides dsh's own locale service (`ctx.locale`): the 🌐 switch sets the language of the whole interface, and these panels repaint live — no reload.

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.26.2 · MIT · supports dsh **≥ 0.1.7-rc.2** (verification baseline **0.2.0-rc.1**, see [docs/COMPAT.md](docs/COMPAT.md))
**CI:** test matrix Node 22/24 on every push; tagged releases publish to npm with provenance.
**🇨🇳 中文文档:** [README.md](./README.md)

## The eleven panels

| Surface | Where | What it does |
|---|---|---|
| 🔌 Extensions | Settings → Plugins | install / uninstall / update / enable-disable profile plugins (pnpm orchestration + dsh peer-compat pre-check) |
| 📚 Skills | Settings → Built-in Plugins | full skill roster (global + per-preset + per-session scope merge), strictly read-only |
| 🔌 MCP Servers | Settings → Built-in Plugins | row-level CRUD + real handshake probes + tool try-call console; **edits to a mounted entry hot-apply, no restart** |
| 🛰️ Subagents | Settings → Built-in Plugins | managed subagent CRUD + live monitor / follow-up + CLI backends |
| ⌨️ Commands | Settings → Built-in Plugins | prompt-command CRUD / import-export; saving registers live |
| 🪝 Hooks | Settings → Built-in Plugins | hooks.json editing + one-click Claude / Codex bridge install; saving hot-restarts the bridge |
| 🤖 Automation | Settings → Automation | Cron Tasks + Webhook Triggers + Workflows, three tabs, each with template cards |
| 🕘 Session History | Settings → Web & Sessions | search / pin / collapsible directories / bulk delete / Markdown export / health check / full-text search |
| 🔍 Web Search | Settings → Web & Sessions | provider switching + the config editor Exa / Perplexity never shipped; secrets write-only |
| 📊 Usage Dashboard | Settings → Usage Dashboard | token usage / activity analysis; deleting a session keeps its usage (three-layer ledger) |
| ✅ Todo Dock | above the composer | live todo projection + git file-change footer, no settings trip |

Operations that change profile config (plugin install/uninstall/enable-disable, MCP add/remove, web search, webhook runtime, overlays) need a **dsh restart**; the panel says so. Editing a mounted MCP entry is the exception (hot-apply).

## Install

```sh
pnpm dsh plugin --profile web add dsh-plugin-admin   # or a local path ~/dsh-plugin-admin
pnpm dsh --profile web                                # restart dsh to load it
```

## Common tasks

| I want to… | Go to | Notes |
|---|---|---|
| Install an extension | Settings → Plugins → Extensions | type an npm package name or local absolute path → Enter → restart; a dsh peer-compat pre-check runs automatically |
| Bulk-clean session history | Settings → Web & Sessions → Session History | filter, then **🗑 Delete current (N)** or a directory header's **🗑 Delete directory** (confirm first); online sessions are closed first; per-session **⬇ Export** / **🩺 Health** too |
| Add an MCP server and try it | Settings → Built-in Plugins → MCP Servers | save the form → restart; **🔌 Test** does a real handshake and **🧪 Try call** a real tools/call; **editing a mounted entry applies hot, no restart** |
| Create a subagent | Settings → Built-in Plugins → Subagents | name / persona / tool allow-deny / model / backend; the CLI tab mounts codex / claude-code / other agent CLIs found on PATH |
| Run something on a schedule | Settings → Automation → Cron Tasks | template cards (weekday digest / weekly report / hourly patrol) or the structured editor; action = steer a live session or create one; missed fires are not backfilled |
| Wire a webhook | Settings → Automation → Webhook | create a rule to get a secret → `POST /webhook-triggers/<ruleId>` with the `x-webhook-secret` header; local delivery only by default; delivery history + idempotent dedup |
| Run a workflow (no coding needed) | Settings → Automation → Workflows | **Start from a template** and tweak the args, or `/workflow create <task description>` in a session and let the model write, dry-run and start it |
| Manage commands / hooks | Settings → Built-in Plugins → Commands / Hooks | commands register the moment you save — use them as `/name <input>`; hooks hot-restart the bridge; install the bridge first via **⚡ Install & mount** |
| Switch web search / set an API key | Settings → Web & Sessions → Web Search | radio-select a provider → restart; the ⚙ editor saves apiKey and friends, secrets are write-only |
| See token usage | Settings → Usage Dashboard | date ranges + project filter + trend/heatmap; usage survives session deletion |
| See which skills exist | Settings → Built-in Plugins → Skills | read-only roster with model/human-invocable flags and scopes; 📋 copies `/name`, 📂 reveals the directory |
| Check todos and changed files | the dock above the composer | live projection; the git footer copies the diff and reveals files |

## Learn more

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (Chinese) — architecture and mechanisms (source layout, write/degrade model, per-panel internals, the workflow engine and realm boundary), every config key, security posture, tests and seam contracts
- **[docs/COMPAT.md](docs/COMPAT.md)** — the dsh compatibility matrix and the auto-yield policy
- **[CHANGELOG.md](CHANGELOG.md)** — release history

## License

MIT
