# Agentic Software Development — OpenCode V2 Curriculum

## Course Overview

This course teaches participants how to build reliable software with coding agents. **OpenCode V2** is the reference agent used for demonstrations and exercises, and **Muse Spark 1.3** is the selected large language model (LLM). The underlying methods are intentionally agent- and model-agnostic: participants should be able to transfer them to other coding agents, language models, editors, and development environments.

The course is not primarily about generating more code. It is about designing a development process in which an agent can explore, plan, implement, test, receive feedback, recover from mistakes, and hand work back to a human safely.

### Reference Stack and Portable Concepts

Each module distinguishes among four layers:

1. **Concept** — the durable engineering principle.
2. **OpenCode V2** — how the course applies that principle with the reference agent.
3. **Muse Spark 1.3** — model-specific behavior participants should observe and accommodate.
4. **Portability** — how to apply the same principle with another agent or LLM.

Tool interfaces and model behavior will change. The engineering habits taught here should remain useful.

### Intended Audience

This course is designed for participants who:

- Know basic programming and can navigate a repository.
- Have used Git or are prepared to learn its essential workflow.
- Can run a project and read common terminal errors.
- Want to use coding agents for real, multi-file software development rather than isolated code generation.

Beginners may complete the course with additional Git, terminal, and programming support. Experienced developers can use the stretch exercises to focus on architecture, automation, and multi-agent workflows.

### Course Outcomes

By the end of the course, participants should be able to:

1. Explain the difference between an agent, an LLM, a tool, and a development environment.
2. Manage sessions, context, permissions, checkpoints, and handoffs deliberately.
3. Prompt an agent with useful context, constraints, acceptance criteria, and verification instructions.
4. Direct an agent to explore an unfamiliar codebase before making changes.
5. Steer agent behavior with repository instructions, progressive disclosure, and reusable skills.
6. Decompose large work into PRDs, tracer bullets, phases, and independently verifiable tasks.
7. Build automated feedback loops using tests, type checks, linting, builds, previews, and CI.
8. Decide when work requires direct human supervision and when it is suitable for bounded autonomous execution.
9. Prepare repositories, backlogs, and architectures that agents can navigate effectively.
10. Evaluate agent work through evidence rather than trusting a completion claim.

---

## The Core Operating Model

The course uses the following loop throughout:

1. **Frame** — define the problem, desired outcome, constraints, and decision boundaries.
2. **Explore** — inspect the repository, relevant documentation, dependencies, and existing patterns.
3. **Plan** — identify the smallest useful path, risks, acceptance criteria, and verification steps.
4. **Execute** — implement one bounded change at a time.
5. **Verify** — run deterministic checks and inspect behavior, output, and diffs.
6. **Review** — examine correctness, maintainability, security, scope, and unintended changes.
7. **Record** — preserve decisions, progress, and the next safe starting point.

This is referred to as the **Frame–Explore–Plan–Execute–Verify–Review–Record loop**. Individual modules introduce shorter loops for specific situations, but they all fit inside this operating model.

### Evidence of Completion

An agent saying “done” is not evidence. Depending on the task, acceptable evidence includes:

- A focused Git diff.
- Passing tests, type checks, linting, or builds.
- A working browser preview or reproducible terminal interaction.
- A migration status or database verification query.
- Screenshots or recorded behavior.
- A checklist mapped to acceptance criteria.
- A documented limitation or unresolved decision.

---

## Suggested Delivery Format

The curriculum contains eight modules. It can be delivered as:

- Eight instructor-led course days.
- A self-paced eight-module course.
- Two levels: Modules 1–4 as foundations and Modules 5–8 as advanced practice.

A recommended instructor-led module format is:

| Segment | Purpose |
|---|---|
| Recall and setup | Review previous work and establish the starting state |
| Concept lesson | Explain the durable principle and its trade-offs |
| Live demonstration | Show both a weak attempt and an improved workflow |
| Guided lab | Complete a shared task with explicit checkpoints |
| Independent application | Apply the method to a different repository or feature |
| Review and handoff | Inspect evidence, record decisions, and prepare the next session |

Every demonstration should expose the agent’s mistakes, uncertainty, or incomplete assumptions. The goal is not to make agent-assisted development look effortless; it is to make the control system understandable.

---

# 01 — Before We Start

## Purpose

Prepare the development environment, establish the course’s mental model, and ensure every participant can recover from setup and migration problems before agent-assisted work begins.

## Lessons

### 1. Where We Are Going

- The difference between code generation and agentic software development.
- Why the course emphasizes verification, context, and recoverability.
- The progression from supervised tasks to bounded autonomous work.
- What participants will build and what evidence they will retain for a portfolio.

### 2. Agent, LLM, Tools, and Environment

- **Agent:** the software that manages a task loop, context, and tool use.
- **LLM:** the model that interprets instructions and proposes actions.
- **Tools:** filesystem, terminal, browser, search, Git, and external integrations.
- **Environment:** the repository, runtime, permissions, secrets, services, and sandbox.
- Why changing the model may alter behavior without changing the workflow.
- Why changing the agent may alter tools and interaction patterns without changing the engineering principles.

### 3. Course Communication and Support

- How to navigate the course Discord or equivalent community space.
- Where to ask setup, curriculum, and project questions.
- How to share logs and errors without exposing secrets.
- How office hours, peer support, and escalation work.

### 4. Repository Setup

- Clone or open the course repository.
- Understand the repository’s top-level structure.
- Install dependencies using the repository’s documented package manager.
- Copy example environment configuration without committing secrets.
- Run the baseline application, checks, and tests.
- Create a clean checkpoint before beginning exercises.

### 5. Database Migrations

- What migrations are and why schema state matters to agents.
- How to identify pending migrations.
- How to apply course migrations safely.
- How to distinguish a code defect from an incorrect local database state.
- Why destructive migration and production database operations require explicit human approval.

### 6. Setting Up OpenCode V2 and Muse Spark 1.3

- Install or access OpenCode V2 using the course-supported method.
- Configure Muse Spark 1.3 as the selected model.
- Verify that the agent can read the course repository and run an approved command.
- Review permission defaults before allowing edits or command execution.
- Confirm how configuration, authentication, and model selection are represented locally.
- Use only current course setup instructions; do not infer commands from older agent versions.

### 7. How to Take This Course

- Type and run the exercises rather than watching passively.
- Preserve useful prompts, failed attempts, and verification output.
- Ask the agent to explain unfamiliar code, but confirm explanations against the repository.
- Change one variable at a time when comparing prompts or models.
- Treat mistakes as data about the workflow.
- Never paste credentials, private user data, or production secrets into prompts.

### 8. Office Hours

- Bring a reproducible state: branch, command, output, and expected behavior.
- Explain what was attempted and what evidence was collected.
- Distinguish environment problems, model behavior, agent behavior, and code defects.

### Appendix: Curriculum Changelog

Record substantive changes between cohorts, including:

- OpenCode interface or configuration changes.
- Muse Spark model-version changes.
- Revised labs or deprecated commands.
- Changes motivated by learner feedback.
- Compatibility notes for other agents and models.

## Guided Lab

Set up the repository, run the baseline checks, ask OpenCode to explain the repository at a high level, and compare that explanation against the actual files and documentation.

## Deliverables

- Working course repository.
- Successful baseline verification output.
- Confirmed OpenCode V2 session using Muse Spark 1.3.
- A short setup record containing commands run, problems encountered, and resolutions.

## Exit Check

A participant can start a session, identify the selected model, inspect permissions, run the project, and explain how to recover to a clean Git state without losing intentional work.

---

# 02 — Getting to Know Coding Agents

## Purpose

Understand the mechanics of an agent session and learn to control what the agent sees, does, and changes.

## Lessons

### 1. Introduction to OpenCode V2

- The conversation, tool, model, and repository layers.
- How OpenCode turns a request into tool-assisted actions.
- What the agent can and cannot know without inspecting the environment.
- Why fluent output is not proof of correct repository understanding.

### 2. Managing an OpenCode Session

- Start with a clear objective and known repository state.
- Keep one session focused on a coherent task.
- Recognize when the conversation has accumulated stale assumptions.
- Summarize decisions before changing sessions.
- Preserve the branch, diff, test state, and unresolved questions.

### 3. Prompting in the Terminal

A useful task brief includes:

- **Context:** repository, feature, user, and relevant constraints.
- **Task:** the concrete outcome requested.
- **Boundaries:** what may and may not change.
- **Acceptance criteria:** observable conditions for success.
- **Verification:** checks the agent must run.
- **Decision gates:** choices that require human input.

Participants compare vague instructions with bounded, verifiable instructions.

### 4. OpenCode, the Editor, and the Terminal

- Use the editor for local inspection and deliberate review.
- Use the agent for search, coordinated edits, and tool execution.
- Use the terminal for reproducible commands and direct observation.
- Avoid losing awareness when the agent changes multiple files.
- Review changes in the same tools the team uses without an agent.

### 5. Going Forwards and Backwards in Time

- Use Git commits, branches, and diffs as recoverable checkpoints.
- Distinguish conversation history from repository history.
- Revert or revise an agent decision without discarding unrelated work.
- Never rely on the agent’s memory as the only record of a decision.

### 6. Running Shell Commands

- Ask what a command will do before approving unfamiliar operations.
- Prefer project scripts and documented commands.
- Understand working directory and environment assumptions.
- Capture the complete failure output needed for diagnosis.
- Separate observation commands from commands with side effects.

### 7. Permissions

- Read, write, execute, network, browser, and integration permissions.
- Least privilege for the current task.
- Operations that always require explicit human confirmation.
- Why broad permissions do not improve reasoning quality.
- How sandboxes reduce impact but do not replace review.

## Guided Lab

Give OpenCode a poorly scoped request, inspect the assumptions it makes, stop before implementation, and rewrite the request with boundaries, acceptance criteria, and verification. Complete the bounded version and review the diff.

## Deliverables

- Original and improved task briefs.
- A focused code change.
- Verification output.
- A short explanation of which permissions were needed and why.

## Exit Check

A participant can control session scope, approve commands deliberately, inspect changes, and return the repository to a known state.

---

# 03 — Day 1: Agentic Development Fundamentals

## Purpose

Learn the constraints of LLM-driven work and establish a reliable loop for exploring and changing an unfamiliar codebase.

## Lessons

### 1. The Constraints of LLMs

- Finite context and incomplete repository awareness.
- Pattern prediction rather than guaranteed factual recall.
- Hallucinated APIs, files, commands, and project conventions.
- Sensitivity to wording and available context.
- Non-deterministic outputs from equivalent requests.
- The distinction between reasoning quality and verification quality.

### 2. What Are Subagents?

- A subagent is a delegated worker with a bounded task and its own context.
- Useful cases: independent research, repository exploration, review, or isolated implementation.
- Costs: coordination, duplicate work, conflicting edits, and lost assumptions.
- Delegate outputs, boundaries, and evidence—not vague responsibility.
- Do not use parallel workers on the same files without an explicit integration strategy.

### 3. Codebase Exploration

Before editing, direct the agent to identify:

- Project entry points and runtime boundaries.
- Relevant modules and their callers.
- Existing tests and nearby examples.
- Repository instructions and conventions.
- Dependencies already available.
- Verification commands.
- Security-sensitive or stateful components.

Exploration should end with evidence-backed findings, not a generic architecture summary.

### 4. Build a Feature

- Convert a request into observable acceptance criteria.
- Locate the smallest coherent implementation surface.
- Follow existing abstractions and naming conventions.
- Make a focused change.
- Run the narrowest useful checks before broader verification.
- Inspect the resulting diff for unrelated changes.

### 5. Non-Determinism

- Repeat equivalent tasks and compare approaches.
- Separate desirable flexibility from unacceptable inconsistency.
- Stabilize outcomes with constraints, examples, tests, schemas, and repository rules.
- Do not optimize a prompt around one lucky run.

### 6. Showing Context in the Status Line

- Make the selected model, working directory, branch, and context pressure visible where supported.
- Treat context use as an engineering resource.
- Notice model or repository switches before they cause incorrect changes.
- If the agent lacks a status surface, use explicit session check-ins.

### 7. Where Plan Mode Fails

- Plans based on uninspected assumptions create false confidence.
- Excessive planning delays the first real feedback.
- Plans become stale once code reveals new constraints.
- Planning is valuable when it identifies risks, decision gates, and verification—not when it predicts every edit.

### 8. The Frame–Execute–Inspect Loop

For small tasks:

1. Frame one bounded outcome.
2. Execute the smallest useful change.
3. Inspect behavior, checks, and diff.
4. Correct the next highest-risk issue.
5. Clear stale assumptions before continuing.

The loop favors concrete feedback over extended speculation.

### 9. Compaction

- Compaction summarizes older context so the session can continue.
- Summaries may omit constraints, failed attempts, or subtle decisions.
- Preserve critical state in files, issues, commits, or handoff notes before compaction.
- Re-read authoritative repository sources after compaction.

### 10. Handing Off

A useful handoff records:

- Objective and current status.
- Relevant files and architecture findings.
- Decisions made and rejected alternatives.
- Changes completed.
- Verification already run and its results.
- Known failures, risks, and next action.
- Repository branch and working-tree state.

## Guided Lab

Explore an unfamiliar area of the course repository and implement one scoped feature. Halfway through, create a handoff, begin a fresh session, and complete the work using only the repository and handoff record.

## Deliverables

- Exploration report with file references.
- Acceptance criteria.
- Working feature and tests or equivalent verification.
- Mid-task handoff.
- Final diff review.

## Exit Check

A participant can recover task continuity after a fresh session without relying on hidden conversational context.

---

# 04 — Day 2: Steering

## Purpose

Turn repeated verbal corrections into durable, discoverable instructions that guide an agent without overwhelming its context.

## Lessons

### 1. What Is an AGENTS.md File?

- Repository-level operating instructions for coding agents.
- Appropriate content: architecture boundaries, commands, conventions, safety rules, and definition of done.
- Inappropriate content: stale task details, essays, duplicated documentation, or unsupported preferences.
- Instructions must be testable and consistent with the repository.

### 2. Steering an Agent with AGENTS.md

- Capture rules that apply repeatedly across tasks.
- Prefer concrete instructions over aspirational language.
- Include exact verification commands when stable.
- Explain where deeper documentation lives.
- Test whether a fresh session discovers and follows the instructions.

### 3. Progressive Disclosure

- Keep high-frequency rules close to the entry point.
- Link specialized guidance instead of loading everything into every session.
- Reveal domain details when the task enters that domain.
- Design documentation so both humans and agents can locate authoritative information.

### 4. What Are Agent Skills?

- A skill is a reusable procedure for a recurring class of work.
- It may contain steps, constraints, decision points, templates, or supporting resources.
- Skills should encode a workflow, not merely restate general advice.
- Skills need clear triggers and a measurable completion condition.

### 5. Using Skills for Steering

- Choose a repeated workflow such as debugging, planning, testing, reviewing, or handoff.
- Compare behavior before and after using the skill.
- Keep repository-specific facts in repository documentation and reusable procedures in skills.
- Review skills when tools or project practices change.

### 6. Automatic Memory

- Memory can preserve preferences and recurring context.
- Memory may also preserve obsolete or incorrect assumptions.
- Distinguish personal preference, repository fact, and temporary task state.
- Prefer version-controlled sources for project-critical knowledge.
- Audit, correct, or remove stale memory.

## Guided Lab

Observe an agent violate or miss a real repository convention. Add the smallest durable steering mechanism—an `AGENTS.md` rule, linked reference, or reusable skill—and repeat the task in a fresh session to evaluate the result.

## Deliverables

- Before-and-after agent transcripts or observations.
- One concise steering artifact.
- Evidence that a fresh session discovered the instruction.
- A note explaining why the information belongs at that layer.

## Exit Check

A participant can decide whether guidance belongs in a prompt, repository instruction, linked document, skill, or memory.

---

# 05 — Day 3: Planning Large Work

## Purpose

Plan and execute work that is too large for one prompt, one session, or one context window.

## Lessons

### 1. How to Tackle Massive Tasks

- Separate discovery, decisions, implementation, migration, and rollout.
- Identify unknowns before estimating solution detail.
- Decompose by independently verifiable outcomes rather than file lists.
- Preserve working software between phases.
- Define pause points where a human reviews direction.

### 2. Write Useful PRDs

A practical PRD records:

- Problem and affected users.
- Desired outcomes and non-goals.
- Current behavior and relevant constraints.
- User journeys or system interactions.
- Acceptance criteria.
- Risks, open questions, and decision owners.
- Rollout and verification expectations.

The PRD should clarify intent without pretending implementation is already known.

### 3. Multi-Phase Plans Across Context Windows

Each phase should specify:

- Outcome.
- Preconditions.
- Scope and non-scope.
- Expected artifacts.
- Verification.
- Human decision gates.
- Handoff state for the next phase.

A new session should be able to begin a phase without replaying the entire project history.

### 4. What Are Tracer Bullets?

A tracer bullet is a narrow, end-to-end implementation that crosses the real system and proves the architecture with minimal surface area.

It should:

- Exercise real boundaries.
- Produce observable behavior.
- Expose integration risks early.
- Be retained and expanded where practical.
- Avoid polishing low-risk details before proving the path.

### 5. Use Tracer Bullets in a Multi-Phase Plan

- Place the tracer bullet before broad implementation.
- Use its findings to revise architecture and estimates.
- Identify which assumptions it proves and which remain untested.
- Add broader behavior only after the path works.

### 6. Executing a Multi-Phase Plan

- Begin each phase by confirming repository state and assumptions.
- Complete and verify one phase before advancing.
- Update the plan when evidence changes the approach.
- Do not mark incomplete work complete to preserve schedule appearance.
- Create explicit handoffs at context and ownership boundaries.

### 7. Asking the User a Question

Ask when the answer changes product behavior, architecture, risk, cost, or irreversible actions.

A useful question:

- States the decision and why it matters.
- Offers a small number of viable options.
- Explains trade-offs briefly.
- Recommends a default when appropriate.
- Avoids asking for information available in the repository.

## Guided Lab

Turn a broad feature request into a short PRD and multi-phase plan. Build the tracer bullet, verify it end to end, then revise the remaining phases based on what the implementation revealed.

## Deliverables

- PRD.
- Multi-phase execution plan.
- Working tracer bullet.
- Updated risk and assumptions list.
- Phase handoff.

## Exit Check

A participant can divide a large initiative into recoverable, evidence-producing phases and identify decisions that require human input.

---

# 06 — Day 4: Feedback Loops

## Purpose

Replace confidence based on plausible output with confidence based on fast, repeatable feedback.

## Lessons

### 1. Is Code Cheap?

- Producing code is increasingly cheap.
- Understanding, integrating, securing, operating, and maintaining code remain costly.
- More generated code can increase review and ownership burden.
- Optimize for the smallest verified change, not the largest diff.

### 2. Steering Agents to Use Feedback Loops

Require the agent to:

- Reproduce the current behavior.
- Define expected behavior.
- Run the narrowest relevant check after each meaningful change.
- Inspect failures rather than repeatedly rewriting code.
- Run broader checks before completion.
- Report commands and results accurately.

### 3. Building a Do-Work Skill

Create a reusable procedure that instructs the agent to:

1. Inspect repository guidance.
2. Understand the relevant code path.
3. Define acceptance criteria.
4. Establish a failing check or observable baseline where practical.
5. Make the smallest coherent change.
6. Run focused and broad verification.
7. Review the diff.
8. Record limitations and handoff state.

### 4. Using the Do-Work Skill

- Apply it to a bug, feature, and refactor.
- Identify where the generic workflow needs domain-specific extension.
- Evaluate whether it improves outcomes or merely adds ceremony.
- Refine it using observed failures.

### 5. Fixing Broken Formatting with Pre-Commit Checks

- Use the repository’s formatter rather than asking the model to imitate formatting manually.
- Run lint and formatting checks before review.
- Understand what pre-commit hooks change automatically.
- Reinspect diffs after automated fixes.
- Do not bypass quality or security hooks to force completion.

### 6. What Is Red–Green–Refactor?

- **Red:** create a failing test that demonstrates missing or incorrect behavior.
- **Green:** make the smallest change that passes.
- **Refactor:** improve structure while preserving passing behavior.
- TDD is most useful when the behavior can be expressed clearly and the test protects meaningful risk.

### 7. Practicing Red–Green–Refactor

- Confirm the test fails for the intended reason.
- Avoid tests that merely mirror implementation details.
- Keep generated tests readable and deterministic.
- Include meaningful edge cases.
- Run the broader suite after the focused cycle.

## Guided Lab

Reproduce a defect, write a failing regression test, implement the fix, refactor the result, and pass repository formatting, lint, type, test, and build checks as applicable.

## Deliverables

- Failing-then-passing regression test.
- Focused fix.
- Verification log.
- Reusable do-work procedure or skill draft.
- Diff review identifying any generated code removed or simplified.

## Exit Check

A participant can prove a change works using repeatable checks and can distinguish useful generated code from unnecessary implementation volume.

---

# 07 — Day 5: Supervised Autonomous Agents

## Purpose

Learn when an agent may work asynchronously and how to bound, observe, and recover that work safely.

## Lessons

### 1. What Is an AFK Agent?

An AFK agent continues a bounded task without continuous human interaction. It is appropriate only when the task has:

- Clear scope.
- Executable acceptance criteria.
- Safe permissions.
- A recoverable working environment.
- Observable progress and output.
- Defined escalation conditions.

Autonomy is an engineering property of the surrounding system, not a personality trait of the agent.

### 2. Sandboxed Workspaces

- Isolate filesystem, process, network, and secret access.
- Start from a reproducible repository state.
- Use disposable environments for risky experiments.
- Persist intended artifacts outside ephemeral execution where necessary.
- Treat sandboxing as impact reduction, not proof of correctness.

### 3. Trying Human-in-the-Loop Agents

- Define decision gates before execution.
- Require approval for architecture changes, destructive operations, new dependencies, migrations, and external side effects.
- Let deterministic checks proceed without unnecessary interruption.
- Escalate ambiguity instead of silently choosing high-impact behavior.

### 4. Sandboxing and Permissions

- Match privileges to the task.
- Limit secret and production access.
- Restrict network access where external services are unnecessary.
- Set resource and execution limits.
- Preserve logs needed to explain failure.

### 5. Setting Up and Trying an AFK Task

- Choose a low-risk, well-tested task.
- Prepare a clean branch or isolated workspace.
- Provide repository instructions and acceptance criteria.
- Define permitted commands and prohibited actions.
- Require a final report with diff, checks, limitations, and unresolved questions.
- Review before integration.

### 6. Using Backlogs to Queue AFK Work

Backlog items intended for agents should include:

- Problem and user impact.
- Relevant context and links.
- Scope and non-goals.
- Acceptance criteria.
- Verification commands.
- Dependencies and blockers.
- Escalation rules.

Not every backlog item is ready for autonomous execution.

### 7. Setting Up a Repository for GitHub Issues

- Use issue templates or consistent task structure.
- Add labels for type, risk, readiness, and required review.
- Link issues to PRDs, plans, and decisions.
- Keep secrets and private user data out of issues.
- Define what “agent-ready” means for the repository.

### 8. Connecting Agents to the Backlog

- Select only ready, bounded work.
- Track ownership to prevent duplicate execution.
- Require branch or workspace isolation.
- Attach results and evidence to the originating task.
- Route failed or ambiguous work back to human triage.

### 9. Updating PRD and Planning Workflows for GitHub

- Connect strategic intent in the PRD to executable issues.
- Preserve acceptance criteria during decomposition.
- Represent phase dependencies explicitly.
- Keep issue status aligned with actual verification state.
- Close the loop from implementation findings back to the plan.

## Guided Lab

Prepare one low-risk issue for autonomous execution, run it in an isolated workspace, observe without intervening unless an escalation condition occurs, and perform a human review before integration.

## Deliverables

- Agent-ready issue.
- Permission and sandbox policy.
- Execution log.
- Agent completion report.
- Human review with accept, revise, or reject decision.

## Exit Check

A participant can explain why a task is or is not suitable for AFK execution and can recover the workspace when the task fails.

---

# 08 — Day 6: Human-in-the-Loop Patterns

## Purpose

Combine research, prototyping, planning, architecture, and supervised execution into an end-to-end workflow that keeps humans responsible for consequential decisions.

## Lessons

### 1. HITL and AFK Tasks

Use **human-in-the-loop (HITL)** work when:

- Requirements are ambiguous.
- Product judgment is central.
- Architecture or security decisions are unresolved.
- Operations are destructive or externally consequential.
- Feedback must be interpreted rather than merely checked.

Use **AFK** work when:

- Scope is narrow and reversible.
- Success is mechanically verifiable.
- The environment is isolated.
- Escalation conditions are explicit.

Many initiatives should move between HITL and AFK phases rather than use one mode throughout.

### 2. Do Not Plan the Whole Kanban Board

- Detailed planning degrades with distance from current evidence.
- Keep near-term work specific and future work directional.
- Replan after tracer bullets, research, and user feedback.
- Limit work in progress.
- Do not generate dozens of speculative issues merely because an agent can.

### 3. Using a Kanban Workflow

- Define states based on evidence, not agent activity.
- Example states: Discovery, Ready, In Progress, Human Review, Verified, Blocked, Done.
- Make blockers and decision owners visible.
- Keep one source of truth for task status.
- Require verification before “Done.”

### 4. Research

- Start with a precise question and decision it will inform.
- Prefer primary, current, authoritative sources.
- Separate sourced facts from inference.
- Record links, publication dates, and unresolved contradictions.
- Time-box research and define a stopping condition.

### 5. Trying Out Research

- Investigate an unfamiliar API, framework capability, or architectural option.
- Verify claims against current documentation and a minimal experiment.
- Produce a recommendation with trade-offs rather than a raw link dump.
- Feed findings back into the PRD or plan.

### 6. Prototyping

- Use prototypes to answer a specific design question.
- Decide in advance whether prototype code will be discarded or evolved.
- Minimize polish unrelated to the question.
- Record what the prototype proves and does not prove.

### 7. Trying Out UI Prototyping

- Generate multiple interaction approaches quickly.
- Test the flow with representative tasks.
- Inspect accessibility, empty states, errors, loading, and responsive behavior.
- Ask humans to evaluate clarity and desirability; use automated checks for deterministic properties.

### 8. The Prototype Workflow

A reusable prototype procedure should specify:

1. Question to answer.
2. Audience or user scenario.
3. Fidelity required.
4. Time and scope boundary.
5. Evaluation method.
6. Decision produced.
7. Disposal or integration plan.

### 9. Designing Codebases Agents Can Navigate

Agent-friendly codebases are also human-friendly. They provide:

- Clear module boundaries and stable interfaces.
- Consistent terminology.
- Discoverable entry points.
- Local tests and short feedback cycles.
- Executable setup and verification commands.
- Documentation near architectural decisions.
- Limited hidden coupling and implicit global state.
- Errors that expose actionable context without leaking secrets.

### 10. Improving Codebase Architecture

- Identify modules that expose excessive internal complexity.
- Move knowledge behind focused interfaces.
- Reduce duplicated domain rules.
- Add characterization tests before risky structural changes.
- Refactor in independently verifiable steps.
- Measure improvement through easier usage and safer change, not merely fewer files.

### 11. Adding Module Awareness to PRD and Planning Workflows

Plans should identify:

- The module that owns each behavior.
- Public interfaces affected.
- Cross-module dependencies.
- Data ownership and migration boundaries.
- Tests at the appropriate boundary.
- Whether the proposed work deepens an existing module or creates unnecessary coupling.

### 12. The Final Workflow

For substantial work:

1. Frame the product or engineering problem.
2. Research unresolved external facts.
3. Explore the repository and map module ownership.
4. Prototype high-risk interactions or architecture.
5. Write or revise the PRD.
6. Build an end-to-end tracer bullet.
7. Decompose the remaining work into near-term phases and agent-ready tasks.
8. Choose HITL or AFK execution for each task.
9. Execute with automated feedback loops.
10. Review and verify before integration.
11. Update documentation, backlog, and handoff state.
12. Observe real usage and feed findings into the next cycle.

### Appendix: Greenfield Projects

For a new codebase:

- Begin with the smallest deployable path.
- Establish formatting, type checking, testing, builds, and CI early.
- Record architecture decisions before conventions become accidental.
- Avoid generating broad scaffolding that has no immediate verified use.
- Build one tracer bullet before expanding modules.
- Add repository instructions as practices become real, not speculative.

### Appendix: Grilling a Plan with Documentation

Before execution, challenge a plan against authoritative sources:

- Which assumptions are unsupported?
- Which APIs or versions have not been verified?
- What is the riskiest integration boundary?
- Which acceptance criteria are subjective or untestable?
- What could cause data loss, security exposure, or irreversible change?
- What is the smallest experiment that would disprove the approach?
- Which decisions require a human owner?

The purpose is not to make the plan longer. It is to expose weak assumptions before they become expensive changes.

## Capstone Lab

Teams complete a substantial feature using the full workflow:

- Research one unresolved technical question.
- Explore and map the relevant modules.
- Prototype the highest-risk interaction.
- Produce a concise PRD and phased plan.
- Build a tracer bullet.
- Prepare at least one agent-ready backlog item.
- Run one bounded AFK task in an isolated workspace.
- Complete human review, integration, and verification.
- Present both the product result and the control system used to produce it.

## Deliverables

- Research note with primary sources.
- Prototype and recorded decision.
- PRD and module-aware plan.
- Tracer bullet.
- Kanban or backlog state.
- AFK task record and human review.
- Final implementation, verification evidence, and handoff.

## Exit Check

A participant can design an end-to-end agentic development workflow, assign the right degree of autonomy at each stage, and defend the result using evidence.

---

# Assessment Framework

## Individual Assessment

Participants are assessed on their ability to:

- Write bounded, testable task briefs.
- Inspect repositories before editing.
- Use permissions safely.
- Diagnose failures using evidence.
- Review diffs critically.
- Preserve context through written handoffs.
- Explain which conclusions came from the model and which came from verification.

## Team Assessment

Teams are assessed on:

- Quality and clarity of the problem definition.
- Effectiveness of repository steering.
- Use of tracer bullets and phased planning.
- Strength and speed of feedback loops.
- Appropriateness of HITL and AFK decisions.
- Safety and recoverability of autonomous work.
- Correctness and maintainability of the final implementation.
- Quality of evidence presented.

## Suggested Checkpoints

| Checkpoint | Evidence |
|---|---|
| Environment ready | Baseline project and checks run successfully |
| Controlled session | Improved task brief, permission rationale, focused diff |
| Fundamental workflow | Explored feature, verification, and fresh-session handoff |
| Persistent steering | Repository instruction or skill validated in a fresh session |
| Large-task planning | PRD, phased plan, and working tracer bullet |
| Feedback loops | Failing-then-passing test and full verification results |
| Bounded autonomy | Agent-ready issue, sandbox policy, execution log, human review |
| Capstone | End-to-end workflow and verified implementation |

---

# Facilitator Guidance

## Demonstrate Failure Honestly

- Show incorrect assumptions and incomplete first attempts.
- Avoid presenting edited transcripts as normal agent behavior.
- Narrate why a command is safe or unsafe.
- Make verification visible.
- Compare plausible output with repository-backed evidence.

## Teach Concepts Before Product Features

Introduce the portable principle first, demonstrate it in OpenCode V2 second, and discuss Muse Spark 1.3 behavior third. Close with how learners can locate the equivalent mechanism in another tool.

## Keep Model Comparisons Controlled

When comparing Muse Spark 1.3 with another model:

- Use the same repository state and task brief.
- Compare correctness, tool use, scope discipline, and verification.
- Avoid drawing conclusions from one run.
- Do not equate longer answers with better engineering.

## Protect Learners and Infrastructure

- Use course-managed or sandboxed resources.
- Never ask learners to expose personal credentials in shared material.
- Keep production systems out of early exercises.
- Require explicit approval for destructive or externally consequential operations.
- Provide recovery instructions for every lab involving stateful changes.

## Adapt to Skill Levels

- Give beginners narrower tasks and explicit checkpoints.
- Give advanced learners ambiguous architecture or integration constraints.
- Keep acceptance criteria shared so outcomes remain comparable.
- Pair learners by rotating driver and reviewer roles rather than allowing one participant to operate the agent throughout.

---

# Portability Guide

When applying the course with another agent or model, identify equivalents for:

| Course capability | Questions to answer |
|---|---|
| Model selection | Which model is active, and how is it changed? |
| Context visibility | What files, messages, and summaries are currently available? |
| Repository instructions | Which instruction files or configuration conventions are supported? |
| Skills or workflows | How are reusable procedures defined and invoked? |
| Permissions | How are file, shell, network, browser, and integration actions approved? |
| Checkpoints | How are changes reviewed, reverted, or resumed? |
| Subagents | Can work be delegated, and how are results isolated and integrated? |
| Sandboxing | What filesystem, process, network, and secret isolation exists? |
| Automation | How can backlog tasks trigger bounded execution? |
| Evidence | Where are commands, diffs, tests, logs, and outputs recorded? |

If a tool lacks one of these capabilities, reproduce the control manually through Git, scripts, documentation, isolated environments, or human review. The workflow should not depend on a product label.

---

# Final Principle

The goal is not to make the agent appear autonomous. The goal is to create a development system in which useful work can proceed quickly, mistakes become visible early, consequential decisions remain accountable, and every claim of completion can be verified.
