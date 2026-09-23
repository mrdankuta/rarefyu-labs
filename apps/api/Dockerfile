FROM oven/bun:1-slim AS base
WORKDIR /app
COPY package.json bun.lockb* ./
COPY apps/api/package.json ./apps/api/
COPY packages/lab-sdk/package.json ./packages/lab-sdk/
RUN bun install --cwd . 2>/dev/null || bun install
COPY . .
ENV API_PORT=3000
EXPOSE 3000
CMD ["bun", "./apps/api/src/index.ts"]
