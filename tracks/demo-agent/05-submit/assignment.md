---
title: Submit your commit
difficulty: easy
timelimit: 10
tabs:
  - { title: Terminal, type: terminal }
---

# Step 5 · Submit your commit

Stage everything and record the submission hash the grader will verify:

```sh
SUBMIT="$(echo "$RANDOM-$(date +%s)" | sha256sum | cut -c1-12)"
echo "$SUBMIT" > SUBMIT.txt && cat SUBMIT.txt
```

Keep `src/`, `tests/` and `SUBMIT.txt` — all three are required.
