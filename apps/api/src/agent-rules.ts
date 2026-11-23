/**
 * Agent instruction file for every new workspace. OpenCode (2.4.1) loads `AGENTS.md` from the project
 * directory (the workspace root, where `opencode serve` runs) into the model's system prompt; the e2e
 * suite asserts that by looking for this text in the stub model's request. It is seeded by the driver's
 * create(), before the starter snapshot, and never overwrites an existing file.
 *
 * Only commands that exist in the lab image (images/base-lab: node 22, npm, python3, bun, procps) appear here.
 */
export const AGENT_RULES_FILE = "AGENTS.md";

export function agentRules(port: number): string {
  return `# How to work in this lab

You are helping a beginner build a website or small app. Explain what you did in plain, friendly language, with no jargon. Keep answers short. Work only inside this project folder; do not read or change files outside it.

## Keep the site runnable
- Prefer plain HTML, CSS and JavaScript. Use a framework only if the student asks for one (then pick the simplest, e.g. Vite).
- Put the main page in \`index.html\` at the project root (or give \`package.json\` a \`dev\` or \`start\` script).
- After each change the project should still open without errors.

## The live Preview
The lab shows the site in its Preview panel from **port ${port}**. The lab starts the preview by itself when your turn ends, so for a plain \`index.html\` site you do not need to do anything. Never tell the student to type commands.
If you need to start, restart or stop the preview server yourself:
- Stop: \`pkill -f "http.server ${port}"\` (for a Node app: \`pkill -f "node.*${port}"\`)
- Plain site: \`mkdir -p .lab && nohup python3 -m http.server ${port} --bind 0.0.0.0 >.lab/preview.log 2>&1 &\`
- Node app: \`mkdir -p .lab && PORT=${port} HOST=0.0.0.0 nohup npm run dev >.lab/preview.log 2>&1 &\` (add \`-- --host 0.0.0.0 --port ${port}\` for Vite; run \`npm install\` first if \`node_modules\` is missing)
- Always run servers in the background (end the command with \`&\`) so your turn does not hang waiting for them. Look at \`.lab/preview.log\` (inside the project, hidden from the student) if the site does not appear. Use only paths inside the project: reading or writing anything outside it (including \`/tmp\`) with the file tools is refused.
`;
}
