// public/labs/js/blocklyLab.js

let workspace;
let saveTimeout;
let stageWidth;
let stageHeight;
let recordingStartTime = null;
let recordingTimerInterval = null;

window.sprites = [];

window.currentSprite = null;
window.backgrounds = [];
window.isRunning = false;
window.stopRequested = false;

let mediaRecorder;
let recordedChunks = [];

let recordingStream = null;

let isRecording = false;
let recordingCanvas;
let recordingCtx;

let cursorX = 0;
let cursorY = 0;

let backgroundImage = null;

window.createSprite = function (spriteName) {
  const stage = document.getElementById("stage");

  const sprite = document.createElement("img");

  sprite.src = `/labs/images/sprites/${spriteName}.png`;

  sprite.classList.add("sprite");

  sprite.style.position = "absolute";
  sprite.style.left = "100px";
  sprite.style.top = "200px";
  sprite.style.width = "120px";
  sprite.style.height = "120px";

  stage.appendChild(sprite);


  const spriteData = {
    id: Date.now(),
    name: spriteName,
    element: sprite,
    x: 100,
    y: 100,
    width: 120,
    height: 120,
    rotation: 0,
    visible: true,
    speed: 1,
    workspaceXml: "", // a new sprite starts with no scripts of its own
  };

  sprites.push(spriteData);
  makeSpriteDraggable(spriteData);

  renderSpriteList();
  selectSpriteById(spriteData.id);

  document.getElementById("spriteModal").style.display = "none";
};

function makeSpriteDraggable(spriteData) {
  const stage = document.getElementById("stage");

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  spriteData.element.addEventListener("mousedown", (e) => {
    selectSpriteById(spriteData.id);

    dragging = true;

    offsetX = e.offsetX;
    offsetY = e.offsetY;
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
  });

  // document.addEventListener("mousemove", (e) => {
  //   if (!dragging) return;

  //   const rect = stage.getBoundingClientRect();

  //   spriteData.x = e.clientX - rect.left - offsetX;

  //   spriteData.y = e.clientY - rect.top - offsetY;

  //   spriteData.element.style.left = spriteData.x + "px";

  //   spriteData.element.style.top = spriteData.y + "px";

  //   if (currentSprite && currentSprite.id === spriteData.id) {
  //     loadSpriteProperties(spriteData);
  //   }
  // });

  document.addEventListener("mousemove", (e) => {

    const rect = stage.getBoundingClientRect();

    // Update cursor tracking
    cursorX = e.clientX - rect.left;
    cursorY = e.clientY - rect.top;

    // Drag sprite
    if (!dragging) return;

    spriteData.x = e.clientX - rect.left - offsetX;
    spriteData.y = e.clientY - rect.top - offsetY;

    if (spriteData.id === "mainSprite") {
      spriteX = spriteData.x;
      spriteY = spriteData.y;
    }

    spriteData.element.style.left = spriteData.x + "px";
    spriteData.element.style.top = spriteData.y + "px";

    if (currentSprite && currentSprite.id === spriteData.id) {
      loadSpriteProperties(spriteData);
    }

  });
}

window.renderSpriteList = function () {
  const container = document.getElementById("spriteList");

  container.innerHTML = "";

  sprites.forEach((sprite) => {
    const card = document.createElement("div");

    // card.className = "sprite-card";
    card.className = "sprite-card";
    card.dataset.spriteId = sprite.id;

    card.innerHTML = `
            <img src="/labs/images/sprites/${sprite.name}.png" >
            <br>
            <div class="sprite-action">
            <span>${sprite.name}</span>
            <button onclick="deleteSprite(${sprite.id})" style="background: none; border: none; color: red; font-size: 12px; cursor: pointer;">
                <i class="fas fa-trash"></i>
            </button>
            </div>
        `;

    card.onclick = () => {
      selectSpriteById(sprite.id);
    };

    container.appendChild(card);
  });
};

window.deleteSprite = function (id) {
  const index = sprites.findIndex((s) => s.id === id);

  if (index === -1) return;

  sprites[index].element.remove();

  sprites.splice(index, 1);

  renderSpriteList();
};

window.moveCurrentSprite = function (x, y) {
  if (!currentSprite) return;

  currentSprite.x = x;
  currentSprite.y = y;

  currentSprite.element.style.left = x + "px";

  currentSprite.element.style.top = y + "px";
};


window.addBackground = function (file) {
  const stage = document.getElementById("stage");

  stage.style.backgroundImage = `url('/labs/images/backgrounds/${file}')`;

  backgroundImage = new Image();

  backgroundImage.src = `/labs/images/backgrounds/${file}`;

  stage.style.backgroundSize = "cover";
  stage.style.backgroundPosition = "center";
  stage.style.backgroundRepeat = "no-repeat";

  backgrounds.push(file);
  setBackground(file);

  renderBackgroundList();
};

window.setBackground = function (file) {
  const stage = document.getElementById("stage");

  currentBackground = file;

  stage.style.backgroundImage = `url('/labs/images/backgrounds/${file}')`;

  stage.style.backgroundSize = "cover";
  stage.style.backgroundPosition = "center";
  stage.style.backgroundRepeat = "no-repeat";

  backgroundImage = new Image();
  backgroundImage.src = `/labs/images/backgrounds/${file}`;
};

// window.renderBackgroundList = function () {
//   const container = document.getElementById("backgroundList");

//   container.innerHTML = "";

//   backgrounds.forEach((bg) => {
//     const item = document.createElement("div");

//     item.innerHTML = `
//     <img
//         src="/labs/images/backgrounds/${bg}"
//         style="
//             width:100%;
//             height:80px;
//             object-fit:cover;
//             border-radius:8px;
//         ">
//     `;

//     container.appendChild(item);
//   });
// };

window.renderBackgroundList = function () {
  const container = document.getElementById("backgroundList");

  container.innerHTML = "";

  backgrounds.forEach((bg, index) => {
    const item = document.createElement("div");

    item.className = "background-card";

    item.innerHTML = `
      <img
        src="/labs/images/backgrounds/${bg}"
        style="
          width:100%;
          height:40px;
          object-fit:cover;
          border-radius:8px;
          cursor:pointer;
        "
      >

      <button
        class="delete-bg-btn"
        onclick="deleteBackground(${index})">
        <i class="fas fa-trash" style="background: none; border: none; color: red; font-size: 12px; cursor: pointer;"></i>
      </button>
    `;

    item.querySelector("img").addEventListener("click", () => {
      setBackground(bg);
    });

    container.appendChild(item);
  });
};

window.deleteBackground = function (index) {
  const deletedBg = backgrounds[index];

  backgrounds.splice(index, 1);

  if (deletedBg === currentBackground) {
    if (backgrounds.length > 0) {
      setBackground(backgrounds[0]);
    } else {
      const stage = document.getElementById("stage");

      stage.style.backgroundImage = "none";

      backgroundImage = null;

      currentBackground = null;
    }
  }

  renderBackgroundList();
};

window.addEventListener("load", async () => {
  try {
    // Initialize Blockly
    console.log("toolbox", document.getElementById("toolbox"));

    workspace = Blockly.inject("blocklyDiv", {
      toolbox: document.getElementById("toolbox"),
      trashcan: true,

      grid: {
        spacing: 20,
        length: 3,
        colour: "#ccc",
        snap: true,
      },

      zoom: {
        controls: true,
        wheel: true,
        startScale: 1,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.2,
      },
    });

    window.addEventListener("resize", () => {
      if (workspace) {
        Blockly.svgResize(workspace);
      }
    });

    setTimeout(() => {
      Blockly.svgResize(workspace);
      workspace.resize();
      workspace.render();
    }, 3000);

    const defaultSprite = document.getElementById("sprite");
    defaultSprite.style.left = "100px";
    defaultSprite.style.top = "100px";
    defaultSprite.style.position = "absolute";
    const spriteData = {
      id: "mainSprite",
      name: "Jay",
      element: defaultSprite,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      visible: true,
      speed: 1,
      workspaceXml: "",
    };

    makeSpriteDraggable(spriteData);

    defaultSprite.addEventListener("click", () => {
      selectSpriteById("mainSprite");
    });

    window.sprites.push(spriteData);
    renderSpriteList();

    // Load project
    await initLab("blockly");
    // compileEvents();

    const stage = document.getElementById("stage");

    const mouseX = document.getElementById("mouseXIndicator");

    const mouseY = document.getElementById("mouseYIndicator");

    stage.addEventListener("mousemove", (e) => {
      const rect = stage.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left);
      const y = Math.round(e.clientY - rect.top);
      cursorX = x;
      cursorY = y;
      mouseX.textContent = `X: ${x}`;
      mouseY.textContent = `Y: ${y}`;
      const cursor = document.getElementById("recordCursor");
      cursor.style.left = x + "px";
      cursor.style.top = y + "px";
    });
    stage.addEventListener("mouseleave", () => {
      mouseX.textContent = "X: -";
      mouseY.textContent = "Y: -";
    });


    // Buttons
    document.getElementById("saveBtn").addEventListener("click", saveProject);

    document.getElementById("runBtn").addEventListener("click", runCode);

    document.getElementById("resetBtn").addEventListener("click", resetStage);

    
    const fullscreenBtn = document.getElementById("fullscreenBtn");

    const exitFullscreenBtn = document.getElementById("exitFullscreenBtn");

    const stagePanel = document.querySelector(".stage-panel");

    fullscreenBtn.addEventListener("click", () => {
      // stagePanel.classList.add("fullscreen");
      document.body.classList.add("presentation-mode");
      stagePanel.classList.add("fullscreen");

      fullscreenBtn.style.display = "none";

      exitFullscreenBtn.style.display = "inline-block";

      setTimeout(() => {
        Blockly.svgResize(workspace);
      }, 100);
    });

    exitFullscreenBtn.addEventListener("click", () => {
      // stagePanel.classList.remove("fullscreen");
      document.body.classList.remove("presentation-mode");

      stagePanel.classList.remove("fullscreen");

      fullscreenBtn.style.display = "inline-block";

      exitFullscreenBtn.style.display = "none";

      setTimeout(() => {
        Blockly.svgResize(workspace);
      }, 100);
    });

    document
      .getElementById("screenshotBtn")
      .addEventListener("click", takeStageScreenshot);

    document.getElementById("stopBtn").addEventListener("click", () => {
      stopRequested = true;

      document.getElementById("runStatus").textContent = "Stopped";
    });

    document
      .getElementById("recordBtn")
      .addEventListener("click", startRecording);
    
    document
      .getElementById("stopRecordBtn")
      .addEventListener("click", stopRecording);

    const addSpriteBtn = document.getElementById("addSpriteBtn");

    const addBackgroundBtn = document.getElementById("addBackgroundBtn");

    const spriteModal = document.getElementById("spriteModal");

    const backgroundModal = document.getElementById("backgroundModal");

    if (addSpriteBtn) {
      addSpriteBtn.addEventListener("click", () => {
        spriteModal.style.display = "flex";
      });
    }

    if (addBackgroundBtn) {
      addBackgroundBtn.addEventListener("click", () => {
        backgroundModal.style.display = "flex";
      });
    }

    // Auto save
    workspace.addChangeListener(() => {
      clearTimeout(saveTimeout);

      saveTimeout = setTimeout(() => {
        saveProject();
      }, 5000);
      // Re-register events immediately
      compileEvents();
    });
  } catch (err) {
    console.error("Blockly Init Error:", err);
  }
});

async function takeStageScreenshot() {
  const stage = document.getElementById("stage");

  try {
    const canvas = await html2canvas(stage, {
      backgroundColor: null,
      useCORS: true,
    });

    const link = document.createElement("a");

    link.download = `stage-${Date.now()}.png`;

    link.href = canvas.toDataURL("image/png");

    link.click();
  } catch (err) {
    console.error("Screenshot failed", err);
  }
}

function renderRecordingFrame() {
  if (!isRecording) return;

  recordingCtx.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);

  // Draw background

  if (backgroundImage && backgroundImage.complete) {

    const imgW = backgroundImage.width;
    const imgH = backgroundImage.height;

    const stageRatio = stageWidth / stageHeight;
    const imageRatio = imgW / imgH;

    let sx = 0;
    let sy = 0;
    let sw = imgW;
    let sh = imgH;

    if (imageRatio > stageRatio) {

        sw = imgH * stageRatio;
        sx = (imgW - sw) / 2;

    } else {

        sh = imgW / stageRatio;
        sy = (imgH - sh) / 2;
    }

    recordingCtx.drawImage(
        backgroundImage,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        stageWidth,
        stageHeight
    );
  }
  
  sprites.forEach((sprite) => {
    if (!sprite.visible) return;

    recordingCtx.save();

    recordingCtx.translate(
      sprite.x + sprite.width / 2,
      sprite.y + sprite.height / 2,
    );

    recordingCtx.rotate(((sprite.rotation || 0) * Math.PI) / 180);

    recordingCtx.drawImage(
      sprite.element,
      -sprite.width / 2,
      -sprite.height / 2,
      sprite.width,
      sprite.height,
    );

    recordingCtx.restore();
  });

  // Draw cursor

  recordingCtx.beginPath();

  recordingCtx.arc(cursorX, cursorY, 8, 0, Math.PI * 2);

  recordingCtx.fillStyle = "red";

  recordingCtx.fill();

  // const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);

  // const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");

  // const seconds = String(elapsed % 60).padStart(2, "0");

  // recordingCtx.fillStyle = "red";
  // recordingCtx.font = "bold 18px Arial";
  // recordingCtx.fillText(`REC ${minutes}:${seconds}`, 15, 30);

  requestAnimationFrame(renderRecordingFrame);
}

async function startRecording() {
    document.getElementById("recordCursor").style.display = "block";
    const useMic =
        await showConfirm(
            "Do you want to record with microphone narration?"
        );

    await recordStage(useMic);

}

function startRecordingTimer() {
  recordingStartTime = Date.now();

  const timer = document.getElementById("recordingTimer");

  timer.classList.add("recording");

  recordingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);

    const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");

    const seconds = String(elapsed % 60).padStart(2, "0");

    timer.textContent = `🔴 REC ${minutes}:${seconds}`;
  }, 1000);
}

function stopRecordingTimer() {
  clearInterval(recordingTimerInterval);

  const timer = document.getElementById("recordingTimer");

  timer.classList.remove("recording");

  timer.textContent = "🔴 REC 00:00";
}

async function recordStage(useMic) {

    const stage =
    document.getElementById("stage");
  
  stageWidth = stage.offsetWidth;
  stageHeight = stage.offsetHeight;

    const scale = 2;
    

    recordingCanvas =
        document.createElement("canvas");

    recordingCanvas.width =
        stage.offsetWidth * scale;

    recordingCanvas.height =
        stage.offsetHeight * scale;

    recordingCtx =
        recordingCanvas.getContext("2d");

    recordingCtx.scale(scale, scale);

    isRecording = true;
    startRecordingTimer();

    renderRecordingFrame();

    recordingStream =
        recordingCanvas.captureStream(60);

    if (useMic) {

        try {

            const mic =
                await navigator.mediaDevices.getUserMedia({
                    audio: true
                });

            mic.getAudioTracks().forEach(track => {

                recordingStream.addTrack(track);

            });

        } catch (err) {

            showAlert(
                "Microphone permission denied"
            );

        }
    }

    recordedChunks = [];

    mediaRecorder =
        new MediaRecorder(
            recordingStream,
            {
                mimeType:
                    "video/webm;codecs=vp9",

                videoBitsPerSecond:
                    12000000
            }
        );

    mediaRecorder.ondataavailable =
        event => {

            if (
                event.data.size > 0
            ) {

                recordedChunks.push(
                    event.data
                );

            }

        };

    mediaRecorder.onstop = () => {

        const blob =
            new Blob(
                recordedChunks,
                {
                    type:
                        "video/webm"
                }
            );

        const url =
            URL.createObjectURL(
                blob
            );

        const a =
            document.createElement("a");

        a.href = url;

        a.download =
            `recording-${Date.now()}.webm`;

        a.click();

    };

    mediaRecorder.start();

    document.getElementById(
        "recordBtn"
    ).style.display = "none";

    document.getElementById(
        "stopRecordBtn"
    ).style.display = "inline-block";
}

function stopRecording() {
  isRecording = false;
  stopRecordingTimer();

  mediaRecorder.stop();
  document.getElementById("recordCursor").style.display = "none";

  document.getElementById("recordBtn").style.display = "inline-block";

  document.getElementById("stopRecordBtn").style.display = "none";
}

window.addEventListener("click", (e) => {
  const spriteModal = document.getElementById("spriteModal");

  const backgroundModal = document.getElementById("backgroundModal");

  if (e.target === spriteModal) {
    spriteModal.style.display = "none";
  }

  if (e.target === backgroundModal) {
    backgroundModal.style.display = "none";
  }
});

async function initLab(labType) {
  try {
    const res = await fetch("/labs/project/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        labType,
      }),
    });

    const data = await res.json();

    if (!data.success) {
      console.error("Init failed", data);
      return;
    }

    window.currentProjectId = data.project.id;

    const project = data.project.project_data || {};

    if (project.sprites && project.sprites.length) {
      // Real per-sprite save — restore every sprite exactly as saved.
      // The first one reuses the existing #sprite DOM element already
      // on the page; any additional ones are created the same way
      // "Add Sprite" already creates them.
      const stage = document.getElementById("stage");
      window.sprites = [];

      project.sprites.forEach((saved, index) => {
        const el = index === 0 ? document.getElementById("sprite") : document.createElement("img");

        if (index > 0) {
          el.classList.add("sprite");
          stage.appendChild(el);
        }

        el.src = `/labs/images/sprites/${saved.name}.png`;
        el.style.position = "absolute";
        el.style.left = saved.x + "px";
        el.style.top = saved.y + "px";
        el.style.width = (saved.width || 120) + "px";
        el.style.height = (saved.height || 120) + "px";
        el.style.transform = `rotate(${saved.rotation || 0}deg)`;
        el.style.display = saved.visible === false ? "none" : "block";

        const spriteData = { ...saved, element: el };

        makeSpriteDraggable(spriteData);
        el.addEventListener("click", () => selectSpriteById(spriteData.id));

        window.sprites.push(spriteData);
      });

      renderSpriteList();

      if (project.backdrop) {
        setBackground(project.backdrop);
      }

      selectSpriteById(window.sprites[0].id);
    } else if (project.workspace) {
      // Legacy project, saved before per-sprite scripting existed —
      // treat the one saved script as the default sprite's own script.
      const mainSprite = window.sprites.find((s) => s.id === "mainSprite");
      if (mainSprite) {
        mainSprite.workspaceXml = project.workspace;
      }

      const xml = Blockly.utils.xml.textToDom(project.workspace);
      Blockly.Xml.domToWorkspace(xml, workspace);
    }

    compileEvents();
  } catch (err) {
    console.error("initLab error:", err);
  }
}

async function saveProject() {
  if (!window.currentProjectId || !workspace) return;

  try {
    // Save whatever's currently in the visible workspace back onto the
    // sprite it belongs to before persisting — it's only ever synced to
    // the sprite object on selection-switch or here, not continuously.
    if (window.currentSprite) {
      window.currentSprite.workspaceXml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
    }

    const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));

    const generatedCode =
      javascript.javascriptGenerator.workspaceToCode(workspace);

    const payload = {
      projectId: window.currentProjectId,

      projectData: {
        workspace: xml, // back-compat field only, sprites[] is authoritative
        generatedCode,
        backdrop: window.currentBackground || null,
        sprites: window.sprites.map((sprite) => ({
          id: sprite.id,
          name: sprite.name,
          x: sprite.x,
          y: sprite.y,
          width: sprite.width,
          height: sprite.height,
          rotation: sprite.rotation,
          visible: sprite.visible,
          speed: sprite.speed || 1,
          workspaceXml: sprite.workspaceXml || "",
        })),
      },
    };

    const res = await fetch("/labs/project/save", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(payload),
    });

    const data = await res.json();

    console.log("Saved:", data);
  } catch (err) {
    console.error("Save Error:", err);
  }
}

// Runs every sprite's own "when run clicked" script independently and
// concurrently — each one gets its own temporary, never-rendered
// workspace built from its saved blocks, so a sprite that isn't
// currently open in the editor still runs correctly. The sprite
// currently open uses the live visible workspace directly, to include
// unsaved edits.
async function runCode() {
  const consoleBox = document.getElementById("console");

  if (consoleBox) {
    consoleBox.innerHTML = "";
  }

  if (window.currentSprite) {
    window.currentSprite.workspaceXml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
  }

  isRunning = true;
  stopRequested = false;

  document.getElementById("runStatus").textContent = "Running...";
  document.getElementById("stopBtn").style.display = "inline-block";

  try {
    const runs = [];

    for (const sprite of window.sprites) {
      if (!sprite.workspaceXml) continue;

      const tempWorkspace = new Blockly.Workspace();
      const xml = Blockly.utils.xml.textToDom(sprite.workspaceXml);
      Blockly.Xml.domToWorkspace(xml, tempWorkspace);

      const generator = javascript.javascriptGenerator;
      generator.init(tempWorkspace);

      const runBlock = tempWorkspace
        .getTopBlocks(true)
        .find((block) => block.type === "when_run_clicked");

      if (runBlock) {
        let code = generator.blockToCode(runBlock);
        if (Array.isArray(code)) code = code[0];
        code = generator.finish(code);

        console.log("Sprite:", sprite.name, code);

        runs.push(runGeneratedCode(sprite, code));
      }

      tempWorkspace.dispose();
    }

    if (!runs.length) {
      showAlert("Add a When Run Clicked block to at least one sprite");
    }

    await Promise.all(runs);
  } catch (err) {
    console.error(err);
    logMessage("Error: " + err.message);
  } finally {
    isRunning = false;
    document.getElementById("runStatus").textContent = "Ready";
    document.getElementById("stopBtn").style.display = "none";
  }
}

async function runGeneratedCode(sprite, code) {
  const fn = new Function(
    "sprite",
    `
    return (async () => {
      window.currentRuntimeSprite = sprite;
      ${code}
    })();
    `,
  );

  try {
    await fn(sprite);
  } finally {
    window.currentRuntimeSprite = null;
  }
}

// Re-registers every sprite's own event blocks (when_key_pressed,
// when_sprite_clicked, when_message_received, when_touching_edge) —
// each sprite's blocks are scanned independently (using its own saved
// XML, or the live workspace for whichever sprite is currently open),
// with currentRuntimeSprite set to the owning sprite while its
// event-setup code runs, so the handlers it registers stay bound to it.
function compileEvents() {
  clearEvents();

  const generator = javascript.javascriptGenerator;

  window.sprites.forEach((sprite) => {
    const isOpenInEditor = window.currentSprite && window.currentSprite.id === sprite.id;

    let sourceWorkspace = null;
    let tempWorkspace = null;

    if (isOpenInEditor) {
      sourceWorkspace = workspace;
    } else if (sprite.workspaceXml) {
      tempWorkspace = new Blockly.Workspace();
      const xml = Blockly.utils.xml.textToDom(sprite.workspaceXml);
      Blockly.Xml.domToWorkspace(xml, tempWorkspace);
      sourceWorkspace = tempWorkspace;
    }

    if (!sourceWorkspace) return;

    generator.init(sourceWorkspace);

    let eventCode = "";
    for (const block of sourceWorkspace.getTopBlocks(true)) {
      if (
        block.type === "when_key_pressed" ||
        block.type === "when_sprite_clicked" ||
        block.type === "when_message_received" ||
        block.type === "when_touching_edge"
      ) {
        let code = generator.blockToCode(block);
        if (Array.isArray(code)) code = code[0];
        eventCode += code + "\n";
      }
    }

    if (eventCode) {
      window.currentRuntimeSprite = sprite;
      new Function(eventCode)();
      window.currentRuntimeSprite = null;
    }

    if (tempWorkspace) tempWorkspace.dispose();
  });
}

function clearEvents() {
  window.keyEvents = {};
  window.broadcastListeners = {};
}

window.changeBackground = function (color) {
  const stage = document.getElementById("stage");

  if (stage) {
    stage.style.background = color;
  }
};

window.addEventListener("click", (e) => {
  if (e.target === spriteModal) {
    spriteModal.classList.remove("show");
  }

  if (e.target === backgroundModal) {
    backgroundModal.classList.remove("show");
  }
});

