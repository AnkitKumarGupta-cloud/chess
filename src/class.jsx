import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveKitRoom, VideoConference, useRoomContext, useLocalParticipant } from "@livekit/components-react";
import "@livekit/components-styles";
import { RoomEvent } from "livekit-client";
import { BackgroundProcessor, supportsBackgroundProcessors } from "@livekit/track-processors";

// The sign-in comes from the website (saved in this browser) or from the mobile app (passed after # in the link).
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

async function api(path, body, opts = {}) {
  const r = await fetch("/api" + path, {
    method: "POST", keepalive: !!opts.keepalive,
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

const BACKGROUNDS = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "board", label: "Chessboard", img: "/backgrounds/board.jpg" },
  { id: "sunset", label: "Sunset", img: "/backgrounds/sunset.jpg" },
  { id: "study", label: "Calm", img: "/backgrounds/study.jpg" },
];

// Extra controls on top of the classroom: raise hand, who has a hand up, and backgrounds.
function Extras({ isTeacher, notify }) {
  const room = useRoomContext();
  const { cameraTrack } = useLocalParticipant();
  const [hands, setHands] = useState({});
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(false);
  const [bg, setBg] = useState("none");
  const proc = useRef(null);
  const supported = typeof window !== "undefined" && supportsBackgroundProcessors();

  useEffect(() => {
    const onData = (payload, participant, _k, topic) => {
      if (topic !== "hand" || !participant) return;
      let m = null; try { m = JSON.parse(new TextDecoder().decode(payload)); } catch {}
      if (!m) return;
      setHands((h) => { const n = { ...h }; if (m.on) n[participant.identity] = participant.name || "Someone"; else delete n[participant.identity]; return n; });
    };
    const onLeft = (p) => setHands((h) => { const n = { ...h }; delete n[p.identity]; return n; });
    room.on(RoomEvent.DataReceived, onData); room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => { room.off(RoomEvent.DataReceived, onData); room.off(RoomEvent.ParticipantDisconnected, onLeft); };
  }, [room]);

  const toggleHand = useCallback(() => {
    const on = !mine; setMine(on);
    room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ on })), { reliable: true, topic: "hand" });
    setHands((h) => { const n = { ...h }; if (on) n[room.localParticipant.identity] = "You"; else delete n[room.localParticipant.identity]; return n; });
  }, [mine, room]);

  const pick = async (b) => {
    const track = cameraTrack && cameraTrack.track;
    if (!track) { notify("Turn your camera on first, then pick a background.", true); return; }
    try {
      if (!proc.current) { proc.current = BackgroundProcessor({ mode: "disabled" }); await track.setProcessor(proc.current); }
      if (b.id === "none") await proc.current.switchTo({ mode: "disabled" });
      else if (b.id === "blur") await proc.current.switchTo({ mode: "background-blur", blurRadius: 14 });
      else await proc.current.switchTo({ mode: "virtual-background", imagePath: b.img });
      setBg(b.id); setOpen(false);
    } catch (e) { notify("This device couldn't change the background.", true); }
  };

  const list = Object.entries(hands);
  return (
    <>
      <div className="extras">
        <button className={"xbtn" + (mine ? " on" : "")} onClick={toggleHand} aria-pressed={mine}>✋ {mine ? "Lower hand" : "Raise hand"}</button>
        {supported ? <button className={"xbtn" + (open ? " on" : "")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>🖼 Background</button> : null}
        {open ? (
          <div className="bgpanel" role="menu">
            {BACKGROUNDS.map((b) => (
              <button key={b.id} role="menuitemradio" aria-checked={bg === b.id} className={"bgopt" + (bg === b.id ? " on" : "")} onClick={() => pick(b)}>
                <span className="bgthumb" style={b.img ? { backgroundImage: `url(${b.img})` } : b.id === "blur" ? { filter: "blur(1px)", background: "linear-gradient(135deg,#667,#99a)" } : {}}>{b.id === "none" ? "✕" : ""}</span>
                {b.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {list.length ? (
        <div className="hands" aria-live="polite">
          {list.map(([id, name]) => <span key={id} className="hand">✋ {name}</span>)}
          {isTeacher ? <span className="handhint">Hands up</span> : null}
        </div>
      ) : null}
    </>
  );
}

function App() {
  const [pass, setPass] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState(null);
  const [left, setLeft] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    if (!signIn) { setError("Please sign in on the Chess Sathi website first."); return; }
    if (!classId) { setError("This class link is not complete."); return; }
    api("/join", { classId }).then(setPass).catch((e) => setError(e.message));
  }, []);

  const notify = useCallback((text, bad) => setNote({ text, bad }), []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  if (error) return <Wait title="Can't open this class" text={error} back />;
  if (left) return <Wait title="You left the class" text={pass && pass.isTeacher ? "The recording will show up on the Live page a few minutes after the class ends." : "Your parents can watch the recording later."} back />;
  if (!pass) return <Wait title="Opening your class…" />;

  return (
    <div style={{ height: "100%" }} data-lk-theme="default">
      {note ? <div className={"note" + (note.bad ? " bad" : "")}>{note.text}</div> : null}
      <LiveKitRoom
        serverUrl={pass.serverUrl} token={pass.token} connect
        video={true} audio={pass.isTeacher}
        onConnected={() => {
          // The class is recorded automatically as soon as the teacher joins.
          if (!pass.isTeacher) return;
          api("/record", { classId, action: "start" })
            .then(() => notify("● This class is being recorded"))
            .catch((e) => notify("Recording didn't start: " + e.message, true));
        }}
        onDisconnected={() => {
          if (pass.isTeacher && !stopped.current) { stopped.current = true; api("/record", { classId, action: "stop" }, { keepalive: true }).catch(() => {}); }
          setLeft(true);
        }}
        onError={(e) => notify(e.message || "Connection problem", true)}
        onMediaDeviceFailure={() => notify("We couldn't use your camera or microphone. Check the browser's permission.", true)}
        style={{ height: "100%" }}
      >
        <VideoConference />
        <Extras isTeacher={pass.isTeacher} notify={notify} />
      </LiveKitRoom>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
