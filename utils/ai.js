

// utils/ai.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function askTutor({ question, lessonContext = "", userName = "Student", maxTokens = 700 }) {
  try {
    // 🧹 Clean lesson context (remove HTML tags, trim spaces)
    let cleanContext = lessonContext.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    // ✅ Summarize automatically if lesson text is very long
    if (cleanContext.length > 3500) {
      console.log("🔹 Summarizing long lesson before sending to model...");

      const summaryResp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a summarizer. Condense long lessons into short, clear summaries under 1000 characters.",
          },
          {
            role: "user",
            content: `Summarize this lesson briefly:\n${cleanContext}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.5,
      });

      cleanContext =
        summaryResp.choices[0]?.message?.content ||
        "Summary unavailable. Please check the lesson.";
    }

    // 🧠 Create system role and user message
    const system = `You are a supportive EdTech tutor. 
- Explain clearly in steps.
- When asked about code, give short runnable snippets.
- If the student looks confused, ask one probing question.
- If there's a video or lesson context, use it to answer.`;

    const userMessage = [
      `Student: ${userName}`,
      cleanContext ? `Lesson context:\n${cleanContext}` : null,
      `Question:\n${question}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // ✅ Ask the AI Tutor
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.5,
    });

    return (
      resp.choices[0]?.message?.content?.trim() ||
      "🤖 I’m not sure yet. Try rephrasing that?"
    );
  } catch (err) {
    console.error("AI Tutor Error:", err.message);
    return "⚠️ Sorry, I couldn’t process your question right now.";
  }
}

// Used by services/adminReminderService.js to judge whether a school's
// WhatsApp/email reply to an admin reminder shows they understood it —
// gates whether the resend nagging stops and the day-before-due-date
// follow-up gets auto-scheduled (controllers/webhookController.js).
async function classifyReminderReply({ reminderTitle, reminderMessage, replyText }) {
  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You judge whether a school's reply to a reminder message shows they read and understood it. " +
            'Reply with ONLY compact JSON: {"understood": true|false, "summary": "<one short sentence>"}. ' +
            "understood=true only if the reply clearly acknowledges or responds to the reminder's actual content " +
            "(e.g. confirms, asks a relevant question, says they'll comply). A vague, off-topic, or unclear reply is understood=false.",
        },
        {
          role: "user",
          content: `Reminder title: ${reminderTitle}\nReminder message: ${reminderMessage}\n\nSchool's reply: ${replyText}`,
        },
      ],
      max_tokens: 150,
      temperature: 0,
    });

    const raw = resp.choices[0]?.message?.content?.trim() || "";
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return {
      understood: parsed.understood === true,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 500) : "",
    };
  } catch (err) {
    console.error("classifyReminderReply error:", err.message);
    return { understood: false, summary: "" };
  }
}

module.exports = { askTutor, classifyReminderReply };
