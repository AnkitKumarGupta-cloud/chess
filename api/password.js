import { handler, HttpError, whoIs, checkLogin, getUser, putUser, hashPassword } from "./_lib.js";
// A student or parent changes their own password. (The teacher's password is the TEACHER_PASSWORD setting.)
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const me = await whoIs(req);
  if (me.role === "teacher") throw new HttpError(400, "The teacher password is changed in the Vercel settings (TEACHER_PASSWORD).");
  const next = String(body.newPassword || "");
  if (next.length < 6) throw new HttpError(400, "Please use at least 6 characters.");
  await checkLogin(me.username, body.oldPassword);
  const rec = await getUser(me.username);
  rec.pw = hashPassword(next);
  await putUser(rec);
  return { ok: true };
}, { needs: ["base", "db"] });
