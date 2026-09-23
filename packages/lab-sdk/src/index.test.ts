import { describe, expect, test } from "bun:test";
import { LabTemplateSchema, SessionSchema } from "./index";

describe("lab-sdk contracts", () => {
  test("accepts a minimal valid LabTemplate", () => {
    const parsed = LabTemplateSchema.safeParse({
      apiVersion: "labs.rarefyu.dev/v1",
      kind: "LabTemplate",
      metadata: { name: "demo-v1" },
      spec: {
        image: "registry.labs.local/labs/demo:0.1.0",
        resources: { cpu: 2, memoryMb: 4096, diskGb: 12, timeoutMin: 60 },
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects an unknown backend", () => {
    const parsed = SessionSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      courseId: "c",
      labId: "l",
      backend: "fly-io",
      status: "active",
      terminalWs: "wss://x/ws",
      previewBase: "https://x/preview",
    });
    expect(parsed.success).toBe(false);
  });
});
