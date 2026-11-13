# Chess Sathi website: live classes setup

This folder is the Chess Sathi website: the lessons, puzzles and quiz, plus **live classes**
(video call, chat, screen share, backgrounds, recording) and the parent recordings page.

Live video is provided by **100ms**. You need a free 100ms account and a free Vercel account.

## 1. Create your 100ms account (5 minutes)

1. Sign up at https://dashboard.100ms.live
2. When it asks what you are building, choose **Video Conferencing**. This creates a template with two roles: `host` (you) and `guest` (students).
3. Open **Developer** in the dashboard and copy the **App Access Key** and **App Secret**. Keep the secret private.
4. Optional but recommended, in the template's **Prebuilt** settings:
   - turn on **Virtual Background** for both roles,
   - check that **Chat**, **Screen share** and **Raise hand** are on,
   - for `guest`, decide whether students may share their screen.

## 2. Put the website online with Vercel

On your computer, inside this folder:

```
npm install
npx vercel
```

Follow the questions (log in, accept the defaults). Then add these 4 settings in the Vercel dashboard
under **Project → Settings → Environment Variables**:

| Name | Value |
|---|---|
| `HMS_ACCESS_KEY` | App Access Key from 100ms |
| `HMS_SECRET` | App Secret from 100ms |
| `TEACHER_PASSWORD` | A long password only you know (your teacher sign-in) |
| `SESSION_SECRET` | Any long random text, 32+ characters. Don't change it later, or all student and parent sign-in links stop working. |

Optional: `HMS_TEMPLATE_ID` (if you have more than one 100ms template), `HMS_TEACHER_ROLE` (default `host`), `HMS_STUDENT_ROLE` (default `guest`).

Finally run `npx vercel --prod`. Your site is now live at the address Vercel shows.

## 3. Use it

1. Open the site → **Live** → sign in with your teacher password.
2. **Add a student**: type the name and batch. You get a student link and a parent link. Send them on WhatsApp.
3. **Schedule a class** for a batch.
4. At class time press **Start class**. Recording starts by itself when you join.
5. A few minutes after the class ends, the recording appears under the class for you, the students of that batch, and their parents.

## 4. Connect the mobile app

In the mobile app project, open `src/config.js` and set `SITE_URL` to your website address, for example
`"https://chess-sathi.vercel.app"`. The app's **Live** tab then shows the schedule, opens the classroom, and plays recordings.

## Try it without any account

```
npm install
npm run build
node test/dev-server.mjs
```

Open http://localhost:4173 and sign in as teacher with the password `demo-teacher`. This uses a fake
video service, so you can click through everything except the video call itself. `npm test` checks the sign-in and permission rules.

## Good to know

- **Costs**: 100ms includes a free monthly allowance (at the time of writing: 10,000 call minutes and 300 recording minutes). A 60-minute class with 10 students uses about 660 call minutes and 60 recording minutes. Check https://www.100ms.live/pricing for current prices.
- **Who sees what**: students and parents only see classes of their own batch. Parents can't join the live call; they watch recordings.
- **Sign-in links** are personal. They are not stored anywhere, so save them when you create them. To cancel every link at once, change `SESSION_SECRET` and send new links.
- **Recordings** are stored by 100ms. Watch links expire after 2 hours and are created fresh each time someone presses play.
