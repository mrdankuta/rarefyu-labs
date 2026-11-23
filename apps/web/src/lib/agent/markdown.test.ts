import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  test("renders bold, italics, inline code, lists, headings", () => {
    const h = renderMarkdown("# Title\n\nSome **bold** and *it* and `x < y`.\n\n- a\n- b\n\n1. one\n2. two");
    expect(h).toContain("<h3>Title</h3>");
    expect(h).toContain("<strong>bold</strong>");
    expect(h).toContain("<em>it</em>");
    expect(h).toContain("<code>x &lt; y</code>");
    expect(h).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(h).toContain("<ol><li>one</li><li>two</li></ol>");
  });
  test("fenced code blocks keep content literal and escaped", () => {
    const h = renderMarkdown("```html\n<script>alert(1)</script> **no**\n```");
    expect(h).toBe('<pre data-lang="html"><code>&lt;script&gt;alert(1)&lt;/script&gt; **no**</code></pre>');
  });
  test("an unfinished fence (still streaming) renders as code, not as a crash", () => {
    expect(renderMarkdown("```js\nconst a = 1")).toContain("<pre");
  });
  test("raw HTML from the model is escaped, never injected", () => {
    for (const evil of ['<img src=x onerror=alert(1)>', "<script>alert(1)</script>", '<a href="javascript:alert(1)">x</a>', '<iframe src="//evil"></iframe>', "<svg/onload=alert(1)>"]) {
      const h = renderMarkdown(evil);
      expect(h).not.toMatch(/<(img|script|iframe|svg|a )/i);
      expect(h).toContain("&lt;");
    }
  });
  test("links: only http(s)/mailto, always noopener", () => {
    expect(renderMarkdown("[ok](https://example.com/a?b=1&c=2)")).toBe('<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok</a></p>');
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "JaVaScRiPt:x"]) {
      expect(renderMarkdown(`[x](${bad})`)).not.toContain("<a ");
    }
    expect(renderMarkdown('[x](https://a.com/"onmouseover="alert(1))')).not.toMatch(/onmouseover="/);
  });
  test("attribute-breaking quotes in text are escaped", () => {
    expect(renderMarkdown(`He said "hi" & 'bye'`)).toContain("&quot;hi&quot; &amp; &#39;bye&#39;");
  });
  test("NUL spoofing of the code-span placeholder is neutralised", () => {
    expect(renderMarkdown("\u00000\u0000 `a`")).not.toContain("undefined");
  });
});
