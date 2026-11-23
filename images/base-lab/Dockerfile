# Base lab image (spec #30). One image: runtimes, tmux, check helpers and the
# coding agents the courses use. Runs as non-root under Docker + gVisor.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git tmux python3 python3-pip procps less nano jq unzip \
    && rm -rf /var/lib/apt/lists/*

# OpenCode, pinned to an exact version. This ARG is the ONE place the version is
# recorded: the terminal agent (`opencode`) and the headless agent server the API
# manages (`opencode serve`, spec #47/#50) are the same binary. The server's
# /api/* surface is experimental and changes between minors, so upgrades are deliberate
# (bump here, rebuild, run the agent-server contract tests).
ARG OPENCODE_VERSION=2.4.1
RUN npm install -g --no-fund --no-audit @opencode/cli@${OPENCODE_VERSION} \
    && opencode --version | grep -qx "opencode v${OPENCODE_VERSION}" \
    && npm cache clean --force

# Other agents + bun, installed globally so every learner has them on PATH.
RUN npm install -g --no-fund --no-audit @anthropic-ai/claude-code@latest bun@latest \
    && npm cache clean --force

# Non-root learner user. Never run sessions as root.
RUN useradd -m -s /bin/bash -u 1001 student
USER student
WORKDIR /home/student

# In-lab check helpers (spec §3 check contract: FAIL: <hint> + nonzero exit).
COPY lab-check fail-message lab-welcome lab-transfer /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/lab-check /usr/local/bin/fail-message /usr/local/bin/lab-welcome /usr/local/bin/lab-transfer \
    && printf '%s\n' '[ -t 1 ] && command -v lab-welcome >/dev/null && { lab-welcome; export LAB_WELCOMED=1; }' >> /etc/bash.bashrc
USER student
