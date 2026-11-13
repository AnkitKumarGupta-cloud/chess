import { handler, HttpError, whoIs, mustBeTeacher, getClassFor, hms } from "./_lib.js";
// Teacher starts or stops the class recording.
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const user = whoIs(req);
  mustBeTeacher(user);
  const cls = await getClassFor(user, body.classId);
  const action = body.action === "stop" ? "stop" : "start";
  await hms(`/recordings/room/${cls.id}/${action}`, { method: "POST", body: action === "start" ? { resolution: { width: 1280, height: 720 } } : undefined });
  return { ok: true, recording: action === "start" };
});
