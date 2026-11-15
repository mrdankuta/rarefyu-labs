# Base lab image (spec #30). One image: runtimes, tmux, check helpers and the
# coding agents the courses use. Runs as non-root under Docker + gVisor.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git tmux python3 python3-pip procps less nano jq unzip \
    && rm -rf /var/lib/apt/lists/*

# Coding agents + bun, installed globally so every learner has them on PATH.
RUN npm install -g --no-fund --no-audit opencode-ai@latest @anthropic-ai/claude-code@latest bun@latest \
    && npm cache clean --force

# Non-root learner user. Never run sessions as root.
RUN useradd -m -s /bin/bash -u 1001 student
USER student
WORKDIR /home/student

# In-lab check helpers (spec §3 check contract: FAIL: <hint> + nonzero exit).
COPY lab-check fail-message /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/lab-check /usr/local/bin/fail-message
USER student
