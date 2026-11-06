# AI Dev Workshop — Detailed Curriculum

## Workshop Overview

The AI Dev Workshop is the technical spine of the 7-Day AI & Innovation Bootcamp. It runs from **9:00 AM to 12:00 PM, Monday through Friday**, and is designed to take 30 YabaTech TVET web-development graduates from "I can build a web page" to "I can design, prototype, and pitch an AI-enabled web product." Each morning builds on the previous one, culminating in a working technical foundation for the Saturday Hackathon and Demo Day.

**Cohort Structure**
- 30 participants
- 6 teams of 5 members each
- Roles per team: Product Lead, AI/Backend Lead, Frontend Lead, UX/Content Lead, Business/Pitch Lead (roles rotate daily where possible)

**Assumed Baseline**
- HTML, CSS, JavaScript fundamentals
- Basic understanding of a frontend framework (e.g., React/Vue) or backend basics (Node.js/Express) is helpful but not required
- Familiarity with Git/GitHub is helpful

**Workshop Goal**
By Friday, every participant should be able to:
1. Use AI tools to write, refactor, debug, and explain code.
2. Integrate at least one AI capability (text generation, embeddings, image generation, etc.) into a web app.
3. Design a simple AI product architecture for a real-world problem.
4. Work effectively in a cross-functional team to ship a prototype.

---

## Daily Format (9:00 AM — 12:00 PM)

Each 3-hour block follows a consistent rhythm:

| Time | Segment | Purpose |
|------|---------|---------|
| 9:00 — 9:15 | **Warm-up & Recall** | Quick review of yesterday's concepts, Q&A, mindset check-in |
| 9:15 — 9:45 | **Concept Block** | Instructor-led explanation with live demos |
| 9:45 — 10:45 | **Guided Lab** | Hands-on coding with AI tools, facilitator support |
| 10:45 — 11:00 | **Break** | |
| 11:00 — 11:40 | **Team Build** | Apply the day's skill to the team project |
| 11:40 — 12:00 | **Show & Share** | 2-minute team demos or checkpoint reviews |

---

## Tools & Platforms

Participants should have access to the following before Day 1:

- **Laptop** with a modern browser and code editor (VS Code recommended)
- **GitHub account** for code collaboration
- **OpenAI / Anthropic / Google AI API key** or access via bootcamp-sponsored account
- **Cloudflare account** (for Workers AI, Pages, and free-tier deployments)
- **Figma account** (for wireframing; free tier acceptable)
- **Replit / CodeSandbox / StackBlitz** (fallback environments for those with setup issues)
- **Slack / Discord channel** for async Q&A between sessions

Recommended APIs and frameworks to teach:
- Cloudflare Workers AI (free tier, no credit card friction)
- OpenAI API (GPT-4o-mini for cost efficiency)
- Hugging Face Inference API
- Vercel AI SDK or simple `fetch`-based integrations
- React / Next.js / Vue (whichever matches cohort's existing training)
- Node.js + Express for backend demos
- Git + GitHub for collaboration

---

## Day 1 — Foundations: AI for Web Developers

**Theme:** Understand what AI can do for web products and learn to pair-program with AI.

### Learning Objectives
- Distinguish between AI, machine learning, and generative AI.
- Identify common AI-powered features in web apps (search, chat, recommendations, summaries, classification).
- Use an LLM as a coding assistant: explain code, generate snippets, debug errors.
- Write effective prompts for technical tasks.

### Concept Block (9:15 — 9:45)
1. **What is AI, really?** — 10 min
   - Definitions: AI, ML, generative AI, LLMs
   - Examples: chatbots, image generation, code completion, recommendation engines
2. **AI on the web: use cases that matter** — 15 min
   - Customer support chatbot
   - Content summarization
   - Semantic search / FAQ
   - Code review assistant
   - Personalization / recommendation
3. **Demo:** Live prompting to explain, refactor, and generate a simple React component

### Guided Lab (9:45 — 10:45)
- Activity: **"Prompt Engineering for Developers"**
  - Each participant picks a small code snippet (HTML form, JS function, CSS layout).
  - Use an LLM to: (a) explain it, (b) refactor it, (c) add error handling, (d) convert to React/Vue component.
  - Share the best prompt-refactor pairs in the team Slack channel.
- Exercise: **Build a one-page "AI Explain" tool** where the user pastes code and gets a plain-English explanation via an LLM API.

### Team Build (11:00 — 11:40)
- Each team selects 2-3 real-world problems they care about (aligned with afternoon product session).
- Brainstorm: "What AI feature could we build for this problem?"
- Output: Team problem-solution sketch + initial role assignments.

### Deliverables
- Individual: Working "AI Explain" mini-app
- Team: Problem-solution sketch + list of potential AI features

### Homework
- Watch a 10-minute video on prompt engineering for developers.
- Come with 2 ideas for AI features to build.

---

## Day 2 — AI-Assisted Coding & Rapid Prototyping

**Theme:** Ship faster by using AI across the full development workflow.

### Learning Objectives
- Use AI to scaffold full projects, write tests, and generate documentation.
- Compare AI coding assistants (GitHub Copilot, Cursor, ChatGPT, Codeium, Continue.dev).
- Build a working UI prototype with AI-generated code.
- Practice pair programming with AI in a team setting.

### Concept Block (9:15 — 9:45)
1. **The AI-assisted developer workflow** — 15 min
   - Planning: generate user stories, component breakdowns
   - Coding: autocomplete, multi-file generation, migrations
   - Debugging: explain errors, suggest fixes
   - Testing: generate unit tests, edge cases
2. **Demo:** Build a complete landing page + contact form in 10 minutes using AI prompts
3. **Responsible prompting:** How to verify AI-generated code and avoid blind copy-paste

### Guided Lab (9:45 — 10:45)
- Activity: **"10-Minute Prototype Challenge"**
  - Prompt: "Create a landing page for a [team's problem area] solution with a hero section, features, and a waitlist form."
  - Participants generate code, run it, fix issues with AI help, and deploy to a free static host.
- Activity: **AI-Generated Tests**
  - Take a simple JavaScript function.
  - Use AI to generate unit tests and identify edge cases.
  - Run tests and iterate.

### Team Build (11:00 — 11:40)
- Begin building the team's landing page / waitlist for the chosen problem.
- Assign sub-tasks: copywriting, hero design, form handling, deployment.
- Output: Team landing page live on a free host (Vercel / Netlify / Cloudflare Pages).

### Deliverables
- Individual: AI-assisted landing page or tested function
- Team: Public landing page for the project idea

### Homework
- Read the Lean Canvas draft created in the afternoon business session.
- Update landing page copy based on the canvas.

---

## Day 3 — Building AI-Powered Features

**Theme:** Integrate real AI capabilities into a web app.

### Learning Objectives
- Call an LLM API from a frontend or backend.
- Build a chatbot, text summarizer, or classifier.
- Understand API keys, serverless functions, and CORS.
- Compare Cloudflare Workers AI, OpenAI, and Hugging Face.

### Concept Block (9:15 — 9:45)
1. **AI APIs 101** — 20 min
   - What is an API key and how to keep it secret
   - Serverless functions as a safe backend for API calls
   - Cloudflare Workers AI demo: `@cf/meta/llama-3-8b-instruct`
   - OpenAI API demo: `gpt-4o-mini`
2. **Common integration patterns** — 10 min
   - Chatbot with message history
   - Text summarization from user input
   - Classification / tagging of user submissions
   - Image generation button

### Guided Lab (9:45 — 10:45)
- Activity: **"Build Your First AI Feature"**
  - Option A: Chatbot UI that calls a serverless function
  - Option B: Input summarizer (paste long text, get bullet summary)
  - Option C: Form classifier (submit feedback, get sentiment + category)
- Step-by-step:
  1. Create a Cloudflare Worker or simple Node backend.
  2. Call the AI model with a structured prompt.
  3. Return JSON to the frontend.
  4. Render the result in the UI.

### Team Build (11:00 — 11:40)
- Each team picks **one core AI feature** for their project.
- Draft the API request/response shape on a shared document.
- Identify data inputs and outputs for the feature.
- Output: Feature spec + first API call working in isolation.

### Deliverables
- Individual: One working AI feature (chatbot, summarizer, or classifier)
- Team: Feature spec + isolated prototype API call

### Homework
- Review the afternoon's Design Thinking session.
- Prepare 3 user interview questions for potential users of your team's product.

---

## Day 4 — Full-Stack AI Integration & Responsible AI

**Theme:** Connect frontend, backend, and AI into a coherent product; build responsibly.

### Learning Objectives
- Integrate Day 3's AI feature into the team's full-stack app.
- Handle errors, loading states, and streaming responses.
- Understand basics of embeddings and retrieval-augmented generation (RAG).
- Discuss bias, safety, privacy, and responsible AI practices.

### Concept Block (9:15 — 9:45)
1. **Full-stack AI architecture** — 15 min
   - Frontend → API route → AI model → response → UI
   - State management for AI features
   - Streaming vs. single-response APIs
2. **Embeddings & RAG for beginners** — 15 min
   - What are embeddings?
   - Simple RAG: upload a document, chunk it, ask questions
   - Demo: A FAQ bot powered by a small text file
3. **Responsible AI** — 15 min
   - Bias and hallucinations
   - User data and privacy
   - Transparency: when to tell users AI is involved
   - Content moderation basics

### Guided Lab (9:45 — 10:45)
- Activity: **"Wire It Up"**
  - Take the AI feature from Day 3 and connect it to the team's landing page/app.
  - Add a loading spinner, error message, and retry button.
  - Optional: add streaming text output.
- Activity: **"Build a Smart FAQ"** (RAG mini-lab)
  - Each team creates a small knowledge base document (e.g., product FAQ, local service info).
  - Build a bot that answers questions using only that document.

### Team Build (11:00 — 11:40)
- Integrate the chosen AI feature into the team's main project.
- Add error handling and a polished UI state.
- Output: Working end-to-end AI feature in the team app.

### Deliverables
- Individual: Full-stack AI integration lab submission
- Team: End-to-end AI feature working in the project app

### Homework
- Prepare a 2-minute technical demo of the team's AI feature.
- Identify remaining blockers for Saturday.

---

## Day 5 — Hackathon Prep & Architecture Design

**Theme:** Lock the technical plan and prepare to build during the Saturday Hackathon.

### Learning Objectives
- Break a prototype into Saturday-sized tasks.
- Create a technical architecture diagram.
- Practice pitching the technical approach.
- Set up the repo and deployment pipeline for the hackathon.

### Concept Block (9:15 — 9:45)
1. **From prototype to product** — 15 min
   - What to cut, what to keep for a 1-day hackathon
   - MVP definition: the smallest AI-powered product that proves value
2. **Architecture for non-engineers and engineers** — 15 min
   - Boxes-and-arrows diagrams
   - Data flow: user input → frontend → backend → AI → database/storage → UI
   - Choosing free-tier tools under time pressure
3. **Demo:** Live architecture review of 2 team sketches

### Guided Lab (9:45 — 10:45)
- Activity: **"Saturday Sprint Plan"**
  - Each team creates:
    1. One-sentence product promise
    2. Architecture diagram (data flow + tools)
    3. Task backlog with owners (who does what by when)
    4. Deployment checklist
  - Use a simple Kanban board (GitHub Projects, Trello, or sticky notes).
- Activity: **"Repo & Deploy"**
  - Initialize team GitHub repo.
  - Set up branch protection rules, README, and `.env.example`.
  - Configure CI/CD or one-click deploy to Cloudflare Pages / Vercel.

### Team Build (11:00 — 11:40)
- Dry-run technical pitch: each team explains their architecture to another team.
- Cross-team feedback: "What is unclear? What might break?"
- Finalize Saturday task assignments.
- Output: Architecture diagram + sprint plan + live repo/deployment.

### Deliverables
- Individual: Contribution commitment for Saturday
- Team:
  - Architecture diagram
  - Saturday sprint plan (Kanban board)
  - GitHub repo with README and deploy pipeline

### Homework
- Rest. Saturday is a long day.

---

## Cross-Cutting Themes

### Collaboration & Teamwork
- Rotate roles daily so every participant experiences product, engineering, UX, and business responsibilities.
- Use pair programming during labs.
- Require each team to present daily, even if briefly.

### Mindset & Identity
- Begin each day with a 5-minute reflection: "What did you build yesterday that surprised you?"
- Highlight examples of African women builders and AI founders during transitions.
- Encourage questions and normalize "I don't know yet."

### Continuous Improvement
- End each session with a 2-minute written feedback card: What worked? What was confusing? What do you need tomorrow?
- Adjust Day 4-5 content based on Day 1-3 feedback.

### Documentation
- Teams maintain a running README with:
  - Problem statement
  - Solution overview
  - AI feature description
  - Setup instructions
  - Demo link
  - Team member roles

---

## Assessment & Checkpoints

| Checkpoint | When | Criteria |
|------------|------|----------|
| Individual mini-app | End of Day 1 | Submits a working "AI Explain" or equivalent tool |
| Landing page | End of Day 2 | Team landing page is live and on-brand |
| AI feature prototype | End of Day 3 | API call works and returns useful output |
| Full-stack integration | End of Day 4 | Feature is wired into the app with error handling |
| Architecture & plan | End of Day 5 | Diagram, sprint plan, and repo are ready |
| Demo Day prototype | Saturday evening | Team pitches a working AI-enabled prototype |

---

## Facilitator Notes

- **Keep it practical.** Every concept must be followed by hands-on code within 10 minutes.
- **Embrace failure.** If an API call fails, debug it live as a class.
- **Avoid API key sprawl.** Use bootcamp-managed API keys where possible, or guide participants through free-tier signups on Day 1.
- **Support diverse skill levels.** Provide "stretch" challenges for advanced participants and "follow-along" templates for those who need them.
- **Link to the afternoons.** Reference the business model, design thinking, and entrepreneurship sessions so technical work serves the product, not the other way around.

---

## Saturday Hackathon Tie-In

The AI Dev Workshop feeds directly into the Saturday Hackathon:

| Time | Focus |
|------|-------|
| 9:00 AM — 12:00 PM | Build core AI feature and frontend |
| 12:00 PM — 1:00 PM | Lunch + pitch deck review with mentors |
| 1:00 PM — 4:00 PM | Integration, testing, polish, deployment |
| 4:00 PM — 5:00 PM | Demo rehearsal and final bug fixes |
| 6:00 PM — 9:00 PM | Demo Day pitches (6 teams, 5-7 min each) |

Demo Day judging criteria should mirror the workshop values:
- **Innovation:** Does the AI feature solve a real problem in a novel way?
- **Feasibility:** Can this be built out further with the team's skills?
- **Presentation:** Is the problem, solution, and demo clear?
- **Collaboration:** Did all team members contribute?

---

## Post-Bootcamp Mentorship Pipeline

The AI Dev Workshop also prepares graduates for ongoing support:
- Maintain team GitHub repos as portfolio pieces.
- Invite top teams to a 4-week online mentorship sprint.
- Share a curated resource list (courses, APIs, communities) for continued learning.
- Create a LinkedIn / Twitter showcase of Demo Day prototypes.

---

## Appendix A: Suggested Project Ideas

To help teams start quickly, provide a starter menu of problem areas:

1. **Agriculture:** AI-powered crop advice chatbot for smallholder farmers.
2. **Education:** Personalized study planner / quiz generator for secondary students.
3. **Health:** Symptom checker and clinic finder for underserved communities.
4. **Finance:** Simple expense tracker with AI-generated savings tips.
5. **Employment:** AI resume reviewer and interview prep assistant for job seekers.
6. **Local Services:** AI assistant for finding verified artisans and services.

Teams are free to propose their own ideas, but the menu reduces decision fatigue.

---

## Appendix B: Resource List for Participants

- **Prompt Engineering:** OpenAI Prompt Engineering Guide
- **Cloudflare Workers AI:** developers.cloudflare.com/workers-ai
- **Vercel AI SDK:** sdk.vercel.ai/docs
- **Git & GitHub:** GitHub Skills learning paths
- **Free Deployment:** Vercel, Netlify, Cloudflare Pages
- **Design:** Figma for Education, Unsplash, Google Fonts
- **AI Communities:** Women in AI Africa, IndabaX, Zindi

---

*Curriculum designed for the 7-Day AI & Innovation Bootcamp for Young Women. Aligns with the week-at-a-glance schedule and supports the production of 6 AI-enabled prototypes for Demo Day.*
