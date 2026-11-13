// Runs the API against a fake 100ms so the logic can be checked without an account: npm test
import assert from "node:assert/strict";
process.env.HMS_ACCESS_KEY = "test-key"; process.env.HMS_SECRET = "test-secret-test-secret";
process.env.TEACHER_PASSWORD = "chess-teacher-pw"; process.env.SESSION_SECRET = "session-secret-0123456789";

const rooms = new Map(); const calls = [];
const assets = [{ id: "asset1", room_id: null, type: "room-composite", path: "a/b.mp4", status: "completed", duration: 1800, size: 5e7, created_at: "2026-11-10T11:00:00Z" },
                { id: "chat1", room_id: null, type: "chat", path: "a/chat.csv", status: "completed", created_at: "2026-11-10T11:00:00Z" }];
let n = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const p = u.pathname.replace("/v2", ""); const method = opts.method || "GET";
  calls.push(method + " " + p);
  assert.match(opts.headers.Authorization, /^Bearer .+\..+\..+$/);
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (p === "/rooms" && method === "POST") { const b = JSON.parse(opts.body); const id = "room" + String(++n).padStart(8, "0"); rooms.set(id, { id, enabled: true, ...b }); return json(200, rooms.get(id)); }
  if (p === "/rooms" && method === "GET") return json(200, { data: [...rooms.values()].filter((r) => r.enabled).concat([{ id: "other0000001", name: "someone-elses-room", description: "hi", enabled: true }]) });
  const m = p.match(/^\/rooms\/(\w+)$/);
  if (m && method === "GET") return rooms.has(m[1]) ? json(200, rooms.get(m[1])) : json(404, {});
  if (m && method === "POST") { Object.assign(rooms.get(m[1]), JSON.parse(opts.body)); return json(200, rooms.get(m[1])); }
  if (p.startsWith("/active-rooms/")) return p.endsWith(liveRoom) ? json(200, { id: liveRoom, session: { id: "s1", peers: [] } }) : json(404, {});
  if (p.startsWith("/recordings/room/")) return json(200, {});
  if (p === "/recording-assets") return json(200, { data: assets.filter((a) => a.room_id === u.searchParams.get("room_id")) });
  if (p.match(/^\/recording-assets\/\w+\/presigned-url$/)) return json(200, { url: "https://storage.example/rec.mp4?sig=1" });
  return json(500, { message: "unexpected " + p });
};
let liveRoom = "none";

const load = async (f) => (await import("../api/" + f + ".js")).default;
async function call(file, { method = "GET", body, query = {}, auth } = {}) {
  const h = await load(file); let status, out;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { out = j; } };
  await h({ method, body, query, headers: auth ? { authorization: "Bearer " + auth } : {} }, res);
  return { status, ...out };
}
const { verifyJwt } = await import("../api/_lib.js");

// teacher login
assert.equal((await call("login", { method: "POST", body: { password: "nope" } })).status, 401);
const T = (await call("login", { method: "POST", body: { password: "chess-teacher-pw" } })).token; assert.ok(T);
assert.equal((await call("me", { auth: T })).user.role, "teacher");
assert.equal((await call("classes")).status, 401);

// add students in two batches
const A = await call("invite", { method: "POST", auth: T, body: { name: "Aarav", batch: "Beginners Sat" } });
const B = await call("invite", { method: "POST", auth: T, body: { name: "Meera", batch: "Advanced" } });
assert.equal((await call("me", { auth: A.parentCode })).user.role, "parent");
assert.equal((await call("me", { auth: A.studentCode })).user.name, "Aarav");
assert.equal((await call("me", { auth: A.studentCode.slice(0, -2) + "xx" })).status, 401, "tampered code rejected");
assert.equal((await call("invite", { method: "POST", auth: A.studentCode, body: { name: "X y", batch: "b" } })).status, 403);

// schedule classes
const soon = new Date(Date.now() + 5 * 60000).toISOString();
const c1 = (await call("classes", { method: "POST", auth: T, body: { title: "Forks practice", batch: "Beginners Sat", startsAt: soon, durationMin: 60 } })).class;
const c2 = (await call("classes", { method: "POST", auth: T, body: { title: "Rook endings", batch: "Advanced", startsAt: soon } })).class;
assert.equal((await call("classes", { method: "POST", auth: A.studentCode, body: { title: "Hack", batch: "x", startsAt: soon } })).status, 403);
liveRoom = c1.id; assets[0].room_id = c1.id; assets[1].room_id = c1.id;

// who sees what
assert.equal((await call("classes", { auth: T })).classes.length, 2);
const aList = (await call("classes", { auth: A.parentCode })).classes;
assert.deepEqual(aList.map((c) => c.title), ["Forks practice"]); assert.equal(aList[0].live, true);
assert.deepEqual((await call("classes", { auth: B.studentCode })).classes.map((c) => c.title), ["Rook endings"]);

// joining
const j = await call("join", { method: "POST", auth: A.studentCode, body: { classId: c1.id } });
const claims = verifyJwt(j.authToken, process.env.HMS_SECRET);
assert.equal(claims.role, "guest"); assert.equal(claims.room_id, c1.id); assert.equal(claims.type, "app"); assert.equal(claims.version, 2); assert.equal(claims.access_key, "test-key");
assert.equal(verifyJwt((await call("join", { method: "POST", auth: T, body: { classId: c1.id } })).authToken, process.env.HMS_SECRET).role, "host");
assert.equal((await call("join", { method: "POST", auth: A.parentCode, body: { classId: c1.id } })).status, 403, "parents don't join live");
assert.equal((await call("join", { method: "POST", auth: B.studentCode, body: { classId: c1.id } })).status, 404, "other batch can't join");
assert.equal((await call("join", { method: "POST", auth: T, body: { classId: "other0000001" } })).status, 404, "non-class rooms hidden");

// recording
assert.equal((await call("record", { method: "POST", auth: A.studentCode, body: { classId: c1.id } })).status, 403);
assert.equal((await call("record", { method: "POST", auth: T, body: { classId: c1.id, action: "start" } })).ok, true);
assert.ok(calls.includes(`POST /recordings/room/${c1.id}/start`));
const recs = (await call("recordings", { auth: A.parentCode, query: { classId: c1.id } })).recordings;
assert.equal(recs.length, 1, "only the video, not the chat file"); assert.equal(recs[0].durationSec, 1800);
assert.match((await call("recordings", { auth: A.parentCode, query: { classId: c1.id, assetId: "asset1" } })).url, /^https:/);
assert.equal((await call("recordings", { auth: B.parentCode, query: { classId: c1.id } })).status, 404, "other family can't see it");
assert.equal((await call("recordings", { auth: A.parentCode, query: { classId: c1.id, assetId: "chat1" } })).status, 404);

// delete
assert.equal((await call("classes", { method: "DELETE", auth: T, query: { id: c2.id } })).ok, true);
assert.equal((await call("classes", { auth: T })).classes.length, 1);

// setup guard
delete process.env.HMS_SECRET;
const g = await call("classes", { auth: T }); assert.equal(g.status, 503); assert.equal(g.code, "setup");
console.log("All API checks passed.");
