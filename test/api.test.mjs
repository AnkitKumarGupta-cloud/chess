// Runs the API against a fake Redis and a fake LiveKit so the logic is checked without any account: npm test
import assert from "node:assert/strict";
import { useEnv, db, lk, decodeLk } from "./fakes.mjs";
useEnv();

const load = async (f) => (await import("../api/" + f + ".js")).default;
async function call(file, { method = "GET", body, query = {}, auth } = {}) {
  const h = await load(file); let status, out;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { out = j; } };
  await h({ method, body, query, headers: auth ? { authorization: "Bearer " + auth } : {} }, res);
  return { status, ...out };
}
const login = async (username, password) => call("login", { method: "POST", body: { username, password } });

// --- sign in ---
assert.equal((await login("teacher", "nope")).status, 401);
assert.equal((await login("", "")).status, 400);
const t = await login("Teacher", "chess-teacher-pw"); assert.equal(t.status, 200); const T = t.token;
assert.equal((await call("me", { auth: T })).user.role, "teacher");
assert.equal((await call("me")).status, 401);
assert.equal((await call("me", { auth: "a.b.c" })).status, 401);

// --- teacher adds a student ---
assert.equal((await call("users", { method: "POST", body: { name: "Rohan" } })).status, 401);
const made = await call("users", { method: "POST", auth: T, body: { name: "Rohan Gupta", batch: "Beginners Saturday" } });
assert.equal(made.status, 200); assert.equal(made.accounts.length, 1, "no parent login any more"); const [stu] = made.accounts;
assert.equal(stu.username, "rohangupta");
// older parent accounts (made before parent logins were removed) keep working for recordings
const lib = await import("../api/_lib.js"); const par = { username: "rohangupta-parent", password: "parentpw1" };
await lib.putUser({ username: par.username, name: "Rohan Gupta", role: "parent", batch: "beginners-saturday", batchName: "Beginners Saturday", pw: lib.hashPassword(par.password), createdAt: Date.now() }); assert.match(stu.password, /^[a-z2-9]{8}$/);
const stored = db.get("u:rohangupta"); assert.ok(!stored.includes(stu.password), "password must be stored hashed");
const S = (await login(stu.username, stu.password)).token, P = (await login(par.username, par.password)).token;
assert.equal((await login(stu.username, "wrong")).status, 401);
assert.equal((await call("me", { auth: S })).user.batch, "beginners-saturday");
// same name again gets a different username
const again = await call("users", { method: "POST", auth: T, body: { name: "Rohan Gupta", batch: "Beginners Saturday", withParent: false } });
assert.notEqual(again.accounts[0].username, "rohangupta"); assert.equal(again.accounts.length, 1);
// students cannot manage accounts or classes
assert.equal((await call("users", { auth: S })).status, 403);
assert.equal((await call("users", { method: "POST", auth: S, body: { name: "x", batch: "y" } })).status, 403);
assert.equal((await call("classes", { method: "POST", auth: S, body: {} })).status, 403);
assert.equal((await call("users", { auth: T })).users.length, 3);

// --- lock after too many wrong passwords ---
for (let i = 0; i < 8; i++) await login("rohangupta-parent", "bad" + i);
assert.equal((await login("rohangupta-parent", par.password)).status, 429);
db.delete("rl:rohangupta-parent");

// --- change password ---
assert.equal((await call("password", { method: "POST", auth: S, body: { oldPassword: "wrong", newPassword: "newpass99" } })).status, 401);
assert.equal((await call("password", { method: "POST", auth: S, body: { oldPassword: stu.password, newPassword: "abc" } })).status, 400);
assert.equal((await call("password", { method: "POST", auth: S, body: { oldPassword: stu.password, newPassword: "newpass99" } })).status, 200);
assert.equal((await login(stu.username, stu.password)).status, 401); assert.equal((await login(stu.username, "newpass99")).status, 200);
const rs = await call("users", { method: "POST", auth: T, body: { action: "reset", username: stu.username } });
assert.equal((await login(stu.username, rs.password)).status, 200);

// --- classes ---
const mk = (batch, at = "2026-11-20T11:00:00Z") => call("classes", { method: "POST", auth: T, body: { title: "Knight forks", batch, startsAt: at, durationMin: 60 } });
assert.equal((await call("classes", { method: "POST", auth: T, body: { title: "", batch: "x" } })).status, 400);
const c1 = (await mk("Beginners Saturday")).class, c2 = (await mk("Advanced Sunday")).class;
assert.equal(c1.roomName, "cs-" + c1.id);
const tl = await call("classes", { auth: T }); assert.equal(tl.classes.length, 2); assert.equal(tl.recordingReady, true);
const sl = await call("classes", { auth: S }); assert.deepEqual(sl.classes.map((c) => c.id), [c1.id]);
assert.equal((await call("classes", { auth: P })).classes.length, 1);

// --- joining ---
assert.equal((await call("join", { method: "POST", auth: P, body: { classId: c1.id } })).status, 403);
assert.equal((await call("join", { method: "POST", auth: S, body: { classId: c2.id } })).status, 404);
assert.equal((await call("join", { method: "POST", auth: S, body: { classId: "../etc" } })).status, 400);
const js = await call("join", { method: "POST", auth: S, body: { classId: c1.id } });
assert.equal(js.serverUrl, "wss://demo.livekit.cloud"); assert.equal(js.isTeacher, false);
const sg = decodeLk(js.token); assert.equal(sg.video.room, c1.roomName); assert.equal(sg.video.roomAdmin, undefined); assert.deepEqual(sg.video.canPublishSources, ["camera", "microphone", "screen_share", "screen_share_audio"]); assert.equal(sg.sub, "rohangupta");
const jt = await call("join", { method: "POST", auth: T, body: { classId: c1.id } });
const tg = decodeLk(jt.token); assert.equal(tg.video.roomAdmin, true); assert.equal(tg.video.canPublishSources, undefined); assert.equal(jt.isTeacher, true);

// --- live status + recording ---
lk.rooms[c1.roomName] = 3;
assert.equal((await call("classes", { auth: S })).classes[0].live, true);
assert.equal((await call("record", { method: "POST", auth: S, body: { classId: c1.id, action: "start" } })).status, 403);
assert.equal((await call("record", { method: "POST", auth: T, body: { classId: c1.id, action: "start" } })).started, true);
assert.equal((await call("record", { method: "POST", auth: T, body: { classId: c1.id, action: "start" } })).already, true);
assert.equal(Object.keys(lk.egress).length, 1);
assert.deepEqual((await call("recordings", { query: { classId: c1.id }, auth: S })).recordings, []);   // still recording
assert.equal((await call("record", { method: "POST", auth: T, body: { classId: c1.id, action: "stop" } })).stopped, true);
const recs = (await call("recordings", { query: { classId: c1.id }, auth: P })).recordings;
assert.equal(recs.length, 1); assert.match(recs[0].url, /^https:\/\/pub-demo\.r2\.dev\/recordings\/[a-f0-9]{12}\/\d+-[a-f0-9]{16}\.mp4$/);
assert.equal((await call("recordings", { query: { classId: c2.id }, auth: P })).status, 404);   // other batch
// teacher left without pressing stop: recording is wrapped up once the room is empty
await call("record", { method: "POST", auth: T, body: { classId: c1.id, action: "start" } }); lk.rooms[c1.roomName] = 0;
assert.equal((await call("recordings", { query: { classId: c1.id }, auth: S })).recordings.length, 2);
assert.ok(Object.values(lk.egress).every((e) => e.stopped));

// --- delete ---
assert.equal((await call("classes", { method: "DELETE", auth: T, query: { id: c2.id } })).ok, true);
assert.equal((await call("classes", { auth: T })).classes.length, 1);
assert.equal((await call("users", { method: "DELETE", auth: T, query: { username: stu.username } })).ok, true);
assert.equal((await call("me", { auth: S })).status, 401);   // deleted account is cut off

// --- missing settings give a friendly message ---
delete process.env.LIVEKIT_API_KEY;
const noLive = await call("join", { method: "POST", auth: P, body: { classId: c1.id } });
assert.equal(noLive.status, 503); assert.match(noLive.error, /LIVEKIT_API_KEY/);
console.log("All API checks passed.");

// Batches typed differently still match ("Batch 1" == "batch1").
{
  const lib = await import("../api/_lib.js");
  assert.equal(lib.sameBatch("batch-1", "batch1"), true);
  assert.equal(lib.sameBatch("Beginners Saturday", "beginners-saturday"), true);
  assert.equal(lib.sameBatch("batch1", "batch2"), false);
  assert.equal(lib.sameBatch("", ""), false);
  assert.equal(lib.canSee({ role: "student", batch: "batch1" }, { batch: "batch-1" }), true);
  console.log("Batch matching checks passed.");
}
