// public/js/installPrompt.js
// Only loaded (see views/partials/notificationBell.ejs) when the server
// says this request is the one right after a fresh login AND this user
// hasn't dismissed the prompt before (users2.install_prompt_dismissed_at).
// Uses uiAlerts.js's showActionDialog for the dialog UI, already loaded
// site-wide, so this matches every other confirmation/action dialog in
// the app instead of inventing new modal markup.
(function () {
  var deferredInstallEvent = null;

  function dismiss() {
    fetch("/pwa/install-prompt/dismiss", { method: "POST" }).catch(function () {});
  }

  function show(isIosFallback) {
    var message = isIosFallback
      ? 'Install JKT Hub on your phone: tap the Share icon, then "Add to Home Screen".'
      : "Install JKT Hub for quicker access, right from your home screen or desktop.";
    var buttons = isIosFallback
      ? [{ label: "Got it", value: "dismiss", className: "ui-alert-btn-primary" }]
      : [
          { label: "Not now", value: "dismiss", className: "ui-alert-btn-secondary" },
          { label: "Install", value: "install", className: "ui-alert-btn-primary" },
        ];
    window.showActionDialog(message, "info", buttons, "dismiss").then(function (value) {
      if (value === "install" && deferredInstallEvent) {
        deferredInstallEvent.prompt();
      }
      dismiss();
    });
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallEvent = e;
    show(false);
  });

  // iOS Safari never fires beforeinstallprompt — this is the only way to
  // detect "not already installed" there (navigator.standalone is only
  // ever defined on iOS, true once added to the home screen).
  var isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone;
  if (isIos) show(true);
})();
