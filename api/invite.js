import { handler, HttpError, whoIs, mustBeTeacher, makeCode, slug } from "./_lib.js";
// Teacher adds a student: returns one sign-in code for the student and one for the parent.
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  mustBeTeacher(whoIs(req));
  const name = String(body.name || "").trim();
  const batch = slug(body.batch);
  if (name.length < 2) throw new HttpError(400, "Enter the student's name.");
  if (!batch) throw new HttpError(400, "Enter the batch name.");
  return { name, batch, studentCode: makeCode("student", name, batch), parentCode: makeCode("parent", name, batch) };
});
