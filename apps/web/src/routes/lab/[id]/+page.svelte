<script lang="ts">
  import "../../../app.css";
  import { page } from "$app/stores";
  const id = $derived($page.params.id);
</script>

<!-- Slice-1 dock skeleton. Slices 3/4 fill panes: xterm terminal,
     CodeMirror editor + file tree, signed preview iframe, checks bar. -->
<header class="border-b p-2 font-semibold">RarefyU Labs · session {id} (stub)</header>
<main class="grid h-[calc(100vh-41px)] grid-cols-4">
  <aside class="border-r p-2">Steps / Files / Projects (slice 2, 4)</aside>
  <section class="col-span-2 border-r p-2">Editor (slice 4: CodeMirror)</section>
  <div class="flex flex-col">
    <section class="flex-1 border-b p-2">Terminal (slice 3: xterm)</section>
    <section class="flex-1 p-2">Preview / Agent / Checks (slice 5, 8)</section>
  </div>
</main>
