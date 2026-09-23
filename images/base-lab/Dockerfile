# Base lab image. Slice 1 scope: build, scan, push by digest.
# Slices 3+ run learner sessions FROM this image (or per-course FROM it).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git tmux python3 python3-pip nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Non-root learner user. Never run sessions as root (spec §8).
RUN useradd -m -s /bin/bash student
RUN mkdir -p /home/student && chown student:student /home/student
USER student
WORKDIR /home/student

# In-lab checker entrypoint (real validators arrive in slice 5).
COPY --chown=student:student lab-check /usr/local/bin/lab-check
RUN chmod +x /usr/local/bin/lab-check && lab-check --help
