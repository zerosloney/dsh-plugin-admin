# dsh-plugin-admin

Admin web UI for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness): seven management panels inside dsh's built-in settings UI (two standalone settings pages — Usage Dashboard 28 / Automation 29; four tabs (Extensions / MCP Servers / Commands / Hooks) alongside the official Plugin list tab inside the Built-in Plugins page; one floating dock above the composer. The seventh panel is the third tab inside the Automation page — Cron Tasks / Webhook / Workflows, three tabs in one page). Zero `@deepseek-ai/dsh-*` imports on the host side — the browser half reuses the official `@deepseek-ai/dsh-client-ui-primitives` atoms — and everything else rides the live Cordis Context: `inject` is empty, so a missing dsh service retires only the panel that needs it (one warning at mount) instead of failing the mount.

Panel copy ships in Simplified Chinese and English and rides dsh's own locale service (`ctx.locale`): the Chinese/English dropdown in the Extensions toolbar sets the language of the whole interface, and these panels repaint live — no reload.

**npm:** [`dsh-plugin-admin`](https://www.npmjs.com/package/dsh-plugin-admin) · v1.38.0 · MIT · supports dsh **≥ 0.1.7-rc.2** (verification baseline **0.2.1-rc.4**; declared upper bound **< 0.3.0**, see [docs/COMPAT.md](docs/COMPAT.md))
**CI:** the full gate plus the real-host smoke on every push (Node 24 — dsh itself requires >= 24.9.0); tagged releases publish to npm with provenance.
**🇨🇳 中文文档:** [README.md](./README.md)

## The seven panels

| Surface | Where | What it does |
|---|---|---|
| 🔌 Extensions | Settings → Built-in Plugins | install / uninstall / update / enable-disable profile plugins (pnpm orchestration + dsh peer-compat pre-check) |
| 🔌 MCP Servers | Settings → Built-in Plugins | row-level CRUD + real handshake probes + tool try-call console; **edits to a mounted entry hot-apply, no restart** |
| ⌨️ Commands | Settings → Built-in Plugins | prompt-command CRUD / import-export; saving registers live |
| 🪝 Hooks | Settings → Built-in Plugins | hooks.json editing + one-click Claude / Codex bridge install; saving hot-restarts the bridge |
| 🤖 Automation | Settings → Automation | Cron Tasks + Webhook Triggers + Workflows, three tabs; the Workflows tab has one-click generation (describe the task in one sentence, a subagent writes the script and saves it into the library) |
| 📊 Usage Dashboard | Settings → Usage Dashboard | token usage / activity analysis; deleting a session keeps its usage (three-layer ledger) |
| ✅ Todo Dock | above the composer | live todo projection + git file-change footer, no settings trip |

Operations that change profile config (plugin install/uninstall/enable-disable, MCP add/remove, webhook runtime, overlays) need a **dsh restart**; the panel says so. Editing a mounted MCP entry is the exception (hot-apply).

## Install

```sh
pnpm dsh plugin --profile web add dsh-plugin-admin   # or a local path ~/dsh-plugin-admin
pnpm dsh --profile web                                # restart dsh to load it
```

## Common tasks

| I want to… | Go to | Notes |
|---|---|---|
| Install an extension | Settings → Built-in Plugins → Extensions | type an npm package name or local absolute path → Enter → restart; a dsh peer-compat pre-check runs automatically |
| Add an MCP server and try it | Settings → Built-in Plugins → MCP Servers | save the form → restart; **🔌 Test** does a real handshake and **🧪 Try call** a real tools/call; **editing a mounted entry applies hot, no restart** |
| Run something on a schedule | Settings → Automation → Cron Tasks | template cards (weekday digest / weekly report / hourly patrol) or the structured editor; action = steer a live session or create one; missed fires are not backfilled |
| Wire a webhook | Settings → Automation → Webhook | create a rule to get a secret → `POST /webhook-triggers/<ruleId>` with the `x-webhook-secret` header; local delivery only by default; delivery history + idempotent dedup |
| Run a workflow (no coding needed) | Settings → Automation → Workflows | Use one-click generation (a subagent writes and saves the script) or a template card (prefills a draft into the library); start and manage runs via the /workflow command (create / run / runs / stop) or the workflow_admin tool in a session |
| Manage commands / hooks | Settings → Built-in Plugins → Commands / Hooks | commands register the moment you save — use them as `/name <input>`; hooks hot-restart the bridge; install the bridge first via **⚡ Install & mount** |
| See token usage | Settings → Usage Dashboard | date ranges + project filter + trend/heatmap; usage survives session deletion |
| Check todos and changed files | the dock above the composer | live projection; the git footer copies the diff and reveals files |

## Learn more

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (Chinese) — architecture and mechanisms (source layout, write/degrade model, per-panel internals, the workflow engine and realm boundary), every config key, security posture, tests and seam contracts
- **[docs/COMPAT.md](docs/COMPAT.md)** — the dsh compatibility matrix and the auto-yield policy
- **[CHANGELOG.md](CHANGELOG.md)** — release history

## License

MIT
