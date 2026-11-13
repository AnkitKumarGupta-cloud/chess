// Local preview with a FAKE video service, to click through the Live page without a 100ms account.
//   npm run build && node test/dev-server.mjs   -> http://localhost:4173  (teacher password: demo-teacher)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
process.env.HMS_ACCESS_KEY ||= "demo"; process.env.HMS_SECRET ||= "demo-secret-demo-secret"; process.env.TEACHER_PASSWORD ||= "demo-teacher"; process.env.SESSION_SECRET ||= "demo-session-secret";
const rooms = new Map(); let n = 0; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, o = {}) => {
  if (!String(url).startsWith("https://api.100ms.live")) return realFetch(url, o);
  const u = new URL(url), p = u.pathname.replace("/v2", ""), m = o.method || "GET"; const J = (s, b) => ({ ok: s < 300, status: s, json: async () => b });
  if (p === "/rooms" && m === "POST") { const id = "demoroom" + String(++n).padStart(4, "0"); rooms.set(id, { id, enabled: true, ...JSON.parse(o.body) }); return J(200, rooms.get(id)); }
  if (p === "/rooms") return J(200, { data: [...rooms.values()].filter((r) => r.enabled) });
  const r = p.match(/^\/rooms\/(\w+)$/);
  if (r && m === "GET") return rooms.has(r[1]) ? J(200, rooms.get(r[1])) : J(404, {});
  if (r) { Object.assign(rooms.get(r[1]), JSON.parse(o.body)); return J(200, {}); }
  if (p.startsWith("/active-rooms/")) return J(404, {});
  if (p === "/recording-assets") return J(200, { data: [{ id: "demoasset1", type: "room-composite", path: "x.mp4", status: "completed", duration: 2710, size: 1, created_at: new Date().toISOString() }] });
  if (p.endsWith("/presigned-url")) return J(200, { url: "/voice/f1.mp3" });
  return J(200, {});
};
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".mp3": "audio/mpeg", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
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
