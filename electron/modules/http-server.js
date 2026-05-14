// electron/modules/http-server.js
// Lightweight HTTP server to serve the built dist folder.
// Solves the file:// + <script type="module"> blocking issue in Chromium.

const http = require("http");
const path = require("path");
const fs = require("fs");

// Helper to read files - files are now unpacked from asar
function readFileFromPath(filePath, callback) {
  fs.readFile(filePath, callback);
}

function existsSync(filePath) {
  return fs.existsSync(filePath);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

let serverInstance = null;
let serverPort = 0;

function getMime(type) {
  return MIME_TYPES[type] || "application/octet-stream";
}

function parseUrl(urlStr) {
  try {
    const u = new URL(urlStr, "http://localhost");
    return { pathname: decodeURIComponent(u.pathname), search: u.search };
  } catch {
    return { pathname: "/", search: "" };
  }
}

function serveDir(req, res, rootPath) {
  console.log(`[HTTP] Request: ${req.url}, rootPath: ${rootPath}`);
  
  const { pathname, search } = parseUrl(req.url);

  // Strip query string for file lookup
  const cleanPath = pathname.replace(/[?#].*$/, "");

  // Always serve index.html for non-file paths (SPA fallback)
  let filePath = path.join(rootPath, cleanPath);
  console.log(`[HTTP] Trying filePath: ${filePath}, exists: ${existsSync(filePath)}`);
  
  if (
    cleanPath.endsWith("/") ||
    (!existsSync(filePath) && cleanPath !== "" && !cleanPath.includes("."))
  ) {
    filePath = path.join(rootPath, "index.html");
    console.log(`[HTTP] Fallback to index.html: ${filePath}`);
  }

  // Path traversal guard
  const absRoot = path.resolve(rootPath);
  const absFile = path.resolve(filePath);
  if (!absFile.startsWith(absRoot + path.sep) && absFile !== absRoot) {
    console.log(`[HTTP] Forbidden: ${absFile} outside ${absRoot}`);
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  readFileFromPath(filePath, (err, data) => {
    if (err) {
      console.log(`[HTTP] Error reading ${filePath}: ${err.code} - ${err.message}`);
      if (err.code === "ENOENT") {
        res.writeHead(404);
        res.end("Not Found");
      } else {
        res.writeHead(500);
        res.end("Server Error");
      }
      return;
    }
    console.log(`[HTTP] Served: ${filePath} (${data.length} bytes)`);

    const ext = path.extname(filePath);
    const contentType = getMime(ext);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function start(distDir, preferredPort) {
  // Kill existing server if running
  stop();

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      serveDir(req, res, distDir);
    });

    server.on("listening", () => {
      const addr = server.address();
      serverPort = addr.port;
      serverInstance = server;
      resolve(serverPort);
    });

    server.on("error", (err) => {
      reject(err);
    });

    // Try preferred port first, then 0 for any available
    const portsToTry = preferredPort ? [preferredPort, 0] : [0];
    let idx = 0;

    function tryStart() {
      if (idx >= portsToTry.length) {
        reject(new Error("No available port found"));
        return;
      }
      server.listen(portsToTry[idx], "127.0.0.1", () => {
        const addr = server.address();
        if (addr.port === 0) {
          // 0 means random, try again with explicit next port
          idx++;
          server.close(() => tryStart());
        } else {
          // Success
        }
      });
    }

    tryStart();
  });
}

function stop() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
    serverPort = 0;
  }
}

function getURL() {
  return serverPort ? `http://127.0.0.1:${serverPort}` : null;
}

module.exports = { start, stop, getURL, getPort: () => serverPort };
