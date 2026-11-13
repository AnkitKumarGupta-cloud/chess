import { handler, HttpError, checkTeacherPassword, teacherToken } from "./_lib.js";
// Teacher sign-in. Students and parents don't call this: their personal code is their sign-in.
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  if (!checkTeacherPassword(body.password)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    throw new HttpError(401, "Wrong password.");
  }
  return { token: teacherToken(), user: { role: "teacher", name: "Teacher" } };
});
