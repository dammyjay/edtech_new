// Shared, styled replacement for the browser's native alert()/confirm()
// dialogs (the ugly "localhost says" box). Loaded once per page via a
// shared header/footer partial (or a direct <script> tag on standalone
// pages), so window.showAlert / window.showConfirm are available globally.
//
//   showAlert(message, type)         -> Promise<void>,  type: info|success|error|warning
//   showConfirm(message, options)    -> Promise<boolean>, options: { confirmText, cancelText, type: 'danger' }
//   handleConfirmSubmit(event, msg)  -> for onsubmit="return handleConfirmSubmit(event, 'Delete this?')"
//
// Unlike native confirm(), these never block the main thread — anything
// that needs to happen only after the user responds must be chained with
// .then(...) rather than assumed to run "after" the call returns.
(function () {
  if (window.showAlert && window.showConfirm) return;

  var STYLE_ID = "ui-alerts-style";
  var OVERLAY_ID = "ui-alerts-overlay";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#" + OVERLAY_ID + "{position:fixed;inset:0;z-index:100000;background:rgba(20,15,5,0.55);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;" +
      "opacity:0;pointer-events:none;transition:opacity 0.2s ease;}" +
      "#" + OVERLAY_ID + ".show{opacity:1;pointer-events:auto;}" +
      ".ui-alert-card{background:#fff;border-radius:var(--radius-lg,16px);" +
      "box-shadow:0 20px 60px rgba(0,0,0,0.35);max-width:420px;width:100%;" +
      "padding:28px 26px 22px;text-align:center;transform:translateY(-16px) scale(0.97);" +
      "transition:transform 0.2s ease;font-family:inherit;}" +
      "#" + OVERLAY_ID + ".show .ui-alert-card{transform:translateY(0) scale(1);}" +
      ".ui-alert-icon{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;" +
      "justify-content:center;margin:0 auto 14px;font-size:24px;font-weight:700;color:#fff;}" +
      ".ui-alert-icon.info{background:linear-gradient(135deg,#4A90D9,#2C5FA8);}" +
      ".ui-alert-icon.success{background:linear-gradient(135deg,#34C77B,#1F9D55);}" +
      ".ui-alert-icon.error{background:linear-gradient(135deg,#E9615C,#D64545);}" +
      ".ui-alert-icon.warning{background:linear-gradient(135deg,#F0B23A,var(--brand-pri,#A17807));}" +
      ".ui-alert-message{font-size:15px;line-height:1.5;color:#2b2b2b;white-space:pre-line;margin-bottom:22px;}" +
      ".ui-alert-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}" +
      ".ui-alert-btn{border:none;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:600;" +
      "cursor:pointer;transition:transform 0.1s ease,opacity 0.15s ease;}" +
      ".ui-alert-btn:active{transform:scale(0.96);}" +
      ".ui-alert-btn:hover{opacity:0.9;}" +
      ".ui-alert-btn-primary{background:linear-gradient(135deg,var(--brand-pri-light,#D9A82C),var(--brand-pri,#A17807));color:#fff;}" +
      ".ui-alert-btn-danger{background:linear-gradient(135deg,#E9615C,#D64545);color:#fff;}" +
      ".ui-alert-btn-secondary{background:#f0f0f0;color:#333;}";
    document.head.appendChild(style);
  }

  function buildOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML =
      '<div class="ui-alert-card" role="alertdialog" aria-modal="true">' +
      '<div class="ui-alert-icon"></div>' +
      '<div class="ui-alert-message"></div>' +
      '<div class="ui-alert-actions"></div>' +
      "</div>";
    document.body.appendChild(overlay);
    return overlay;
  }

  var ICONS = { info: "i", success: "✓", error: "✕", warning: "!" };

  function openModal(message, iconType, buttons) {
    injectStyles();
    var overlay = buildOverlay();
    var iconEl = overlay.querySelector(".ui-alert-icon");
    var msgEl = overlay.querySelector(".ui-alert-message");
    var actionsEl = overlay.querySelector(".ui-alert-actions");

    iconEl.className = "ui-alert-icon " + iconType;
    iconEl.textContent = ICONS[iconType] || ICONS.info;
    msgEl.textContent = message;
    actionsEl.innerHTML = "";

    return new Promise(function (resolve) {
      function close(result) {
        overlay.classList.remove("show");
        document.removeEventListener("keydown", onKeydown);
        resolve(result);
      }
      function onKeydown(e) {
        if (e.key === "Escape") close(buttons.escapeValue);
        if (e.key === "Enter") close(buttons.enterValue);
      }

      buttons.list.forEach(function (btnDef) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ui-alert-btn " + btnDef.className;
        btn.textContent = btnDef.label;
        btn.addEventListener("click", function () {
          close(btnDef.value);
        });
        actionsEl.appendChild(btn);
      });

      document.addEventListener("keydown", onKeydown);
      requestAnimationFrame(function () {
        overlay.classList.add("show");
      });

      var focusBtn = actionsEl.querySelector("button:last-child");
      if (focusBtn) setTimeout(function () { focusBtn.focus(); }, 50);
    });
  }

  window.showAlert = function (message, type) {
    type = type || "info";
    return openModal(message, type, {
      list: [{ label: "OK", className: "ui-alert-btn-primary", value: true }],
      escapeValue: true,
      enterValue: true,
    });
  };

  window.showConfirm = function (message, options) {
    options = options || {};
    var danger = options.type === "danger" || /delete|remove|deactivat|cancel|permanent/i.test(message);
    return openModal(message, danger ? "warning" : "info", {
      list: [
        { label: options.cancelText || "Cancel", className: "ui-alert-btn-secondary", value: false },
        {
          label: options.confirmText || (danger ? "Yes, delete" : "Yes"),
          className: danger ? "ui-alert-btn-danger" : "ui-alert-btn-primary",
          value: true,
        },
      ],
      escapeValue: false,
      enterValue: true,
    });
  };

  // For onsubmit="return handleConfirmSubmit(event, 'Delete this?')" —
  // native confirm() blocked synchronously so the form's onsubmit could just
  // return true/false; this intercepts the submit, shows the async modal,
  // and re-submits programmatically only if confirmed.
  window.handleConfirmSubmit = function (event, message, options) {
    event.preventDefault();
    var form = event.target;
    window.showConfirm(message, options).then(function (ok) {
      if (ok) form.submit();
    });
    return false;
  };
})();
