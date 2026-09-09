// public/js/markdownLite.js
//
// Small, dependency-free markdown-to-HTML renderer for AI chat replies —
// covers headings, bold/italic, inline code, fenced code blocks, ordered/
// unordered lists, blockquotes, links, and paragraphs. This is the only
// place this logic lives; both the lesson AI tutor (views/student/
// dashboard.ejs) and the coding-labs AI tutor (public/labs/js/
// labAiTutor.js) load this file and share it, instead of each keeping
// its own copy.
//
// Deliberately NOT a CDN-hosted library (e.g. marked.js): that used to be
// how both tutors rendered replies, and in practice the CDN script
// sometimes failed to load silently — every reply then degraded to raw
// "**bold**"/"```code```" text with no visible error. This file is part
// of the app's own static assets, so "did it load" is the same question
// as "did any of this page's JS load".
//
// Exposes window.MarkdownLite = { escapeHtml, renderInline, render }.

(function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Inline-only formatting (bold/italic/links) — no block wrapping. Used
  // for short strings that shouldn't be turned into paragraphs/lists,
  // like a student's own typed chat question.
  function renderInline(str) {
    return str
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  // Full block-level render — headings, lists, blockquotes, fenced/inline
  // code, paragraphs — plus the inline formatting above within each.
  function render(raw) {
    const text = String(raw == null ? "" : raw).replace(/\r\n/g, "\n");

    // 1) Fenced code blocks first, so nothing below touches their content.
    const codeBlocks = [];
    let working = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
      return ` CB${codeBlocks.length - 1} `;
    });

    // 2) Escape everything else, then inline code spans.
    working = escapeHtml(working).replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);

    // 3) Block-level pass, line by line.
    const lines = working.split("\n");
    const out = [];
    let list = null; // { type: 'ul'|'ol', items: [] }

    function flushList() {
      if (!list) return;
      out.push(`<${list.type}>${list.items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</${list.type}>`);
      list = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const cb = line.match(/^ CB(\d+) $/);
      if (cb) {
        flushList();
        out.push(codeBlocks[Number(cb[1])]);
        continue;
      }

      if (!line.trim()) {
        flushList();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushList();
        const level = heading[1].length;
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }

      if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
        flushList();
        out.push("<hr>");
        continue;
      }

      const ulItem = line.match(/^\s*[-*]\s+(.*)$/);
      if (ulItem) {
        if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
        list.items.push(ulItem[1]);
        continue;
      }

      const olItem = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (olItem) {
        if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
        list.items.push(olItem[1]);
        continue;
      }

      const quote = line.match(/^&gt;\s?(.*)$/); // already HTML-escaped by now
      if (quote) {
        flushList();
        out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
        continue;
      }

      flushList();
      out.push(`<p>${renderInline(line)}</p>`);
    }
    flushList();

    return out.join("");
  }

  window.MarkdownLite = { escapeHtml, renderInline, render };
})();
