import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const API_PORT = process.env.API_PORT ?? "3000";
const API_HTTP = `http://127.0.0.1:${API_PORT}`;
const API_WS = `ws://127.0.0.1:${API_PORT}`;

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    // Local laptop dev only: forward same-origin /api + /ws to the API.
    // Matches `bun run dev:api` (apps/api defaults to :3000).
    // If :3000 is taken on your machine, run the API with a custom port
    // and mirror it here, e.g. `API_PORT=3001 bun run dev:api` +
    // `API_PORT=3001 bun run dev`.
    // Production uses Caddy for this (see infra/Caddyfile).
    proxy: {
      "/api": API_HTTP,
      "/ws": { target: API_WS, ws: true },
    },
  },
});
