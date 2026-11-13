// Shared helpers for the Chess Sathi API (Vercel serverless functions).
//  - Accounts (teacher, students, parents) and classes live in a small Upstash Redis database.
//  - Live video, chat, screen share and recording run on LiveKit Cloud.
//  - Recordings are saved to a Cloudflare R2 (or any S3-compatible) bucket.
// Nothing here needs an npm package: tokens are signed with Node's built-in crypto.
import crypto from "node:crypto";

const b64u = (x) => Buffer.from(x).toString("base64url");

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/* ---------- Settings ---------- */
export function cfg() {
  const e = process.env;
  return {
    sessionSecret: e.SESSION_SECRET, teacherPassword: e.TEACHER_PASSWORD,
    dbUrl: e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL, dbToken: e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN,
    lkUrl: e.LIVEKIT_URL, lkKey: e.LIVEKIT_API_KEY, lkSecret: e.LIVEKIT_API_SECRET,
    rec: { endpoint: e.RECORD_S3_ENDPOINT, bucket: e.RECORD_S3_BUCKET, accessKey: e.RECORD_S3_ACCESS_KEY, secret: e.RECORD_S3_SECRET,
      region: e.RECORD_S3_REGION || "auto", publicUrl: (e.RECORD_PUBLIC_URL || "").replace(/\/+$/, "") },
  };
}
const NEEDS = {
  base: (c) => [["SESSION_SECRET", c.sessionSecret]],
  db: (c) => [["UPSTASH_REDIS_REST_URL", c.dbUrl], ["UPSTASH_REDIS_REST_TOKEN", c.dbToken]],
  live: (c) => [["LIVEKIT_URL", c.lkUrl], ["LIVEKIT_API_KEY", c.lkKey], ["LIVEKIT_API_SECRET", c.lkSecret]],
};
export function missing(groups) {
  const c = cfg();
  return groups.flatMap((g) => NEEDS[g](c)).filter(([, v]) => !v).map(([k]) => k);
}
export const recordingReady = () => { const r = cfg().rec; return !!(r.endpoint && r.bucket && r.accessKey && r.secret && r.publicUrl); };

/* ---------- JWT (HS256) ---------- */
export function signJwt(payload, secret, expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, nbf: now - 5, exp: now + expiresInSec, jti: crypto.randomUUID() };
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

/* ---------- Database (Upstash Redis over HTTPS) ---------- */
export async function kv(...cmd) {
  const miss = missing(["db"]);
  if (miss.length) throw new HttpError(503, "The database is not connected yet. Missing settings: " + miss.join(", "), "setup");
  const { dbUrl, dbToken } = cfg();
  const r = await fetch(dbUrl, { method: "POST", headers: { Authorization: "Bearer " + dbToken, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok || !j || j.error) throw new HttpError(502, "The database returned an error. Please try again.", "db");
  return j.result;
}
const jparse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/* ---------- People ---------- */
export const slug = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
export const normUser = (u) => String(u || "").trim().toLowerCase();
export const validUsername = (u) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
const PW_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
export const newPassword = () => Array.from({ length: 8 }, () => PW_CHARS[crypto.randomInt(PW_CHARS.length)]).join("");

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(String(pw), salt, 32).toString("hex");
}
function checkHash(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), salt, 32), want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function sameSecret(a, b) {
  const x = crypto.createHash("sha256").update(String(a || "")).digest(), y = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(x, y);
}
export const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, batch: u.batch || null, batchName: u.batchName || null });
export const TEACHER = { username: "teacher", name: "Teacher", role: "teacher", batch: null, batchName: null };

export async function getUser(username) { return jparse(await kv("GET", "u:" + normUser(username))); }
export async function putUser(u) { await kv("SET", "u:" + u.username, JSON.stringify(u)); await kv("SADD", "users", u.username); }
export async function listUsers() {
  const names = (await kv("SMEMBERS", "users")) || [];
  if (!names.length) return [];
  const vals = await kv("MGET", ...names.map((n) => "u:" + n));
  return vals.map(jparse).filter(Boolean).map(publicUser).sort((a, b) => a.batch === b.batch ? a.name.localeCompare(b.name) : String(a.batch).localeCompare(String(b.batch)));
}

// Too many wrong passwords in a row locks that username for 15 minutes.
async function throttle(username, failed) {
  if (missing(["db"]).length) return;
  const k = "rl:" + username;
  if (failed === undefined) { const n = +(await kv("GET", k)) || 0; if (n >= 8) throw new HttpError(429, "Too many wrong tries. Please wait 15 minutes and try again.", "locked"); return; }
  if (failed) { const n = await kv("INCR", k); if (n === 1) await kv("EXPIRE", k, 900); } else await kv("DEL", k);
}
export async function checkLogin(usernameRaw, password) {
  const username = normUser(usernameRaw);
  if (!username || !password) throw new HttpError(400, "Please enter your username and password.");
  await throttle(username);
  let user = null;
  if (username === "teacher") {
    const tp = cfg().teacherPassword;
    if (!tp) throw new HttpError(503, "Live classes are not set up yet. Missing settings: TEACHER_PASSWORD", "setup");
    if (sameSecret(password, tp)) user = TEACHER;
  } else {
    const rec = await getUser(username);
    if (rec && checkHash(password, rec.pw)) user = publicUser(rec);
  }
  await throttle(username, !user);
  if (!user) throw new HttpError(401, "That username or password is not right.", "bad-login");
  return user;
}
export const sessionToken = (user) => signJwt({ u: user.username, r: user.role }, cfg().sessionSecret, 30 * 24 * 3600);

// Who is calling? Reads "Authorization: Bearer <session token>".
export async function whoIs(req) {
  const raw = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const t = raw && verifyJwt(raw, cfg().sessionSecret);
  if (!t) throw new HttpError(401, "Please sign in.", "signin");
  if (t.r === "teacher") return { ...TEACHER, id: "teacher" };
  const rec = await getUser(t.u);
  if (!rec) throw new HttpError(401, "This account is not active any more. Please sign in again.", "signin");
  return { ...publicUser(rec), id: rec.username };
}
export function mustBeTeacher(user) { if (user.role !== "teacher") throw new HttpError(403, "Only the teacher can do this."); }

/* ---------- Classes ---------- */
export const canSee = (user, cls) => user.role === "teacher" || user.batch === cls.batch;
export async function listClasses() {
  const ids = (await kv("SMEMBERS", "classes")) || [];
  if (!ids.length) return [];
  const vals = await kv("MGET", ...ids.map((i) => "c:" + i));
  return vals.map(jparse).filter(Boolean).sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
}
export async function getClassFor(user, id) {
  if (!/^[a-f0-9]{12}$/.test(String(id || ""))) throw new HttpError(400, "That class was not found.");
  const cls = jparse(await kv("GET", "c:" + id));
  if (!cls || !canSee(user, cls)) throw new HttpError(404, "That class was not found.");
  return cls;
}
export async function putClass(cls) { await kv("SET", "c:" + cls.id, JSON.stringify(cls)); await kv("SADD", "classes", cls.id); }
export async function removeClass(id) { await kv("SREM", "classes", id); await kv("DEL", "c:" + id); }

/* ---------- LiveKit ---------- */
const lkHttp = () => cfg().lkUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/+$/, "");
export const lkServerUrl = () => cfg().lkUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
function lkToken(identity, grant, ttl, extra = {}) {
  const c = cfg();
  return signJwt({ iss: c.lkKey, sub: identity, video: grant, ...extra }, c.lkSecret, ttl);
}
export function joinToken(user, cls) {
  const teacher = user.role === "teacher";
  const grant = { room: cls.roomName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: true };
  if (teacher) grant.roomAdmin = true; else grant.canPublishSources = ["camera", "microphone"];
  return lkToken(user.id, grant, 6 * 3600, { name: user.role === "parent" ? user.name + " (parent)" : user.name, metadata: JSON.stringify({ role: user.role }) });
}
async function twirp(service, method, grant, body) {
  const miss = missing(["live"]);
  if (miss.length) throw new HttpError(503, "Live classes are not set up yet. Missing settings: " + miss.join(", "), "setup");
  const r = await fetch(`${lkHttp()}/twirp/livekit.${service}/${method}`, {
    method: "POST", headers: { Authorization: "Bearer " + lkToken("server", grant, 600), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw new HttpError(502, "The video service returned an error" + (j && j.msg ? `: ${j.msg}` : ` (${r.status}).`), "video");
  return j || {};
}
// { roomName: number of people } for every room that has someone in it right now.
export async function liveRooms() {
  const r = await twirp("RoomService", "ListRooms", { roomList: true }, {});
  const out = {};
  for (const room of r.rooms || []) out[room.name] = Number(room.numParticipants || room.num_participants || 0);
  return out;
}

/* ---------- Recording (LiveKit Egress -> S3-compatible bucket) ---------- */
export async function startRecording(cls) {
  if (!recordingReady()) throw new HttpError(503, "Recording is not set up yet. Missing settings: RECORD_S3_ENDPOINT, RECORD_S3_BUCKET, RECORD_S3_ACCESS_KEY, RECORD_S3_SECRET, RECORD_PUBLIC_URL", "setup");
  if (await kv("GET", "e:" + cls.id)) return { already: true };
  const s = cfg().rec, file = `recordings/${cls.id}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.mp4`;
  const info = await twirp("Egress", "StartRoomCompositeEgress", { roomRecord: true }, {
    roomName: cls.roomName, layout: "speaker",
    fileOutputs: [{ fileType: "MP4", filepath: file, s3: { accessKey: s.accessKey, secret: s.secret, region: s.region, endpoint: s.endpoint, bucket: s.bucket, forcePathStyle: true } }],
  });
  const id = info.egressId || info.egress_id;
  if (!id) throw new HttpError(502, "The recording did not start.", "video");
  await kv("SET", "e:" + cls.id, JSON.stringify({ egressId: id, file, startedAt: Date.now() }));
  return { started: true };
}
export async function stopRecording(cls) {
  const cur = jparse(await kv("GET", "e:" + cls.id));
  if (!cur) return { already: true };
  try { await twirp("Egress", "StopEgress", { roomRecord: true }, { egressId: cur.egressId }); } catch (e) { if (!(e instanceof HttpError) || e.status !== 502) throw e; }
  const list = jparse(await kv("GET", "r:" + cls.id)) || [];
  list.push({ id: cur.egressId, file: cur.file, startedAt: cur.startedAt, endedAt: Date.now() });
  await kv("SET", "r:" + cls.id, JSON.stringify(list));
  await kv("DEL", "e:" + cls.id);
  return { stopped: true };
}
export async function recordingsFor(cls, nowLive) {
  // If the teacher left without stopping, wrap the recording up once the room is empty.
  if (!nowLive && (await kv("GET", "e:" + cls.id))) await stopRecording(cls);
  const list = jparse(await kv("GET", "r:" + cls.id)) || [];
  const base = cfg().rec.publicUrl;
  return list.map((r, i) => ({ id: r.id, part: i + 1, durationSec: Math.max(1, Math.round((r.endedAt - r.startedAt) / 1000)), url: `${base}/${r.file}` }));
}

/* ---------- Request plumbing ---------- */
export function handler(fn, { needs = ["base"] } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const miss = missing(needs);
      if (miss.length) throw new HttpError(503, "The website is not set up yet. Missing settings: " + miss.join(", "), "setup");
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
