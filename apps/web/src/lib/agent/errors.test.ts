import { describe, expect, test } from "bun:test";
import { AgentApiError, ERR, isAbort, mapAgentError, mapRequestError } from "./errors";

// Real 2.4.1 payloads (captured from a live server driven by the stub model).
const e401 = { type: "provider.auth", message: "stub 401 authentication_error", status: 401, response: { body: '{"error":{"message":"stub 401 authentication_error"}}' } };
const e429 = { type: "provider.rate-limit", message: "stub 429 rate_limit_error", status: 429, response: { body: "{}" } };
const e500 = { type: "provider.internal", message: "stub 500 server_error", status: 500, response: { body: "{}" } };

describe("mapAgentError", () => {
  test("401 -> key rejected", () => expect(mapAgentError(e401)).toBe(ERR.auth));
  test("429 -> rate limited", () => expect(mapAgentError(e429)).toBe(ERR.rate_limit));
  test("500 -> model problem", () => expect(mapAgentError(e500)).toBe(ERR.model));
  test("402 or quota wording -> exhausted key", () => {
    expect(mapAgentError({ type: "provider.unknown", message: "x", status: 402 })).toBe(ERR.quota);
    expect(mapAgentError({ type: "provider.rate-limit", message: "limit", status: 429, response: { body: "You exceeded your current quota" } })).toBe(ERR.quota);
    expect(mapAgentError({ type: "provider.auth", message: "Insufficient credits", status: 401 })).toBe(ERR.quota);
  });
  test("user stop is not an error", () => {
    expect(mapAgentError({ type: "aborted", message: "Step interrupted" })).toBeNull();
    expect(isAbort({ message: "Interrupted by user" })).toBe(true);
  });
  test("network-ish and unknown", () => {
    expect(mapAgentError({ type: "network", message: "fetch failed" })).toBe(ERR.network);
    expect(mapAgentError({ type: "weird", message: "boom" })).toBe(ERR.unknown);
    expect(mapAgentError(undefined)).toBe(ERR.unknown);
  });
  test("never leaks raw text: no provider message, stack, key or password in any output", () => {
    const secret = "sk-SECRET-KEY-123 at Object.<anonymous> (/srv/app.js:1:1)";
    for (const err of [e401, e429, e500, { type: "x", message: secret, response: { body: secret } }]) {
      const m = mapAgentError({ ...err, message: secret + (err.message ?? ""), response: { body: secret } });
      expect(JSON.stringify(m)).not.toMatch(/sk-SECRET|Object\.<anonymous>|stub \d{3}/);
    }
  });
  test("every message has a title and a next step", () => {
    for (const u of Object.values(ERR)) { expect(u.title.length).toBeGreaterThan(5); expect(u.hint.length).toBeGreaterThan(5); }
  });
});

describe("mapRequestError", () => {
  test("no response -> network", () => expect(mapRequestError(new AgentApiError(0))).toBe(ERR.network));
  test("start failure (503) -> agent could not start", () => expect(mapRequestError(new AgentApiError(503, "unhealthy"), "start")).toBe(ERR.agent_start));
  test("proxy 503/502 on a call -> agent stopped responding", () => {
    expect(mapRequestError(new AgentApiError(503, "stopped"))).toBe(ERR.agent_down);
    expect(mapRequestError(new AgentApiError(502, "unhealthy"))).toBe(ERR.agent_down);
  });
  test("403 / missing workspace -> session ended", () => {
    expect(mapRequestError(new AgentApiError(403))).toBe(ERR.session);
    expect(mapRequestError(new AgentApiError(404), "start")).toBe(ERR.session);
  });
  test("non-API throw -> network", () => expect(mapRequestError(new TypeError("x"))).toBe(ERR.network));
});
