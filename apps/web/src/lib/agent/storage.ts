// Latest chat session id per workspace, in localStorage (try/catch: private mode / blocked storage must not break chat).
export const sessionKey = (workspaceId: string) => `rfy_chat_session:${workspaceId}`;

type S = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const def = (): S | undefined => { try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; } };

export function readSessionId(ws: string, s: S | undefined = def()): string | null {
  try { const v = s?.getItem(sessionKey(ws)); return v && /^ses_[\w-]+$/.test(v) ? v : null; } catch { return null; }
}
export function writeSessionId(ws: string, id: string | null, s: S | undefined = def()) {
  try { if (id) s?.setItem(sessionKey(ws), id); else s?.removeItem(sessionKey(ws)); } catch { /* storage blocked */ }
}
