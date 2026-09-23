import { z } from "zod";

/** Isolation backend per lab. See spec.md §5. */
export const BackendSchema = z.enum(["auto", "gvisor", "kubevirt", "kata-fc"]);
export type Backend = z.infer<typeof BackendSchema>;

export const CheckSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["command", "http", "file", "git", "db", "k8s"]),
  run: z.string().optional(),
  url: z.string().optional(),
  expectStatus: z.number().optional(),
  path: z.string().optional(),
  mustContain: z.string().optional(),
});
export type Check = z.infer<typeof CheckSchema>;

export const LabTemplateSchema = z.object({
  apiVersion: z.literal("labs.rarefyu.dev/v1"),
  kind: z.literal("LabTemplate"),
  metadata: z.object({ name: z.string().min(1), title: z.string().optional() }),
  spec: z.object({
    image: z.string().min(1),
    backend: BackendSchema.default("auto"),
    resources: z.object({
      cpu: z.number().positive(),
      memoryMb: z.number().positive(),
      diskGb: z.number().positive(),
      timeoutMin: z.number().positive(),
    }),
    ports: z.array(
      z.object({ name: z.string(), port: z.number(), preview: z.boolean() }),
    ).default([]),
    checks: z.array(CheckSchema).default([]),
  }),
});
export type LabTemplate = z.infer<typeof LabTemplateSchema>;

export const SessionStatusSchema = z.enum([
  "creating",
  "active",
  "sleeping",
  "destroyed",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().min(1),
  labId: z.string().min(1),
  backend: BackendSchema,
  status: SessionStatusSchema,
  terminalWs: z.string(),
  previewBase: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

export const CheckResultSchema = z.object({
  pass: z.boolean(),
  failures: z.array(z.object({ name: z.string(), hint: z.string() })),
  durationMs: z.number(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const AgentPolicySchema = z.object({
  allowed: z.array(z.string()),
  approvalRequired: z.array(z.string()),
  forbidden: z.array(z.string()),
});
export type AgentPolicy = z.infer<typeof AgentPolicySchema>;
