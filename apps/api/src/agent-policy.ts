/**
 * Server-side policy for every workspace's agent server, applied through OpenCode's inline config
 * (OPENCODE_CONFIG_CONTENT), which outranks the project's own opencode.json, so a student's file
 * cannot loosen it. The workspace directory is already the sandbox (a per-learner container), so
 * inside it the agent is pre-approved: nothing inside the workspace ever waits for a click.
 *
 * Verified on OpenCode 2.4.1 (headless `serve`): with no config NOTHING asks, including a write to an
 * absolute path outside the project dir. `external_directory: "deny"` makes that tool call fail
 * ("Permission denied: external_directory") and the agent carries on. So the one rule we add is the
 * refusal of paths outside the workspace; the chat panel still renders approve/deny cards for any
 * `permission.asked` that does occur (e.g. a student's own project config asking for bash).
 */
export const AGENT_SERVER_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  permission: { external_directory: "deny" },
  update: "disable",
} as const;

/** Single-line JSON, safe inside single quotes in a shell script (no quotes in the policy). */
export const agentServerConfigJson = () => JSON.stringify(AGENT_SERVER_CONFIG);
