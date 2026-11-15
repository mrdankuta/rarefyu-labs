import { DockerDriver } from "./docker";
import { LocalDriver } from "./local";
import type { ExecDriver } from "./types";

/**
 * Pick the execution backend once per API process.
 *   DRIVER=local          dev stand-in, host processes (default; NO isolation)
 *   DRIVER=docker-gvisor  production: Docker + gVisor (refuses to run without runsc)
 *   DRIVER=docker         hardened runc containers, dev/testing only
 */
export function selectDriver(name = process.env.DRIVER ?? "local"): ExecDriver {
  switch (name) {
    case "local":
      return new LocalDriver();
    case "docker-gvisor":
    case "docker":
      return new DockerDriver({ backend: name });
    default:
      throw new Error(`unknown DRIVER "${name}" (local | docker | docker-gvisor)`);
  }
}

/** Singleton: one driver per API process. */
export const driver: ExecDriver = selectDriver();
