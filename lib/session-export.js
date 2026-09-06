/**
 * Human-readable Markdown transcript rendering for dsh session logs.
 *
 * The stock `dsh-session-log-export` bundle ships a ZIP of the raw session
 * tree — an archival format. This module renders the OTHER thing the
 * community keeps asking for (Save My Chatbot, ai-chat-md-export and their
 * kin exist purely for this): a readable, shareable transcript — user and
 * assistant prose with one-line tool-call traces, ready for docs, issues,
 * and paste-into-another-AI workflows.
 *
 * Pure functions only: the host service reads the events (live memory or the
 * persistence replay) and hands them over.
 */

/** Cap one embedded JSON arguments blob so a huge write/edit stays one line. */
const MAX_TOOL_ARGS_CHARS = 160

/** Cap one rendered text section — pathological sessions still export. */
const MAX_SECTION_CHARS = 100_000

/**
 * Flatten one message's content blocks into transcript text: text blocks
 * verbatim, image blocks as a placeholder line, tool-call blocks as a quoted
 * one-liner. Reasoning stays out — the transcript is the visible work.
 * @param blocks - ContentBlock-like array (type-tagged plain objects).
 * @returns { text: string, toolCalls: string[] } rendered prose and tool lines.
 */
function renderBlocks(blocks) {
  const prose = []
  const toolCalls = []
  if (!Array.isArray(blocks)) return { text: '', toolCalls }
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      prose.push(block.text)
    } else if (block.type === 'image') {
      prose.push('[图片]')
    } else if (block.type === 'tool-call' && typeof block.name === 'string' && block.name !== '') {
      let args = ''
      if (typeof block.arguments === 'string' && block.arguments !== '') {
        args = block.arguments.length > MAX_TOOL_ARGS_CHARS
          ? block.arguments.slice(0, MAX_TOOL_ARGS_CHARS) + '…'
          : block.arguments
      }
      toolCalls.push('`' + block.name + '`' + (args === '' ? '' : ' — ' + args.replace(/\s+/g, ' ')))
    }
  }
  return { text: prose.join('\n\n'), toolCalls }
}

/**
 * Fold a session's event log into a Markdown transcript. Sections appear in
 * log order; consecutive sections are separated by rules. Unknown event
 * types are skipped, so the renderer tolerates future log vocabularies.
 * @param header - { id, title, cwd, createdAt } (any field may be missing).
 * @param events - session events (live in-memory or replayed from disk).
 * @returns { markdown: string, messages: number, toolCalls: number }.
 */
export function renderSessionMarkdown(header, events) {
  const h = header && typeof header === 'object' ? header : {}
  const list = Array.isArray(events) ? events : []
  const title = typeof h.title === 'string' && h.title.trim() !== '' ? h.title.trim() : '未命名会话'
  const meta = []
  if (typeof h.id === 'string' && h.id !== '') meta.push('- Session: `' + h.id + '`')
  if (typeof h.cwd === 'string' && h.cwd !== '') meta.push('- 工作目录: `' + h.cwd + '`')
  if (typeof h.createdAt === 'number' && Number.isFinite(h.createdAt)) {
    meta.push('- 创建: ' + new Date(h.createdAt).toISOString())
  }
  meta.push('- 导出: ' + new Date().toISOString())

  const sections = []
  let messages = 0
  let toolCalls = 0
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue
    const data = ev.data && typeof ev.data === 'object' ? ev.data : null
    if (ev.type === 'user/message') {
      const rendered = data !== null
        ? renderBlocks(Array.isArray(data.content) ? data.content : [])
        : { text: typeof (data && data.text) === 'string' ? data.text : '', toolCalls: [] }
      if (rendered.text === '' && rendered.toolCalls.length === 0) continue
      messages++
      toolCalls += rendered.toolCalls.length
      sections.push('## 👤 用户\n\n' + rendered.text + rendered.toolCalls.map((t) => '\n\n> 🔧 ' + t).join(''))
    } else if (ev.type === 'assistant/message') {
      const rendered = renderBlocks(data !== null ? data.message?.content : null)
      if (rendered.text === '' && rendered.toolCalls.length === 0) continue
      messages++
      toolCalls += rendered.toolCalls.length
      sections.push('## 🤖 助手\n\n' + rendered.text + rendered.toolCalls.map((t) => '\n\n> 🔧 ' + t).join(''))
    }
  }

  const head = '# ' + title + '\n\n' + meta.join('\n')
  const body = sections.length > 0
    ? '\n\n' + sections.map((s) => '---\n\n' + clip(s)).join('\n\n')
    : '\n\n> （此会话没有可导出的消息）'
  return { markdown: head + body + '\n', messages, toolCalls }
}

/** Bound one section so a pathological message cannot dominate the file. */
function clip(section) {
  return section.length > MAX_SECTION_CHARS ? section.slice(0, MAX_SECTION_CHARS) + '…[截断]' : section
}

/**
 * Download filename for an export: slug the title, anchor with the short id,
 * date-suffix for ordering. Chinese titles survive as-is (modern filesystems
 * handle them; the short id keeps uniqueness).
 * @param header - { id, title, createdAt }.
 * @returns e.g. `dsh-session-修复登录-3f2a91c0-2026-09-04.md`.
 */
export function exportFilename(header) {
  const h = header && typeof header === 'object' ? header : {}
  const slug = typeof h.title === 'string'
    ? h.title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    : ''
  const short = typeof h.id === 'string' && h.id.length >= 8 ? h.id.slice(-8) : (typeof h.id === 'string' ? h.id : 'session')
  const day = Number.isFinite(h.createdAt) ? new Date(h.createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  return 'dsh-session-' + (slug !== '' ? slug + '-' : '') + short + '-' + day + '.md'
}
