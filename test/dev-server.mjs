// Local preview with a FAKE database and FAKE LiveKit, to click through the site without any account.
//   npm run build && node test/dev-server.mjs   -> http://localhost:4173  (teacher: teacher / demo-teacher)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { useEnv } from "./fakes.mjs";
useEnv({ TEACHER_PASSWORD: "demo-teacher" });
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".mp3": "audio/mpeg", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    let raw = ""; for await (const c of req) raw += c;
    const mod = await import("../api/" + u.pathname.slice(5).replace(/[^a-z]/g, "") + ".js").catch(() => null);
    if (!mod) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end("{}"); }
    req.body = raw ? JSON.parse(raw) : {}; req.query = Object.fromEntries(u.searchParams);
    res.status = (s) => { res.statusCode = s; return res; }; res.json = (j) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(j)); };
    return mod.default(req, res);
  }
  const f = path.join(dist, u.pathname === "/" ? "index.html" : path.normalize(u.pathname));
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(4173, () => console.log("Chess Sathi demo on http://localhost:4173"));
