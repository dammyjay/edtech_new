// Zero-dependency static file server for this spike only — just serves
// index.html/worker.js over http:// so the browser treats Worker loading
// normally (file:// origins block classic Worker script loading in most
// browsers). Not part of the real app; nothing here touches routes/,
// controllers/, or the DB.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.SPIKE_PORT || 4501;
const ROOT = __dirname;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

http
  .createServer((req, res) => {
    const urlPath = req.url === "/" ? "/index.html" : req.url;
    const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Spike server on http://127.0.0.1:${PORT}`));
