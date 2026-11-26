# Base lab image (spec #30). One image: runtimes, tmux, check helpers and the
# coding agents the courses use. Runs as non-root under Docker + gVisor.
FROM node:22-bookworm-slim

# PIP_BREAK_SYSTEM_PACKAGES: Debian's PEP 668 marker would otherwise make a plain
# `pip install` fail; the container is disposable, so allow it (venvs also work).
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget git tmux python3 python3-pip python3-venv procps less nano vim jq unzip \
    build-essential ripgrep fd-find sqlite3 openssh-client tree htop \
    && ln -s "$(command -v fdfind)" /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

# Default git identity + branch so a learner's first `git commit` works.
RUN git config --system user.name "Student" \
    && git config --system user.email "student@lab.local" \
    && git config --system init.defaultBranch main

# GitHub CLI, pinned and checksum-verified against the release's published sums.
ARG GH_VERSION=2.106.0
RUN arch="$(dpkg --print-architecture)" \
    && f="gh_${GH_VERSION}_linux_${arch}.tar.gz" \
    && base="https://github.com/cli/cli/releases/download/v${GH_VERSION}" \
    && cd /tmp && curl -fsSLO "$base/$f" && curl -fsSLO "$base/gh_${GH_VERSION}_checksums.txt" \
    && grep " $f\$" "gh_${GH_VERSION}_checksums.txt" | sha256sum -c - \
    && tar -xzf "$f" && install -m 0755 "gh_${GH_VERSION}_linux_${arch}/bin/gh" /usr/local/bin/gh \
    && rm -rf /tmp/gh_* \
    && gh --version | grep -q "gh version ${GH_VERSION}"

# OpenCode, pinned to an exact version. This ARG is the ONE place the version is
# recorded: the terminal agent (`opencode`) and the headless agent server the API
# manages (`opencode serve`, spec #47/#50) are the same binary. The server's
# /api/* surface is experimental and changes between minors, so upgrades are deliberate
# (bump here, rebuild, run the agent-server contract tests).
ARG OPENCODE_VERSION=2.4.1
RUN npm install -g --no-fund --no-audit @opencode/cli@${OPENCODE_VERSION} \
    && opencode --version | grep -qx "opencode v${OPENCODE_VERSION}" \
    && npm cache clean --force

# Other agents, bun and pnpm, pinned and installed globally so every learner has
# them on PATH. Bump deliberately, rebuild, run verify.sh.
ARG CLAUDE_CODE_VERSION=2.1.332
ARG BUN_VERSION=1.4.5
ARG PNPM_VERSION=12.23.0
RUN npm install -g --no-fund --no-audit \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} bun@${BUN_VERSION} pnpm@${PNPM_VERSION} \
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
