import { readFileSync } from "node:fs";

/** The single place the version is recorded: the ARG in the workspace image. */
export const PINNED_OPENCODE = /^ARG OPENCODE_VERSION=(\S+)/m.exec(
  readFileSync(new URL("../../../images/base-lab/Dockerfile", import.meta.url), "utf8"),
)![1]!;

/** Locate a real opencode binary of exactly the pinned version (OPENCODE_BIN, else PATH), or say why not. */
export function realOpencode(): { bin?: string; skip?: string } {
  const bin = process.env.OPENCODE_BIN ?? "opencode";
  const r = Bun.spawnSync([bin, "--version"], { stdout: "pipe", stderr: "ignore" });
  if (r.exitCode !== 0) return { skip: `no \`${bin}\` binary; set OPENCODE_BIN to opencode ${PINNED_OPENCODE}` };
  const v = r.stdout.toString().trim().replace(/^opencode v?/, "");
  if (v !== PINNED_OPENCODE) return { skip: `\`${bin}\` is ${v}, the pinned version is ${PINNED_OPENCODE}; set OPENCODE_BIN` };
  return { bin };
}
