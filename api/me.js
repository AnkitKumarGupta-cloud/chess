import { handler, whoIs, publicUser } from "./_lib.js";
export default handler(async ({ req }) => ({ user: publicUser(await whoIs(req)) }));
