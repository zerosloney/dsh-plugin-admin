/** commands-hooks — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiCheckbox, UiInput, createElement, downloadTextFile, dshT, messageOf, useEffect, useState } from './context.js'
import { unwrap } from './subagents.js'

/* ========================================================================== */
/*          Command & Hook Admin (merged from dsh-command-hook-admin)         */
/* ========================================================================== */

/**
 * dsh-command-hook-admin browser half: the 「命令与钩子」 settings section
 * with two segmented tabs, styled with the same --dsw-* design tokens and
 * visual recipes as the other admin sections (toolbar cards, blue primary
 * buttons, tag badges, card rows).
 *
 * - 命令: file-backed slash commands (`~/.dsh/commands/*.json`), registered
 *   live by the host half — 新建 / 编辑 / 启停 / 删除 apply immediately.
 * - 钩子: the Claude-Code-format hooks file the stock bridge reads once at
 * apply. 启停 moves entries between hooks.json and a sidecar so the bridge
 * never fires disabled hooks; every write restarts the mounted bridge
 * through Fiber.update (the loader's own restart path) and reports the
 * true outcome. The stock bridge package itself can be installed/mounted
 * (or uninstalled) right from this panel — the host solidified the bridge
 * lifecycle that used to require hand-editing the profile. The Codex-format
 * sibling bridge (`@deepseek-ai/dsh-hooks-codex`, its own `hooks.codex.json`)
 * is installed/removed from the same tab instead of a settings page of its
 * own: both are one `listHooks()` payload with the same install/remove shape,
 * so a second page only duplicated the affordance.
 */

/** The events the stock Claude-Code bridge supports, with matcher notes. */
export var CH_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop']

/** @type {Record<string, boolean>} */
export var CH_MATCHERLESS = { UserPromptSubmit: true, Stop: true }

/**
 * Describe one hook reload outcome for the status banner. The host restarts
 * the mounted bridge through Fiber.update; "已生效" is only ever claimed when
 * the restart actually completed.
 * @param {Record<string, any>} reload - the host's reload report.
 * @returns display text, or null when there is nothing to say.
 */
export function chReloadNote(reload) {
  if (reload === undefined || reload === null) return null
  if (reload.reloaded) return dshT('✓ 已重启 hooks 桥，配置已生效。')
  if (reload.mounted) return dshT('⚠ hooks 桥热重启失败：') + messageOf(reload.error) + dshT('（配置已写入，重启 dsh 后生效）')
  return dshT('已写入 hooks.json。当前未挂载 hooks 桥（hooks-claude-code），挂载后生效。')
}

/**
 * Notice tone for a status note: ✓ prefixes read as success (green), ⚠ as a
 * warning (amber), everything else stays informational (blue).
 * @param {string} text - the note text.
 * @returns the notice class name.
 */
export function chNoticeClass(text) {
  if (typeof text === 'string' && text.indexOf('✓') !== -1) return 'notice ok'
  if (typeof text === 'string' && text.indexOf('⚠') !== -1) return 'notice warn'
  return 'notice'
}

/**
 * One labeled form field.
 * @param {string} label - label text.
 * @param {any} input - the input element (a createElement result — the React seam returns any).
 * @param {string} [hint] - optional hint line under the control.
 * @returns the field element.
 */
export function chField(label, input, hint) {
  return createElement('div', { className: 'field', key: label },
    createElement('label', null, label),
    input,
    hint ? createElement('div', { className: 'hint' }, hint) : null,
  )
}

/**
 * A small switch button with the toggle role.
 * @param {boolean} checked - current state.
 * @param {(() => void) | null} onChange - click handler.
 * @param {string} label - accessible name.
 * @returns the button element.
 */
export function chToggle(checked, onChange, label) {
  return createElement('button', {
    type: 'button',
    role: 'switch',
    className: 'toggle',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    disabled: !onChange,
    onClick: onChange || undefined,
  })
}

/**
 * One command list row: /name + description, live status, toggle, edit, delete.
 * @param {Record<string, any>} props - { command, busy, onToggle, onEdit, onDelete, confirming, onConfirmDelete, onCancelDelete }.
 * @returns the row element.
 */
export function ChCommandRow(props) {
  var c = props.command
  var badges = []
  if (!c.enabled) badges.push(createElement('span', { className: 'tag', key: 'off' }, dshT('已停用')))
  if (c.conflict) badges.push(createElement('span', { className: 'tag err', key: 'conflict', title: c.conflict }, dshT('注册失败')))
  if (c.fileError) badges.push(createElement('span', { className: 'tag err', key: 'file', title: c.fileError }, dshT('文件错误')))
  var actions = props.confirming
    ? [
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'yes', disabled: props.busy, onClick: props.onConfirmDelete }, dshT('确认删除')),
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'no', disabled: props.busy, onClick: props.onCancelDelete }, dshT('取消')),
    ]
    : [
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'edit', disabled: props.busy, onClick: props.onEdit }, dshT('编辑')),
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'del', disabled: props.busy, 'aria-label': dshT('删除命令 /') + c.name, onClick: props.onDelete }, dshT('删除')),
    ]
  return createElement('div', { className: 'row' + (c.enabled ? '' : ' off') },
    createElement('div', { className: 'main' },
      createElement('div', { className: 'name-row' },
        createElement('span', { className: 'name' }, '/' + c.name),
        badges,
      ),
      createElement('div', { className: 'desc' }, c.description || ''),
      c.inputHint ? createElement('div', { className: 'meta' }, dshT('参数提示：') + c.inputHint) : null,
    ),
    createElement('div', { className: 'actions' }, actions),
    chToggle(c.enabled, props.busy ? null : props.onToggle, (c.enabled ? dshT('停用') : dshT('启用')) + dshT('命令 /') + c.name),
  )
}

/**
 * The command create/edit form.
 * @param {Record<string, any>} props - { initial, busy, error, onSave, onCancel }.
 * @returns the form element.
 */
export function ChCommandForm(props) {
  var initial = props.initial
  var originalName = initial.originalName !== undefined ? initial.originalName : null
  var nameHooks = useState(initial.name || '')
  var name = nameHooks[0]
  var setName = nameHooks[1]
  var descHooks = useState(initial.description || '')
  var description = descHooks[0]
  var setDescription = descHooks[1]
  var hintHooks = useState(initial.inputHint || '')
  var inputHint = hintHooks[0]
  var setInputHint = hintHooks[1]
  var promptHooks = useState(initial.prompt || '')
  var prompt = promptHooks[0]
  var setPrompt = promptHooks[1]
  var imagesHooks = useState(initial.images === true)
  var images = imagesHooks[0]
  var setImages = imagesHooks[1]
  var enabledHooks = useState(initial.enabled !== false)
  var enabled = enabledHooks[0]
  var setEnabled = enabledHooks[1]

  return createElement('form', { className: 'form', onSubmit: function (/** @type {{ preventDefault: () => void }} */ e) { e.preventDefault() } },
    createElement('div', { className: 'grid2' },
      chField(dshT('名称'), createElement(UiInput, {
        type: 'text',  value: name, placeholder: 'my-command',
        onChange: function (/** @type {{ target: { value: string } }} */ e) { setName(e.target.value) },
      }), dshT('小写字母开头，可含数字、-、_。会话中输入 /名称 调用。')),
      chField(dshT('参数提示（可选）'), createElement(UiInput, {
        type: 'text',  value: inputHint, placeholder: dshT('例如 <file-path>'),
        onChange: function (/** @type {{ target: { value: string } }} */ e) { setInputHint(e.target.value) },
      })),
    ),
    chField(dshT('描述'), createElement(UiInput, {
      type: 'text',  value: description, placeholder: dshT('这个命令做什么'),
      onChange: function (/** @type {{ target: { value: string } }} */ e) { setDescription(e.target.value) },
    })),
    chField(dshT('提示词'), createElement('textarea', {
      className: 'input', value: prompt, placeholder: dshT('# 角色\n\n你要…\n\n当前请求：$ARGUMENTS'),
      onChange: function (/** @type {{ target: { value: string } }} */ e) { setPrompt(e.target.value) },
    }), dshT('发送给模型的提示词。$ARGUMENTS 会替换为用户输入；未使用占位符时输入会追加在末尾。')),
    createElement('div', { className: 'checks' },
      createElement(UiCheckbox, {
        checked: enabled,
        onChange: function (/** @type {boolean} */ next) { setEnabled(next) },
        label: dshT('启用'),
        className: 'check',
      }),
      createElement(UiCheckbox, {
        checked: images,
        onChange: function (/** @type {boolean} */ next) { setImages(next) },
        label: dshT('接受图片附件'),
        className: 'check',
      }),
    ),
    props.error ? createElement('div', { className: 'error-text' }, props.error) : null,
    createElement('div', { className: 'form-actions' },
      createElement(UiButton, { variant: 'outline', size: 'sm', disabled: props.busy, onClick: props.onCancel }, dshT('取消')),
      createElement(UiButton, {
        variant: 'primary', disabled: props.busy,
        onClick: function () {
          props.onSave({
            originalName: originalName,
            name: name,
            description: description,
            inputHint: inputHint,
            prompt: prompt,
            images: images,
            enabled: enabled,
          })
        },
      }, dshT('保存')),
    ),
  )
}

/**
 * The 命令 tab: list + create/edit form + inline delete confirm.
 * @param {{ call: (method: string, args: Record<string, any>) => Promise<any> }} props - { call }.
 * @returns the tab content element.
 */
export function ChCommandsTab(props) {
  var call = props.call
  var listHooks = useState(null)
  var list = listHooks[0]
  var setList = listHooks[1]
  var busyHooks = useState(false)
  var busy = busyHooks[0]
  var setBusy = busyHooks[1]
  var errorHooks = useState('')
  var error = errorHooks[0]
  var setError = errorHooks[1]
  var noteHooks = useState('')
  var note = noteHooks[0]
  var setNote = noteHooks[1]
  var editingHooks = useState(null)
  var editing = editingHooks[0]
  var setEditing = editingHooks[1]
  var confirmHooks = useState(null)
  var confirming = confirmHooks[0]
  var setConfirming = confirmHooks[1]

  function load() {
    setBusy(true)
    call('commandHookAdmin/listCommands', {})
      .then(function (result) {
        setList(unwrap(result))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }
  useEffect(load, [])

  /**
   * Run one list mutation: unwrap the RPC result into the list, refresh busy/error.
   * @param {Promise<any>} promise - the RPC promise.
   * @param {(value: any) => void} [after] - optional hook run with the unwrapped value.
   */
  function act(promise, after) {
    setBusy(true)
    setError('')
    promise
      .then(function (result) {
        var value = unwrap(result)
        if (after) after(value)
        setList(value)
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }

  var commands = (list && list.commands) || []
  var commandsDir = (list && list.commandsDir) || ''

  // Import/export (the awesome-claude-code sharing loop): export downloads
  // every command as one JSON file; import reads a pasted JSON (array or a
  // single command) and saves each entry — same-name commands are skipped so
  // a shared pack never silently overwrites local edits.
  var importState = useState(null) // { text } | null
  var importing = importState[0]
  var setImporting = importState[1]

  function exportCommands() {
    try {
      var payload = commands.map(function (/** @type {Record<string, any>} */ c) {
        return { name: c.name, description: c.description, inputHint: c.inputHint, prompt: c.prompt, enabled: c.enabled !== false }
      })
      downloadTextFile('dsh-commands-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload, null, 2))
      setNote(dshT('已导出 ') + payload.length + dshT(' 条命令'))
    } catch (e) {
      setNote(dshT('导出失败：') + messageOf(e))
    }
  }

  function runImport(/** @type {string} */ raw) {
    var entries
    try {
      var parsed = JSON.parse(raw)
      entries = Array.isArray(parsed) ? parsed : [parsed]
    } catch (e) {
      setNote(dshT('导入失败：JSON 解析错误 — ') + messageOf(e))
      return
    }
    /** @type {Record<string, boolean>} */
    var byName = {}
    for (var i = 0; i < commands.length; i++) byName[commands[i].name] = true
    var saved = 0
    var skipped = 0
    var failed = 0
    var queue = entries.slice()
    var next = function () {
      if (queue.length === 0) {
        setBusy(false)
        setImporting(null)
        setNote(dshT('导入完成：') + saved + dshT(' 条新增') + (skipped > 0 ? dshT('，') + skipped + dshT(' 条同名跳过') : '') + (failed > 0 ? dshT('，') + failed + dshT(' 条失败') : ''))
        load()
        return
      }
      var entry = queue.shift()
      var name = entry && typeof entry.name === 'string' ? entry.name.trim() : ''
      if (name === '' || typeof entry.prompt !== 'string' || entry.prompt === '') {
        failed++
        next()
        return
      }
      if (byName[name]) {
        skipped++
        next()
        return
      }
      byName[name] = true
      call('commandHookAdmin/saveCommand', {
        entry: { name: name, description: typeof entry.description === 'string' ? entry.description : '', inputHint: typeof entry.inputHint === 'string' ? entry.inputHint : '', prompt: entry.prompt, images: [], enabled: entry.enabled !== false },
      }).then(function (result) {
        if (result && result.ok) saved++
        else failed++
        next()
      }, function () {
        failed++
        next()
      })
    }
    setBusy(true)
    next()
  }

  // Same column rhythm as the hooks tab: toolbar / hint / panels would
  // otherwise stack with zero gap inside this bare wrapper.
  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, dshT('提示词命令')),
      createElement('span', { className: 'count' }, String(commands.length)),
      createElement('span', { className: 'spacer' }),
      createElement(UiButton, { variant: 'outline', disabled: busy, onClick: load, 'aria-label': dshT('刷新命令列表') }, dshT('刷新')),
      createElement(UiButton, { variant: 'outline', disabled: busy || commands.length === 0, title: dshT('把全部命令下载为一个 JSON 文件（可分享、可再导入）'), onClick: exportCommands }, dshT('⬇ 导出')),
      createElement(UiButton, { variant: 'outline', disabled: busy || editing !== null, onClick: function () { setImporting(importing === null ? { text: '' } : null) } }, dshT('⬆ 导入')),
      createElement(UiButton, { variant: 'outline', disabled: busy || editing !== null, onClick: function () { setEditing({}) } }, dshT('＋新建命令')),
    ),
    createElement('div', { className: 'hint' }, dshT('存储于 '), createElement('span', { className: 'path-chip' }, commandsDir), dshT(' · 保存后立即生效（含在其他窗口手动改文件）')),
    importing !== null
      ? createElement('div', { className: 'card', key: 'import-panel' },
        createElement('div', { className: 'card-header' },
          createElement('span', { className: 'card-title-text' }, dshT('⬆ 导入命令（JSON 数组或单条）')),
          createElement('div', { className: 'card-actions' },
            createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { setImporting(null) } }, dshT('关闭')))),
        createElement('textarea', {
          className: 'input', rows: 8,
          placeholder: dshT('[{ "name": "review", "description": "代码审查", "prompt": "请审查 $ARGUMENTS" }]'),
          value: importing.text,
          onChange: function (/** @type {{ target: { value: string } }} */ e) { setImporting({ text: e.target.value }) },
        }),
        createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' } },
          createElement(UiButton, {
            variant: 'primary', disabled: busy || importing.text.trim() === '',
            onClick: function () { runImport(importing.text) },
          }, dshT('导入（同名跳过）')),
          createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, dshT('兼容「⬇ 导出」的文件内容；同名命令一律跳过，绝不静默覆盖本地修改。'))))
      : null,
    note ? createElement('div', { className: chNoticeClass(note) }, note) : null,
    error ? createElement('div', { className: 'error-text' }, error) : null,
    editing !== null
      ? createElement(ChCommandForm, {
        initial: editing,
        busy: busy,
        error: '',
        onCancel: function () { setEditing(null) },
        onSave: function (/** @type {Record<string, any>} */ entry) {
          act(call('commandHookAdmin/saveCommand', { entry: entry }), function () {
            setEditing(null)
            setNote(dshT('命令 /') + entry.name + dshT(' 已保存并注册。'))
          })
        },
      })
      : null,
    commands.length === 0
      ? createElement('div', { className: 'empty' }, dshT('还没有命令。点击「＋新建命令」创建一个，会话里输入 /名称 即可把提示词发给模型。'))
      : createElement('div', { className: 'list' }, commands.map(function (/** @type {Record<string, any>} */ c) {
        return createElement(ChCommandRow, {
          key: c.name,
          command: c,
          busy: busy || editing !== null,
          confirming: confirming === c.name,
          onCancelDelete: function () { setConfirming(null) },
          onConfirmDelete: function () {
            act(call('commandHookAdmin/deleteCommand', { name: c.name }), function () {
              setConfirming(null)
              setNote(dshT('命令 /') + c.name + dshT(' 已删除。'))
            })
          },
          onDelete: function () { setConfirming(c.name) },
          onEdit: function () { setEditing(Object.assign({ originalName: c.name }, c)) },
          onToggle: function () {
            act(call('commandHookAdmin/saveCommand', { entry: Object.assign({}, c, { enabled: !c.enabled }) }), function () {
              setNote(dshT('命令 /') + c.name + (c.enabled ? dshT(' 已停用。') : dshT(' 已启用。')))
            })
          },
        })
      })),
  )
}

/**
 * One hook list row: event + matcher + command, toggle, edit, delete.
 * @param {Record<string, any>} props - { hook, busy, onToggle, onEdit, onDelete, confirming, onConfirmDelete, onCancelDelete }.
 * @returns the row element.
 */
export function ChHookRow(props) {
  var h = props.hook
  var actions = props.confirming
    ? [
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'yes', disabled: props.busy, onClick: props.onConfirmDelete }, dshT('确认删除')),
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'no', disabled: props.busy, onClick: props.onCancelDelete }, dshT('取消')),
    ]
    : [
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'edit', disabled: props.busy, onClick: props.onEdit }, dshT('编辑')),
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'del', disabled: props.busy, 'aria-label': dshT('删除钩子 ') + h.event, onClick: props.onDelete }, dshT('删除')),
    ]
  return createElement('div', { className: 'row' + (h.enabled ? '' : ' off') },
    createElement('span', { className: 'tag event' }, h.event),
    createElement('div', { className: 'main' },
      createElement('div', { className: 'meta' },
        (h.matcher === '' ? dshT('匹配全部') : dshT('匹配 ') + h.matcher)
        + (h.timeoutSec !== null && h.timeoutSec !== undefined ? dshT(' · 超时 ') + h.timeoutSec + 's' : ''),
      ),
      createElement('div', { className: 'desc mono' }, h.command),
    ),
    createElement('div', { className: 'actions' }, actions),
    chToggle(h.enabled, props.busy ? null : props.onToggle, (h.enabled ? dshT('停用') : dshT('启用')) + dshT('钩子 ') + h.event),
  )
}

/**
 * The hook create/edit form.
 * @param {Record<string, any>} props - { initial, busy, error, onSave, onCancel }.
 * @returns the form element.
 */
export function ChHookForm(props) {
  var initial = props.initial
  var id = initial.id !== undefined ? initial.id : null
  var eventHooks = useState(initial.event || 'PreToolUse')
  var event = eventHooks[0]
  var setEvent = eventHooks[1]
  var matcherHooks = useState(initial.matcher || '')
  var matcher = matcherHooks[0]
  var setMatcher = matcherHooks[1]
  var commandHooks = useState(initial.command || '')
  var command = commandHooks[0]
  var setCommand = commandHooks[1]
  var timeoutHooks = useState(initial.timeoutSec !== null && initial.timeoutSec !== undefined ? String(initial.timeoutSec) : '600')
  var timeoutSec = timeoutHooks[0]
  var setTimeoutSec = timeoutHooks[1]
  var enabledHooks = useState(initial.enabled !== false)
  var enabled = enabledHooks[0]
  var setEnabled = enabledHooks[1]

  return createElement('form', { className: 'form', onSubmit: function (/** @type {{ preventDefault: () => void }} */ e) { e.preventDefault() } },
    createElement('div', { className: 'grid2' },
      chField(dshT('事件'), createElement('select', { className: 'input', value: event, onChange: function (/** @type {{ target: { value: string } }} */ e) { setEvent(e.target.value) } },
        CH_HOOK_EVENTS.map(function (name) {
          return createElement('option', { key: name, value: name }, name)
        }),
      )),
      chField(dshT('超时（秒）'), createElement(UiInput, {
        type: 'number', min: 1,  value: timeoutSec,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { setTimeoutSec(e.target.value) },
      }), dshT('留空或 600 = 桥默认（10 分钟）。')),
    ),
    chField(dshT('匹配器'), createElement(UiInput, {
      type: 'text',  value: matcher, placeholder: CH_MATCHERLESS[event] ? dshT('（此事件忽略匹配器）') : dshT('write,edit 或正则；留空匹配全部'),
      disabled: CH_MATCHERLESS[event] === true,
      onChange: function (/** @type {{ target: { value: string } }} */ e) { setMatcher(e.target.value) },
    }), CH_MATCHERLESS[event]
      ? dshT('UserPromptSubmit / Stop 没有匹配对象，桥会丢弃匹配器。')
      : dshT('仅 PreToolUse / PostToolUse 有匹配对象（工具名，小写，如 write / edit，大小写敏感）。')),
    chField(dshT('命令'), createElement(UiInput, {
      type: 'text', className: 'mono', value: command, placeholder: 'node C:/path/to/hook.js',
      onChange: function (/** @type {{ target: { value: string } }} */ e) { setCommand(e.target.value) },
    }), dshT('钩子载荷以 JSON 从 stdin 传入；退出码 2 或输出 deny 阻止动作。')),
    createElement(UiCheckbox, {
      checked: enabled,
      onChange: function (/** @type {boolean} */ next) { setEnabled(next) },
      label: dshT('启用'),
      className: 'check',
    }),
    props.error ? createElement('div', { className: 'error-text' }, props.error) : null,
    createElement('div', { className: 'form-actions' },
      createElement(UiButton, { variant: 'outline', size: 'sm', disabled: props.busy, onClick: props.onCancel }, dshT('取消')),
      createElement(UiButton, {
        variant: 'primary', disabled: props.busy,
        onClick: function () {
          props.onSave({
            ...(id !== null ? { id: id } : {}),
            event: event,
            matcher: matcher,
            command: command,
            timeoutSec: timeoutSec === '' ? null : timeoutSec,
            enabled: enabled,
          })
        },
      }, dshT('保存')),
    ),
  )
}

/**
 * The 钩子 tab: bridge status banner (with one-click bridge install/uninstall)
 * + list + create/edit form.
 * @param {{ call: (method: string, args: Record<string, any>) => Promise<any> }} props - { call }.
 * @returns the tab content element.
 */
export function ChHooksTab(props) {
  var call = props.call
  var dataHooks = useState(null)
  var data = dataHooks[0]
  var setData = dataHooks[1]
  var busyHooks = useState(false)
  var busy = busyHooks[0]
  var setBusy = busyHooks[1]
  var errorHooks = useState('')
  var error = errorHooks[0]
  var setError = errorHooks[1]
  var noteHooks = useState('')
  var note = noteHooks[0]
  var setNote = noteHooks[1]
  var editingHooks = useState(null)
  var editing = editingHooks[0]
  var setEditing = editingHooks[1]
  var confirmHooks = useState(null)
  var confirming = confirmHooks[0]
  var setConfirming = confirmHooks[1]

  function load() {
    setBusy(true)
    call('commandHookAdmin/listHooks', {})
      .then(function (result) {
        setData(unwrap(result))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }
  useEffect(load, [])

  /**
   * Run one administrative write and refresh, deriving the status note from the reload report.
   * @param {Promise<any>} promise - the RPC promise.
   * @param {(value: any) => string | void} [after] - optional hook run with the unwrapped value; a returned string overrides the default note.
   */
  function act(promise, after) {
    setBusy(true)
    setError('')
    promise
      .then(function (result) {
        var value = unwrap(result)
        // `after` may return a note override — the default note derives from
        // the reload report, which bridge install/remove payloads don't carry.
        var noteOverride = after ? after(value) : undefined
        setData(value)
        var text = chReloadNote(value && value.reload)
        setNote(noteOverride !== undefined && noteOverride !== null
          ? noteOverride
          : (text !== null ? text : ''))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }

  var hooks = (data && data.hooks) || []
  var bridgeMounted = data !== null && data.bridgeMounted === true
  var bridgeInstalled = data !== null && data.bridgeInstalled === true
  var bridgeRowPresent = data !== null && data.bridgeRowPresent === true
  var bridgePackage = (data && data.bridgePackage) || '@deepseek-ai/dsh-hooks-claude-code'
  var bridgeMissing = !bridgeInstalled || !bridgeRowPresent
  // The bridge reads ONLY the row's own configPath: a row pointing at another
  // file silently no-ops every save made here (the reload succeeds against
  // the OLD file), so the panel says so instead of claiming 已生效.
  var bridgeConfigPath = data !== null && typeof data.bridgeConfigPath === 'string' ? data.bridgeConfigPath : null
  var bridgePathMismatch = bridgeRowPresent && data !== null && data.configPathMatches === false
  var bridgeText
  if (bridgePathMismatch) {
    bridgeText = dshT('⚠️ 桥挂载行的 configPath 指向 ')
      + (bridgeConfigPath === null ? dshT('（未声明）') : bridgeConfigPath)
      + dshT('，与本面板管理的 ') + ((data && data.hooksPath) || 'hooks.json') + dshT(' 不一致——在此保存的钩子不会生效。点「⚡ 修复桥指向」把它改到本面板文件，或手工编辑 profile 的 cordis.patch.yml。')
  } else if (bridgeMounted) {
    bridgeText = dshT('hooks 桥（hooks-claude-code）已挂载：保存 / 启停 / 删除后自动重启桥使配置生效（重启期间钩子有约一秒的空窗）。')
  } else if (bridgeInstalled && bridgeRowPresent) {
    bridgeText = dshT('hooks 桥已安装并写入 profile（configPath 指向 ') + ((data && data.hooksPath) || 'hooks.json') + dshT('）：重启 dsh 后挂载生效。')
  } else {
    bridgeText = dshT('当前未安装 hooks 桥（') + bridgePackage + dshT('）：配置会写入 ') + ((data && data.hooksPath) || 'hooks.json') + dshT('，安装并挂载后才会真正执行。')
  }

  function runBridgeInstall() {
    act(call('commandHookAdmin/bridgeInstall', {}), function (value) {
      return value && value.bridgeMounted
        ? dshT('hooks 桥已就绪。')
        : dshT('hooks 桥已安装并写入 profile，重启 dsh 后生效。')
    })
  }

 function runBridgeRemove() {
 act(call('commandHookAdmin/bridgeRemove', {}), function () {
 return dshT('hooks 桥已卸载：patch 行与依赖包均已移除（重启 dsh 后完全生效）。')
 })
 }

 // The Codex-format sibling bridge is managed right here too: same payload
 // (`listHooks` reports both), same install/remove shape, distinct package
 // and hooks file. It has no standalone settings page — one tab owns every
 // hooks bridge instead of two pages owning one each.
 var codexInstalled = data !== null && data.codexBridgeInstalled === true
 var codexRowPresent = data !== null && data.codexBridgeRowPresent === true
 var codexMounted = data !== null && data.codexBridgeMounted === true
 var codexPackage = (data && data.codexBridgePackage) || '@deepseek-ai/dsh-hooks-codex'
 var codexHooksPath = (data && data.codexHooksPath) || 'hooks.codex.json'
 var codexMissing = !codexInstalled || !codexRowPresent
 var codexText
 if (codexMounted) {
 codexText = dshT('Codex 钩子桥（hooks-codex）已挂载：消费 ') + codexHooksPath + dshT(' 里的 Codex 格式钩子（5 个钩点：SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop），与上面的 Claude-Code 格式互不影响。本页只做安装 / 卸载 —— 钩子内容手工编辑该文件。')
 } else if (codexInstalled && codexRowPresent) {
 codexText = dshT('Codex 钩子桥已安装并写入 profile（钩子文件 ') + codexHooksPath + dshT('）：重启 dsh 后挂载生效。')
 } else {
 codexText = dshT('当前未安装 Codex 钩子桥（') + codexPackage + dshT('）：Codex 格式钩子写入 ') + codexHooksPath + dshT('，安装并挂载后才会执行。')
 }

 /**
 * The Codex verbs answer with a sparse payload (no `listHooks` spread), so
 * this path re-reads through load() instead of act(): setData() on the
 * sparse value would blank the hook list and both bridge banners.
 * @param {string} verb - 'codexBridgeInstall' or 'codexBridgeRemove'.
 */
 function runCodexBridge(verb) {
 setBusy(true)
 setError('')
 setConfirming(null)
 call('commandHookAdmin/' + verb, {}).then(function (result) {
 var value = unwrap(result)
 if (verb === 'codexBridgeInstall') {
 var path = value && typeof value.codexHooksPath === 'string' && value.codexHooksPath !== ''
 ? value.codexHooksPath
 : codexHooksPath
 setNote(dshT('Codex 钩子桥已安装并写入 profile（钩子文件 ') + path + dshT('），重启 dsh 后挂载生效。'))
 } else {
 setNote(dshT('Codex 钩子桥已卸载：patch 行与依赖包均已移除（重启 dsh 后完全生效）。'))
 }
 load()
 }, function (e) {
 setError((verb === 'codexBridgeInstall' ? dshT('安装失败：') : dshT('卸载失败：')) + messageOf(e))
 setBusy(false)
 })
 }

  // Column rhythm for the tab body: toolbar, notices, notes, forms and the
  // list would otherwise stack with zero gap inside this bare wrapper.
  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, dshT('钩子')),
      createElement('span', { className: 'count' }, String(hooks.length)),
      createElement('span', { className: 'spacer' }),
      createElement(UiButton, { variant: 'outline', disabled: busy, onClick: load, 'aria-label': dshT('刷新钩子列表') }, dshT('刷新')),
      createElement(UiButton, { variant: 'outline', disabled: busy || editing !== null, onClick: function () { setEditing({}) } }, dshT('＋新建钩子')),
    ),
    createElement('div', {
      className: 'notice' + (bridgeMounted && !bridgePathMismatch ? '' : ' warn'),
    },
      createElement('span', { className: 'notice-text' }, bridgeText),
      (bridgeMissing || bridgePathMismatch)
        ? createElement(UiButton, {
          variant: 'outline',
          size: 'sm', disabled: busy || editing !== null,
          onClick: runBridgeInstall,
        }, busy ? dshT('安装中…') : (bridgePathMismatch ? dshT('⚡ 修复桥指向') : dshT('⚡ 安装并挂载 hooks 桥')))
        : null,
      (bridgeInstalled || bridgeRowPresent) && confirming === '__bridge__'
        ? createElement('span', { className: 'notice-actions', key: 'confirm' }, [
          createElement(UiButton, {
            variant: 'outline',
            size: 'sm',
            className: 'danger', key: 'yes', disabled: busy,
            onClick: runBridgeRemove,
          }, dshT('确认卸载')),
          createElement(UiButton, {
            variant: 'outline',
            size: 'sm', key: 'no', disabled: busy,
            onClick: function () { setConfirming(null) },
          }, dshT('取消')),
        ])
        : ((bridgeInstalled || bridgeRowPresent)
          ? createElement(UiButton, {
            variant: 'outline',
            size: 'sm',
            className: 'danger', disabled: busy || editing !== null,
            'aria-label': dshT('卸载 hooks 桥'),
            onClick: function () { setConfirming('__bridge__') },
          }, dshT('卸载桥'))
          : null),
    ),
    createElement('div', {
      className: 'notice' + (codexMounted ? '' : ' warn'),
      key: 'codex-bridge',
    },
      createElement('span', { className: 'notice-text' }, codexText),
      codexMissing
        ? createElement(UiButton, {
          variant: 'outline',
          size: 'sm', disabled: busy || editing !== null,
          onClick: function () { runCodexBridge('codexBridgeInstall') },
        }, busy ? dshT('安装中…') : dshT('📥 安装 Codex 钩子桥'))
        : (confirming === '__codex__'
          ? createElement('span', { className: 'notice-actions', key: 'codex-confirm' }, [
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm',
              className: 'danger', key: 'yes', disabled: busy,
              onClick: function () { runCodexBridge('codexBridgeRemove') },
            }, dshT('确认卸载')),
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm', key: 'no', disabled: busy,
              onClick: function () { setConfirming(null) },
            }, dshT('取消')),
          ])
          : createElement(UiButton, {
            variant: 'outline',
            size: 'sm',
            className: 'danger', disabled: busy || editing !== null,
            'aria-label': dshT('卸载 Codex 钩子桥'),
            onClick: function () { setConfirming('__codex__') },
          }, dshT('卸载 Codex 桥'))),
    ),
    error ? createElement('div', { className: 'error-text' }, error) : null,
    note !== '' && error === '' ? createElement('div', { className: chNoticeClass(note) }, note) : null,
    data && data.fileError ? createElement('div', { className: 'error-text' }, data.fileError) : null,
    editing !== null
      ? createElement(ChHookForm, {
        initial: editing,
        busy: busy,
        error: '',
        onCancel: function () { setEditing(null) },
        onSave: function (/** @type {Record<string, any>} */ entry) {
          act(call('commandHookAdmin/saveHook', { entry: entry }), function () { setEditing(null) })
        },
      })
      : null,
    hooks.length === 0
      ? createElement('div', { className: 'empty' }, dshT('还没有钩子。钩子会在特定事件（工具调用前后、提交提示词、会话开始/结束等）自动执行命令。'))
      : createElement('div', { className: 'list' }, hooks.map(function (/** @type {Record<string, any>} */ h) {
        return createElement(ChHookRow, {
          key: h.id,
          hook: h,
          busy: busy || editing !== null,
          confirming: confirming === h.id,
          onCancelDelete: function () { setConfirming(null) },
          onConfirmDelete: function () {
            act(call('commandHookAdmin/deleteHook', { id: h.id }), function () { setConfirming(null) })
          },
          onDelete: function () { setConfirming(h.id) },
          onEdit: function () { setEditing(h) },
          onToggle: function () {
            act(call('commandHookAdmin/setHookEnabled', { id: h.id, enabled: !h.enabled }))
          },
        })
      })),
  )
}

/**
 * The two 内置插件 tabs that used to be the standalone 「命令与钩子」 settings
 * section (v1.24.0 split): 「命令」 rides ChCommandsTab and 「钩子」 rides
 * ChHooksTab — each now a plugins-page tab of its own, no segmented chrome of
 * its own. The 项目 `.agents` read-only view was retired with the split
 * (sessionAdmin/list drives the session picker it needed).
 * @param {{ call: (method: string, args: Record<string, any>) => Promise<any> }} props - renderer-bound props; `call` arrives from the slot inject face.
 * @returns the section element.
 */
export function ChCommandsSection(props) {
  return createElement('div', { 'data-cha-section': '' },
    createElement(ChCommandsTab, { call: props.call, key: 'commands' })
  )
}

export function ChHooksSection(/** @type {{ call: (method: string, args: Record<string, any>) => Promise<any> }} */ props) {
  return createElement('div', { 'data-cha-section': '' },
    createElement(ChHooksTab, { call: props.call, key: 'hooks' })
  )
}
