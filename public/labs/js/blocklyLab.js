// public/labs/js/blocklyLab.js

let workspace;
let saveTimeout;

window.sprites = [];

window.currentSprite = null;
window.backgrounds = [];

window.createSprite = function (spriteName) {
  const stage = document.getElementById("stage");

  const sprite = document.createElement("img");

  sprite.src = `/labs/images/sprites/${spriteName}.png`;

  sprite.classList.add("sprite");

  sprite.style.position = "absolute";
  sprite.style.left = "100px";
  sprite.style.top = "100px";

  stage.appendChild(sprite);

  const spriteData = {
    id: Date.now(),

    name: spriteName,

    element: sprite,

    x: 100,

    y: 100,

    rotation: 0,
  };

  sprites.push(spriteData);

  renderSpriteList();

  document.getElementById("spriteModal").style.display = "none";
};

window.renderSpriteList = function () {
  const container = document.getElementById("spriteList");

  container.innerHTML = "";

  sprites.forEach((sprite) => {
    const card = document.createElement("div");

    card.className = "sprite-card";

    card.innerHTML = `
            <img src="/labs/images/sprites/${sprite.name}.png" >
            <br>
            <span>${sprite.name}</span>
            <button onclick="deleteSprite(${sprite.id})" style="background: none; border: none; color: red; font-size: 16px; cursor: pointer;">
                <i class="fas fa-trash"></i>
            </button>
        `;

    card.onclick = () => {
      currentSprite = sprite;
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

  backgrounds.push(file);

  renderBackgroundList();
};

window.renderBackgroundList = function () {
  const container = document.getElementById("backgroundList");

  container.innerHTML = "";

  backgrounds.forEach((bg) => {
    const item = document.createElement("div");

    item.innerHTML = `
            <img
            src="/labs/images/backgrounds/${bg}"
            width="80">
        `;

    container.appendChild(item);
  });
};

window.addEventListener("load", async () => {
  try {
    // Initialize Blockly
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

    // Load project
    await initLab("blockly");

    // Buttons
    document.getElementById("saveBtn").addEventListener("click", saveProject);

    document.getElementById("runBtn").addEventListener("click", runCode);

    document.getElementById("resetBtn").addEventListener("click", resetStage);

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
    });
  } catch (err) {
    console.error("Blockly Init Error:", err);
  }
});

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

    if (project.workspace) {
      const xml = Blockly.utils.xml.textToDom(project.workspace);

      Blockly.Xml.domToWorkspace(xml, workspace);
    }
  } catch (err) {
    console.error("initLab error:", err);
  }
}

async function saveProject() {
  if (!window.currentProjectId || !workspace) return;

  try {
    const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));

    // const generatedCode =
    //   Blockly.JavaScript.workspaceToCode(workspace);
    const generatedCode =
      javascript.javascriptGenerator.workspaceToCode(workspace);

    const payload = {
      projectId: window.currentProjectId,

      projectData: {
        workspace: xml,
        generatedCode,
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

async function runCode() {
  const consoleBox = document.getElementById("console");

  if (consoleBox) {
    consoleBox.innerHTML = "";
  }

  try {
    const generator = javascript.javascriptGenerator;

    generator.init(workspace);

    const topBlocks = workspace.getTopBlocks(true);

    const runBlock = topBlocks.find(
      (block) => block.type === "when_run_clicked",
    );

    if (!runBlock) {
      alert("Add a When Run Clicked block");
      return;
    }

    let code = generator.blockToCode(runBlock);

    if (Array.isArray(code)) {
      code = code[0];
    }

    code = generator.finish(code);

    console.log("Generated Code:");
    console.log(code);

    await runGeneratedCode(code);
  } catch (err) {
    console.error(err);
    logMessage("Error: " + err.message);
  }
}

async function runGeneratedCode(code) {
  const fn = new Function(`
    return (async () => {
      ${code}
    })();
  `);

  await fn();
}

function resetStage() {
  if (typeof spriteX !== "undefined") spriteX = 100;

  if (typeof spriteY !== "undefined") spriteY = 100;

  if (typeof spriteRotation !== "undefined") spriteRotation = 0;

  if (typeof updateSprite === "function") {
    updateSprite();
  }

  const stage = document.getElementById("stage");

  if (stage) {
    stage.style.background = "#ffffff";
  }

  const consoleBox = document.getElementById("console");

  if (consoleBox) {
    consoleBox.innerHTML = "";
  }
}

window.changeBackground = function (color) {
  const stage = document.getElementById("stage");

  if (stage) {
    stage.style.background = color;
  }
};

const spriteModal = document.getElementById("spriteModal");

const backgroundModal = document.getElementById("backgroundModal");

document.getElementById("addSpriteBtn").addEventListener("click", () => {
  spriteModal.classList.add("show");
});

document.getElementById("addBackgroundBtn").addEventListener("click", () => {
  backgroundModal.classList.add("show");
});

window.addEventListener("click", (e) => {
  if (e.target === spriteModal) {
    spriteModal.classList.remove("show");
  }

  if (e.target === backgroundModal) {
    backgroundModal.classList.remove("show");
  }
});

function createSprite(name) {
  addSprite(name, 100, 100);

  renderSpriteList();

  spriteModal.classList.remove("show");
}

function renderSpriteList() {
  const list = document.getElementById("spriteList");

  list.innerHTML = "";

  window.sprites.forEach((sprite, index) => {
    list.innerHTML += `
        <div class="asset-item">

            <img
            src="/labs/images/sprites/${sprite.name}.png">

            <span>${sprite.name}</span>

            <div class="asset-actions">

                <button
                onclick="selectSprite(${index})">
                Edit
                </button>

                <button
                onclick="deleteSprite(${index})">
                Delete
                </button>

            </div>

        </div>
        `;
  });
}

function deleteSprite(index) {
  const sprite = window.sprites[index];

  if (!sprite) return;

  sprite.element.remove();

  window.sprites.splice(index, 1);

  renderSpriteList();
}

window.selectedSprite = null;

function selectSprite(index) {
  selectedSprite = window.sprites[index];

  console.log("Selected:", selectedSprite.name);
}

window.backgrounds = [];

function addBackground(file) {
  backgrounds.push({
    name: file,
  });

  renderBackgroundList();

  backgroundModal.classList.remove("show");

  document.getElementById("stage").style.backgroundImage =
    `url('/labs/images/backgrounds/${file}')`;

  document.getElementById("stage").style.backgroundSize = "cover";
}

function renderBackgroundList() {
  const list = document.getElementById("backgroundList");

  list.innerHTML = "";

  backgrounds.forEach((bg, index) => {
    list.innerHTML += `
        <div class="asset-item">

            <span>${bg.name}</span>

            <div class="asset-actions">

                <button
                onclick="setBackground(${index})">
                Use
                </button>

                <button
                onclick="deleteBackground(${index})">
                Delete
                </button>

            </div>

        </div>
        `;
  });
}