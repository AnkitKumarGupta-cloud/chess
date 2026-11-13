import { handler, HttpError, whoIs, mustBeTeacher, listClasses, canSee, isLive, hms, cfg, slug } from "./_lib.js";

export default handler(async ({ req, body, query }) => {
  const user = whoIs(req);

  if (req.method === "GET") {
    const now = Date.now();
    const mine = (await listClasses()).filter((c) => canSee(user, c));
    // Only ask the video service about classes that could be running right now.
    await Promise.all(mine.map(async (c) => {
      const start = new Date(c.startsAt).getTime();
      const near = now > start - 45 * 60000 && now < start + (c.durationMin + 120) * 60000;
      c.live = near ? await isLive(c.id) : false;
      c.ended = !c.live && now > start + c.durationMin * 60000;
    }));
    return { classes: mine };
  }

  if (req.method === "POST") {
    mustBeTeacher(user);
    const title = String(body.title || "").trim().slice(0, 80);
    const batchName = String(body.batch || "").trim().slice(0, 40);
    const batch = slug(batchName);
    const at = new Date(body.startsAt);
    const d = Math.max(15, Math.min(240, parseInt(body.durationMin, 10) || 60));
    if (title.length < 2) throw new HttpError(400, "Give the class a title.");
    if (!batch) throw new HttpError(400, "Enter the batch name.");
    if (isNaN(at)) throw new HttpError(400, "Pick a date and time.");
    const room = await hms("/rooms", {
      method: "POST",
      body: {
        name: `cs-${batch}-${Date.now().toString(36)}`,
        description: JSON.stringify({ t: title, b: batch, bn: batchName, at: at.toISOString(), d }),
        ...(cfg().templateId ? { template_id: cfg().templateId } : {}),
      },
    });
    return { class: { id: room.id, title, batch, batchName, startsAt: at.toISOString(), durationMin: d, live: false, ended: false } };
  }

  if (req.method === "DELETE") {
    mustBeTeacher(user);
    const id = String(query.id || "");
    if (!/^[a-zA-Z0-9]{8,40}$/.test(id)) throw new HttpError(400, "That class was not found.");
    await hms(`/rooms/${id}`, { method: "POST", body: { enabled: false } });
    return { ok: true };
  }
  throw new HttpError(405, "Method not allowed.");
});
