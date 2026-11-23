// Svelte action: a "Copy" button inside every code block of rendered markdown. The markdown stays the pure,
// escaped output of renderMarkdown; the button is added to the DOM afterwards (and again after each re-render).
export function copyButtons(node: HTMLElement, _text?: string) {
  const add = () => {
    node.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(":scope > button.copy")) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "copy"; b.textContent = "Copy"; b.setAttribute("aria-label", "Copy code");
      pre.prepend(b);
    });
  };
  const onClick = async (e: Event) => {
    const b = (e.target as HTMLElement).closest("button.copy") as HTMLButtonElement | null;
    if (!b || !node.contains(b)) return;
    const code = b.parentElement?.querySelector("code")?.textContent ?? "";
    try { await navigator.clipboard.writeText(code); b.textContent = "Copied"; }
    catch { b.textContent = "Press Ctrl+C"; }
    setTimeout(() => { b.textContent = "Copy"; }, 1500);
  };
  node.addEventListener("click", onClick);
  add();
  return { update: add, destroy: () => node.removeEventListener("click", onClick) };
}
