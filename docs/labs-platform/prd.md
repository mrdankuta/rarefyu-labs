# PRD: RarefyU Labs — zero-install course sandbox for developers and agents

## Problem Statement

Instructors preparing software courses have nowhere to send learners where everything just works. Today a learner must install language toolchains, editors, container runtimes, and credentials before the first lesson, and every machine drifts differently, so course authors spend support time debugging setups instead of teaching. When courses involve AI agents that generate and run code, the problem is worse: arbitrary model-generated code cannot safely execute on a learner's laptop or on a shared container host with only process-level isolation. Existing options force a bad trade: managed classroom products that cannot be self-hosted or extended, generic cloud IDEs with no notion of steps, checks, hints, cohorts, or agent policy, or bare infrastructure primitives that leave the entire learning loop unbuilt. There is no self-hosted platform that combines an iximiuz-grade realistic lab (real kernels, breakable networking, Docker and Kubernetes inside the lab) with a guided course workflow and a safe agent runtime on hardware the course provider owns.

## Solution

RarefyU Labs is a self-hosted, browser-based course operating system running on our own Hetzner metal. A learner opens one course URL and receives a coherent training workspace with no local install: guided steps, a code editor, one or more terminals, a file manager, a browser preview of the app they are building, and a project selector, plus a Check button that validates their work and offers hints without spoilers. The same sandbox runs AI coding agents under an explicit tool policy with approvals and a full audit trail. Course authors define labs as Git repositories containing instructions, a lab template describing the environment, starter files, and checks; the platform builds versioned, digest-pinned images and provisions each learner an isolated Firecracker-class microVM session with quotas, idle hibernation, reset and replay. Instructors get cohort management with live presence and assist, reset, and extend controls. The platform starts on a single Hetzner dedicated server and scales by adding identical nodes, keeping per-session cost visible and under our control.

## User Stories

### First contact and onboarding
1. As a prospective learner, I want to open a course URL and see what I will build and what I need (nothing installed), so that I can decide to enroll with confidence.
2. As a new learner, I want to sign up with email code or GitHub/Google and join a cohort, so that I can start learning in minutes without operations help.
3. As a returning learner, I want my progress and files to survive a browser refresh or a dropped connection, so that unreliable networks never lose my work.
4. As a learner on a slow connection, I want the workspace to stay interactive without downloading a multi-megabyte IDE bundle, so that I can learn on constrained bandwidth.

### Workspace and projects
5. As a learner, I want a single dock layout with steps, files, projects, editor, terminals, browser preview, and check results, so that everything I need for training is bundled in one place.
6. As a learner, I want to switch between my enrolled courses and the tasks within each course, so that I always know what to work on next.
7. As a learner, I want each task to start from a clean starter repository forked into my session, so that I never inherit another learner's mess.
8. As a learner, I want to commit my task work to version control from inside the workspace, so that my submissions are reviewable artifacts.

### Editor and files
9. As a learner, I want to browse my session's files as a tree and open them for editing, so that I can navigate starter projects naturally.
10. As a learner, I want syntax highlighting for the course languages with a fast-loading editor, so that editing feels responsive even on first load.
11. As a learner, I want to see which files I changed compared to the starter and reset a single file or the whole project, so that I can recover from mistakes without asking for help.
12. As a learner, I want protected starter ranges and inline hints in the editor where the course intends a challenge, so that I learn the intended skill rather than editing around it.
13. As a learner in an advanced lab, I want the option of a full VS Code-compatible IDE in the browser, so that I am not limited by the lightweight editor.

### Terminals
14. As a learner, I want one or more real shells in the browser attached to my session, so that I can run the same commands the course teaches.
15. As a learner, I want multiple terminals at once for running an app in one and tests in another, so that I can follow realistic developer workflows.
16. As a learner, I want my terminal sessions to persist across reconnects, so that a closed laptop lid does not kill my running processes.
17. As a learner, I want the terminal to correctly render colors, Unicode, and full-screen tools, so that standard CLI tooling behaves as documented.

### Browser preview
18. As a learner, I want to preview the app running in my session in a pane beside the editor, so that I can verify my work visually without exposing ports myself.
19. As a learner, I want a clear ready-or-waiting indicator for preview ports, so that I know when my app has finished starting.
20. As a learner, I want to open the preview in a new tab, so that I can use full browser developer tools when a course requires it.
21. As a learner, I want expired preview links to fail with a friendly retry rather than a blank frame, so that I am never stuck on an opaque error.

### Checks, hints, and progress
22. As a learner, I want a Check button that validates my current step against tests, HTTP endpoints, and expected files, so that I get fast feedback without waiting for an instructor.
23. As a learner whose check fails, I want a hint that points me forward without revealing the solution, so that I stay challenged but unblocked.
24. As a learner who is truly stuck, I want to unlock the worked solution for a step, so that I can study it and move on.
25. As a learner, I want my step completion recorded automatically when checks pass, so that my progress is always accurate.
26. As a learner, I want to reset the current step or start a fresh session while keeping my progress history, so that experimentation is safe.

### Agents in the lab
27. As a learner, I want to ask the lab agent for help scoped to my current task, so that assistance always applies to my actual code.
28. As a learner, I want to watch the agent's plan, tool calls, file diffs, and test output stream live, so that the agent is a glass box I learn from, not a black box.
29. As a learner, I want sensitive agent actions such as installing packages or calling the network to pause for my approval, so that nothing surprising happens in my session.
30. As a learner, I want to deny an agent action and keep working manually, so that I stay in control of my environment.
31. As a learner, I want to replay an agent run from its recorded trace after the session, so that I can review how a solution was produced.

### Cohorts and instructors
32. As an instructor, I want to invite learners into a cohort and see who is active, idle, or stuck, so that I can direct attention where it matters.
33. As an instructor, I want to reset a learner's session or extend their time when they fall behind, so that no one is blocked by environment state.
34. As an instructor, I want to broadcast an announcement to all active sessions in a cohort, so that schedule or content changes reach everyone.
35. As an instructor, I want per-lab statistics on boot success, check pass rates, and time to completion, so that I can improve weak steps.
36. As an instructor, I want to review agent audit traces for my cohort, so that I can verify how agent-assisted work was produced.

### Course authoring
37. As a course author, I want to define a course as a Git repository with instructions, an environment template, starter files, and checks, so that curriculum lives in version control like code.
38. As a course author, I want pushing to the course repository to build, test, and publish a newly pinned environment version automatically, so that publishing is safe and repeatable.
39. As a course author, I want to preview my lab exactly as a learner sees it before publishing, so that broken steps never reach a cohort.
40. As a course author, I want published template versions to be immutable with rollback support, so that a bad publish can be reverted instantly mid-cohort.
41. As a course author, I want to express validation as composable checks on commands, files, version control state, HTTP APIs, databases, and Kubernetes resources, so that grading reflects real system state rather than terminal output matching.
42. As a course author, I want to choose the isolation tier per lab from dense shared-kernel sandboxes to VM-backed pods to full multi-machine topologies, so that each lesson pays only for the realism it needs.
43. As a course author, I want to declare the network destinations a lab may reach, so that learners and agents work within an explicit egress policy.

### Grading integrity
44. As a course provider, I want graded checks to run in an isolated checker environment from the learner's submitted state rather than inside the learner's session, so that tampering with the in-lab checker cannot change a grade.
45. As a course provider, I want identical submissions to always produce identical verdicts, so that grading is deterministic and defensible.
46. As a course provider, I want every check attempt with its logs stored immutably, so that disputes can be resolved from evidence.

### Safety, cost, and operations
47. As a platform administrator, I want each learner session to run in its own isolated workload with default-deny networking and resource quotas, so that untrusted learner and agent code cannot affect other sessions or the host.
48. As a platform administrator, I want idle sessions to hibernate and expired sessions to be destroyed automatically, so that capacity and cost stay bounded.
49. As a platform administrator, I want per-session and per-course cost derived from our server amortization visible on a dashboard, so that pricing and capacity decisions use real numbers.
50. As a platform administrator, I want a single kill switch that destroys all sessions of a cohort within a minute, so that abuse or runaway agents can be stopped immediately.
51. As a platform administrator, I want every shell execution, file write, and outbound fetch audited with secrets redacted, so that incidents are investigable without leaking credentials.
52. As a platform administrator, I want provisioning success, boot latency distributions, and resource exhaustion alerted, so that degradation is caught before learners notice.
53. As a platform administrator, I want to add a second identical server by following a documented join procedure without touching the control plane, so that capacity grows incrementally with demand.

## Implementation Decisions

- The system is decomposed into a SvelteKit learning shell, a single Bun service exposing REST plus terminal WebSocket relay plus preview proxy plus content webhooks plus background workers, a shared authentication module, a shared contract module for lab templates and session and check shapes, versioned course images, declarative cluster manifests for the execution plane, and a Playwright end-to-end suite. No Elm and no Next.js anywhere in the product surface.
- All process code runs on Bun as the single runtime, package manager, and test runner; the frontend deploys with the Bun adapter behind Caddy, which terminates TLS and routes page, API, terminal WebSocket, and preview traffic from the one box.
- Authentication is self-hosted Better-Auth backed by Postgres through Drizzle, with organization membership modeling cohorts and instructor versus learner roles, email one-time-code plus OAuth plus passkey sign-in, and session claims that gate session creation and quota enforcement. Auth schema changes are additive only.
- The learning shell is SvelteKit with Svelte 5 runes state and Tailwind, organized as steps, files, and projects panes beside an editor pane beside terminal, preview, and agent panes above a checks bar, with automatic WebSocket reconnection and refresh-safe session rehydration.
- The default editor is CodeMirror 6 with language packs and course extensions for read-only starter ranges, inline hint widgets, dirty tracking, diff view, and single-file versus whole-project reset; a full code-server frame remains an opt-in per lab for VS Code parity rather than the default, keeping first load small for constrained networks.
- Terminal rendering goes through a small renderer interface whose initial implementation wraps xterm.js with process-group persistence per session, so a future Ghostty WASM renderer can replace the implementation without touching session or relay logic.
- Learner browser preview is an iframe pointed at a short-lived signed preview URL served through the API proxy with a restrictive sandbox attribute and clear port-readiness states, rather than any embedded Chromium component; agent and grader browsing uses a snapshot-and-interact automation pattern backed by Playwright in checker environments.
- Execution is Firecracker-class isolation orchestrated by Kubernetes on our own metal: a lightweight distribution on the single Hetzner dedicated host with KVM enabled, VM-backed labs via KubeVirt with isolated virtual networks and extra disks, dense standard labs via a gVisor runtime class, strict Firecracker pods via a Kata-with-Firecracker runtime class where the curriculum names it, and the community Agent Sandbox controllers providing sandbox, template, claim, and warm-pool lifecycle with pre-warmed capacity per popular template.
- All course environments are standard OCI images built from a common base with a non-root learner user and baked dependencies, pushed to an on-box registry, scanned for critical vulnerabilities, and consumed exclusively by digest once a template version is published; templates are never mutated in place while a cohort uses them.
- Lab authors declare plain manifests selecting the isolation backend per lab with resources, preview ports, starter source, persistence, lifecycle hooks, network allowlists, and composable checks; the router sends application lessons to dense sandboxes, untrusted or agent-heavy work to VM-backed pods, and Docker, Kubernetes, systemd, and networking lessons to full virtual machines.
- Control-plane state lives in Postgres for users, organizations, courses, enrollments, sessions, attempts, and progress, with a queue for asynchronous checks and cleanup and object storage for starter bundles, snapshots, submissions, and immutable attempt logs; local NVMe volumes back per-session home directories until multi-node replicated storage is justified by measured demand.
- The agent runtime is a tool broker in the API service exposing file, shell, preview, and check tools under a per-lab policy of allowed, approval-gated, and forbidden operations, with learner approve-or-deny dialogs, live streaming of plans and diffs and outputs, and redacted immutable audit records exportable per session.
- Graded validation runs in freshly provisioned checker environments built from the learner's submitted commit against pinned dependencies, never inside the learner's own session, so identical submissions always yield identical verdicts regardless of in-lab tampering.
- Networking defaults to deny with per-session allowlisted egress through a proxy, secrets are brokered as short-lived scoped credentials never placed in session environments, images are signed with software bills of materials, and every privileged capability such as host mounts or shared daemon sockets is refused by admission.
- Scaling from one server to a fleet keeps the control plane on the first node and joins additional identical hosts as schedulable agents with workload labels, spreading warm pools by affinity and expanding replicated storage and overlay networking only when cross-host labs are actually needed.

## Testing Decisions

- A good test exercises externally visible behavior through the single chosen seam and asserts on learner- or instructor-observable outcomes such as session readiness, file persistence across refresh, preview availability, check verdicts with hints, approval gating, and grade determinism, never on internal component wiring or styling details.
- All product testing for this PRD goes through one seam: the service API plus the browser workspace driven end to end, covering session creation through terminal relay through signed preview through check submission through reset and destroy, with quota, cohort, agent-policy, tamper-resistance, determinism, and degraded-network cases expressed as scenarios at that same seam while backend differences are handled by parametrizing the isolation tier per scenario rather than by adding lower seams.
- The end-to-end scenarios enumerated in the platform plan (learner flow, file edit and reset, check pass and fail with hints, backend switching with unchanged learner experience, agent allow and block and approve paths, instructor reset and extend and announce, network-throttled resilience, and double-submit determinism) constitute the prior art and regression corpus for this feature; new scenarios follow their established shape.
- Load and provisioning behavior is verified with synthetic session cohorts measuring warm-claim and cold-boot latency distributions and success rates, and release readiness additionally requires a clean critical-vulnerability image scan and a stranger-completes-demo-lab pass with boot times and per-session cost recorded.

## Out of Scope

- Managed execution vendors as the primary runtime, including per-second container clouds and hosted agent sandboxes; the driver boundary may acknowledge them but nothing in this PRD depends on them.
- Full learning-management commercial surface: course marketplace, payment processing beyond cohort essentials, certificates, and university single-sign-on integrations.
- A native desktop wrapper, offline-first packaging, and bring-your-own-cluster distribution for institutions.
- GPU-backed labs for machine-learning workloads.
- Multi-machine cluster topologies spanning physical hosts; single-host virtual-machine labs satisfy the realism requirement until cross-host demand is demonstrated.
- Rewriting the terminal renderer on emerging WebAssembly emulation cores; the abstraction reserves that future without committing to it.

## Further Notes

- The single Hetzner dedicated server is both a cost decision and a pedagogy decision: owning the metal makes per-session economics legible from amortized invoices and makes kernel-level realism (Docker inside the lab, Kubernetes from scratch, firewall and bridge manipulation) teachable rather than mocked.
- The plan's phase gates are the acceptance mechanism for this PRD: a stranger completing the demo lab unaided on the live domain, identical learner experience across isolation backends, deterministic tamper-proof grading, and a documented second-node join rehearsal.
- Decisions already locked in conversation and reflected above are SvelteKit only with no Elm, Bun with no Node package managers, Better-Auth with organizations as cohorts, and Firecracker-first execution without an interim managed-container hop; challenges to any of these belong in architecture decision records, not in implementation improvisation.
