const canvas = document.getElementById("circuitCanvas");

document.querySelectorAll(".component").forEach((comp) => {
  comp.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("type", comp.dataset.type);
  });
});

canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
});

canvas.addEventListener("drop", (e) => {
  e.preventDefault();

  const type = e.dataTransfer.getData("type");

  const item = document.createElement("div");

  item.className = "circuit-item";

  item.innerText = type.toUpperCase();

  item.style.left = e.offsetX + "px";
  item.style.top = e.offsetY + "px";

  canvas.appendChild(item);
});
