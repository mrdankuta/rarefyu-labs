FROM oven/bun:1-slim AS base
WORKDIR /app
COPY package.json bun.lock bun.lockb* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/lab-sdk/package.json ./packages/lab-sdk/
COPY packages/auth/package.json ./packages/auth/
COPY e2e/package.json ./e2e/
RUN bun install
COPY . .
RUN cd packages/lab-sdk && bun run build && cd ../auth && bun run build
# Run as the unprivileged bun user (oven/bun:1-slim provides it).
RUN chown -R bun:bun /app
USER bun
ENV API_PORT=3000
EXPOSE 3000
CMD ["bun", "./apps/api/src/index.ts"]
