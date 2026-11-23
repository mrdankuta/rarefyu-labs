export type Theme = "dark" | "light";
const KEY = "rfy_theme";

export function currentTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent("rfy-theme", { detail: t }));
}
export function toggleTheme(): Theme {
  const n: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(n);
  return n;
}
