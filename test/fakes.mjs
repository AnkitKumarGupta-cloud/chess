// Fake Upstash Redis + fake LiveKit Cloud, so the API can be tested without any account.
import assert from "node:assert/strict";
import crypto from "node:crypto";

export const env = {
  SESSION_SECRET: "session-secret-0123456789", TEACHER_PASSWORD: "chess-teacher-pw",
  UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "redis-token",
  LIVEKIT_URL: "wss://demo.livekit.cloud", LIVEKIT_API_KEY: "APIkey123", LIVEKIT_API_SECRET: "lk-secret-lk-secret-lk-secret-00",
  RECORD_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", RECORD_S3_BUCKET: "recs", RECORD_S3_ACCESS_KEY: "ak", RECORD_S3_SECRET: "sk",
  RECORD_PUBLIC_URL: "https://pub-demo.r2.dev",
};
export function useEnv(extra = {}) { Object.assign(process.env, env, extra); }

export const db = new Map();     // key -> string | Set
export const lk = { rooms: {}, egress: {}, calls: [] };

function redis(cmd) {
  const [op, k, ...a] = cmd;
  switch (op.toUpperCase()) {
    case "GET": return db.has(k) ? db.get(k) : null;
    case "SET": db.set(k, String(a[0])); return "OK";
    case "DEL": return db.delete(k) ? 1 : 0;
    case "SADD": { const s = db.get(k) || new Set(); s.add(a[0]); db.set(k, s); return 1; }
    case "SREM": { const s = db.get(k); return s && s.delete(a[0]) ? 1 : 0; }
    case "SMEMBERS": return [...(db.get(k) || [])];
    case "MGET": return [k, ...a].map((x) => (db.has(x) ? db.get(x) : null));
    case "INCR": { const n = (+db.get(k) || 0) + 1; db.set(k, String(n)); return n; }
    case "EXPIRE": return 1;
    default: throw new Error("fake redis: unsupported " + op);
  }
}
function decode(token) {
  const [h, p, s] = token.split(".");
  const want = crypto.createHmac("sha256", env.LIVEKIT_API_SECRET).update(h + "." + p).digest("base64url");
  assert.equal(s, want, "LiveKit token must be signed with the API secret");
  return JSON.parse(Buffer.from(p, "base64url").toString());
}

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url), json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (u.origin === "https://redis.test") {
    assert.equal(opts.headers.Authorization, "Bearer redis-token");
    return json(200, { result: redis(JSON.parse(opts.body)) });
  }
  if (u.origin === "https://demo.livekit.cloud") {
    const tok = decode(opts.headers.Authorization.replace("Bearer ", "")); assert.equal(tok.iss, env.LIVEKIT_API_KEY);
    const m = u.pathname.replace("/twirp/livekit.", ""), body = JSON.parse(opts.body || "{}"); lk.calls.push(m);
    if (m === "RoomService/ListRooms") { assert.ok(tok.video.roomList); return json(200, { rooms: Object.entries(lk.rooms).map(([name, n]) => ({ name, numParticipants: n })) }); }
    if (m === "Egress/StartRoomCompositeEgress") {
      assert.ok(tok.video.roomRecord); assert.ok(body.roomName.startsWith("cs-")); const o = body.fileOutputs[0];
      assert.equal(o.s3.bucket, "recs"); assert.match(o.filepath, /^recordings\/[a-f0-9]{12}\/\d+-[a-f0-9]{16}\.mp4$/);
      const id = "EG_" + Object.keys(lk.egress).length; lk.egress[id] = { file: o.filepath, stopped: false }; return json(200, { egressId: id });
    }
    if (m === "Egress/StopEgress") { assert.ok(lk.egress[body.egressId]); lk.egress[body.egressId].stopped = true; return json(200, { egressId: body.egressId }); }
    return json(404, { msg: "unexpected " + m });
  }
  throw new Error("unexpected fetch " + url);
};
export { decode as decodeLk };
