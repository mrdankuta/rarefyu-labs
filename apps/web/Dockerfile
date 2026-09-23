FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lockb* ./
COPY apps/web/package.json ./apps/web/
RUN bun install --cwd . 2>/dev/null || bun install
COPY apps/web ./apps/web
RUN bun --cwd apps/web run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/apps/web/build ./build
COPY --from=build /app/apps/web/package.json ./
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "./build/index.js"]
