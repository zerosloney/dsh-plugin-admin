/**
 * Ad-hoc verification for the Agent Preset administration section:
 *  1. `list()` enumerates shipped presets (read-only) plus seeded user
 *     presets, sorted user-then-shipped with `isDefault` only on the
 *     active id.
 *  2. `getDocument(id)` returns metadata + raw composition; rejects
 *     shipped ids.
 *  3. `upsert(id, payload)` writes `preset.yml` + `agent.cordis.yml`
 *     atomically; re-saves a composition; rejects when no entry has
 *     a `name:` scalar; rejects shipped ids.
 *  4. `delete(id)` removes the user preset directory; refuses shipped
 *     ids with a structured error.
 *  5. `setDefault(id)` writes `agent-presets.config.default: <id>` to
 *     a fresh `agent-presets` row (the user patch composes with the
 *     bundle layer that defines the row's base config); clearing without a
 *     settings service is refused instead of writing an empty preset id.
 *  6. With the settings service mounted, `setDefault` writes the settings
 *     namespace (set / unset) and leaves the patch untouched — the live
 *     default is settings-first.
 *  7. `preset.yml` scalars are escaped, so a `": "` in name/description
 *     round-trips instead of corrupting the file.
 *
 * Run: node scripts/verify-agent-presets-admin.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Temp profile directory: drop a dummy `package.json` so profileDirOf
// resolves here, and an empty `cordis.patch.yml` for setDefault to land on.
const tmpRoot = mkdtempSync(join(tmpdir(), 'agent-presets-admin-'))
process.env.DSH_HOME = tmpRoot
writeFileSync(join(tmpRoot, 'package.json'), '{"name":"tmp-profile"}', 'utf8')
writeFileSync(join(tmpRoot, 'cordis.patch.yml'), '', 'utf8')

// Seed one user preset: <dshHome>/.agent-presets/my-team/{preset,agent.cordis}.yml
const userRoot = join(tmpRoot, '.agent-presets')
const seedDir = join(userRoot, 'my-team')
mkdirSync(seedDir, { recursive: true })
writeFileSync(join(seedDir, 'preset.yml'),
  'name: My Team preset\ndescription: 用于团队项目\norder: 5\n', 'utf8')
writeFileSync(join(seedDir, 'agent.cordis.yml'),
  '# team composition\n' +
  '- id: tool-bash\n' +
  "  name: '@deepseek-ai/dsh-tool-bash'\n" +
  '- id: tool-fs\n' +
  "  name: '@deepseek-ai/dsh-tool-fs'\n",
  'utf8')

// Host context stub (mirrors the storage-admin verify script shape):
// `baseUrl` is a plain context property, not a service.
let service = null
const wrapperCtx = {
  baseUrl: 'file://' + tmpRoot + '/',
  get() { return undefined },
  effect(cb) { cb.call(wrapperCtx); return () => {} },
  provide(_key, svc) { service = svc },
}
const { applyAgentPresetsAdmin } = await import('../lib/agent-presets-admin.js')
applyAgentPresetsAdmin(wrapperCtx)
assert.ok(service !== null, 'agentPresetsAdmin service mounted')

// ---------- Scenario 1: list() exposes shipped + user presets ----------
const list1 = await service.list()
assert.equal(typeof list1.defaultId, 'string', 'list() returns a defaultId string')
assert.equal(list1.defaultId, '', 'defaultId is empty before any setDefault')
const userEntries = list1.presets.filter((p) => p.trust === 'user')
const shippedEntries = list1.presets.filter((p) => p.trust === 'shipped')
assert.equal(userEntries.length, 1, 'one seeded user preset')
assert.equal(userEntries[0].id, 'my-team', 'user preset id is my-team')
assert.equal(userEntries[0].name, 'My Team preset', 'metadata name parsed from preset.yml')
assert.equal(userEntries[0].description, '用于团队项目', 'metadata description parsed')
assert.equal(userEntries[0].order, 5, 'metadata order parsed')
assert.equal(userEntries[0].editable, true, 'user preset is editable')
assert.equal(shippedEntries.length, 4, 'four shipped presets (cordis, minimal, ptc, standard)')
for (const id of ['cordis', 'minimal', 'ptc', 'standard']) {
  const e = shippedEntries.find((p) => p.id === id)
  assert.ok(e !== undefined, `shipped preset "${id}" listed`)
  assert.equal(e.editable, false, `shipped preset "${id}" is not editable`)
}
console.log('scenario 1 OK: list() exposes shipped + user presets with editable flags')

// ---------- Scenario 2: getDocument() reads metadata + composition, refuses shipped -
const doc1 = await service.getDocument('my-team')
assert.equal(doc1.id, 'my-team', 'getDocument returns the id')
assert.equal(doc1.metadata.name, 'My Team preset', 'metadata round-trip')
assert.equal(doc1.metadata.description, '用于团队项目', 'description round-trip')
assert.equal(doc1.metadata.order, 5, 'order round-trip')
assert.ok(doc1.composition.raw.startsWith('# team composition'), 'composition raw text returned')
assert.ok(/^\s*- id: tool-bash/m.test(doc1.composition.raw), 'composition includes tool-bash row')
await assert.rejects(
  () => service.getDocument('cordis'),
  /dsh 默认预设/,
  'getDocument refuses shipped preset',
)
console.log('scenario 2 OK: getDocument() reads user preset + refuses shipped')

// ---------- Scenario 3: upsert() writes metadata + composition atomically, validates shape -
// 3a: create a new preset
const createRes = await service.upsert('new-preset', {
  metadata: { name: '新预设', description: '试试看', order: 7 },
  compositionText:
    '- name: \'@deepseek-ai/dsh-tool-bash\'\n' +
    '- name: \'@deepseek-ai/dsh-tool-fs\'\n',
})
assert.equal(createRes.ok, true, 'upsert returns ok')
assert.ok(existsSync(join(userRoot, 'new-preset', 'preset.yml')), 'preset.yml written')
assert.ok(existsSync(join(userRoot, 'new-preset', 'agent.cordis.yml')), 'agent.cordis.yml written')
const compWritten = readFileSync(join(userRoot, 'new-preset', 'agent.cordis.yml'), 'utf8')
assert.ok(/^\s*- name: '\@deepseek-ai\/dsh-tool-bash'/m.test(compWritten), 'composition tool-bash row written')
assert.ok(/^\s*- name: '\@deepseek-ai\/dsh-tool-fs'/m.test(compWritten), 'composition tool-fs row written')
// 3b: overwriting the seeded preset preserves the metadata name change
await service.upsert('my-team', {
  metadata: { name: 'My Team v2', description: '改了', order: 6 },
  compositionText:
    '# v2\n- id: tool-fs\n  name: \'@deepseek-ai/dsh-tool-fs\'\n',
})
const v2Meta = readFileSync(join(seedDir, 'preset.yml'), 'utf8')
assert.ok(/name: "My Team v2"/.test(v2Meta), 'metadata name updated (quoted scalar)')
assert.ok(/order: 6/.test(v2Meta), 'metadata order updated')
const v2Comp = readFileSync(join(seedDir, 'agent.cordis.yml'), 'utf8')
assert.ok(/v2/.test(v2Comp), 'composition overwritten')
assert.ok(!/- id: tool-bash/.test(v2Comp), 'old tool-bash row dropped')
// 3c: refuse compositions without a `name:` entry
await assert.rejects(
  () => service.upsert('bad-preset', {
    metadata: { name: '' },
    compositionText: '- id: tool-bash\n  disabled: false\n',
  }),
  /每条 plugin 行必须包含/,
  'upsert rejects composition without a name: scalar on any entry',
)
// 3d: refuse empty composition
await assert.rejects(
  () => service.upsert('bad-preset-2', { metadata: {}, compositionText: '   \n' }),
  /至少需要一条/,
  'upsert rejects empty composition',
)
// 3e: refuse shipped ids
await assert.rejects(
  () => service.upsert('cordis', { metadata: {}, compositionText: '- name: \'@deepseek-ai/dsh-tool-fs\'\n' }),
  /dsh 默认预设/,
  'upsert refuses shipped ids',
)
console.log('scenario 3 OK: upsert() writes atomically, validates shape, refuses shipped')

// ---------- Scenario 3f: the composition shape check is key-level aware -----
// Legal spellings must pass, and a nested `config.name` must NOT count as the
// row's own name (dsh would reject that preset as broken while the panel said
// it saved).
await service.upsert('shape-ok-inline', {
  metadata: {},
  compositionText: "- name: '@deepseek-ai/dsh-tool-web'\n",
})
await service.upsert('shape-ok-dash-only', {
  metadata: {},
  compositionText: "- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n",
})
await service.upsert('shape-ok-comment', {
  metadata: {},
  compositionText: "# leading comment\n- name: '@deepseek-ai/dsh-tool-web' # trailing\n",
})
// Flow-map rows and group rows are legal dsh shapes (entryListProblem accepts
// any map carrying its own `name`); they must not be rejected.
await service.upsert('shape-ok-flow', {
  metadata: {},
  compositionText: "- { name: '@deepseek-ai/dsh-tool-web', id: web }\n",
})
await service.upsert('shape-ok-group', {
  metadata: {},
  compositionText: "- name: '@deepseek-ai/dsh-group'\n  group: true\n  config:\n    - name: '@deepseek-ai/dsh-tool-web'\n",
})
await assert.rejects(
  () => service.upsert('shape-bad-nested', {
    metadata: {},
    compositionText: "- id: tool-web\n  config:\n    name: nested-only\n",
  }),
  /每条 plugin 行必须包含/,
  'a nested config.name does not satisfy the row name requirement',
)
await assert.rejects(
  () => service.upsert('shape-bad-flow', {
    metadata: {},
    compositionText: "- { id: x, config: { name: nested-only } }\n",
  }),
  /每条 plugin 行必须包含/,
  'a flow-map row whose name is only nested is rejected',
)
await assert.rejects(
  () => service.upsert('shape-bad-second', {
    metadata: {},
    compositionText: "- name: '@deepseek-ai/dsh-tool-web'\n- id: tool-fs\n  disabled: false\n",
  }),
  /每条 plugin 行必须包含/,
  'the second entry is validated too',
)
console.log('scenario 3f OK: composition shape check accepts legal spellings, rejects nested-only name')

// ---------- Scenario 3g: the real shipped compositions still validate -------
// A validator that rejects the harness's own presets would block editing the
// shapes users actually copy. Skipped when the harness package is absent.
const shippedRoot = process.env.DSH_HARNESS_ROOT === undefined
  ? 'D:/npm-global/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets'
  : join(process.env.DSH_HARNESS_ROOT, 'packages/preset/agent-presets/presets')
let checkedShipped = 0
for (const id of ['cordis', 'minimal', 'ptc', 'standard']) {
  const file = join(shippedRoot, id, 'agent.cordis.yml')
  if (!existsSync(file)) continue
  await service.upsert('shape-shipped-' + id, { metadata: {}, compositionText: readFileSync(file, 'utf8') })
  checkedShipped++
}
assert.ok(checkedShipped === 0 || checkedShipped === 4,
  `either all four shipped compositions validate or none are present (got ${checkedShipped})`)
console.log(`scenario 3g OK: shipped compositions accepted (${checkedShipped} checked)`)

// ---------- Scenario 4: delete() removes user dir + refuses shipped -
const delBefore = existsSync(join(userRoot, 'new-preset'))
assert.equal(delBefore, true, 'new-preset exists before delete')
const delRes = await service.delete('new-preset')
assert.equal(delRes.removed, true, 'delete returns removed:true')
assert.equal(existsSync(join(userRoot, 'new-preset')), false, 'directory removed')
const delRes2 = await service.delete('absent-preset')
assert.equal(delRes2.removed, false, 'delete returns removed:false when dir missing')
await assert.rejects(
  () => service.delete('standard'),
  /dsh 默认预设/,
  'delete refuses shipped ids',
)
console.log('scenario 4 OK: delete() removes user dir, refuses shipped')

// ---------- Scenario 5: setDefault() writes config.default in cordis.patch.yml -
// 5a: before setDefault, the patch is empty (no agent-presets row)
const beforeSet = readFileSync(join(tmpRoot, 'cordis.patch.yml'), 'utf8')
assert.equal(beforeSet.trim(), '', 'patch file is empty before setDefault')
const setRes1 = await service.setDefault('my-team')
assert.equal(setRes1.defaultId, 'my-team', 'setDefault returns the new defaultId')
const afterSet = readFileSync(join(tmpRoot, 'cordis.patch.yml'), 'utf8')
assert.ok(/^- id: agent-presets\s*$/m.test(afterSet), 'agent-presets row appended')
assert.ok(/^\s*config:\s*$/m.test(afterSet), 'config block present')
assert.ok(/^\s+default: my-team\s*$/m.test(afterSet), 'config.default: my-team written')

// 5b: readDefault() now picks up "my-team" (also probe via list())
const list2 = await service.list()
assert.equal(list2.defaultId, 'my-team', 'list() defaultId matches setDefault')
const myTeam = list2.presets.find((p) => p.id === 'my-team')
assert.equal(myTeam.isDefault, true, 'my-team is marked isDefault')

// 5c: clearing WITHOUT a settings service is refused. An empty string is not a
// preset id — writing it into the patch would resolve to
// `agent-preset/not-found` for every session that relies on the default — so
// the host refuses and leaves the patch untouched.
const beforeClear = readFileSync(join(tmpRoot, 'cordis.patch.yml'), 'utf8')
await assert.rejects(
  () => service.setDefault(''),
  /清空默认预设需要 settings 服务/,
  'setDefault("") without a settings service is refused',
)
assert.equal(readFileSync(join(tmpRoot, 'cordis.patch.yml'), 'utf8'), beforeClear,
  'a refused clear leaves the patch untouched')

// 5d: setDefault() preserves sibling rows in the same file
writeFileSync(join(tmpRoot, 'cordis.patch.yml'),
  '# header comment\n' +
  '- id: storage-domain\n' +
  "  name: '@deepseek-ai/dsh-storage-domain'\n" +
  '  config:\n' +
  '    backend: json\n' +
  '# sibling row preserved across edits\n' +
  '- id: tool-web\n' +
  "  name: '@deepseek-ai/dsh-tool-web'\n" +
  '  config:\n' +
  '    fetch: true\n',
  'utf8')
await service.setDefault('my-team')
const preserved = readFileSync(join(tmpRoot, 'cordis.patch.yml'), 'utf8')
assert.ok(/^\s+backend: json\s*$/m.test(preserved), 'storage-domain.backend preserved')
assert.ok(/^\s+fetch: true\s*$/m.test(preserved), 'tool-web.fetch preserved')
assert.ok(/# header comment/.test(preserved), 'header comment preserved')
assert.ok(/# sibling row preserved across edits/.test(preserved), 'inline comment preserved')
assert.ok(/^\s+default: my-team\s*$/m.test(preserved), 'new default key written')
// The agent-presets row should now have id + config (matching the
// append-row path when the patch had no prior row). Verify directly via
// a literal-line check rather than reconstructing the split-by-dash.
assert.ok(preserved.split(/\r?\n/).some((line) => /^- id: agent-presets\s*$/.test(line)), 'agent-presets row present after second setDefault')

// 5e: an inline `config: {...}` row is rewritten as a block WITHOUT dropping
// the user's sibling keys — a patch replaces the target's whole `config`, so
// re-emitting only `default:` would silently delete them on the next click.
writeFileSync(join(tmpRoot, 'cordis.patch.yml'),
  '# header comment\n' +
  '- id: agent-presets\n' +
  "  name: '@deepseek-ai/dsh-agent-presets'\n" +
  "  config: { default: 'cordis', order: 5 }\n",
  'utf8')
await service.setDefault('inline-team')
const inlineOut = readFileSync(join(tmpRoot, 'cordis.patch.yml'), 'utf8')
assert.ok(/^\s+config:\s*$/m.test(inlineOut), 'the inline map became a block')
assert.ok(/^\s+default: inline-team\s*$/m.test(inlineOut), 'the new default landed')
assert.ok(/^\s+order: 5\s*$/m.test(inlineOut), 'sibling config key survives the inline→block rewrite')

// ---------- Scenario 6: settings-first default -----------------------------
// dsh-agent-presets resolves `settings.default ?? config.default`, so a
// patch-only write is invisible wherever the settings layer already holds a
// value (the panel's choice bounced straight back on the next reload). With
// the settings service mounted the write must land there.
const mutations = []
const settingsStub = {
  async mutate(ns, ops) { mutations.push({ ns, ops }); return { revision: mutations.length } },
}
const { applyAgentPresetsAdmin: applyWithSettings } = await import('../lib/agent-presets-admin.js')
let settingsService = null
const settingsCtx = {
  baseUrl: 'file://' + tmpRoot + '/',
  get(key) { return key === 'settings' ? settingsStub : undefined },
  effect(cb) { cb.call(settingsCtx); return () => {} },
  provide(_key, svc) { settingsService = svc },
}
writeFileSync(join(tmpRoot, 'cordis.patch.yml'), '# untouched\n', 'utf8')
applyWithSettings(settingsCtx)
const res6 = await settingsService.setDefault('my-team')
assert.equal(res6.layer, 'settings', 'setDefault writes the settings layer when it is mounted')
assert.deepEqual(mutations[0], {
  ns: 'agent-presets',
  ops: [{ op: 'set', path: ['default'], value: 'my-team' }],
}, 'settings mutate carries the single-key set op')
assert.equal(readFileSync(join(tmpRoot, 'cordis.patch.yml'), 'utf8'), '# untouched\n',
  'the patch stays untouched on the settings path')
await settingsService.setDefault('')
assert.deepEqual(mutations[1], {
  ns: 'agent-presets',
  ops: [{ op: 'unset', path: ['default'] }],
}, 'clearing unsets the settings key (falls back to the bundle default)')
console.log('scenario 6 OK: setDefault writes the settings layer first (set / unset ops)')

// ---------- Scenario 7: metadata scalars are escaped, not interpolated -----
// `description: note: fast` was written raw and made preset.yml unparsable, so
// dsh silently dropped the name/description/order. Values must round-trip.
const escapeCheck = await service.upsert('escape-check', {
  compositionText: "- name: '@deepseek-ai/dsh-tool-web'\n",
  metadata: { name: 'Team: Backend', description: 'note: fast', order: 2 },
})
assert.equal(escapeCheck.ok, true, 'upsert accepts metadata containing ": "')
const metaText = readFileSync(join(userRoot, 'escape-check', 'preset.yml'), 'utf8')
assert.ok(metaText.includes('description: "note: fast"'), 'the description is emitted as a quoted scalar')
assert.ok(metaText.includes('name: "Team: Backend"'), 'the name is emitted as a quoted scalar')
const listed7 = await service.list()
const escaped7 = listed7.presets.find((p) => p.id === 'escape-check')
assert.equal(escaped7.name, 'Team: Backend', 'name round-trips through readMetadata')
assert.equal(escaped7.description, 'note: fast', 'description round-trips through readMetadata')
assert.equal(escaped7.order, 2, 'order round-trips')
console.log('scenario 7 OK: preset.yml metadata is escaped and round-trips')

rmSync(tmpRoot, { recursive: true, force: true })
delete process.env.DSH_HOME
console.log('verify-agent-presets-admin OK: all Agent preset administration scenarios passed')
