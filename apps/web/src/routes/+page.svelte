<script lang="ts">
  import "../app.css";
  let starting = $state(false);
  let error = $state("");
  let existingId = $state<string | null>(null);
  async function start() {
    starting = true;
    error = "";
    existingId = null;
    try {
      const r = await fetch("/api/playgrounds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (r.status === 429) {
        existingId = (await r.json().catch(() => ({}))).existingId ?? null;
        error = "You already have a live playground.";
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pg = await r.json();
      location.assign(`/lab/${pg.id}`);
    } catch (e) {
      error = `Couldn't start a playground (${(e as Error).message}). Is the API up?`;
    } finally {
      starting = false;
    }
  }
</script>

<main style="font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 24px">
  <h1 class="text-2xl font-bold">RarefyU Labs</h1>
  <p>No account needed for playgrounds — a free shell with a 2h timer.</p>
  <button
    onclick={start}
    disabled={starting}
    style="background:#18252f;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;border:0;cursor:pointer;font-size:16px"
  >{starting ? "starting…" : "▶ Start a playground"}</button>
  {#if error}<p style="color:#b91c1c">{error}
    {#if existingId}<a class="underline" href="/lab/{existingId}">Resume it →</a>{/if}</p>{/if}
  <p style="margin-top:24px"><a class="underline" href="/teach">Teach console →</a></p>
</main>
