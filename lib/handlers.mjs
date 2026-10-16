import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(zlib.gzip);

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

// text types worth gzipping (images/fonts/audio are already compressed)
const COMPRESSIBLE = new Set(["html", "js", "mjs", "css", "json", "svg"]);

function isCompressible(path) {
  return COMPRESSIBLE.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}

function cacheControlFor(path) {
  // vendored libs are content-stable → cache hard; everything else revalidates
  return path.includes(`${sep}vendor${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function sendJson(res, payload) {
  res.writeHead(200, { "content-type": MIME.json });
  res.end(JSON.stringify(payload));
}

function sendSnapshot(req, res, entry) {
  const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  const headers = { "content-type": MIME.json, vary: "Accept-Encoding" };
  if (wantsGzip && entry.gzip) {
    res.writeHead(200, { ...headers, "content-encoding": "gzip" });
    res.end(entry.gzip);
  } else {
    res.writeHead(200, headers);
    res.end(entry.json ?? JSON.stringify(entry.snapshot));
  }
}

export function createRequestHandler({ staticDir, cache, prefix = "" }) {
  const safeRoot = resolve(staticDir);
  // static-file cache: abs path -> { mtimeMs, size, etag, buf, gzip }
  const staticCache = new Map();

  async function loadStatic(abs) {
    const st = await stat(abs);
    const hit = staticCache.get(abs);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const buf = await readFile(abs);
    const entry = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      etag: `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`,
      buf,
      gzip:
        isCompressible(abs) && buf.length > 1024 ? await gzipAsync(buf) : null,
    };
    staticCache.set(abs, entry);
    return entry;
  }

  return async (req, res) => {
    const full = (req.url || "/").split("?")[0];
    if (prefix && full === prefix) {
      res.writeHead(301, { location: prefix + "/" });
      res.end();
      return;
    }
    let url =
      prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full;
    if (url === "") url = "/";

    if (url.endsWith("/api/snapshot")) {
      try {
        sendSnapshot(req, res, await cache.get());
      } catch {
        sendJson(res, { generatedAt: Date.now(), islands: [] });
      }
      return;
    }
    if (url.endsWith("/api/refresh")) {
      try {
        sendSnapshot(req, res, await cache.refresh());
      } catch {
        sendJson(res, { generatedAt: Date.now(), islands: [] });
      }
      return;
    }

    let abs;
    try {
      const reqPath = url === "/" ? "/OpenTree.html" : decodeURIComponent(url);
      abs = resolve(
        safeRoot,
        "." + (reqPath.startsWith("/") ? reqPath : "/" + reqPath),
      );
    } catch {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (abs !== safeRoot && !abs.startsWith(safeRoot + sep)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      const entry = await loadStatic(abs);
      const headers = {
        "content-type": mimeFor(abs),
        "cache-control": cacheControlFor(abs),
        etag: entry.etag,
        vary: "Accept-Encoding",
      };
      if (req.headers["if-none-match"] === entry.etag) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
      if (wantsGzip && entry.gzip) {
        res.writeHead(200, { ...headers, "content-encoding": "gzip" });
        res.end(entry.gzip);
      } else {
        res.writeHead(200, headers);
        res.end(entry.buf);
      }
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  };
}
