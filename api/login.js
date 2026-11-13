import { handler, HttpError, checkLogin, sessionToken } from "./_lib.js";
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const user = await checkLogin(body.username, body.password);
  return { token: sessionToken(user), user };
});
