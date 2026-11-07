import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed preview URLs (issue #6, workspace-spec §2).
 * Preview tabs proxy to the session app's listening port through the API,
 * never exposing the session network directly. Token: base64url(payload).sig
 * where payload = `${sessionId}:${port}:${exp}` and sig = HMAC-SHA256(secret).
 * Short TTL (default 60s); expired links get a friendly retry message.
 */

const SECRET =
  process.env.PREVIEW_SECRET ?? "dev-only-insecure-preview-secret";
export const PREVIEW_TTL_SEC = 60;

function b64url(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function unb64url(data: string): string {
  return Buffer.from(data, "base64url").toString();
}

export function signPreview(sessionId: string, port: number, ttlSec = PREVIEW_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = b64url(`${sessionId}:${port}:${exp}`);
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPreview(
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): { sessionId: string; port: number } | { error: string } {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return { error: "malformed preview token" };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { error: "invalid preview signature" };
  const [sessionId, portStr, expStr] = unb64url(payload).split(":");
  if (!sessionId || !portStr || !expStr) return { error: "malformed preview token" };
  if (Number(expStr) <= nowSec) return { error: "preview link expired — refresh for a new one" };
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { error: "invalid preview port" };
  return { sessionId, port };
}
