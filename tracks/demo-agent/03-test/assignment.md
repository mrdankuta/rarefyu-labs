---
title: Write a test
difficulty: easy
timelimit: 15
tabs:
  - { title: Terminal, type: terminal }
---

# Step 3 · Write a test

Add `tests/healthz.test.ts` using `bun:test` asserting the handler shape.
The checker runs `bun test` and requires at least 1 passing test.

```sh
mkdir -p tests
bun test
```
