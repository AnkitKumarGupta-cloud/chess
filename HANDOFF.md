# Chess Sathi: handover notes

Live site: **https://chess-sathi-live.vercel.app**
Code you deploy from: **https://github.com/kishkishkish123-wq/chess-** (branch `main`)
Backup copy: https://github.com/AnkitKumarGupta-cloud/chess (`main` = same code, `old-main` = the old Gupta Chess Academy site)

## How the pieces connect

```
GitHub kishkishkish123-wq/chess-  ──push to main──►  Vercel project "chess-sathi-live"  ──►  chess-sathi-live.vercel.app
                                                          │
                     ┌────────────────────────────────────┼────────────────────────────────┐
                     ▼                                    ▼                                ▼
          Upstash Redis (Vercel Storage)        LiveKit Cloud project "chess sathi"   (optional) Cloudflare R2
          "upstash-kv-crimson-garden"           live video, 5,000 free min/month      class recordings, NOT set up
          stores users, classes                 key: "Chess Sathi website (Vercel)"
```

Vercel environment variables (Settings → Environment Variables of `chess-sathi-live`):

| Variable | What it is | Status |
|---|---|---|
| `TEACHER_PASSWORD` | Teacher login password (username `teacher`) | set |
| `SESSION_SECRET` | Signs login sessions. Never share. | set |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (+ `KV_URL`, `KV_REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`) | Upstash database, added by Vercel when the store was connected | set |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud project | set |
| `RECORD_S3_ENDPOINT`, `RECORD_S3_BUCKET`, `RECORD_S3_ACCESS_KEY`, `RECORD_S3_SECRET`, `RECORD_PUBLIC_URL` | Cloudflare R2 bucket for recordings | not set (recording is off) |

Accounts used: Vercel team "kishkishkish123-7008's projects", GitHub `kishkishkish123-wq` (Claude can push because `AnkitKumarGupta-cloud` is a collaborator), LiveKit Cloud (account "krishna agarwal"), Upstash via Vercel.
Vercel Deployment Protection must stay **off** for `chess-sathi-live`, or students get a Vercel login wall.

## What the app has

- **Login first.** Teacher signs in as `teacher`. On the **Live** tab the teacher adds students (makes a username + password to send on WhatsApp), resets or deletes them. No sign-up, no parent logins.
- **Home:** dashboard (continue lesson, daily goal, puzzle of the day, rank, next live class, totals). XP, streak, ranks Pawn → King.
- **Courses:** 4 courses, 12 voiced video lessons on a learning path.
- **Live:** teacher schedules classes per batch; students of that batch see Join. Classroom (LiveKit): video, mic/camera pickers, screen share (teacher and students, computers only), chat, people list, raise hand, backgrounds (blur / pictures), End/Leave. Recording starts automatically only when R2 is set up.
- **Practice:** 32 topics / 316 positions from Lichess practice, 5 sections. Play against Stockfish (runs in the browser) until the goal is reached. Hint, take back, restart, full screen, move list. 10 XP per position.
- **Puzzles:** 115 levels × 10 puzzles (rating ~500 → ~2800) from the Lichess puzzle database (CC0) on an illustrated map of 6 worlds (Meadow, Forest, Desert, Snow, Fire, Castle; artwork made with ChatGPT). Stars, unlocks, full screen. Old 39 classic puzzles still open from the home "Puzzle of the day" tile.
- **Tests, Progress.** Progress is saved in each browser (not visible to the teacher yet).
- **Full screen** button on practice and puzzle boards for screen sharing.
- **Phones:** on practice and puzzle boards the board, status and Next button fit on one screen (checked at 360×640 up to 412×915). Students can "Add to Home screen" (`public/manifest.webmanifest`, icons in `public/icons/`) and it opens like an app, without the browser bar.
- **Puzzle levels save after every puzzle** (`S.lv.part`), so a reload mid-level keeps the solved puzzles and reopens at the first unsolved one.
- Pieces: "cburnett" set (Colin M.L. Burnett, GPLv2+). Board: our own brown colours. Move sounds are generated in the browser (no sound files).

## How to change things

1. Edit the code (main file: `public/index.html`; classroom: `src/class.jsx` + `class.html`; server: `api/*.js`).
2. `npm test` (checks the server API with fakes) and `npx vite build`.
3. Optional local demo: `npm run build && node test/dev-server.mjs` → http://localhost:4173 (teacher password `demo-teacher`).
4. Push to `main` of `kishkishkish123-wq/chess-` → Vercel deploys in ~1 minute.

## File map

| Path | What |
|---|---|
| `public/index.html` | The whole main app (all pages, styles, logic) |
| `public/practice.json` | Practice topics and positions |
| `public/levels.json` | 115 puzzle levels |
| `public/worlds/w0..w5.webp` | Puzzle map artwork |
| `public/stockfish/` | Chess engine (GPLv3, licence included) |
| `public/mediapipe/` | Background-blur engine for the classroom |
| `class.html`, `src/class.jsx` | Live classroom page (React + LiveKit) |
| `api/_lib.js` | Login, database, LiveKit tokens, recording helpers |
| `api/login.js me.js password.js users.js classes.js join.js record.js recordings.js` | Server endpoints |
| `test/` | API tests, fakes, local demo server |
| `SETUP.md` | Step-by-step setup of every service |

## Not done yet / ideas

- Recording: needs a Cloudflare R2 bucket + the five `RECORD_*` variables. LiveKit free plan includes only ~60 recorded minutes a month.
- Teacher can't yet see each student's practice/puzzle progress (it lives in the student's browser).
- Mobile app (Expo, separate zip `chess-sathi.zip`): needs `SITE_URL` set in `src/config.js`; not tested on a phone; doesn't have Practice/Puzzle levels yet.
- Old Vercel projects `chess`, `chess_sathi`, `chess-sathi`, `chess--sathi-yyrr` are unused and can be deleted.
