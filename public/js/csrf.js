// App-wide CSRF auto-injection. Loaded once per page (see the shared
// header partials) alongside a `<meta name="csrf-token" content="...">`
// tag that middlewares/csrf.js's ensureCsrfToken puts on every render.
// Two jobs, both automatic so individual views/scripts don't each need
// editing by hand:
//   1. Patches window.fetch to add an X-CSRF-Token header to same-origin
//      POST/PUT/PATCH/DELETE requests that don't already set one.
//   2. Adds a hidden _csrf field to every same-origin <form method="post">
//      on submit, for pages that still use plain form posts.
// Safe no-op on a page with no meta tag (public pages not yet wired in).
(function () {
  function getToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : null;
  }

  function isSameOrigin(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  var UNSAFE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      var token = getToken();
      if (token) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var method = ((init && init.method) || (typeof input === "object" && input.method) || "GET").toUpperCase();

        if (isSameOrigin(url) && UNSAFE_METHODS.indexOf(method) !== -1) {
          init = init || {};
          var headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined) || {});
          if (!headers.has("X-CSRF-Token")) {
            headers.set("X-CSRF-Token", token);
          }
          init = Object.assign({}, init, { headers: headers });
        }
      }
      return originalFetch.call(this, input, init);
    };
  }

  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      var method = (form.getAttribute("method") || "GET").toUpperCase();
      if (method !== "POST") return;

      var action = form.getAttribute("action") || window.location.href;
      if (!isSameOrigin(action)) return;

      var token = getToken();
      if (!token) return;

      if (!form.querySelector('input[name="_csrf"]')) {
        var input = document.createElement("input");
        input.type = "hidden";
        input.name = "_csrf";
        input.value = token;
        form.appendChild(input);
      }
    },
    true // capture phase — runs before the form's own submit handlers fire
  );
})();
