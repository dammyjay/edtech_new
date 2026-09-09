// public/labs/js/labAiTutor.js
//
// Floating AI tutor widget for the coding labs (Web Lab, Blockly Lab, …).
// Talks to the same backend endpoint and daily-free/coin economy as
// views/student/dashboard.ejs's lesson AI tutor (/student/ai/ask,
// controllers/studentController.js's askAITutor) — just with a `labContext`
// payload instead of a `lessonId`, so the tutor answers about the
// student's in-progress code instead of a lesson.
//
// This file has zero lab-specific knowledge: each lab page defines
// `window.getLabAIContext()` returning `{ labType, code }` before this
// script runs, and that's the only integration point. That keeps this
// widget droppable into any future lab editor unchanged.
//
// Reuses the shared .ai-tutor/.ai-messages/.ai-msg/.ai-input-row/.ai-float
// CSS already defined globally in public/css/styles2.css (built for the
// dashboard's lesson tutor) instead of shipping its own stylesheet, and
// the shared public/js/markdownLite.js (loaded by each lab editor view
// alongside this file) to render replies — see that file for why it's a
// small local renderer instead of a CDN-hosted markdown library.

(function () {
  const escapeHtml = window.MarkdownLite.escapeHtml;
  const renderInline = window.MarkdownLite.renderInline;
  const renderMarkdown = window.MarkdownLite.render;

  function buildWidget() {
    const title = window.LAB_AI_TUTOR_TITLE || "🤖 Lab Tutor";

    const wrap = document.createElement("div");
    wrap.id = "labAiTutor";
    wrap.className = "ai-tutor";
    wrap.style.display = "none";
    wrap.innerHTML = `
      <div class="ai-tutor-header">
        <span>${title}</span>
        <div class="ai-controls">
          <button type="button" id="labAiFullscreen" class="ai-circle-btn" title="Fullscreen">⛶</button>
          <button type="button" id="labAiToggle" class="ai-circle-btn" title="Minimize">–</button>
        </div>
      </div>
      <div id="labAiMessages" class="ai-messages"></div>
      <div class="ai-input-row">
        <input id="labAiQuestion" type="text" placeholder="Ask about your code…" />
        <button type="button" id="labAiSend">Send</button>
      </div>
    `;
    document.body.appendChild(wrap);

    const float = document.createElement("div");
    float.id = "labAiFloat";
    float.className = "ai-float";
    float.title = "Ask the AI tutor about your code";
    float.textContent = "🤖";
    float.style.display = "flex";
    document.body.appendChild(float);

    return { wrap, float };
  }

  function initWidget() {
    const { wrap, float } = buildWidget();
    const messages = wrap.querySelector("#labAiMessages");
    const input = wrap.querySelector("#labAiQuestion");
    const sendBtn = wrap.querySelector("#labAiSend");
    const toggleBtn = wrap.querySelector("#labAiToggle");
    const fullscreenBtn = wrap.querySelector("#labAiFullscreen");

    function pushMsg(html, who) {
      const msg = document.createElement("div");
      msg.className = "ai-msg " + who;
      msg.innerHTML = html;
      messages.appendChild(msg);
      messages.scrollTop = messages.scrollHeight;
      return msg;
    }

    async function sendQuestion(raw) {
      const q = (raw || "").trim();
      if (!q) return;
      // Inline formatting only (no <p>/list/heading wrapping) — this is
      // the student's own short typed question, not a full reply.
      pushMsg(renderInline(escapeHtml(q)), "user");
      input.value = "";

      const thinking = pushMsg("…", "bot");

      let labContext = null;
      try {
        labContext = typeof window.getLabAIContext === "function" ? window.getLabAIContext() : null;
      } catch (e) {
        console.error("getLabAIContext error:", e);
      }

      try {
        const res = await fetch("/student/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, labContext }),
        });
        const data = await res.json();
        thinking.remove();

        if (data.ok) {
          pushMsg(renderMarkdown(data.answer), "bot");
          if (data.coinsSpent && typeof window.showToast === "function") {
            window.showToast(`💰 -${data.coinsSpent} coins — extra question`, "info");
          }
        } else if (data.needsCoins) {
          pushMsg(`<em>🪙 ${data.message}</em>`, "bot");
        } else {
          pushMsg("<em>⚠️ Tutor unavailable right now.</em>", "bot");
        }
      } catch (err) {
        thinking.remove();
        console.error("Lab AI tutor error:", err);
        pushMsg("<em>❌ Couldn't reach the tutor. Check your connection.</em>", "bot");
      }
    }

    sendBtn.onclick = () => sendQuestion(input.value);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendQuestion(input.value);
      }
    });

    function open() {
      wrap.style.display = "flex";
      wrap.classList.remove("collapsed");
      float.style.display = "none";
      if (!messages.childElementCount) {
        pushMsg(
          "Hi! Ask me anything about the code you're writing here — stuck on a bug, not sure what a block does, or just want a hint.",
          "bot"
        );
      }
      input.focus();
    }

    float.onclick = open;
    toggleBtn.onclick = () => {
      wrap.classList.add("collapsed");
      wrap.style.display = "none";
      float.style.display = "flex";
    };
    fullscreenBtn.onclick = () => wrap.classList.toggle("fullscreen");
  }

  function start() {
    initWidget();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
