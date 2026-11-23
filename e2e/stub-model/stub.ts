/**
 * Tiny OpenAI-compatible chat-completions stub (streaming SSE) for deterministic, free chat tests.
 * Point an OpenCode custom provider at `http://127.0.0.1:<port>/v1` with a dummy key.
 *
 * Behaviour is chosen by a marker in the LAST user message:
 *   (none)        stream a normal text reply ("Hello from the stub model. ...")
 *   [[slow]]      stream words slowly (~150ms each, 60 words) so a turn can be interrupted
 *   [[tool]]      ask for a `write` tool call (hello.txt), then, after the tool result, a final text reply
 *   [[401]] [[429]] [[500]]   respond with that HTTP status and a provider-style JSON error body
 * Every request is recorded in `requests` (authorization header + body) for assertions.
 */
export interface StubRequest { path: string; authorization: string | null; body: any }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunk(delta: object, finish: string | null = null, extra: object = {}) {
  return `data: ${JSON.stringify({ id: "chatcmpl-stub", object: "chat.completion.chunk", created: 1, model: "stub-1", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
}

function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map((p: any) => p.text ?? "").join(" ");
  }
  return "";
}

export function startStub(port = 0) {
  const requests: StubRequest[] = [];
  const enc = new TextEncoder();
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "stub-1", object: "model" }] });
      if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
      const body: any = await req.json().catch(() => ({}));
      requests.push({ path: url.pathname, authorization: req.headers.get("authorization"), body });
      const msgs: any[] = body.messages ?? [];
      const text = lastUserText(msgs);
      const afterTool = msgs[msgs.length - 1]?.role === "tool";

      for (const code of [401, 429, 500] as const) {
        if (text.includes(`[[${code}]]`)) {
          const type = code === 401 ? "authentication_error" : code === 429 ? "rate_limit_error" : "server_error";
          return Response.json({ error: { message: `stub ${code} ${type}`, type, code: String(code) } }, { status: code });
        }
      }

      const stream = new ReadableStream({
        async start(c) {
          const send = (s: string) => c.enqueue(enc.encode(s));
          send(chunk({ role: "assistant", content: "" }));
          if (text.includes("[[tool]]") && !afterTool) {
            send(chunk({ tool_calls: [{ index: 0, id: "call_stub1", type: "function", function: { name: "write", arguments: "" } }] }));
            const args = JSON.stringify({ path: "hello.txt", content: "hello from the stub\n" });
            send(chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }));
            send(chunk({}, "tool_calls", { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
          } else if (text.includes("[[slow]]")) {
            for (let i = 0; i < 60; i++) {
              await sleep(150);
              try { send(chunk({ content: `word${i} ` })); } catch { return; } // client (opencode) aborted
            }
            send(chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 60, total_tokens: 70 } }));
          } else {
            const reply = afterTool
              ? "I created hello.txt for you."
              : "Hello from the stub model. Here is **bold** text and a code block:\n\n```js\nconsole.log('hi')\n```\n";
            for (const w of reply.match(/\S+\s*/g) ?? []) { send(chunk({ content: w })); await sleep(20); }
            send(chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 } }));
          }
          send("data: [DONE]\n\n");
          c.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    },
  });
  return { port: server.port as number, url: `http://127.0.0.1:${server.port}/v1`, requests, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const s = startStub(Number(process.env.STUB_PORT ?? 4599));
  console.log(`stub model listening on ${s.url}`);
}
