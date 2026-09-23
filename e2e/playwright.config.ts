import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Live-server specs (learner-flow etc.) arrive from slice 3 onward and
  // run against E2E_BASE_URL. Until then the placeholder asserts the seam
  // contract shape only.
});
