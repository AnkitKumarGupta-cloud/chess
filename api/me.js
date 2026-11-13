import { handler, whoIs } from "./_lib.js";
export default handler(async ({ req }) => {
  const u = whoIs(req);
  return { user: { role: u.role, name: u.name, batch: u.batch } };
});
