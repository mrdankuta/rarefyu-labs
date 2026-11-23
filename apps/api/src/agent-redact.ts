/**
 * Scrub provider-error detail out of what the agent proxy returns to a student's browser.
 *
 * When the model provider rejects a request, OpenCode's error objects carry the raw provider response
 * (`error.response.body`, headers) which can name the FACILITATOR's provider workspace ("wrk_...") and a billing
 * console URL. The chat panel only shows a mapped message, but devtools shows the raw JSON. So:
 *  - `response.body` / `responseBody` / response headers are replaced by a marker that keeps ONLY the quota keyword the panel's
 *    classifier looks at (web/src/lib/agent/errors.ts QUOTA), so "out of credit"-style failures still map to the quota message;
 *  - any string: provider workspace ids become "wrk_…" and URLs that carry one become "[link removed]".
 * `type`, `status`, `message` (minus those identifiers) and everything else are untouched, so the panel still classifies
 * 401 / 402 / 429 / 5xx and "provider.go-limit".
 */
const QUOTA = /quota|credit|exhaust|insufficient|billing|budget|usage limit|limit (reached|exceeded)|out of (tokens|funds)|payment|spend/i; // keep in step with web errors.ts
const WRK = /wrk_[A-Za-z0-9]+/g;
const URL_WITH_WRK = /https?:\/\/[^\s"'<>)]*wrk_[^\s"'<>)]*/g;

export function scrubString(s: string): string {
  if (!s.includes("wrk_")) return s;
  return s.replace(URL_WITH_WRK, "[link removed]").replace(WRK, "wrk_…");
}

function bodyMarker(v: unknown): string {
  const text = typeof v === "string" ? v : JSON.stringify(v ?? "");
  const m = QUOTA.exec(text);
  return m ? `[redacted: ${m[0]}]` : "[redacted]";
}

export function redactValue(v: unknown): unknown {
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      if (k === "responseBody") out[k] = bodyMarker(val);
      else if (k === "responseHeaders") out[k] = {};
      else if (k === "response" && val && typeof val === "object" && !Array.isArray(val)) {
        const r = val as Record<string, unknown>;
        const rr: Record<string, unknown> = {};
        for (const [rk, rv] of Object.entries(r)) {
          if (rk === "body") rr[rk] = bodyMarker(rv);
          else if (rk === "headers") rr[rk] = {};
          else if (rk === "url") rr[rk] = "[link removed]";
          else rr[rk] = redactValue(rv);
        }
        out[k] = rr;
      } else out[k] = redactValue(val);
    }
    return out;
  }
  return v;
}

const NEEDS = /"response"|"responseBody"|"responseHeaders"|wrk_/;

/** Redact a JSON text; unparsable or irrelevant text comes back unchanged (string-scrubbed when it names a workspace). */
export function redactJsonText(text: string): string {
  if (!NEEDS.test(text)) return text;
  try { return JSON.stringify(redactValue(JSON.parse(text))); } catch { return scrubString(text); }
}

/**
 * Streaming SSE redactor: passes every COMPLETE frame (blank-line terminated) through as soon as it is complete, holding
 * back only a partial trailing frame. Nothing waits for later frames, so live events are not delayed.
 */
export function createSseRedactor() {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  const frame = (f: string) => f.split("\n").map((l) => (l.startsWith("data:") ? `data:${(l[5] === " " ? " " : "")}${redactJsonText(l.slice(l[5] === " " ? 6 : 5))}` : l)).join("\n");
  return {
    push(chunk: Uint8Array): Uint8Array | null {
      buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      const i = buf.lastIndexOf("\n\n");
      if (i < 0) return null;
      const done = buf.slice(0, i + 2);
      buf = buf.slice(i + 2);
      return enc.encode(done.split("\n\n").map((f, k, a) => (k === a.length - 1 ? f : frame(f))).join("\n\n"));
    },
  };
}
