import crypto from "node:crypto";
import { sameBatch, handler, HttpError, whoIs, mustBeTeacher, listClasses, getClassFor, putClass, removeClass, liveRooms, slug, recordingReady, stopRecording } from "./_lib.js";

export default handler(async ({ req, body, query }) => {
  const me = await whoIs(req);
  if (req.method === "GET") {
    // The class list and LiveKit's "who is in which room" are fetched at the same time.
    const [all, roomsOrErr] = await Promise.all([listClasses(), liveRooms().catch((e) => e)]);
    const mine = all.filter((c) => me.role === "teacher" || sameBatch(c.batch, me.batch));
    let rooms = {};
    if (roomsOrErr instanceof Error) { const e = roomsOrErr; if (!(e instanceof HttpError)) throw e; if (e.code === "setup" && me.role === "teacher") throw e; }
    else rooms = roomsOrErr;
    const now = Date.now();
    return {
      recordingReady: recordingReady(),
      classes: mine.map((c) => ({
        id: c.id, title: c.title, batch: c.batch, batchName: c.batchName, startsAt: c.startsAt, durationMin: c.durationMin,
        live: (rooms[c.roomName] || 0) > 0, ended: now > new Date(c.startsAt).getTime() + (c.durationMin + 30) * 60000,
      })),
    };
  }
  mustBeTeacher(me);
  if (req.method === "POST") {
    const title = String(body.title || "").trim().slice(0, 80), batchName = String(body.batch || "").trim().slice(0, 40);
    const startsAt = new Date(body.startsAt), dur = Math.round(Number(body.durationMin) || 60);
    if (!title || !slug(batchName) || isNaN(startsAt) || dur < 15 || dur > 240) throw new HttpError(400, "Please fill in the title, batch, date and minutes (15 to 240).");
    const id = crypto.randomBytes(6).toString("hex");
    const cls = { id, title, batch: slug(batchName), batchName, startsAt: startsAt.toISOString(), durationMin: dur, roomName: "cs-" + id };
    await putClass(cls);
    return { class: cls };
  }
  if (req.method === "DELETE") {
    const cls = await getClassFor(me, query.id);
    await stopRecording(cls).catch(() => {});
    await removeClass(cls.id);
    return { ok: true };
  }
  throw new HttpError(405, "Use GET, POST or DELETE.");
}, { needs: ["base", "db"] });
