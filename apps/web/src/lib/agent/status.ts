// The one plain-language status line of the chat. Pure: the controller feeds it, the panel renders it.
// Never raw errors: every state is a short phrase, and an action only where the student can do something.
import type { ConnState } from "./api";

/** How the agent server itself is doing, as the chat sees it. */
export type AgentHealth = "up" | "restarting" | "unavailable";

export type StatusKind = "idle" | "working" | "waiting" | "reconnecting" | "restarting" | "unavailable" | "starting";
export interface ChatStatus { kind: StatusKind; text: string; /** Show a Restart button. */ restart?: boolean }

export interface StatusInput {
  phase: "idle" | "starting" | "ready" | "failed";
  conn: ConnState;
  agent: AgentHealth;
  running: boolean;
  pendingPermissions: number;
}

export function chatStatus(i: StatusInput): ChatStatus {
  if (i.agent === "restarting") return { kind: "restarting", text: "Agent stopped, restarting…" };
  if (i.agent === "unavailable" || i.phase === "failed") return { kind: "unavailable", text: "Agent unavailable", restart: true };
  if (i.phase === "idle" || i.phase === "starting") return { kind: "starting", text: "Starting the agent…" };
  if (i.conn === "reconnecting") return { kind: "reconnecting", text: "Reconnecting…" };
  if (i.pendingPermissions > 0) return { kind: "waiting", text: "Waiting for your answer" };
  if (i.running) return { kind: "working", text: "Working" };
  return { kind: "idle", text: "" };
}
