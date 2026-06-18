import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

const MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  mp3: "audio/mpeg",
  woff2: "font/woff2",
  ico: "image/x-icon",
};

function mimeFor(path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

export function createServer({ staticDir, getSnapshot }) {
  return http.createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (url === "/api/snapshot") {
      let payload;
      try {
        payload = await getSnapshot();
      } catch {
        payload = { generatedAt: Date.now(), islands: [] };
      }
      res.writeHead(200, { "content-type": MIME.json });
      res.end(JSON.stringify(payload));
      return;
    }

    const rel = normalize(url === "/" ? "/OpenTree.html" : url).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    if (rel.includes("..")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      const buf = await readFile(join(staticDir, rel));
      res.writeHead(200, { "content-type": mimeFor(rel) });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
}
