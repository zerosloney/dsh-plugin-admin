/**
 * Workspace administration host half.
 *
 * dsh ships a complete Workspace registry through `ctx.workspaceRegistry`
 * (`@deepseek-ai/dsh-workspace`): durable workspace records (uuid, canonical
 * path, title, manual session account, archive set) with first-class
 * verbs — list / create / rename / delete / insertBefore / archiveSession
 * / unarchiveSession. The web-app bundle mounts the registry + the
 * `workspace-controller` Typert Remote; the base CLI bundle does not.
 * dsh ships no web UI for any of it: the official session sidebar reads
 * the registry for grouping, but no panel exposes rename / delete /
 * archive / reorder / "attach new dir".
 *
 * This module wraps the registry verbs as a `workspaceAdmin` RPC
 * namespace so the plugin's settings page can manage workspaces and
 * the archived-session set. All read paths project the registry's
 * `Workspace` instances through `toWorkspaceView` (the registry's own
 * `WorkspaceView` shape: id / path / title / sessionIds / createdAt /
 * updatedAt — the implementation class stays private to this side).
 *
 * Security / data posture:
 *   - The panel receives canonical paths and titles; no filesystem
 *     contents cross this boundary.
 *   - `pickDirectory()` is best-effort: when `ctx.directoryPicker` is
 *     absent (CLI bundle / no dialog backend), it returns `null` and
 *     the panel falls back to a manual path input. The picker is a
 *     pure seam — this module never spawns a dialog itself.
 *   - Every mutation surfaces host-side rejections as plain errors so
 *     the panel can render them inline (name-conflict, invalid-path,
 *     not-found, move-invalid).
 *
 * Zero dsh imports on purpose: everything rides the live Cordis
 * context by service key (`workspaceRegistry`, `directoryPicker`).
 */

const SERVICE_KEY = 'workspaceAdmin'
const NAMESPACE = 'workspaceAdmin'
const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

const descriptor = (id, method, parameters) => ({
  id: `${DESCRIPTOR_PACKAGE}/${id}`,
  service: SERVICE_KEY,
  namespace: NAMESPACE,
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: { mode: 'src-json' },
})

/** @returns {Array} typert invocation descriptors. */
export function workspaceInvocations() {
  return [
    descriptor('workspace/list', 'list', []),
    descriptor('workspace/create', 'create', [
      { name: 'path', wire: 'path', source: 'json', codec: { mode: 'src-json' } },
      { name: 'title', wire: 'title', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/rename', 'rename', [
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: { mode: 'src-json' } },
      { name: 'title', wire: 'title', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/delete', 'delete', [
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/insertBefore', 'insertBefore', [
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: { mode: 'src-json' } },
      { name: 'beforeWorkspaceId', wire: 'beforeWorkspaceId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/attachSession', 'attachSession', [
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: { mode: 'src-json' } },
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/detachSession', 'detachSession', [
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: { mode: 'src-json' } },
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/insertSessionBefore', 'insertSessionBefore', [
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: { mode: 'src-json' } },
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } },
      { name: 'beforeSessionId', wire: 'beforeSessionId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/archiveSession', 'archiveSession', [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/unarchiveSession', 'unarchiveSession', [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('workspace/pickDirectory', 'pickDirectory', []),
    descriptor('workspace/status', 'status', [
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: { mode: 'src-json' } },
    ]),
  ]
}

/**
 * Mount the workspaceAdmin service onto ctx.
 *
 * @param {object} ctx - host context.
 * @returns {() => Array} workspaceInvocations().
 */
export function applyWorkspaceAdmin(ctx) {
  /**
   * Resolve the host workspace registry if the deployment exposes it.
   * Returns null when the registry is absent (base CLI bundle does not
   * mount `@deepseek-ai/dsh-workspace`); the panel renders an
   * "unavailable" hint instead of failing.
   * @returns the registry, or null when absent.
   */
  const registry = () => {
    try {
      const svc = ctx.get('workspaceRegistry')
      return svc && typeof svc.list === 'function' ? svc : null
    } catch {
      return null
    }
  }

  /**
   * Resolve the directory-picker CAPABILITY, not the service. dsh's
   * `DirectoryPicker` service only declares `capability()`; `pick()` lives on
   * the native capability object, while the `browse` capability serves
   * list/createDirectory and has no pick action at all. Duck-typing
   * `svc.pick` therefore never matched and left picking permanently
   * "unavailable" in every deployment.
   * @returns {object|null} the capability object, or null when absent.
   */
  const pickerCapability = () => {
    try {
      const svc = ctx.get('directoryPicker')
      if (svc === null || svc === undefined || typeof svc.capability !== 'function') return null
      const cap = svc.capability()
      return cap !== null && typeof cap === 'object' && typeof cap.kind === 'string' ? cap : null
    } catch {
      return null
    }
  }

  /**
   * Project one Workspace registry instance into the JSON-safe
   * `WorkspaceView` shape (id / path / title / sessionIds /
   * createdAt / updatedAt). Brand types collapse to their underlying
   * strings so the panel can render without re-importing the
   * `@deepseek-ai/dsh-workspace/types` declarations.
   * @param {object} workspace - registry Workspace instance.
   * @returns JSON-safe Workspace view.
   */
  const project = (workspace) => {
    if (!workspace || typeof workspace !== 'object') return null
    return {
      workspaceId: typeof workspace.id === 'string' ? workspace.id : String(workspace.id ?? ''),
      path: typeof workspace.path === 'string' ? workspace.path : '',
      title: typeof workspace.title === 'string' ? workspace.title : '',
      sessionIds: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.slice() : [],
      createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : '',
      updatedAt: typeof workspace.updatedAt === 'string' ? workspace.updatedAt : '',
    }
  }

  const service = {
    /**
     * Read one point-in-time snapshot of every Workspace plus the
     * archived-session set. When the registry is absent, the panel
     * gets `{ available: false, workspaces: [], archivedSessionIds: [] }`
     * so it can render a graceful "workspace unavailable" hint.
     * @returns { available, workspaces, archivedSessionIds }
     */
    async list() {
      const reg = registry()
      if (reg === null) {
        return { available: false, workspaces: [], archivedSessionIds: [] }
      }
      let workspaces = []
      try {
        const list = reg.list()
        workspaces = Array.isArray(list) ? list.map(project).filter((row) => row !== null) : []
      } catch {
        workspaces = []
      }
      let archived = []
      try {
        archived = Array.isArray(reg.archivedSessionIds) ? reg.archivedSessionIds.slice() : []
      } catch {
        archived = []
      }
      return {
        available: true,
        workspaces,
        archivedSessionIds: archived,
      }
    },

    /**
     * Adopt one existing directory as a Workspace (or resolve the
     * existing registration if `path` already maps to one). The
     * registry returns the same `Workspace` instance for both new
     * and pre-existing paths; the panel distinguishes via the
     * host-side `WorkspaceCreateValue.created` boolean (the
     * workspace-controller pair — this method derives the same
     * distinction by comparing ids before and after).
     * @param path - absolute directory path to adopt.
     * @param title - optional display title (defaults to last path segment).
     * @returns the created-or-resolved WorkspaceView and a `created` boolean.
     */
    async create(path, title) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      if (typeof path !== 'string' || path.trim() === '') {
        throw new Error('workspace-admin: path 必须是非空字符串')
      }
      const safePath = path.trim()
      const safeTitle = typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined
      const idsBefore = new Set(reg.list().map((w) => w.id))
      const workspace = await reg.create(safePath, safeTitle)
      const idsAfter = new Set(reg.list().map((w) => w.id))
      const created = !idsBefore.has(workspace.id) && idsAfter.has(workspace.id)
      return { workspace: project(workspace), created }
    },

    /**
     * Replace one Workspace's display title. A blank title is rejected
     * to mirror the workspace-controller validation (which throws
     * `gateway/bad-request`); a title another workspace already uses is
     * rejected the way the official controller does
     * (`workspace/name-conflict`) — the registry itself allows duplicates, so
     * without this check the sidebar would grow two identically named groups
     * and the header's "name-conflict renders inline" promise would never be
     * reachable.
     * @param workspaceId - the registry id.
     * @param title - new title (non-blank, unique among workspaces).
     * @returns the updated WorkspaceView.
     */
    async rename(workspaceId, title) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
        throw new Error('workspace-admin: workspaceId 必须是非空字符串')
      }
      if (typeof title !== 'string' || title.trim() === '') {
        throw new Error('workspace-admin: title 不能为空')
      }
      const safeTitle = title.trim()
      const workspace = reg.get(workspaceId)
      if (workspace === undefined) throw new Error(`workspace-admin: workspace "${workspaceId}" 不存在`)
      const conflict = reg.list().some((candidate) => candidate.id !== workspaceId && candidate.title === safeTitle)
      if (conflict) {
        throw new Error(`workspace-admin: workspace/name-conflict: 名称 "${safeTitle}" 已被其他工作区使用`)
      }
      await workspace.setTitle(safeTitle)
      return { workspace: project(workspace) }
    },

    /**
     * Delete one Workspace registration. Pure registry mutation: the
     * directory on disk and the session logs stay untouched (the
     * registry's own contract — see `@deepseek-ai/dsh-workspace`).
     * @param workspaceId - the registry id.
     * @returns { ok: true } on success, throws when the id is unknown.
     */
    async delete(workspaceId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
        throw new Error('workspace-admin: workspaceId 必须是非空字符串')
      }
      const deleted = await reg.delete(workspaceId)
      if (!deleted) throw new Error(`workspace-admin: workspace "${workspaceId}" 不存在`)
      return { ok: true }
    },

    /**
     * Move one Workspace within the durable display order
     * (DOM-insertBefore-like). Omitting `beforeWorkspaceId` appends
     * to the end.
     * @returns the new complete order.
     */
    async insertBefore(workspaceId, beforeWorkspaceId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
        throw new Error('workspace-admin: workspaceId 必须是非空字符串')
      }
      const beforeId = typeof beforeWorkspaceId === 'string' && beforeWorkspaceId !== '' ? beforeWorkspaceId : undefined
      const order = await reg.insertBefore(workspaceId, beforeId)
      return { workspaceIds: Array.isArray(order) ? order.slice() : [] }
    },

    /**
     * Account one session to a Workspace. The registry already rejects
     * unknown session ids and cwd mismatches; we re-throw the rejection
     * verbatim so the panel can render it inline.
     */
    async attachSession(workspaceId, sessionId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      const workspace = requireWorkspace(reg, workspaceId, 'attachSession')
      await workspace.attachSession(sessionId)
      return { ok: true }
    },

    /** Detach one session from a Workspace. Idempotent. */
    async detachSession(workspaceId, sessionId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      const workspace = requireWorkspace(reg, workspaceId, 'detachSession')
      await workspace.detachSession(sessionId)
      return { ok: true }
    },

    /**
     * Move one accounted session within a Workspace's manual order.
     * Omitting `beforeSessionId` appends to the end.
     */
    async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      const workspace = requireWorkspace(reg, workspaceId, 'insertSessionBefore')
      const anchor = typeof beforeSessionId === 'string' && beforeSessionId !== '' ? beforeSessionId : undefined
      await workspace.insertSessionBefore(sessionId, anchor)
      return { ok: true }
    },

    /**
     * Add one session to the global archive set. Already-archived
     * ids resolve without writing — the registry's contract.
     * @returns the new complete archive set.
     */
    async archiveSession(sessionId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      if (typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw new Error('workspace-admin: sessionId 必须是非空字符串')
      }
      await reg.archiveSession(sessionId)
      return { archivedSessionIds: Array.isArray(reg.archivedSessionIds) ? reg.archivedSessionIds.slice() : [] }
    },

    /**
     * Drop one session from the global archive set. Idempotent.
     *
     * Rides the registry's public serialized write verb
     * (`WorkspaceRegistry.unarchiveSession`): the chain slot serializes
     * against every other registry write, and an id that is not archived
     * resolves without writing.
     * @returns the new complete archive set.
     */
    async unarchiveSession(sessionId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      if (typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw new Error('workspace-admin: sessionId 必须是非空字符串')
      }
      const safeId = sessionId.trim()
      if (typeof reg.unarchiveSession !== 'function') {
        throw new Error('workspace-admin: workspaceRegistry 缺少 unarchiveSession() — dsh 版本变了？')
      }
      await reg.unarchiveSession(safeId)
      const next = reg.archivedSessionIds
      return { archivedSessionIds: Array.isArray(next) ? next.slice() : [] }
    },

    /**
     * Best-effort native directory picker. Returns the chosen
     * absolute path, or `null` when the user cancels / the seam is
     * absent (CLI mode, headless backend, native dialog unavailable).
     * Never throws.
     * @returns { path, available, backend }
     */
    async pickDirectory() {
      const cap = pickerCapability()
      if (cap === null) return { available: false, path: null, backend: null }
      if (cap.kind !== 'native' || typeof cap.pick !== 'function') {
        // A non-native backend (e.g. `browse`) exposes no picking action:
        // report the capability so the panel hides the affordance.
        return { available: false, path: null, backend: cap.kind }
      }
      try {
        const path = await cap.pick(new AbortController().signal)
        return { available: true, path: typeof path === 'string' ? path : null, backend: cap.kind }
      } catch {
        return { available: true, path: null, backend: cap.kind }
      }
    },

    /**
     * Live directory-existence check for one Workspace's path.
     * Returns 'ok' when the directory exists and is a directory,
     * 'missing-dir' otherwise. The registry does NOT rewrite the
     * record on a missing directory (per the dsh-workspace contract)
     * — a missing directory may only be temporarily moved.
     * @param workspaceId - the registry id.
     * @returns 'ok' | 'missing-dir'
     */
    async status(workspaceId) {
      const reg = registry()
      if (reg === null) throw new Error('workspace-admin: workspaceRegistry 服务不可用')
      const workspace = requireWorkspace(reg, workspaceId, 'status')
      return await workspace.status()
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/workspaceAdmin: provide')

  return workspaceInvocations
}

/**
 * Resolve a Workspace by id with a uniform "unknown id" error message
 * that names the calling verb, so the panel can render the rejection
 * without parsing the host's internal error classes.
 * @param {object} reg - workspace registry.
 * @param {string} workspaceId - candidate id.
 * @param {string} verb - calling verb name for the error message.
 */
function requireWorkspace(reg, workspaceId, verb) {
  if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
    throw new Error(`workspace-admin: ${verb}: workspaceId 必须是非空字符串`)
  }
  const workspace = reg.get(workspaceId)
  if (workspace === undefined) {
    throw new Error(`workspace-admin: ${verb}: workspace "${workspaceId}" 不存在`)
  }
  return workspace
}