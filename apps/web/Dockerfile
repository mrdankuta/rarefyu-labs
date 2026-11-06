FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock bun.lockb* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/lab-sdk/package.json ./packages/lab-sdk/
COPY packages/auth/package.json ./packages/auth/
COPY e2e/package.json ./e2e/
RUN bun install
COPY apps/web ./apps/web
RUN bun --cwd apps/web run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/apps/web ./
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "./build/index.js"]
