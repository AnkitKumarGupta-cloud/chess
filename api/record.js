import { handler, HttpError, whoIs, mustBeTeacher, getClassFor, startRecording, stopRecording } from "./_lib.js";
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const me = await whoIs(req); mustBeTeacher(me);
  const cls = await getClassFor(me, body.classId);
  if (body.action === "stop") return await stopRecording(cls);
  if (body.action === "start") return await startRecording(cls);
  throw new HttpError(400, "Say whether to start or stop.");
}, { needs: ["base", "db", "live"] });
