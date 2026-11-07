---
title: Scaffold the app
difficulty: easy
timelimit: 10
tabs:
  - { title: Terminal, type: terminal }
---

# Step 1 · Scaffold the app

Create `src/app.ts` exporting a `healthz` handler shape. The checker looks for
the file and the string `healthz`.

Starter: an empty `src/` directory. Run the setup, then write the file.

```sh
mkdir -p src && printf 'export const healthz = () => ({ ok: true });\n' > src/app.ts
```
