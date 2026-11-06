# AI Build Workshop — Dual-Track Curriculum

## Workshop Overview

This curriculum teaches **how to use AI to build with the best results** — a repeatable, tool-agnostic way of building *with* AI as a teammate. Building *AI-enabled products* (chatbots, recommenders, summarizers) is the motivating context and the weekly project vehicle, but it is **secondary**: the durable skill is AI-assisted building — briefing AI well, generating fast, verifying rigorously, and iterating to a shippable prototype.

It is designed for the 7-Day AI & Innovation Bootcamp and runs from **9:00 AM to 12:00 PM, Monday through Friday**.

The workshop uses a **dual-track** format (same process, different execution):

- **Track A: Lightweight Stack** — for participants with little or no coding background. Uses no-code/low-code tools, forms, spreadsheets, automations, and AI assistants.
- **Track B: Advanced Stack** — for participants with web development or programming background. Uses code, databases, APIs, and full-stack deployment.

Both tracks follow the **same daily process and class build**, but apply it with different tools. Teams may choose one track or mix members across tracks depending on the project.

**Cohort Structure**
- 30 participants
- 6 teams of 5 members each
- Team roles rotate daily: Vision Lead, Product/UX Lead, AI/Prompts Lead, Build/Operations Lead, Growth/Pitch Lead

**Assumed Baseline**
- All participants: comfortable with a computer, browser, and common apps
- Track A: no coding required
- Track B: assumes familiarity with HTML/CSS/JS, Git, and basic backend/frontend concepts

**Workshop Goal (primary: build WITH AI)**
By Friday, every participant should be able to:
1. Brief AI effectively: give context → task → constraints → format → checks, and iterate when output is weak.
2. Generate fast with AI (pages, copy, workflows, code, data, decks) then verify: test, debug, cross-check, and fix — never ship unverified AI output.
3. Use AI across the full build arc: frame → scaffold → add logic/data → polish/test → pitch, keeping a prompt + decision log.
4. Apply the same AI-build habits in their chosen stack (Lightweight or Advanced) and explain *how AI helped them build* on Demo Day.
5. (Secondary / applied context) Ship a prototype that *contains* a clear "AI moment" where intelligence adds user value, with fallback behavior when the AI fails.

---

## The Two Loops (read this first)

**Primary loop — Build WITH AI (taught every day).** This is the graded, durable skill:

1. **Brief** — Give AI sharp context: who/what/stack, task, constraints, desired format, how to verify.
2. **Generate** — Produce a fast first draft (copy, page, workflow, code, prompt, deck).
3. **Verify** — Test it: click through, check edge cases, compare against requirements, ask AI to critique itself.
4. **Refine** — Iterate with follow-up prompts: "keep X, fix Y, add Z"; log what changed and why.
5. **Integrate & own** — Merge the best AI output into the team's prototype; the team — not the AI — owns quality.

**Secondary loop — Build AI INTO the product (the weekly project context).** The class example (AgriLink) and team projects happen to include an "AI moment" (generate / classify / summarize / recommend / converse), so participants also practice:

1. See the problem → 2. Find the AI moment → 3. Design the interaction → 4. Shape the intelligence → 5. Prototype cheaply → 6. Test with humans → 7. Tell the story.

Facilitator rule: whenever the class designs an AI *feature*, narrate the AI-assisted *process* out loud — show the prompt used, the bad first output, the fix, and the verification step. The feature is the demo; the process is the lesson.

---

## Daily Format (9:00 AM — 12:00 PM)

| Time | Segment | Purpose |
|------|---------|---------|
| 9:00 — 9:15 | **Warm-up & Recall** | Review yesterday's step, share wins and blockers |
| 9:15 — 9:45 | **Concept Block** | Instructor-led: today's AI-build skill, live demoed (including a deliberately bad first AI output + fix) |
| 9:45 — 10:45 | **Guided Class Build** | Everyone builds the same example problem together, split by track — facilitator narrates every AI prompt |
| 10:45 — 11:00 | **Break** | |
| 11:00 — 11:40 | **Team Application** | Each team applies the same AI-build skill to their own project; log prompts + changes |
| 11:40 — 12:00 | **Show & Share** | 2-min demos incl. "best prompt, worst output, how we fixed/verified it" |

---

## The Two Tracks

### Track A: Lightweight Stack

For participants who want to build without writing code.

**Typical tools:**
- AI assistants: ChatGPT, Claude, Gemini
- Landing pages/forms: Carrd, Typedream, Tally, Typeform, Google Forms
- Databases: Airtable, Google Sheets, Notion
- Automations: Make, Zapier, Notion automations
- Chatbots: Chatbase, Botpress, Voiceflow
- Design and decks: Figma, FigJam, Canva, Gamma, Tome
- Demos: Loom, Tella, screen recording

**Typical outputs:**
- Live landing page with form
- Automated workflow (form → AI summary → email/notification)
- Chatbot trained on a document
- Pitch deck and recorded walkthrough

### Track B: Advanced Stack

For participants who want to build with code.

**Typical tools:**
- Editor/IDE: VS Code
- Frontend: React / Next.js / Vue / plain HTML+JS
- Backend/serverless: Node.js + Express, Python + FastAPI, or Cloudflare Workers
- AI APIs: Cloudflare Workers AI, OpenAI, Anthropic, Gemini, Hugging Face
- Databases: SQLite, PostgreSQL, Supabase, MongoDB
- Version control: Git + GitHub
- Deployment: Vercel, Netlify, Cloudflare Pages, Railway, Render

**Typical outputs:**
- Full-stack web app with AI integration
- Custom API endpoint calling an AI model
- Database-backed user flows
- Live deployed prototype

### Mixing Tracks Within a Team

Teams may mix Track A and Track B members. For example:
- Track A members own the landing page, pitch deck, user interviews, and workflow design.
- Track B members own the custom web app, API integration, and database.
- Both tracks collaborate on the problem framing, user journey, prompts, and pitch story.

---

## Pre-Selected Problem Domains

To reduce decision fatigue and keep the class build coherent, the bootcamp provides a menu of problem domains. Teams may pick from this menu or propose their own by Day 2.

1. **Agriculture & Food:** Help smallholder farmers get advice, market prices, or buyers.
2. **Education & Skills:** Create a personalized learning or career-prep assistant.
3. **Health & Wellness:** Build a symptom checker, appointment helper, or mental health check-in.
4. **Jobs & Employment:** Help job seekers prepare resumes, find opportunities, or practice interviews.
5. **Local Services:** Match people with verified artisans, vendors, or service providers.
6. **Small Business:** Help entrepreneurs create content, manage customers, or track finances.

---

## Example Class Build Problem

The daily class build uses a single shared example so everyone can follow the same process:

> **"AgriLink" — A service that helps urban Nigerians find fresh produce from nearby farms and ask an AI assistant what to cook with it."

Each day advances this example one step further. By Friday the class has walked through a complete AI product build from problem to pitch.

Teams then apply the same day's step to their own problem.

---

## Day 1 — Brief AI Well: From Vague Idea to Sharp Build Brief

**Theme:** Turn a vague issue into a sharply framed problem *by briefing AI well* — and identify where AI adds value in the product.

**AI-build skill of the day:** Write a build brief AI can act on (context → task → constraints → format → checks). Anti-pattern: "make a website for my business." Pattern: scoped brief + success criteria + "ask me 3 clarifying questions first."

### Learning Objectives
- Brief AI to help frame a problem: generate stakeholder maps, problem variants, and "AI moment" candidates — then *choose* (human judgment, not AI output).
- Ask good problem-framing questions: who, what, when, where, why, how often?
- Distinguish symptoms from root causes.
- Write a one-page concept brief *with AI assistance* and log the prompts used.

### Concept Block (9:15 — 9:45)
1. **What is a good problem?** — 15 min
   - Specific person + specific pain + cost of not solving
   - Bad: "farmers need help" → Good: "urban buyers cannot find fresh yams at fair prices on weekdays"
2. **Where does AI fit?** — 15 min
   - Generate: produce text, images, code, ideas
   - Classify: sort, tag, score, route
   - Summarize: condense long content
   - Recommend: match users to options
   - Converse: answer questions in natural language
3. **Class example:** Reframe "food access" into the AgriLink problem statement and AI moments.

### Guided Class Build (9:45 — 10:45)

**All tracks together:**
- Define the AgriLink user: an urban professional who wants fresh farm produce.
- Map stakeholders: buyer, farmer, delivery person, market coordinator.
- Identify three AI moments: (1) natural-language produce search, (2) recipe suggestions based on available produce, (3) price/farmer matching.
- Vote on the highest-value AI moment to prototype first.

**Track A activity:**
- Use a shared doc or FigJam board to fill out a one-page concept brief:
  - Problem
  - User
  - Current workaround
  - AI moment
  - What success looks like

**Track B activity:**
- Same concept brief, plus a technical feasibility note:
  - What data would the AI need?
  - What API or model could power it?
  - What are the main technical risks?

### Team Application (11:00 — 11:40)
- Each team selects or proposes a problem.
- Complete the one-page concept brief.
- Identify 2-3 AI moments and rank them by value and feasibility.
- Choose the top AI moment to focus on this week.

### Deliverables
- Class: AgriLink concept brief + prompt log (briefing prompts + best/worst outputs)
- Team: Own concept brief + chosen AI moment + prompt log

### Homework
- Talk to one potential user about the problem.
- Bring notes: what did they currently do? What frustrated them?

---

## Day 2 — Generate Fast: Scaffold the Journey & First Draft

**Theme:** Map the user's path *by generating drafts with AI in minutes*, then editing like an owner.

**AI-build skill of the day:** Scaffold-then-sculpt: ask AI for a journey map / page / workflow draft, then critique it ("what's missing? what's wrong for our user?") and regenerate. Verification habit: click every step as a user would.

### Learning Objectives
- Build a user journey map with concrete steps.
- Identify inputs, outputs, and handoff points for the AI moment.
- Decide what the AI does vs. what humans or rules do.
- Create a low-fidelity flow diagram.

### Concept Block (9:15 — 9:45)
1. **User journey mapping** — 15 min
   - Discovery → First action → Core interaction → Value delivery → Follow-up
   - For each step: user thought, user action, system response, emotion
2. **Designing the AI interaction** — 15 min
   - What does the user put in? (text, image, voice, click, upload)
   - What does the AI return? (answer, recommendation, summary, action)
   - What happens when the AI is wrong or uncertain?
3. **Class example:** Map AgriLink's journey from "hears about service" to "receives produce and recipe."

### Guided Class Build (9:45 — 10:45)

**All tracks together:**
- Draw the AgriLink journey on a shared whiteboard/FigJam.
- Mark the AI moment: "User asks: What can I cook with yam and tomatoes?"
- Design the interaction:
  - Input: text or voice message
  - AI task: suggest recipes using available produce
  - Output: 3 recipes with estimated cost and prep time
  - Fallback: "I couldn't find a match. Here are popular recipes with yam."

**Track A activity:**
- Create a paper or FigJam storyboard of the journey.
- Design a simple chat or form interaction using sticky notes or wireframes.

**Track B activity:**
- Same storyboard, plus a data flow sketch:
  - Frontend collects input
  - Backend receives input, builds prompt, calls AI model
  - AI returns structured JSON
  - Frontend renders recipes
- Identify required data structures.

### Team Application (11:00 — 11:40)
- Map the team's chosen user journey.
- Design the specific AI interaction: input, output, fallback.
- Produce a journey map and interaction design.

### Deliverables
- Class: AgriLink journey map + interaction design + prompt log (scaffold prompt + critique prompt)
- Team: Journey map + interaction design for own project + prompt log

### Homework
- Show the journey map to a potential user and ask: "Would you use this? What is missing?"

---

## Day 3 — Verify & Shape: Prompts, Guardrails, Debugging

**Theme:** Translate the interaction into clear instructions that produce *reliable* AI outputs — and learn to debug AI like code.

**AI-build skill of the day:** Constrain + test + harden: role/task/context/constraints/format, few-shot examples, edge-case tests, fallbacks. Applies both to *product prompts* (the AI feature) and *builder prompts* (Track B: ask AI to write/debug the API call; Track A: ask AI to write the automation steps).

### Learning Objectives
- Write effective prompts or system instructions.
- Provide context, examples, and desired output format.
- Plan for failure: wrong answers, missing data, harmful outputs.
- Test the AI output quickly before building the full app.

### Concept Block (9:15 — 9:45)
1. **Prompts as product design** — 15 min
   - Role, task, context, constraints, format
   - The difference between a vague request and a sharp instruction
2. **Examples and guardrails** — 15 min
   - Few-shot examples
   - Output format: JSON, bullet list, table
   - Fallback behavior when the AI fails
3. **Class example:** Write and test the AgriLink recipe-suggestion prompt.

### Guided Class Build (9:45 — 10:45)

**All tracks together:**
- Draft the system instruction for AgriLink:
  - "You are a Nigerian cooking assistant. Given a list of available produce, suggest 3 affordable, quick-to-prepare Nigerian recipes."
- Test the prompt with several inputs:
  - "yam, tomatoes, peppers"
  - "plantain, eggs"
  - "rice, beans, nothing else"
- Refine based on outputs: add constraints, format, fallback.

**Track A activity:**
- Create a prompt template in a shared doc.
- Manually run the prompt using ChatGPT/Claude and paste outputs into a spreadsheet.
- Evaluate outputs against criteria: useful, accurate, safe, culturally appropriate.

**Track B activity:**
- Same prompt template, then implement it in a serverless function or script.
- Call the AI API and log the raw response.
- Parse the response into structured data and handle errors.

### Team Application (11:00 — 11:40)
- Draft the prompt/system instruction for the team's AI moment.
- Define output format and fallback behavior.
- Test the prompt with 3-5 sample inputs.
- Refine based on results.

### Deliverables
- Class: AgriLink refined prompt + sample outputs (incl. 1 failure + fix) + verification checklist
- Team: Refined prompt + sample outputs + fallback rules + verification checklist

### Homework
- Find 2 edge cases where your prompt might fail and plan fallbacks.

---

## Day 4 — Integrate & Test: Cheapest Prototype That Proves It

**Theme:** Build the cheapest version that proves the value — AI does the heavy lifting, humans verify with real users.

**AI-build skill of the day:** Build-measure-fix loop with AI: generate the prototype (Track A: form/chat/automation; Track B: form + API + deploy), then use AI to draft test scripts, summarize user feedback, and propose fixes — but humans run the tests and decide.

### Learning Objectives
- Choose the right fidelity for the prototype.
- Build quickly without getting stuck on polish.
- Run a lightweight user test and capture feedback.
- Iterate in a single session.

### Concept Block (9:15 — 9:45)
1. **Prototype fidelity** — 10 min
   - Paper → clickable mockup → scripted demo → working automation → full app
   - Choose the lowest fidelity that still tests the riskiest assumption
2. **The "wizard of oz" method** — 10 min
   - Humans power the backend while the interface looks automated
3. **User testing in 15 minutes** — 15 min
   - Give the user a task, watch, ask questions, avoid leading
   - Record what they do, not what they say they would do
4. **Class example:** Decide the right prototype for AgriLink.

### Guided Class Build (9:45 — 10:45)

**All tracks together:**
- AgriLink riskiest assumption: "People will trust and use AI-generated recipe suggestions based on available produce."
- Choose the prototype:
  - Track A: WhatsApp-style chat simulation using a form + AI-generated responses
  - Track B: Simple web form that sends produce list to backend and returns recipes

**Track A activity:**
- Build a chat-style form in Tally/Typeform.
- Connect it to a spreadsheet where responses are stored.
- Use the Day 3 prompt to manually generate sample replies and paste them into a response email or message template.
- Test with a neighbor.

**Track B activity:**
- Build a minimal frontend form.
- Connect it to the backend function from Day 3.
- Return and render the AI-generated recipes.
- Add basic error handling.
- Deploy to a free host if possible.

### Team Application (11:00 — 11:40)
- Each team builds the cheapest prototype of their AI moment.
- Run at least one user test with another team or a mentor.
- Capture feedback and list 3 immediate fixes or learnings.

### Deliverables
- Class: AgriLink working/faked prototype + test notes + iteration log (AI-suggested fixes vs. human decisions)
- Team: Working/faked prototype + user test notes + iteration backlog

### Homework
- Run 2 more user tests and update the prototype.
- Record a 1-minute Loom-style walkthrough.

---

## Day 5 — Own It & Tell the Story: Pitch, Plan & Demo Prep

**Theme:** Tell two stories: the product story *and* the build story (how AI helped you build it) — and lock the Saturday plan.

**AI-build skill of the day:** Use AI as pitch coach and planner: generate deck outlines, critique the pitch ("where would a judge poke holes?"), draft the sprint board — then humans rehearse, assign owners, and own the demo (incl. offline fallback).

### Learning Objectives
- Structure a 3-5 minute founder pitch.
- Communicate the problem, AI moment, demo, business model, and team story.
- Create a simple architecture or process diagram.
- Lock the Saturday sprint plan.

### Concept Block (9:15 — 9:45)
1. **The founder pitch formula** — 20 min
   - Hook: why this matters now
   - Problem: who feels pain and how much
   - Solution: demo the prototype
   - AI moment: what the intelligence does
   - Model: how it could sustain itself
   - Validation: what users said
   - Team: why this team
   - Ask: what you need next
2. **Architecture diagrams that anyone can understand** — 10 min
   - User → interface → intelligence → data/output
   - No complex UML required; boxes and arrows are enough
3. **Class example:** Build and deliver the AgriLink pitch as a class.

### Guided Class Build (9:45 — 10:45)

**All tracks together:**
- Co-create the AgriLink pitch deck or one-pager.
- Draw the AgriLink architecture diagram:
  - Buyer enters produce on landing page
  - AI suggests recipes and matches to nearby farms
  - Farmer receives order notification
  - Delivery is coordinated

**Track A activity:**
- Build a pitch deck in Canva/Gamma/Tome.
- Include screenshots or wireframes of the prototype.
- Record a 2-minute pitch walkthrough.

**Track B activity:**
- Same pitch content, plus a technical architecture diagram.
- Note the API, database, and deployment choices.
- Prepare a live demo script with fallback screenshots in case the app fails.

### Team Application (11:00 — 11:40)
- Each team finalizes their pitch deck and architecture diagram.
- Assign speaking roles for Demo Day.
- Create the Saturday sprint plan:
  - What must be built/polished?
  - Who owns each task?
  - What are the blockers?

### Deliverables
- Class: AgriLink pitch deck + architecture diagram + "how AI built this" appendix (3 best prompts)
- Team: Pitch deck, architecture diagram, Demo Day speaking roles, Saturday sprint plan, "how AI built this" appendix

### Homework
- Practice the pitch as a team.
- Prepare for Saturday.

---

## Saturday Hackathon Flow

The Saturday hackathon gives teams focused time to polish prototypes, rehearse demos, and deliver final pitches.

| Time | Focus |
|------|-------|
| 9:00 AM — 12:00 PM | Build/polish: fix the highest-priority items from Friday's sprint plan |
| 12:00 PM — 1:00 PM | Lunch + mentor pitch rehearsal |
| 1:00 PM — 4:00 PM | Final user tests, demo recording, pitch refinement |
| 4:00 PM — 5:00 PM | Dress rehearsal and final feedback |
| 6:00 PM — 9:00 PM | Demo Day pitches and judging |

**Demo Day pitch format:** 5 minutes pitch + 2 minutes Q&A per team.

---

## Demo Day Judging Criteria

- **AI-assisted build craft (primary):** Can the team show *how* they used AI to build — briefs, iterations, verification, fixes? (prompt log / build story required.)
- **Innovation:** Does the idea use AI in a meaningful or novel way?
- **Problem Clarity:** Is the problem sharply defined and worth solving?
- **AI Moment:** Is it clear where intelligence adds value?
- **Prototype Quality:** Is there a working or convincingly faked version?
- **User Validation:** Did the team show evidence of testing with real users?
- **Feasibility:** Can this team realistically build or sustain this product?
- **Presentation:** Is the pitch clear, compelling, and well-rehearsed?
- **Collaboration:** Did all team members contribute?

---

## Facilitator Notes

- **Process first, tools second — and process means AI-build process.** Teach Brief → Generate → Verify → Refine → Own daily. Whenever AI produces output live, show the prompt, show a bad output, fix it, verify it.
- **Require a prompt + decision log.** Every team artifact ships with: prompts tried, what changed, what was verified, what humans decided. No log = incomplete deliverable.
- **One shared example.** The AgriLink example gives the whole cohort a common reference, but teams should feel free to diverge for their own projects.
- **Rapid cycles.** Each day should produce a tangible artifact. Perfection is the enemy.
- **Normalize failure.** If the AI gives bad outputs, use it as a teaching moment about prompting and guardrails.
- **Cross-track collaboration.** Encourage Track A and Track B teams to share what they built. The same AI moment can be implemented at very different fidelities.
- **Daily feedback.** End each session with a 2-minute written card: What was clear? What was confusing? What do you need tomorrow?

---

## Assessment & Checkpoints

| Checkpoint | When | Track A Criteria | Track B Criteria |
|------------|------|------------------|------------------|
| Concept brief | End of Day 1 | Problem + user + AI moment clearly stated + prompt log | Plus feasibility notes and data needs |
| Journey map | End of Day 2 | Storyboard/wireframe of the AI interaction + scaffold/critique prompts | Plus data flow and structure sketch |
| Prompt design | End of Day 3 | Refined prompt + 3 sample outputs (incl. 1 failure + fix) | Plus implemented API call or script (AI-assisted, human-verified) |
| Working prototype | End of Day 4 | Form/workflow/chat simulation + user test notes + iteration log | Deployed/faked app + user test notes + iteration log |
| Pitch + plan | End of Day 5 | Pitch deck + architecture diagram + sprint plan + "how AI built this" appendix | Plus technical architecture and live demo plan |
| Demo Day | Saturday | 5-min pitch with working or faked prototype | 5-min pitch with live demo or strong fallback |

---

## Post-Bootcamp Mentorship Pipeline

- Teams keep their concept briefs, journey maps, prompt templates, prototypes, and pitch decks in a shared folder.
- Invite strong teams to a 4-week online mentorship sprint focused on launching or applying for support.
- Share a curated resource list: communities, newsletters, funding opportunities, no-code and code tutorials.
- Publish a Demo Day showcase for visibility and networking.

---

## Appendix A: Starter Project Menu

Teams may pick from these or propose their own by Day 2.

1. **AgriLink:** Help urban buyers find fresh produce from nearby farms and get AI recipe suggestions.
2. **SkillMatch:** A personalized learning path and interview prep assistant for job seekers.
3. **HealthPal:** A symptom checker and clinic finder for underserved communities.
4. **ArtisanFind:** A chatbot that matches users with verified local artisans and tracks job progress.
5. **BudgetBuddy:** An expense tracker that uses AI to generate savings tips in plain language.
6. **ContentHelper:** A tool for small business owners to generate social media captions and images from product details.

---

## Appendix B: Tool Decision Framework

Instead of prescribing tools, teach participants to ask:

| Question | If yes, consider |
|----------|------------------|
| Do I need to store or organize data? | Spreadsheet, Airtable, Notion, database |
| Do I need users to submit information? | Form builder, chatbot, custom form |
| Do I need to send notifications or emails? | Automation tool, backend script, messaging API |
| Do I need AI to generate or classify text? | ChatGPT, Claude, Gemini, custom API, Cloudflare Workers AI |
| Do I need a public website? | Carrd, Typedream, Webflow, Vercel, Netlify |
| Do I need a mobile app? | FlutterFlow, React Native, progressive web app |
| Do I need to show a demo without building? | Loom, slide deck, clickable prototype, role-play |

---

## Appendix C: Glossary

- **AI moment:** The specific point in a product where artificial intelligence creates value for the user.
- **Prompt:** The instruction given to an AI model to produce a useful output.
- **Prototype:** An early, inexpensive version of a product used to test an idea.
- **User journey:** The sequence of steps a user takes to achieve a goal with your product.
- **Wizard of oz:** A prototype that looks automated but is powered by a human behind the scenes.
- **MVP:** Minimum Viable Product — the smallest version of an idea that can prove value.
- **Fallback:** A backup behavior when the AI cannot produce a good answer.
- **API:** A way for two applications to communicate and exchange data.

---

*Curriculum designed for a process-first, tool-agnostic AI Build Workshop with dual tracks: Lightweight Stack and Advanced Stack. Primary outcome: participants can use AI to build with the best results (brief → generate → verify → refine → own); secondary context: the prototype they build contains a clear AI moment. Prepared for the 7-Day AI & Innovation Bootcamp.*
