import { startServer } from "./server";
import { runLifecycle } from "./lifecycle";
import { reconcile } from "./reconcile";
import { loadSessions, startSessionPersistence } from "./session-store";

const port = Number(process.env.API_PORT ?? 3000);

// Opportunistic expiry sweep every 60s (a worker owns this in production).
setInterval(() => {
  void runLifecycle();
}, 60_000);

// Restore live sessions BEFORE the reconciler, or it would destroy their workspaces as orphans.
console.log(`restored ${loadSessions()} session(s)`);
startSessionPersistence();

// Reconcile backend state with the session store on boot and every 5 minutes.
void reconcile().catch((e) => console.error("reconcile failed", e));
setInterval(() => void reconcile().catch((e) => console.error("reconcile failed", e)), 5 * 60_000);

const server = startServer(port);

console.log(`api listening on :${server.port}`);
