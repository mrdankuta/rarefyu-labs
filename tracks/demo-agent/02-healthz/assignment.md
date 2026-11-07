---
title: Serve GET /healthz
difficulty: easy
timelimit: 15
tabs:
  - { title: Terminal, type: terminal }
  - { title: Preview, type: website, port: 3000 }
---

# Step 2 · Serve GET /healthz

Write `src/index.ts` so it starts a server on `$PORT` (default 3000) answering
`GET /healthz` with `{"ok":true}`.

```sh
bun src/index.ts & sleep 1
curl -s localhost:3000/healthz
# {"ok":true}
```
