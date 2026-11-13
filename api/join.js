import { handler, HttpError, whoIs, getClassFor, roomAuthToken } from "./_lib.js";
// Gives the teacher or a student a short-lived pass into the class's video room.
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const user = whoIs(req);
  if (user.role === "parent") throw new HttpError(403, "Parents can watch the recording after the class.");
  const cls = await getClassFor(user, body.classId);
  return { authToken: roomAuthToken(cls.id, user), userName: user.name, userId: user.id, isTeacher: user.role === "teacher", title: cls.title };
});
