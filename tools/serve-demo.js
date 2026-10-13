/** 本地静态服务器（仅验收/工具用）：node tools/serve-demo.js [port]
 *  额外提供 POST /__save?path=<rel> —— 将 base64 图片写回项目内（仅本机开发用）。
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const port = Number(process.argv[2]) || 8811;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (req.method === "POST" && u.pathname === "/__save") {
      const rel = u.searchParams.get("path") || "";
      const file = path.resolve(root, rel);
      if (!rel || !file.startsWith(root) || file.includes("..")) { res.writeHead(403); return res.end("forbidden"); }
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          const b64 = body.replace(/^data:image\/png;base64,/, "");
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.from(b64, "base64"));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, bytes: fs.statSync(file).size }));
        } catch (e) {
          res.writeHead(500); res.end(String(e));
        }
      });
      return;
    }
    const urlPath = decodeURIComponent(u.pathname);
    let file = path.join(root, urlPath === "/" ? "DEMO/mock.html" : urlPath.replace(/^\//, ""));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`demo at http://127.0.0.1:${port}/`));
