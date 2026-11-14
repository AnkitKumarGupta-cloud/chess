import { handler, HttpError, whoIs, mustBeTeacher, kv, kvPipe, getUser, putUser, listUsers, hashPassword, newPassword, slug, normUser, validUsername } from "./_lib.js";

async function freeUsername(base) {
  let u = base.slice(0, 24);
  if (u.length < 3) u = (u + "student").slice(0, 12);
  for (let i = 0; i < 20; i++) {
    const t = i === 0 ? u : u + Math.floor(10 + Math.random() * 89);
    if (validUsername(t) && !(await getUser(t))) return t;
  }
  throw new HttpError(500, "Could not make a username. Please try another name.");
}
async function create(role, name, batch, base) {
  const username = await freeUsername(base), pw = newPassword();
  await putUser({ username, name, role, batch: slug(batch), batchName: batch, pw: hashPassword(pw), createdAt: Date.now() });
  return { username, password: pw, role, name, batch };
}

// Teacher only: list accounts, add a student, reset a password, delete an account.
export default handler(async ({ req, body, query }) => {
  mustBeTeacher(await whoIs(req));
  if (req.method === "GET") return { users: await listUsers() };
  if (req.method === "DELETE") {
    const u = normUser(query.username);
    if (!(await getUser(u))) throw new HttpError(404, "That account was not found.");
    await kvPipe([["DEL", "u:" + u], ["SREM", "users", u]]);
    return { ok: true };
  }
  if (req.method !== "POST") throw new HttpError(405, "Use GET, POST or DELETE.");
  if (body.action === "reset") {
    const rec = await getUser(body.username);
    if (!rec) throw new HttpError(404, "That account was not found.");
    const pw = newPassword(); rec.pw = hashPassword(pw); await putUser(rec);
    return { username: rec.username, password: pw, role: rec.role, name: rec.name, batch: rec.batchName };
  }
  const name = String(body.name || "").trim().slice(0, 40), batch = String(body.batch || "").trim().slice(0, 40);
  if (!name || !slug(batch)) throw new HttpError(400, "Please enter the student's name and the batch.");
  const base = slug(name).replace(/-/g, "");
  const accounts = [await create("student", name, batch, base)];
  return { accounts };
}, { needs: ["base", "db"] });
