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
//
// Multipart (file-upload) forms get the token a second way: also appended
// to the form's action URL as ?_csrf=... . A native <form> submit can't
// set a custom header the way fetch() can, and the server's CSRF check
// (middlewares/csrf.js) runs before the route's own multer middleware has
// parsed a multipart body — so the hidden _csrf field alone arrives too
// late for the server to see it on those forms. The query-string copy is
// read from req.query, which Express populates immediately regardless of
// Content-Type. Non-multipart forms don't need this — their body is
// already parsed by the time the check runs — so it's left untouched.
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

      var enctype = (form.getAttribute("enctype") || "").toLowerCase();
      if (enctype === "multipart/form-data" && form.action.indexOf("_csrf=") === -1) {
        var sep = form.action.indexOf("?") === -1 ? "?" : "&";
        form.action = form.action + sep + "_csrf=" + encodeURIComponent(token);
      }
    },
    true // capture phase — runs before the form's own submit handlers fire
  );
})();
