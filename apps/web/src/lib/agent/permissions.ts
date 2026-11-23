// Plain-language wording for OpenCode permission prompts (`permission.asked`). Pure, no DOM.
// The lab pre-approves everything inside the workspace (agent-policy.ts on the API) and refuses paths outside it,
// so a prompt only appears when a student's own project config asks for one. We still never leave it unseen.

export interface UiPermission {
  id: string;
  /** Raw OpenCode action ("edit", "shell", "external_directory"...), kept for tests/analytics only. */
  action: string;
  title: string;
  /** Command or file list, shown in monospace. */
  detail: string;
  status: "pending" | "sending";
}

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function describePermission(action: string, resources: string[] = []): { title: string; detail: string } {
  const list = clip(resources.join(", "));
  switch (action) {
    case "shell": case "bash": return { title: "The agent wants to run a command", detail: clip(resources.join("\n")) };
    case "edit": case "write": case "patch": case "multiedit": return { title: "The agent wants to change files", detail: list };
    case "read": return { title: "The agent wants to read files", detail: list };
    case "external_directory": return { title: "The agent wants to use files outside your workspace", detail: list };
    case "webfetch": case "fetch": return { title: "The agent wants to open a web page", detail: list };
    case "doom_loop": return { title: "The agent keeps repeating the same step", detail: "Allow it to keep going, or deny to stop it." };
    default: return { title: "The agent is asking for permission", detail: clip([action, ...resources].join(" ")) };
  }
}

/** From a `permission.asked` event payload or a `GET .../permission` item. Null when it has no usable id. */
export function permissionFromPayload(d: Record<string, any> | undefined): UiPermission | null {
  if (!d || typeof d.id !== "string" || !d.id) return null;
  const action = typeof d.action === "string" ? d.action : "";
  const resources = Array.isArray(d.resources) ? d.resources.filter((r: unknown): r is string => typeof r === "string") : [];
  return { id: d.id, action, ...describePermission(action, resources), status: "pending" };
}
