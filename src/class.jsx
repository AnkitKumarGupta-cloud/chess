import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HMSPrebuilt } from "@100mslive/roomkit-react";

// Sign-in comes from the home page (saved in this browser) or from the mobile app (passed after # in the link).
function getSignIn() {
  const fromApp = new URLSearchParams(location.hash.slice(1)).get("k");
  if (fromApp) {
    try { sessionStorage.setItem("cs.k", fromApp); } catch {}
    history.replaceState(null, "", location.pathname + location.search);
    return fromApp;
  }
  try { const s = sessionStorage.getItem("cs.k"); if (s) return s; } catch {}
  try { return JSON.parse(localStorage.getItem("targetchess.v2") || "{}").liveToken || ""; } catch { return ""; }
}
const signIn = getSignIn();
const classId = new URLSearchParams(location.search).get("c") || "";

async function api(path, body) {
  const r = await fetch("/api" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + signIn },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
  return j;
}

function Wait({ title, text, back }) {
  return (
    <div className="wait">
      <h1>{title}</h1>
      {text ? <p>{text}</p> : null}
      {back ? <a href="/#live">Back to classes</a> : null}
    </div>
  );
}

function App() {
  const [pass, setPass] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState(null);
  const [left, setLeft] = useState(false);

  useEffect(() => {
    if (!signIn) { setError("Please sign in on the Live page first."); return; }
    if (!classId) { setError("This class link is not complete."); return; }
    api("/join", { classId }).then(setPass).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  if (error) return <Wait title="Can't open this class" text={error} back />;
  if (left) return <Wait title="You left the class" text={pass && pass.isTeacher ? "The recording will show up on the Live page a few minutes after the class ends." : "Your parents can watch the recording later."} back />;
  if (!pass) return <Wait title="Opening your class…" />;

  return (
    <div style={{ height: "100%" }}>
      {note ? <div className={"note" + (note.bad ? " bad" : "")}>{note.text}</div> : null}
      <HMSPrebuilt
        authToken={pass.authToken}
        options={{ userName: pass.userName, userId: pass.userId }}
        onJoin={() => {
          // The class is recorded automatically as soon as the teacher joins.
          if (!pass.isTeacher) return;
          api("/record", { classId, action: "start" })
            .then(() => setNote({ text: "● This class is being recorded" }))
            .catch(() => setNote({ bad: true, text: "Recording didn't start. Use the record button in the menu." }));
        }}
        onLeave={() => setLeft(true)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
