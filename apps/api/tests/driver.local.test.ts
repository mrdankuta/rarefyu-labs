import { LocalDriver } from "../src/drivers/local";
import { agentServerContract, driverContract } from "./driver-contract";
import { PINNED_OPENCODE, realOpencode } from "./opencode-bin";

driverContract("local", () => new LocalDriver());

// Unit-level: a tiny stub speaking the same protocol, so these run fast everywhere.
const STUB = new URL("./fixtures/fake-opencode.ts", import.meta.url).pathname;
agentServerContract("local (stub opencode)", () => new LocalDriver({ opencodeBin: [STUB] }));

// The real pinned binary (275 MB), when available. Point OPENCODE_BIN at a ${PINNED_OPENCODE} build to enable.
const real = realOpencode();
agentServerContract("local (real opencode)", () => new LocalDriver({ opencodeBin: [real.bin ?? "opencode"] }), {
  skip: real.skip,
  real: true,
  version: PINNED_OPENCODE,
});
