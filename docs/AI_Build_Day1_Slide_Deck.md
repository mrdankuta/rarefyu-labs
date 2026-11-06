# Day 1 Slide Deck — Build With AI (Hands-On + Slides)
**Workshop: Ideate → Design → Spec → Build → Deploy | Day 1 of 6**
Audience: YabaTech TVET web-dev graduates (HTML/CSS/JS basics). Mostly hands-on. This deck is the *spine* — keep lectures to ~60 min total, labs to ~120 min.

Sources woven in: [AI Hero LLM Fundamentals](https://www.aihero.dev/llm-fundamentals) (5 lessons: messages/system/reasoning, tokens, context window, tools, agents) + [AI Coding Dictionary](https://www.aihero.dev/ai-coding-dictionary) (71 terms — model, harness, session/turn, tool call/result, etc.).

Timebox for Day 1 (9:00–12:00):
- 9:00–9:20 Intro + week map (Slides 1–5)
- 9:20–9:50 SWE Basics (Slides 6–12)
- 9:50–10:20 AI Dev Interface ladder (Slides 13–20)
- 10:20–10:30 break
- 10:30–11:00 Tooling Setup live (Slides 21–25)
- 11:00–11:40 LLM Fundamentals (Slides 26–38)
- 11:40–12:00 Expected Outcomes + team seeds + homework (Slides 39–43)

---
# SECTION 0 — INTRODUCTION

## Slide 1 — Title
**Build real software with AI. Ship it by Saturday.**
Day 1: How it all fits together
Ideate → Design → Spec → Build → Deploy (×3) → Hackathon → Demo Day

*Talking points (2 min):*
- [Say] "You already know how to build a web page. This week you learn to build an AI *product* and ship it live. Day 1 is the only heavy-slides day. Days 2–4 we repeat the same loop: ideate, design, spec, build, deploy — getting faster each day. Day 5 we form 6 teams of 5 and hack. Day 6 you demo."
- [Ask] "Hands up: who's shipped something to a public URL before? Who's used AI to write code?" Calibrate pace.
- [Do] Show the physical week board: Day 1 / Day 2 / Day 3 / Day 4 / Day 5 (physical) / Day 6 (demo).

## Slide 2 — The week at a glance
- Day 1 (today): SWE Basics + AI Dev Interface + Tooling + LLM Fundamentals
- Day 2–4: Ideate → Design → Spec → Build → Deploy (same loop, harder each day; individual + team reps)
- Day 5 (physical): Teams creation + Hackathon (9am–5pm build)
- Day 6: Demo Day (5–7 min pitches, live demo required)

*Talking points (3 min):*
- [Say] The repetition is intentional. Day 2 you build a landing page + waitlist. Day 3 you add one AI feature (chat/summarize/classify). Day 4 you wire it full-stack with error/loading states. Same five verbs every day. By Saturday it's muscle memory.
- [Do] Point to deliverables wall: D1 = tools working + "AI Explain" mini-app; D2 = live landing page; D3 = working API call to a model; D4 = end-to-end feature; D5 = repo + architecture + sprint plan.

## Slide 3 — How today runs (mostly hands-on)
Rule: **No concept without code within 10 minutes.**
- I talk 5–10 min → you do 20–30 min → teams share 2 min. Repeat.
- Failure is curriculum: if an API call fails, we debug it live together.
- Keep this tab open: repo README + Slack/Discord #help.

*Talking points (2 min):*
- [Say] "You will get stuck today — Git auth, API keys, model errors. That's the lesson. Bring your error to the mic and we fix it as a class."
- [Do] Show #help channel, feedback card (2 min at end: what worked / what's confusing / what you need tomorrow).

## Slide 4 — Working agreements
1. Verify, don't vibe (yet) — read the diff before you accept it.
2. Small steps, commit often.
3. No secrets in frontend code. Keys live server-side.
4. Ask the agent *then* ask a human — paste what you tried.

*Talking points (2 min):*
- Tie to Dictionary terms you'll reuse: `human-in-the-loop` (you review), `vibe coding` (accepting without review — banned this week except for throwaway prototypes), `automated check` (tests/lint/build decide pass/fail, no judgement).

## Slide 5 — What "done" looks like today
By 12:00 you will have:
1. Git + GitHub + editor + model provider working
2. Made your first agent edit a real repo (commit to prove it)
3. Called an LLM API and can explain tokens/context/tools/agents in plain English
4. 2 product ideas written down for Days 2–4

*Talking points (1 min):* This is your exit ticket. If 1–3 aren't green, stay after or hit office hours — Day 2 assumes them.

---
# SECTION 1 — SWE BASICS (Slides 6–12)

## Slide 6 — The map: how the pieces fit
```
[Prodeation] → [UX/UI Research & Design] → [FE] ⇄ [API] ⇄ [BE] ⇄ [DB]
                                                     ↓
                                           [CI/CD] → [Infra] → [OBS]
```
One user click travels this whole chain. Your job this week: own the whole chain with AI help.

*Talking points (5 min):*
- [Say] "Software engineering isn't just code. It's a pipeline from *problem* to *running system someone can use and you can observe*."
- Walk the diagram left-to-right, then trace a real example: "User taps 'Ask AI for study plan' on your app."
- Name each box in one sentence (detail in next slides). Emphasize: FE/BE/DB/API are *where code lives*; CI/CD/Infra/OBS are *how it ships and stays alive*; Prodeation/UX are *what to build and why*.

## Slide 7 — Prodeation (Product ideation + development)
Problem → users → promise → MVP scope. Output: one-sentence promise + Lean Canvas.
Ex: "Help SS2 students turn past questions into a 7-day study plan in 30 seconds."

*Talking points:*
- [Say] No code yet. Answer: who hurts, what job do they hire your product for, what's the smallest thing that proves value? If you can't say it in one sentence, you're not ready to build.
- [Do] 3-min lightning: each table writes one promise on a sticky. Read 3 aloud. Kill vague ones ("AI for education") — force specific user + outcome.
- Link to Days 2–4 Ideate step: same 10-min exercise daily, faster each time.

## Slide 8 — UX / UI: Research & Design
UX = flow (can a stressed user succeed in 3 taps?). UI = look (can they read it on a small Android + bad network?).
Output: wireframe in Figma / pen-and-paper before code.

*Talking points:*
- [Say] "AI will happily generate a beautiful page that no user can use. Design first, generate second." Show a bad AI landing page (tiny contrast, 6 CTAs) vs. a wireframe (hero → problem → demo → waitlist).
- [Do] Show Figma starter (hero, features, waitlist form). Rule: grayscale wireframe must pass the "mum test" before color.
- Dictionary tie: `design concept` = shared understanding of what's being built, separate from any asset. Get agreement on the concept *before* generating assets.

## Slide 9 — FE ⇄ API ⇄ BE ⇄ DB (the request journey)
- **FE:** what the user sees/touches (React/Vue, HTML/CSS/JS). Owns loading/error/empty states.
- **API:** the contract (e.g. `POST /api/summarize {text} → {bullets}`). Frontend and backend agree here first.
- **BE:** server logic + secrets + model calls (Node/Express, Cloudflare Worker). Keys never ship to browser.
- **DB:** durable memory (Postgres). Stores users, docs, history.

*Talking points (7 min + live demo):*
- [Do] Live-trace in DevTools Network tab: type in your Day-1 "AI Explain" box → `POST /api/explain` → Worker calls `gpt-4o-mini` / Workers AI `llama-3-8b` → JSON back → render. Show request, response, and where the key lives (env, not bundle).
- [Say] "If you remember one architecture sentence: *Frontend → API route → AI model → response → UI.* Everything Days 3–4 is a variation of that."
- Dictionary tie: `environment` = what the agent acts on; for web it's browser + server + DB. `primary source` = the actual code/logs; read those, not summaries, when debugging.

## Slide 10 — CI/CD → Infra → OBS (ship + stay alive)
- **CI/CD:** every push runs checks (lint/type/test/build) then deploys. Green = live.
- **Infra:** where it runs (Cloudflare Pages/Workers, Vercel, Hetzner/k3s for our labs). Free tiers win this week.
- **OBS (Observability):** logs, errors, latency, cost per request. If you can't see it, you can't fix it.

*Talking points:*
- [Say] "Done = deployed + observable. A demo on localhost is not done." Show a GitHub push → Pages deploy → `/healthz` green → log tail with model latency + token counts.
- [Do] Show `.env.example`, branch + PR, and one-click rollback. Homework for Day 5: every team repo must have README + deploy badge.
- Dictionary tie: `automated check` (deterministic: tests/lint/build) vs `automated review` (another agent judging — non-deterministic). You need checks on every PR.

## Slide 11 — Hands-on (10 min): trace the chain
In pairs: open any site you built before. Fill this on paper:
1. Where is FE? BE? DB? Draw the API contract (method + path + JSON).
2. Where would an AI feature plug in? What input/output?
3. What would you monitor (errors? cost? latency)?

*Talking points:* Circulate. Pick 2 pairs to share. Listen for "API as contract" language — correct anyone describing FE calling the model directly with a secret key.

## Slide 12 — Why SWE basics matter *more* with AI
AI writes code fast — so architecture, contracts, and checks are your leverage. Sloppy boundaries + fast generation = fast mess.
Takeaway: **You design the boxes and arrows. AI fills the boxes.**

*Talking points (2 min):*
- [Say] "Copilot makes juniors produce senior *volumes* of code with junior *boundaries*. Your edge is boxes-and-arrows + verification." Preview Section 2: the higher the automation, the more you need specs and reviews.

---
# SECTION 2 — AI DEV INTERFACE: 6 LEVELS (Slides 13–20)

Framing: not "which tool is best" but "how much agency do you delegate?" Higher = faster, but needs more steering.

## Slide 13 — The ladder (overview)
1. Prompt-Copy-Pasta (chat → copy)
2. Lovable / Bolt (prompt → app scaffold)
3. Copilotry (autocomplete in IDE — Copilot, Cursor tab, VSCode++)
4. AgentUI (agentic IDE/harness — OpenCode, Pi, Claude Code)
5. Orchestra (multi-agent coordination — Orca, Paseo, T3 Code)
6. SweFactory Lobe (software factory — triggers start sessions, humans review edges)

*Talking points (2 min):*
- [Say] "We'll climb this ladder today. You leave Level 4 able to work. Levels 5–6 are how teams ship after this week."
- Dictionary anchor: `harness` = everything around the model (tools, system prompt, permissions, context management). Levels 3→6 are progressively smarter harnesses.

## Slide 14 — L1: Prompt, Copy, Pasta
ChatGPT/Claude/Gemini in browser. You prompt, copy code, paste into editor. No repo context. No tools.
Good for: explaining errors, small snippets, learning. Bad for: multi-file changes, secrets, iteration.

*Talking points + micro-demo (4 min):*
- [Do] Paste a JS function, ask: explain → refactor → add error handling → convert to React. Show the failure: ask it to "update my repo" — it can't, it has no tools. That's the ceiling.
- Warn: blind paste = `vibe coding`. Fine for learning, not for shipping.

## Slide 15 — L2: Lovable / Bolt (.diy) — prompt-to-app
Describe app → hosted scaffold + preview + deploy. Great for Day-2 landing pages and clickable prototypes. Ceiling: opaque code, auth/data-model pain, export lock-in.

*Talking points:*
- [Say] "Use L2 to *think with a prototype* — Day 2's 10-minute landing page. Then eject to real code for anything with users, money, or secrets."
- Dictionary tie: `prototyping` = build a rough version when talk is too low-fidelity. L2 is the fastest prototype; don't confuse it with product.

## Slide 16 — L3: Copilotry — Devin, Cursor Tab, VSCode++
Autocomplete + inline chat *inside* your files. Knows open file, suggests next lines, writes tests/docs. You still drive every step.

*Talking points:*
- [Do] Live: trigger a Copilot completion, accept/reject, ask inline chat to "add edge-case tests." Show the habit: read diff, run checks, commit.
- [Say] Best for speed on well-understood tasks. Weak on big refactors across 10 files — that's Level 4.

## Slide 17 — L4: AgentUI — OpenCode, Pi, Claude Code ⭐ (we live here)
The editor *is* the harness: model + tools (Read/Write/Bash/Search) + permissions + session memory. It reads your repo, plans, edits multiple files, runs commands, shows diffs. You supervise turns.

*Talking points (6 min — core of day):*
- [Say] "This is today's upgrade. The agent perceives via `tool results` and acts via `tool calls`. You are human-in-the-loop: approve risky tools, review every diff."
- [Do] Live in OpenCode/Pi: "Add empty + error states to the waitlist form, add a test, run `bun run build`." Narrate: `session` (bounded run starting empty) → `turn` (your message + its tool loop until it yields) → `permission request` (approve Bash?) → `human review` (read diff, not summary).
- Setup note: we use OpenCode + Muse Spark; Zed as editor (below). Keep one session per task; `clearing`/fresh session when it gets dumb (next section explains why).

## Slide 18 — L5: Orchestra — Orca, Paseo, T3 Code
Multiple agents, supervised: dispatcher breaks spec into tickets, workers run in parallel, coordinator reviews. You conduct, not pair.

*Talking points:*
- [Say] "When one session can't hold the whole project, split it. Spec → tickets → parallel sessions → review. That's Days 4–5."
- Dictionary tie: `spec` (multi-session plan) → `ticket` (one-session scope) → `handoff artifact` (doc one session writes for the next). `subagent` runs in its own session and returns one result. Demo only if time; else preview for Day 5.

## Slide 19 — L6: The SweFactory Lobe (Software Factory)
Triggers — not humans — start sessions: new issue → agent implements → checks run → human reviews edge. Most work runs AFK; HITL time saved for judgment.

*Talking points:*
- [Say] "L6 is the repeatable system in your Expected Outcomes. Example: every night, factory triages issues, opens PRs with tests + deploy preview; you review over coffee. Dark factory (no human ever reviews) is banned here — everything ships with human review."
- Dictionary tie: `software factory` vs `dark factory`, `AFK` vs `human-in-the-loop`, `memory system`/`AGENTS.md` as the factory's standing brief.

## Slide 20 — Where we live this week (hands-on rule)
- Days 1–2: L4 for everything (one session, small tickets).
- Days 3–4: L4 + L5 habits (spec + tickets + handoffs).
- Day 5: L5/L6 rehearsal (factory builds, humans conduct + review).
- L1–L2 for learning and throwaway prototypes only.

*Talking points + check (3 min):*
- [Ask] "Who can name the level where the tool can edit 5 files and run the build? … Level 4. Who can name what starts sessions in Level 6? … Triggers."
- [Do] 5-min exercise: in your current editor, do one L1 task (explain a function in chat) then the *same* task in L4 (ask agent in-repo to add a test). Compare: which knew your files? Which could run checks?

---
# SECTION 3 — TOOLING SETUP (Slides 21–25) — LIVE, ALL HANDS

Goal: everyone green before LLM theory. No one watches — everyone types. TAs roam with checklist.

## Slide 21 — Checklist (definition of green)
- [ ] Git installed (`git --version`) + configured (name/email)
- [ ] GitHub account + SSH or HTTPS auth + can clone + push
- [ ] Node/Bun + repo cloned + `bun install` + `bun run build` passes
- [ ] Model provider works (Rec: OpenCode Go / Muse Spark key in env, never in code)
- [ ] Editor works (Rec: Zed) + OpenCode/Pi extension + first agent edit committed
- [ ] Design account (Figma free / Open Design) — can open wireframe

*Talking points:* "Green means you pushed a commit made with the agent and the build passed. Screenshots don't count."

## Slide 22 — Git + GitHub (5 min)
`git clone → branch → commit → push → PR`. One branch per task. Conventional messages.

*Talking points + do:*
- [Do] Together: `git config`, clone course repo, `git checkout -b day1/<name>`, empty commit, push, open PR. Fix SSH vs HTTPS + token scope live. This unblocks Day 5 repo work now.
- Pitfall callout: committing `.env` or `node_modules`. Show `.gitignore` + `.env.example`.

## Slide 23 — Model provider + keys (5 min)
Rec: OpenCode Go (or bootcamp key). Put key in `.env`, never in frontend. Verify with one cheap call (`gpt-4o-mini` / `llama-3-8b`).

*Talking points:*
- [Say] Keys live server-side (Worker/Node). Frontend calls *your* API, your API calls the model. If your key leaks, revoke + rotate — demo where to rotate.
- Cost note (preview of tokens): input cheaper than output; reasoning effort costs output tokens. Start on mini/small models; upscale only when stuck.

## Slide 24 — Editor: Zed + OpenCode/Pi (10 min) ⭐
Install Zed, add OpenCode/Pi, open repo, run first agentic turn: "Add a health check section to README + verify build."

*Talking points + do:*
- [Do] Narrate permissions: Approve Read (auto), approve Bash (ask). Show session pane, diff view, `clear` when looping. Everyone must produce: 1 agent commit on their branch before we move on.
- [Say] "If the agent is confused, it needs context, not shouting. Point it at primary sources: 'read src/api/explain.ts and the log, then fix.'"

## Slide 25 — Design + verify (5 min)
Open the Figma/Open Design starter, duplicate it, rename for your team. Then run: `bun run build`, `bun run test` (or lint). Paste green output in #day1-proof with your PR link.

*Talking points:* TAs mark green/red on a visible board. Reds get help during the break — no one enters LLM Fundamentals with broken tools, or the theory won't stick.

---
# SECTION 4 — LLM FUNDAMENTALS (Slides 26–38)
*How to think so you can steer. Follows AI Hero's 5 lessons, compressed to 40 min with demos. Use plain English + one live call.*

## Slide 26 — The one-sentence mental model
**A model predicts the next token. A harness turns it into an agent. You steer with context, tools, and checks.**
- `model` = parameters only, stateless, does next-token prediction and nothing else.
- `harness` (OpenCode/Pi/Cursor) = tools + system prompt + permissions + context management.
- `agent` = model in motion: model + harness + tools + context, taking turns with you.

*Talking points (3 min):*
- [Say, from AI Hero + Dictionary] "AI is powerful but weird. If you don't know its constraints, you can't work around them. The constraints are: tokens, context window, tools, and attention. Learn those and you have an unfair advantage."
- [Ask] "If the model is stateless, where does memory live?" → In the harness/session (context you carry). That answer unlocks the next 5 slides.

## Slide 27 — Messages, system prompts, reasoning (Lesson 1)
Every request = ordered messages: `system` (standing brief, prepended every time) → `user`/`assistant` turns → optional `reasoning` (scratchpad) → final answer + `tool calls`.
- `system prompt`: stable instructions ("You are a senior TS dev. Prefer small diffs, run checks…").
- `reasoning/effort`: dial for how much the model thinks before answering. More effort = more output tokens = better shot at hard problems, higher cost/latency.
- `turn` = your message + everything the agent does until it yields. Contains 1+ provider requests.

*Talking points + demo (5 min):*
- [Do] Show the same prompt with two system prompts ("terse senior" vs "tutorial for beginners") — compare output. Then low vs high effort on a tricky bug — show token/cost delta.
- [Say] "Your `AGENTS.md` *is* a system prompt for coding agents — the project's standing brief loaded at session start. Write it like you'd brief a smart new hire."
- Pitfall: stuffing the system prompt with 40 rules slows everything (attention + cost). Keep it short; use `skills` + `progressive disclosure` (load detail only when needed via context pointers).

## Slide 28 — Tokens (Lesson 2)
`token` ≈ word-piece, not a word. Everything counts in tokens: context size, cost, latency. Input tokens (you send) billed lower; output tokens (model writes, incl. reasoning) billed higher; cached prefix tokens cheapest.

*Talking points + demo (4 min):*
- [Do] Live tokenizer: "tokenization" → 3–4 tokens; code vs prose; emoji. Show billing line from a real call: input / output / cached. Rule of thumb: 1 page ≈ 2k tokens; 1 min of reasoning ≈ hundreds of output tokens.
- [Say] "Why seniors care: every extra tool, doc, orchat history you load costs money and latency on *every* request. Spend tokens like money — because they are."
- Dictionary: `prefix cache` (provider skips reprocessing shared prefix) → keep system prompt + hot files stable across turns to hit cache.

## Slide 29 — Context window (Lesson 3) — your agent's entire world
`context window` = everything the model sees on one request. Finite, model-specific. `context` = the relevant slice you give it right now. `session` accumulates turns until it fills.

*Talking points (4 min):*
- [Say] "The model perceives *only* through the context window. If the doc isn't loaded, it doesn't exist. If you load 200 files, the important one drowns."
- Three laws (AI Hero):
  1. Overstuffing backfires — more ≠ better.
  2. Lost in the middle — models overweight start/end, underweight middle.
  3. Smart zone → dumb zone — early session = sharp; long session = sloppy, forgetful, more mistakes (`attention degradation`: each token's influence spreads thinner as N grows, ~N² pairings).
- Habits: one task per session; put the ask + key files first/last; `clearing`/fresh session + `handoff artifact` when drifting; prefer `primary sources` (code/logs) over pasted summaries.

## Slide 30 — Hands-on: feel the window break (7 min)
1. In a fresh session, ask a good question with 2 files loaded → note quality.
2. Now paste 10 files + full chat history and ask again → note drift/vagueness.
3. Run `/clear` (or new session), write a 5-line handoff note (goal, files, next step), paste into fresh session, retry.

*Talking points:* Debrief: "Who felt the dumb zone? What did the handoff note save?" Make the rule physical: when you repeat yourself twice, clear + hand off.

## Slide 31 — Tools: how the agent touches the world (Lesson 4)
`tool` = function you expose (Read/Write/Bash/Search, MCP servers). `tool call` = model outputs structured text naming tool + args. Harness executes. `tool result` (file/output/error) comes back into context. That's the *only* way the agent sees your repo.

*Talking points + demo (5 min):*
- [Do] Trace one turn in OpenCode: user msg → provider request → tool call `Read src/api/explain.ts` → tool result → next request → tool call `Bash bun run build` → result → final answer. Show JSON of a tool call.
- Rules (AI Hero: too many tools slows it down):
  1. Few, sharp tools beat 40 vague ones (each tool definition costs tokens + attention every turn).
  2. Names + descriptions are UI for the model — "read_file(path)" beats "util2".
  3. Prefer MCP servers over pasting docs (live tools > stale paste = `contextual knowledge` beats `parametric knowledge`).
- Permissions: `permission mode` decides what auto-runs vs asks. Auto-approve Read/Search; require approval for Write/Bash/network. `sandbox` limits blast radius.

## Slide 32 — Agents vs workflows (Lesson 5) ⭐
- `agent` = improvises: you give goal + tools, it decides steps per turn. Great for unknown paths, worse for repeatability/cost.
- `workflow` = fixed path you define (steps, checks, gates). Great for repeatable team work (spec→ticket→implement→check→review), worse for novel exploration.
- This week: **agents to explore, workflows to ship.**

*Talking points:*
- [Say, from AI Hero] "Agents improvise; workflows optimize for predictable, repeatable tasks. If you need the same thing done 30 times, don't pray to an agent — write the workflow, add automated checks, keep human review at the gate."
- Map to Days 2–5: Day 2 = agent exploration; Day 3+ = workflow (our Ideate→Design→Spec→Build→Deploy loop *is* the workflow); Day 5 factory = triggers + workflows + human review.

## Slide 33 — Failure modes you must design for
- `hallucination` (confidently wrong: invented facts or drift from context) + `sycophancy` (confidently agreeable — "great idea!" to a bad plan).
- `parametric knowledge` (frozen at training) vs `contextual knowledge` (what's loaded now). Post-`knowledge cutoff` APIs are fabrication traps — load docs via tools.
- `non-determinism`: same input → different output. Never rely on exact wording; rely on checks.

*Talking points + demo (3 min):*
- [Do] Ask model about a library version past its cutoff without docs → watch it invent an API. Then load the doc via tool/MCP and ask again → correct. Lesson: "Don't argue with the model. Give it the primary source."
- Counter-moves: demand diffs + test output (not claims), run automated checks, require human review, grill big decisions (`grilling` = Socratic interview, one decision at a time) before building.

## Slide 34 — Cost + latency + quality (the triangle)
Quality ↑ = effort ↑ = output tokens ↑ = cost ↑ + latency ↑. Context ↑ = input tokens ↑ + attention ↓.
Levers: smaller model first, low effort first, cache-friendly prompts, fewer tools, fresh sessions, progressive disclosure.

*Talking points:*
- Show a real invoice line: 3-turn session cost. "A sloppy 50-turn session with 30 tools costs 20× a sharp 5-turn session with 5 tools — and gets a worse answer." This justifies every habit above.

## Slide 35 — Memory & steering (how teams stay sharp)
Sessions are stateless by default. To persist: `AGENTS.md` (standing brief) + `memory system` (persist + reload) + `skills` (teachable units loaded only when needed) + handoff artifacts (spec/ticket/compaction summary).

*Talking points:*
- [Say] "Don't keep everything in chat. Keep the *project's* brain in files: AGENTS.md for always-on rules, skills for on-demand capabilities, spec/ticket for multi-session work, compaction summary when you must continue in a fresh session."
- [Do] Show this repo's `AGENTS.md` + one skill + one ticket template. Rule: secondary sources (summaries) are cheap but lossy — link to primary sources so the next session can pull full context.

## Slide 36 — Guided lab (15 min): build "AI Explain"
Everyone: build the one-page tool — paste code → get plain-English explanation via your backend → render.
1. Scaffold FE (input + button + output + loading/error states).
2. Add `POST /api/explain` on backend; key in env; structured prompt ("Explain in 5 bullets for a junior, flag risks").
3. Call from FE, render, deploy preview, paste URL in #day1-proof.
Stretch: add reasoning-effort toggle (low/high) and show token counts.

*Talking points (facilitator):* Roam for the 3 classic bugs: CORS, key in frontend, missing loading state. Debug one live as class. Require: working URL + PR + green build = Day-1 individual deliverable.

## Slide 37 — Team build (15 min): problem → AI feature sketch
In table teams: pick 2–3 real problems you care about (agriculture, education, health, finance, jobs, local services). For each: user → promise → AI feature (chat/summarize/classify/search) → input/output JSON → what you'd monitor.

*Talking points:* Output = problem-solution sketch + feature spec stub on paper/shared doc. This seeds Day 2 landing pages. Remind roles (Product, AI/Backend, Frontend, UX/Content, Business/Pitch — rotate daily).

## Slide 38 — LLM Fundamentals in one page (cheat sheet)
Model predicts tokens · Harness makes it an agent · System prompt = standing brief · Effort = reasoning dial (costs output tokens) · Tokens = money+latency · Context window = finite world (don't overstuff; ends beat middle; fresh sessions beat long ones) · Tools = only hands (few + sharp + approved) · Agent improvises, workflow repeats · Verify with checks + human review, never vibes.

*Talking points (1 min):* "Screenshot this. Every bug Days 2–6 is one of these 8 lines."

---
# SECTION 5 — EXPECTED OUTCOMES + CLOSE (Slides 39–43)

## Slide 39 — Expected outcomes (the 3 builds)
By Demo Day you will have built:
1. **Build ideas** — portfolio of scoped promises + landing pages + Lean Canvases (Days 2–5).
2. **Build in-app AI feature(s)** — at least one live: chat with history, summarizer, classifier/tagger, or RAG FAQ over your own doc.
3. **Build repeatable system** — your L5/L6 workflow: AGENTS.md + skills + spec→ticket→check→review + deploy pipeline. Triggers start work; humans judge.

*Talking points (3 min):*
- [Say] "Ideas prove you can *find* value. Features prove you can *build* value. Systems prove you can *repeat* value without burning out. Employers and judges pay for #3."
- Show example: same team, Day 2 landing → Day 3 isolated API call → Day 4 wired feature with spinner/errors/retry → Day 5 architecture + Kanban + repo. That's the reel.

## Slide 40 — What good looks like Saturday (judging preview)
- Innovation: real problem, novel AI angle (not chatbot-on-PDF for its own sake).
- Feasibility: could *you* build it further with these skills/tools?
- Presentation: problem → demo (live, not slides) → architecture → next step, 5–7 min.
- Collaboration: all 5 voices, all 5 commits.

*Talking points:* "Judges mirror workshop values. Start your README now — problem, solution, AI feature, setup, demo link, roles — and update it daily. No README, no hiring signal."

## Slide 41 — Homework (do tonight, 30 min)
1. Watch one AI Hero lesson you found hardest (tokens / context / tools / agents) + post your one-line takeaway.
2. Bring 2 AI-feature ideas with input/output JSON sketched.
3. Green your tools if yellow/red (office hours posted). Update landing copy from Lean Canvas if you have it.

*Talking points:* Low friction, high return. Tomorrow assumes green tools + one idea.

## Slide 42 — Exit ticket (2 min, on paper/Slack)
1. In one sentence: model vs harness vs agent?
2. Where does your API key live and why?
3. What will you do when the agent gets dumb?
Plus: What worked? What's confusing? What do you need tomorrow?

*Talking points:* Collect. Read 3 aloud tomorrow at warm-up. Adjust Day 2 emphasis based on confusion clusters.

## Slide 43 — Close: you are builders now
"You came in knowing pages. You leave today knowing *systems*: request journeys, agent turns, tokens, and checks. Tomorrow we ship a landing page before 11am. Rest your machines, charge yourselves."

*Talking points (1 min):* Show Day-2 teaser (10-minute prototype challenge). Dismiss by teams with PR links held high. TAs stay for reds.

---
# APPENDIX (not presented, linked as handout)

## A. Glossary (from AI Coding Dictionary, plain-English subset for Day 1)
Model, parameters, training, inference, token, next-token prediction, non-determinism, model provider, harness, provider request, input/output/cache tokens, prefix cache, stateless/stateful, context, context window, agent, system prompt, session, turn, environment, filesystem, tool, tool call/result, MCP, permission request/mode, agent mode, sandbox, sycophancy, hallucination, parametric/contextual knowledge, knowledge cutoff, attention relationship/budget/degradation, smart zone, clearing, handoff, primary/secondary source, handoff artifact, spec, ticket, compaction, memory system, AGENTS.md, progressive disclosure, context pointer, skill, subagent, human-in-the-loop, AFK, automated check/review, human review, vibe coding, design concept, grilling, prototyping, DX/AX, software/dark factory.

## B. Setup troubleshooting (top 6)
1. `git push` asks for password → use PAT/SSH, check scope `repo`. 2. `bun install` fails → Node/Bun version, delete lock + retry. 3. Model 401 → key wrong env var, restart shell/IDE. 4. CORS on `/api/*` → call same-origin route, key server-side only. 5. Agent loops → `/clear`, 5-line handoff, fewer files. 6. Build fails after agent edit → read diff, `bun run build` log is primary source, paste error + file into fresh session.

## C. Facilitator checklist
Print week board, green/red board, sticky notes, backup USB with installers + offline docs, bootcamp-managed keys, 2 pre-built "AI Explain" fallbacks (one good, one broken for live debug), timer visible, feedback cards.

## D. Slide-to-lab mapping
S6–12 → 10-min chain-trace. S13–20 → 5-min L1-vs-L4 compare. S21–25 → 30-min setup (must-green). S26–35 → 7-min window-break + 15-min AI Explain build + 15-min team sketch. S39–43 → exit + homework.
