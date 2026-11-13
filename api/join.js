import { handler, HttpError, whoIs, getClassFor, joinToken, lkServerUrl } from "./_lib.js";
// Students and the teacher get a ticket into the classroom. Parents watch recordings only.
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const me = await whoIs(req);
  if (me.role === "parent") throw new HttpError(403, "Parents can watch recordings, but only students and the teacher can join the live class.");
  const cls = await getClassFor(me, body.classId);
  return { serverUrl: lkServerUrl(), token: joinToken(me, cls), userName: me.name, userId: me.id, isTeacher: me.role === "teacher", title: cls.title };
}, { needs: ["base", "db", "live"] });
