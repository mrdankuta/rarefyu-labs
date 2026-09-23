import { expect, test } from "@playwright/test";

// Placeholder: proves the e2e harness runs. Slice 3 replaces with the
// learner-flow spec (create session -> terminal -> preview -> check)
// driven through the single API + browser seam.
test("harness placeholder", () => {
  expect({ seam: "api+e2e" }).toEqual({ seam: "api+e2e" });
});
