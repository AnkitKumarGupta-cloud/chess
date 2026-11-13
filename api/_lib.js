// Shared helpers for the Chess Sathi live-class API (Vercel serverless functions).
// Video, chat, screen share and recording are provided by 100ms. Classes are stored as 100ms rooms,
// and students/parents sign in with personal codes signed by SESSION_SECRET (no database needed).
import crypto from "node:crypto";

const HMS_API = "https://api.100ms.live/v2";
const b64u = (x) => Buffer.from(x).toString("base64url");

export function cfg() {
  const e = process.env;
  return {
    key: e.HMS_ACCESS_KEY, secret: e.HMS_SECRET,
    teacherPassword: e.TEACHER_PASSWORD, sessionSecret: e.SESSION_SECRET,
    teacherRole: e.HMS_TEACHER_ROLE || "host", studentRole: e.HMS_STUDENT_ROLE || "guest",
    templateId: e.HMS_TEMPLATE_ID || undefined,
  };
}
export function missingSetup() {
  const c = cfg();
  return [["HMS_ACCESS_KEY", c.key], ["HMS_SECRET", c.secret], ["TEACHER_PASSWORD", c.teacherPassword], ["SESSION_SECRET", c.sessionSecret]]
    .filter(([, v]) => !v).map(([k]) => k);
}

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/* ---------- JWT (HS256) ---------- */
export function signJwt(payload, secret, expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, nbf: now, exp: now + expiresInSec, jti: crypto.randomUUID() };
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = head + "." + b64u(JSON.stringify(body));
  return data + "." + crypto.createHmac("sha256", secret).update(data).digest("base64url");
}
export function verifyJwt(token, secret) {
  const [h, p, s] = String(token).split(".");
  if (!h || !p || !s) return null;
  const want = crypto.createHmac("sha256", secret).update(h + "." + p).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const body = JSON.parse(Buffer.from(p, "base64url").toString());
    if (body.exp && body.exp < Date.now() / 1000) return null;
    return body;
  } catch { return null; }
}

/* ---------- People ---------- */
export const slug = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// A personal sign-in code: role + batch + child's name, signed so it can't be edited.
export function makeCode(role, name, batch) {
  const { sessionSecret } = cfg();
  const data = b64u([role, slug(batch), String(name).trim().slice(0, 40), crypto.randomBytes(3).toString("hex")].join("\n"));
  const sig = crypto.createHmac("sha256", sessionSecret).update("code:" + data).digest().subarray(0, 10);
  return data + "." + b64u(sig);
}
function readCode(code) {
  const { sessionSecret } = cfg();
  const [data, sig] = String(code).split(".");
  if (!data || !sig) return null;
  const want = crypto.createHmac("sha256", sessionSecret).update("code:" + data).digest().subarray(0, 10);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  const [role, batch, name, id] = Buffer.from(data, "base64url").toString().split("\n");
  if (!["student", "parent"].includes(role) || !batch || !name) return null;
  return { role, batch, name, id: role[0] + "-" + id };
}
export function teacherToken() {
  return signJwt({ r: "teacher" }, cfg().sessionSecret, 30 * 24 * 3600);
}
export function checkTeacherPassword(pw) {
  const a = crypto.createHash("sha256").update(String(pw || "")).digest();
  const b = crypto.createHash("sha256").update(String(cfg().teacherPassword)).digest();
  return crypto.timingSafeEqual(a, b);
}
// Who is calling? Reads "Authorization: Bearer <teacher token or personal code>".
export function whoIs(req) {
  const raw = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) throw new HttpError(401, "Please sign in first.", "signin");
  if (raw.split(".").length === 3) {
    const t = verifyJwt(raw, cfg().sessionSecret);
    if (t && t.r === "teacher") return { role: "teacher", name: "Teacher", batch: null, id: "teacher" };
  } else {
    const u = readCode(raw);
    if (u) return u;
  }
  throw new HttpError(401, "This sign-in is not valid any more. Please sign in again.", "signin");
}
export function mustBeTeacher(user) {
  if (user.role !== "teacher") throw new HttpError(403, "Only the teacher can do this.");
}

/* ---------- 100ms ---------- */
let mgmt = { token: null, exp: 0 };
function managementToken() {
  const c = cfg();
  if (!mgmt.token || mgmt.exp < Date.now() + 60000) {
    mgmt = { token: signJwt({ access_key: c.key, type: "management", version: 2 }, c.secret, 3600), exp: Date.now() + 3600000 };
  }
  return mgmt.token;
}
export async function hms(path, { method = "GET", body, allow404 = false } = {}) {
  const r = await fetch(HMS_API + path, {
    method,
    headers: { Authorization: "Bearer " + managementToken(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow404 && (r.status === 404 || r.status === 400)) return null;
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new HttpError(502, "The video service returned an error" + (j && j.message ? `: ${j.message}` : ` (${r.status}).`), "video");
  return j;
}
export function roomAuthToken(roomId, user) {
  const c = cfg();
  return signJwt({
    access_key: c.key, room_id: roomId, user_id: user.id,
    role: user.role === "teacher" ? c.teacherRole : c.studentRole, type: "app", version: 2,
  }, c.secret, 6 * 3600);
}

/* ---------- Classes (each class is one 100ms room) ---------- */
function toClass(room) {
  if (!room || !String(room.name || "").toLowerCase().startsWith("cs-")) return null;
  try {
    const m = JSON.parse(room.description);
    if (!m.t || !m.b || !m.at) return null;
    return { id: room.id, title: m.t, batch: m.b, batchName: m.bn || m.b, startsAt: m.at, durationMin: m.d || 60 };
  } catch { return null; }
}
export async function listClasses() {
  const out = [];
  let start = "";
  for (let page = 0; page < 5; page++) {
    const r = await hms(`/rooms?enabled=true&limit=100${start ? `&start=${encodeURIComponent(start)}` : ""}`);
    const data = (r && r.data) || [];
    for (const room of data) { const c = toClass(room); if (c) out.push(c); }
    if (data.length < 100 || !r.last) break;
    start = r.last;
  }
  return out.sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
}
export const canSee = (user, cls) => user.role === "teacher" || user.batch === cls.batch;
export async function getClassFor(user, id) {
  if (!/^[a-zA-Z0-9]{8,40}$/.test(String(id || ""))) throw new HttpError(400, "That class was not found.");
  const room = await hms(`/rooms/${id}`, { allow404: true });
  const cls = room && room.enabled !== false ? toClass(room) : null;
  if (!cls || !canSee(user, cls)) throw new HttpError(404, "That class was not found.");
  return cls;
}
export async function isLive(roomId) {
  const r = await hms(`/active-rooms/${roomId}`, { allow404: true }).catch(() => null);
  return !!(r && r.session);
}

/* ---------- Request plumbing ---------- */
export function handler(fn, { needsSetup = true } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (needsSetup) {
        const miss = missingSetup();
        if (miss.length) throw new HttpError(503, "Live classes are not set up yet. Missing settings: " + miss.join(", "), "setup");
      }
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const out = await fn({ req, body: body || {}, query: req.query || {} });
      res.status(200).json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: e instanceof HttpError ? e.message : "Something went wrong. Please try again.", code: e.code });
    }
  };
}
