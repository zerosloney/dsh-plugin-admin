/**
 * Panel chunk entry: re-exports the eleven-panel implementation tree split
 * out of the old single-file panels.js. The dsh module loader reads
 * `apply`/`inject` from the main bundle; impl.js lazy-loads THIS chunk via
 * require.async('./client.panels.js') and mounts the sections it exports.
 */
export { configure } from './context.js'

export { AutomationSection } from './automation.js'
export { ChCommandsSection, ChHooksSection } from './commands-hooks.js'
export { McpSection } from './mcp.js'
export { PluginsSection } from './plugins.js'
export { SessionsSection, WebSessionsSection } from './sessions.js'
export { SkillsSection } from './skills.js'
export { SubagentAdminSection } from './subagents.js'
export { TodoAdminDock } from './todo.js'
export { UsageDashboardSection } from './usage.js'
export { WorkflowSection } from './workflow.js'
export { WorkspacesSection } from './workspaces.js'
