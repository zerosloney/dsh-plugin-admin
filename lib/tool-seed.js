/**
 * Shipped tool-name seed for the subagent management panel's tool-constraint
 * picker. Generated from this harness checkout's generated tool catalog
 * (docs/tool-catalog.md, "Tool Package Map"), so the picker offers every real
 * model-visible tool name the shipped tool plugins register — including the
 * preset-plane tools the web surface mounts per session, which the host-plane
 * global registry alone cannot see.
 *
 * Validation truth at delegation time stays with the harness: a restriction
 * naming a tool the child cannot see fails loud at start. The seed only powers
 * suggestions and blocks obviously unknown names.
 */

/** Tool name -> registering plugin package (shipped products only). */
export const TOOL_SEED = {
  ask_user_question: 'dsh-tool-ask-user',
  bash: 'dsh-tool-bash',
  cordis_define: 'dsh-tool-cordis',
  cordis_inspect_list: 'dsh-tool-cordis',
  cordis_inspect_query: 'dsh-tool-cordis',
  cordis_inspect_self: 'dsh-tool-cordis',
  cordis_run: 'dsh-tool-cordis',
  cordis_stop: 'dsh-tool-cordis',
  cordis_undefine: 'dsh-tool-cordis',
  create_goal: 'dsh-tool-goal',
  edit: 'dsh-tool-fs',
  exit_plan_mode: 'dsh-plan-mode',
  followup_task: 'dsh-experimental-tool-agent-team',
  get_goal: 'dsh-tool-goal',
  glob: 'dsh-tool-fs-search',
  grep: 'dsh-tool-fs-search',
  interrupt_agent: 'dsh-tool-subagent-control',
  job_kill: 'dsh-tool-jobs',
  job_list: 'dsh-tool-jobs',
  job_output: 'dsh-tool-jobs',
  list_agents: 'dsh-tool-subagent-control',
  lsp: 'dsh-tool-lsp',
  pwsh: 'dsh-tool-pwsh',
  ralph: 'dsh-tool-ralph',
  read: 'dsh-tool-fs',
  read_image: 'dsh-tool-fs',
  report: 'dsh-tool-subagent-report',
  spawn_teammate: 'dsh-experimental-tool-agent-team',
  str_replace_editor: 'dsh-tool-str-replace-editor',
  subagent: 'dsh-tool-subagent',
  subagent_fork: 'dsh-tool-subagent',
  team_task_create: 'dsh-experimental-tool-agent-team',
  team_task_get: 'dsh-experimental-tool-agent-team',
  team_task_list: 'dsh-experimental-tool-agent-team',
  team_task_update: 'dsh-experimental-tool-agent-team',
  terminal_close: 'dsh-tool-terminal',
  terminal_list: 'dsh-tool-terminal',
  terminal_open: 'dsh-tool-terminal',
  terminal_read: 'dsh-tool-terminal',
  terminal_send: 'dsh-tool-terminal',
  terminal_signal: 'dsh-tool-terminal',
  todo_write: 'dsh-tool-todo',
  update_goal: 'dsh-tool-goal',
  wait_agent: 'dsh-experimental-tool-agent-team',
  web_fetch: 'dsh-tool-web',
  web_search: 'dsh-tool-web',
  workflow: 'dsh-tool-workflow',
  write: 'dsh-tool-fs',
}

/** Tool names the model-facing restriction seam reserves or the shipped presets own. */
export const RESERVED_TOOL_NAMES = ['run_code', 'subagent', 'subagent_fork']
