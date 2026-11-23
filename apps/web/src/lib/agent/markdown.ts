// Small, safe markdown -> HTML for agent replies. Safety by construction: ALL input is HTML-escaped first and
// only a fixed set of tags is ever emitted by us, so model output can never inject raw HTML, handlers or styles.
// Links are limited to http(s)/mailto and get rel="noopener noreferrer" target="_blank".
// Supported: fenced code, headings, bullet/numbered lists, blockquote, hr, paragraphs, **bold**, *italic*, `code`, [text](url).

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeUrl(u: string): string | null {
  const t = u.trim();
  return /^(https?:\/\/|mailto:)/i.test(t) && !/[\s"'<>`]/.test(t) ? t : null;
}

/** Inline formatting on ALREADY-ESCAPED text. Code spans are pulled out first so their contents stay literal. */
function inline(escaped: string): string {
  const codes: string[] = [];
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, c) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    // url was escaped: undo the entity escaping only for the check, then re-escape on output
    const raw = url.replace(/&amp;/g, "&");
    const ok = safeUrl(raw);
    return ok ? `<a href="${escapeHtml(ok)}" target="_blank" rel="noopener noreferrer">${text}</a>` : m;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)]!);
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(escapeHtml(para.join("\n"))).replace(/\n/g, "<br>")}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence (or end of a still-streaming block)
      const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : "";
      out.push(`<pre${lang}><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); const n = h[1]!.length + 2; out.push(`<h${n}>${inline(escapeHtml(h[2]!))}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inline(escapeHtml(q.join("\n"))).replace(/\n/g, "<br>")}</blockquote>`);
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(m[1]!) !== ordered) break;
        items.push(`<li>${inline(escapeHtml(m[2]!))}</li>`);
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line);
    i++;
  }
  flush();
  return out.join("");
}
