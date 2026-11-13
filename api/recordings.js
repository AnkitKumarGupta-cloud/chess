import { handler, HttpError, whoIs, getClassFor, liveRooms, recordingsFor } from "./_lib.js";
// Teacher, students of that batch can watch recordings.
export default handler(async ({ req, query }) => {
  if (req.method !== "GET") throw new HttpError(405, "Use GET.");
  const me = await whoIs(req);
  const cls = await getClassFor(me, query.classId);
  let nowLive = false;
  try { nowLive = ((await liveRooms())[cls.roomName] || 0) > 0; } catch {}
  return { recordings: await recordingsFor(cls, nowLive) };
}, { needs: ["base", "db"] });
