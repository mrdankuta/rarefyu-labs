// Lab shell layout preference: "chat" (agent chat + live preview) or "classic" (explorer / editor / terminal).
// Pure helpers so the policy is unit-testable; the lab page owns the reactive state.
export type ShellLayout = "classic" | "chat";
export const LAYOUT_KEY = "rfy_layout";

export function isLayout(v: unknown): v is ShellLayout {
  return v === "classic" || v === "chat";
}

/** Deployment flag (PUBLIC_DEFAULT_LAYOUT). Only "classic" is meaningful: it forces Classic for everyone. */
export function forcedClassic(flag: string | undefined | null): boolean {
  return (flag ?? "").trim().toLowerCase() === "classic";
}

/** Forced flag wins; else a valid stored choice; else Chat (first visit / corrupt storage). */
export function resolveLayout(stored: string | null | undefined, flag?: string | null): ShellLayout {
  if (forcedClassic(flag)) return "classic";
  return isLayout(stored) ? stored : "chat";
}

export function readStoredLayout(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): string | null {
  try { return storage?.getItem(LAYOUT_KEY) ?? null; } catch { return null; }
}
export function storeLayout(l: ShellLayout, storage: Pick<Storage, "setItem"> | undefined = safeStorage()) {
  try { storage?.setItem(LAYOUT_KEY, l); } catch { /* storage blocked */ }
}
function safeStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}
