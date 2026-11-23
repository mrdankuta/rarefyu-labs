/**
 * Tiny OpenAI-compatible chat-completions stub (streaming SSE) for deterministic, free chat tests.
 * Point an OpenCode custom provider at `http://127.0.0.1:<port>/v1` with a dummy key.
 *
 * Behaviour is chosen by a marker in the LAST user message:
 *   (none)        stream a normal text reply ("Hello from the stub model. ...")
 *   [[slow]]      stream words slowly (~150ms each, 60 words) so a turn can be interrupted
 *   [[tool]]      ask for a `write` tool call (hello.txt), then, after the tool result, a final text reply
 *   [[call:<tool> <json args>]]  (one or more; note the SPACE, vs [[call:NAME:{json}]] below) call that tool with those args, one call per model step, in order,
 *                 then a final text reply "Done with the edits." e.g. [[call:write {"path":"a.txt","content":"x\n"}]]
 *   [[wait:<ms>]] wait that long before the first reply byte of the turn
 *   [[outside]]   ask for a `write` OUTSIDE the workspace (/tmp/rfy-outside-stub.txt), then a final text reply
 *   [[bash]]      ask for a `bash` call (`echo stub-bash-ok`), then a final text reply
 *   [[longout]]   ask for a `bash` call printing 120 lines, then a final text reply
 *   [[longerr]]   ask for a `bash` call that prints 80 lines to stderr and exits 1, then a final text reply
 *   [[site:TEXT]] ask for a `write` tool call that writes index.html (`<h1 id="t">TEXT</h1>` plus a tall spacer), then a final text reply
 *   [[call:NAME:{json}]]   ask for any tool call with those arguments, then a final text reply
 *   [[401]] [[429]] [[500]]   respond with that HTTP status and a provider-style JSON error body
 * Every request is recorded in `requests` (authorization header + body) for assertions.
 */
export interface StubRequest { path: string; authorization: string | null; body: any }

import { createServer } from "node:http";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunk(delta: object, finish: string | null = null, extra: object = {}) {
  return `data: ${JSON.stringify({ id: "chatcmpl-stub", object: "chat.completion.chunk", created: 1, model: "stub-1", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
}

function toolsSinceUserEarly(msgs: any[]): number {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0 && msgs[i].role !== "user"; i--) if (msgs[i].role === "tool") n++;
  return n;
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

function toolFor(text: string): { name: string; args: object } | null {
  const raw = /\[\[call:(\w+):(\{.*?\})\]\]/s.exec(text); // generic: [[call:NAME:{json args}]]
  if (raw) { try { return { name: raw[1]!, args: JSON.parse(raw[2]!) }; } catch { /* fall through */ } }
  const site = /\[\[site:([^\]]*)\]\]/.exec(text);
  if (site) return { name: "write", args: { path: "index.html", content: `<!doctype html><html><body><h1 id="t">${site[1]}</h1><div style="height:3000px"></div><p id="end">bottom</p></body></html>\n` } };
  if (text.includes("[[tool]]")) return { name: "write", args: { path: "hello.txt", content: "hello from the stub\n" } };
  if (text.includes("[[outside]]")) return { name: "write", args: { path: "/tmp/rfy-outside-stub.txt", content: "outside\n" } };
  if (text.includes("[[bash]]")) return { name: "shell", args: { command: "echo stub-bash-ok", description: "Echo" } };
  if (text.includes("[[longout]]")) return { name: "shell", args: { command: "seq 1 120", description: "Count" } };
  if (text.includes("[[longerr]]")) return { name: "shell", args: { command: "for i in $(seq 1 80); do echo \"stub error line $i\" >&2; done; exit 1", description: "Fail" } };
  return null;
}

export function startStub(port = 0): Promise<{ port: number; url: string; requests: StubRequest[]; stop: () => Promise<void> }> {
  const requests: StubRequest[] = [];
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    if (path.endsWith("/models")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ object: "list", data: [{ id: "stub-1", object: "model" }] })); return; }
    if (!path.endsWith("/chat/completions")) { res.statusCode = 404; res.end("not found"); return; }
    let raw = "";
    for await (const c of req) raw += c;
    let body: any = {};
    try { body = JSON.parse(raw); } catch { /* ignore */ }
    requests.push({ path, authorization: (req.headers.authorization as string) ?? null, body });
    const msgs: any[] = body.messages ?? [];
    const text = lastUserText(msgs);
    const afterTool = msgs[msgs.length - 1]?.role === "tool";

    for (const code of [401, 429, 500] as const) {
      if (text.includes(`[[${code}]]`)) {
        const type = code === 401 ? "authentication_error" : code === 429 ? "rate_limit_error" : "server_error";
        res.statusCode = code;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: `stub ${code} ${type}`, type, code: String(code) } }));
        return;
      }
    }

    const wait = /\[\[wait:(\d+)\]\]/.exec(text); // delay the first byte (lets a test act while the agent is "thinking")
    if (wait && !afterTool && toolsSinceUserEarly(msgs) === 0) await sleep(Number(wait[1]));
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    let closed = false;
    res.on("close", () => { closed = true; }); // opencode aborted (Stop)
    const send = (s: string) => { if (!closed) res.write(s); };
    send(chunk({ role: "assistant", content: "" }));
    const calls = [...text.matchAll(/\[\[call:(\w+) (\{.*?\})\]\]/g)].map((m) => ({ name: m[1]!, args: m[2]! }));
    let toolsSinceUser = 0;
    for (let i = msgs.length - 1; i >= 0 && msgs[i].role !== "user"; i--) if (msgs[i].role === "tool") toolsSinceUser++;
    if (calls.length && toolsSinceUser < calls.length) {
      const c = calls[toolsSinceUser]!;
      send(chunk({ tool_calls: [{ index: 0, id: `call_stub_${toolsSinceUser}`, type: "function", function: { name: c.name, arguments: "" } }] }));
      send(chunk({ tool_calls: [{ index: 0, function: { arguments: c.args } }] }));
      send(chunk({}, "tool_calls", { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    } else if (calls.length) {
      for (const w of "Done with the edits.".match(/\S+\s*/g) ?? []) { send(chunk({ content: w })); await sleep(20); }
      send(chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 } }));
    } else if (!afterTool && toolFor(text)) {
      const call = toolFor(text)!;
      send(chunk({ tool_calls: [{ index: 0, id: "call_stub1", type: "function", function: { name: call.name, arguments: "" } }] }));
      send(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(call.args) } }] }));
      send(chunk({}, "tool_calls", { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    } else if (text.includes("[[slow]]")) {
      for (let i = 0; i < 60 && !closed; i++) { await sleep(150); send(chunk({ content: `word${i} ` })); }
      send(chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 60, total_tokens: 70 } }));
    } else {
      const reply = afterTool
        ? (/\[\[site:/.test(text) ? "I updated index.html for you." : text.includes("[[tool]]") ? "I created hello.txt for you." : "All done with the tool step.")
        : "Hello from the stub model. Here is **bold** text and a code block:\n\n```js\nconsole.log('hi')\n```\n";
      for (const w of reply.match(/\S+\s*/g) ?? []) { send(chunk({ content: w })); await sleep(20); }
      send(chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 } }));
    }
    send("data: [DONE]\n\n");
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const p = (server.address() as { port: number }).port;
      resolve({ port: p, url: `http://127.0.0.1:${p}/v1`, requests, stop: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}

if ((import.meta as any).main) {
  startStub(Number(process.env.STUB_PORT ?? 4599)).then((s) => console.log(`stub model listening on ${s.url}`));
}
