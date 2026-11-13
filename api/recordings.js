import { handler, HttpError, whoIs, getClassFor, hms } from "./_lib.js";

const isVideo = (a) => ["room-composite", "room-vod"].includes(a.type) || /\.mp4$/i.test(a.path || "");

async function assetsFor(classId) {
  const r = await hms(`/recording-assets?room_id=${classId}&status=completed&limit=50`, { allow404: true });
  return ((r && r.data) || []).filter(isVideo);
}

// GET ?classId=...            -> list of finished recordings for a class
// GET ?classId=...&assetId=.. -> a private link to watch one (valid for 2 hours)
export default handler(async ({ req, query }) => {
  if (req.method !== "GET") throw new HttpError(405, "Use GET.");
  const user = whoIs(req); // teacher, student or parent; getClassFor checks the batch
  const cls = await getClassFor(user, query.classId);
  const assets = await assetsFor(cls.id);

  if (query.assetId) {
    const a = assets.find((x) => x.id === query.assetId);
    if (!a) throw new HttpError(404, "That recording was not found.");
    const p = await hms(`/recording-assets/${a.id}/presigned-url?presign_duration=7200`);
    return { url: p.url };
  }
  return {
    recordings: assets
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((a, i) => ({ id: a.id, part: i + 1, createdAt: a.created_at, durationSec: a.duration || 0, sizeBytes: a.size || 0 })),
  };
});
