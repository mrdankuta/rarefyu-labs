import { driver } from "./drivers";
import { getPlayground } from "./playgrounds";
import { verifyPreview } from "./preview";

/** Resolve a signed preview token to the in-workspace address, or a typed error. */
export async function resolvePreviewTarget(
  token: string,
): Promise<{ host: string; port: number; sessionId: string } | { error: string; status: 403 | 404 | 502 }> {
  const v = verifyPreview(token);
  if ("error" in v) return { error: v.error, status: 403 };
  const rec = getPlayground(v.sessionId);
  if (!rec || rec.status === "destroyed") return { error: "session gone — reopen the playground", status: 404 };
  try {
    const a = await driver.address(v.sessionId, v.port);
    return { host: a.host, port: a.port, sessionId: v.sessionId };
  } catch {
    return { error: "workspace is not reachable", status: 502 };
  }
}
