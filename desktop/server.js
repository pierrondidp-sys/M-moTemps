"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

// Serves the app's own static files (index.html, css/, js/, icons/) over
// http://127.0.0.1 instead of file://, so the page runs in a real secure
// context: the service worker can register, and OAuth popups (Google
// Drive) get a stable http origin they can be configured to trust as a
// loopback redirect - none of that works from a file:// origin.
function startServer(rootDir, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = path.normalize(path.join(rootDir, urlPath));
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        // The other desktop entry point (desktop/main.js / widget-main.js)
        // is already serving this same port - that's fine, they're meant to
        // share one origin (and therefore one localStorage) even when both
        // run at the same time. Resolve with null: the caller doesn't need
        // its own server instance, just for the port to already be live.
        resolve(null);
        return;
      }
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { startServer };
