require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
  },
});

require(["vs/editor/editor.main"], function () {
  window.htmlEditor = monaco.editor.create(
    document.getElementById("htmlEditor"),
    {
      value: "<h1>Hello World</h1>",
      language: "html",
      automaticLayout: true,
      theme: "vs-dark",
      automaticLayout: true,
      theme: "vs-dark",

      minimap: {
        enabled: false,
      },

      fontSize: 16,

      wordWrap: "on",

      autoClosingBrackets: "always",

      autoClosingQuotes: "always",

      autoIndent: "full",

      formatOnPaste: true,

      formatOnType: true,

      suggestOnTriggerCharacters: true,

      quickSuggestions: true,

      tabCompletion: "on",

      acceptSuggestionOnEnter: "on",
    },
  );

  window.cssEditor = monaco.editor.create(
    document.getElementById("cssEditor"),
    {
      value: "body {\n\n}",
      language: "css",

      automaticLayout: true,
      theme: "vs-dark",

      minimap: {
        enabled: false,
      },

      wordWrap: "on",

      autoClosingBrackets: "always",

      autoClosingQuotes: "always",

      quickSuggestions: true,

      suggestOnTriggerCharacters: true,

      tabCompletion: "on",
    },
  );

  window.jsEditor = monaco.editor.create(document.getElementById("jsEditor"), {
    value: "console.log('Hello World');",
    language: "javascript",
    automaticLayout: true,
    theme: "vs-dark",
  });

    document.getElementById("runBtn").addEventListener("click", runCode);
    document.getElementById("resetBtn").addEventListener("click", () => {
      htmlEditor.setValue("");

      cssEditor.setValue("");

      jsEditor.setValue("");
    });

    document.getElementById("fullscreenBtn").addEventListener("click", () => {
      document.querySelector(".editor-grid").requestFullscreen();
    });

    // document.getElementById("saveBtn").addEventListener("click", async () => {
    //   const payload = {
    //     projectId: window.currentProjectId,
    //     html: htmlEditor.getValue(),
    //     css: cssEditor.getValue(),
    //     js: jsEditor.getValue(),
    //   };

    //   await fetch("/labs/project/save", {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify(payload),
    //   });
    // });

    document.getElementById("saveBtn").addEventListener("click", async () => {

        if (!window.currentProjectId) {
            alert("Project not initialized yet");
            return;
        }

        const payload = {
            projectId: window.currentProjectId,
            html: htmlEditor.getValue(),
            css: cssEditor.getValue(),
            js: jsEditor.getValue(),
        };

        const res = await fetch("/labs/project/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json();

        console.log("SAVE RESPONSE:", data);
    });

    htmlEditor.onDidChangeModelContent(runCode);

    cssEditor.onDidChangeModelContent(runCode);

    jsEditor.onDidChangeModelContent(runCode);
});

// async function initLab(labId) {
//   const res = await fetch("/labs/project/init", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({ labId }),
//   });

//   const data = await res.json();

//     window.currentProjectId = data.project.id;
//     autoSaveEnabled = true;

//   const project = data.project.project_data || {};

//   htmlEditor.setValue(project.html || "");
//   cssEditor.setValue(project.css || "");
//   jsEditor.setValue(project.js || "");
// }

window.addEventListener("load", async () => {
  const LAB_TYPE = "web";

  await initLab(LAB_TYPE);
});

async function initLab(labType) {
  try {
    const res = await fetch("/labs/project/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labType })
    });

    const data = await res.json();

    if (!data.success) {
      console.error("INIT FAILED", data);
      return;
    }

    window.currentProjectId = data.project.id;
    window.autoSaveEnabled = true;

    const project = data.project.project_data || {};

    htmlEditor.setValue(project.html || "");
    cssEditor.setValue(project.css || "");
    jsEditor.setValue(project.js || "");

      console.log("LAB INITIALIZED:", window.currentProjectId);
      console.log("INIT RESPONSE:", data);
      console.log("PROJECT ID:", data?.project?.id);
  } catch (err) {
    console.error("INIT ERROR:", err);
  }
}

let saveTimeout;

// function autoSave() {
//   clearTimeout(saveTimeout);

//   saveTimeout = setTimeout(() => {
//     document.getElementById("saveBtn").click();
//   }, 5000);
// }

function autoSave() {
  if (!autoSaveEnabled) return;

  clearTimeout(saveTimeout);

  saveTimeout = setTimeout(() => {
    document.getElementById("saveBtn").click();
  }, 5000);
}

htmlEditor.onDidChangeModelContent(autoSave);
cssEditor.onDidChangeModelContent(autoSave);
jsEditor.onDidChangeModelContent(autoSave);

function runCode() {
  const html = htmlEditor.getValue();

  const css = cssEditor.getValue();

  const js = jsEditor.getValue();

  const iframe = document.getElementById("preview");

  iframe.srcdoc = `
    <!DOCTYPE html>
    <html>

      <head>
        <style>
          ${css}
        </style>
      </head>

      <body>

        ${html}

        <script>
          ${js}
        <\/script>

      </body>

    </html>
  `;
}
