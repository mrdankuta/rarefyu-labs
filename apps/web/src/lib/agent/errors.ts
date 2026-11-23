// Plain-language error mapping for the chat panel. Pure, no DOM.
// Rules: never surface raw provider/server text, stack traces, keys or passwords; every message names a next step.
// Inputs are (a) OpenCode "StructuredError" objects from events/messages and (b) request failures from our proxy.

export type ErrorKind =
  | "auth" // key rejected
  | "quota" // key exhausted / out of budget
  | "rate_limit"
  | "model" // provider/model failed on its side
  | "no_key" // no class key set up for this workspace
  | "agent_start" // the agent server could not start
  | "agent_down" // the agent server stopped responding
  | "network" // cannot reach the lab at all
  | "session" // signed out / workspace gone
  | "unknown";

export interface UiError { kind: ErrorKind; title: string; hint: string }

/** OpenCode `Session.StructuredError` (openapi 2.4.1). `response.body` is provider text, never displayed. */
export interface StructuredError { type?: string; message?: string; status?: number; response?: { body?: string }; retryAfterMs?: number }

const QUOTA = /quota|credit|exhaust|insufficient|billing|budget|usage limit|limit (reached|exceeded)|out of (tokens|funds)|payment|spend/i;

export const ERR: Record<ErrorKind, UiError> = {
  auth: { kind: "auth", title: "Your model key was rejected.", hint: "Ask your facilitator to check your class code, or re-enter it from the start page." },
  quota: { kind: "quota", title: "Your model key has run out of budget.", hint: "Ask your facilitator to top it up, then try again." },
  rate_limit: { kind: "rate_limit", title: "The model is busy or your key hit its rate limit.", hint: "Wait a minute, then send your message again." },
  model: { kind: "model", title: "The model had a problem on its side.", hint: "Try again in a moment. If it keeps happening, start a new conversation." },
  no_key: { kind: "no_key", title: "No model key is set up for this workspace.", hint: "Join with your class code from the start page, or ask your facilitator." },
  agent_start: { kind: "agent_start", title: "The agent could not start.", hint: "Press Restart to try again. Your files, code and terminal are not affected." },
  agent_down: { kind: "agent_down", title: "The agent stopped responding.", hint: "Press Restart to start it again. Your files, code and terminal are not affected." },
  network: { kind: "network", title: "Can't reach the lab right now.", hint: "Check your internet connection. The chat will reconnect on its own." },
  session: { kind: "session", title: "Your session has ended or this workspace is gone.", hint: "Go back to the start page and open a new playground." },
  unknown: { kind: "unknown", title: "Something went wrong with the agent.", hint: "Try again. If it keeps happening, start a new conversation." },
};

/** True for an interrupted/aborted step: that is a user Stop, not an error. */
export function isAbort(e: StructuredError | undefined | null): boolean {
  return !!e && (e.type === "aborted" || /interrupt/i.test(e.message ?? ""));
}

/** Map an OpenCode structured error (from an event or a stored message) to a short message. Null for a user stop. */
export function mapAgentError(e: StructuredError | undefined | null): UiError | null {
  if (!e) return ERR.unknown;
  if (isAbort(e)) return null;
  const type = (e.type ?? "").toLowerCase();
  const status = e.status;
  const text = `${e.message ?? ""} ${e.response?.body ?? ""}`;
  if (status === 402 || (QUOTA.test(text) && status !== 500)) return ERR.quota;
  if (status === 401 || status === 403 || type === "provider.auth") return ERR.auth;
  if (status === 429 || type === "provider.rate-limit") return ERR.rate_limit;
  if ((status !== undefined && status >= 500) || type === "provider.internal" || type.startsWith("provider.")) return ERR.model;
  if (/network|timeout|econn|fetch failed|socket/.test(type) || /network|timed out|econn|fetch failed/i.test(e.message ?? "")) return ERR.network;
  return ERR.unknown;
}

/** Failure of a request to OUR api (proxy included). `status` 0 = the request never got a response. */
export class AgentApiError extends Error {
  constructor(public status: number, public serverState?: string, message = "agent request failed") {
    super(message);
    this.name = "AgentApiError";
  }
}

/** Map a thrown request error to a message. `phase` tells "could not start" apart from "stopped answering". */
export function mapRequestError(e: unknown, phase: "start" | "call" = "call"): UiError {
  const status = e instanceof AgentApiError ? e.status : 0;
  if (status === 0) return ERR.network;
  if (status === 401 || status === 403 || status === 404 && phase === "start") return ERR.session;
  if (status === 404) return ERR.unknown;
  if (phase === "start") return ERR.agent_start;
  if (status === 502 || status === 503) return ERR.agent_down;
  return ERR.unknown;
}
