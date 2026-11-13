import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LiveKitRoom, RoomAudioRenderer, StartAudio, ConnectionStateToast, LayoutContextProvider,
  GridLayout, CarouselLayout, FocusLayout, FocusLayoutContainer, ParticipantTile, TrackToggle, MediaDeviceMenu, Chat,
  useTracks, useParticipants, useRoomContext, useLocalParticipant, useLocalParticipantPermissions,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { RoomEvent, Track } from "livekit-client";
import { BackgroundProcessor, supportsBackgroundProcessors } from "@livekit/track-processors";

// ---------- sign-in and API ----------
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
  if (!r.ok) { const e = new Error(j.error || "Something went wrong. Please try again."); e.code = j.code; throw e; }
  return j;
}

const canShareScreen = () => typeof navigator !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
  && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ---------- small pieces ----------
const I = {
  hand: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1V4.5a1.5 1.5 0 0 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V13m0-4.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L3.5 15.5a1.6 1.6 0 0 1 2.4-2.1L8 15.5"/></svg>,
  image: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>,
  chat: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12Z"/></svg>,
  people: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2A5 5 0 0 1 21.5 19"/></svg>,
  leave: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 14.5c5-4.7 12-4.7 17 0l-2.3 2.6-3.2-1.4v-2.6a11 11 0 0 0-6 0v2.6l-3.2 1.4z"/></svg>,
  close: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>,
  chev: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>,
  screen: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
};
const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="var(--accent)"/><circle cx="14" cy="9.2" r="3.6" fill="#fff"/><path d="M10.4 20.6c0-3.3 1.6-5.7 3.6-7.3 2 1.6 3.6 4 3.6 7.3z" fill="#fff"/><rect x="8.4" y="20.2" width="11.2" height="2.8" rx="1.4" fill="#fff"/></svg>
);

function Wait({ title, text, back, spin }) {
  return (
    <div className="wait">
      <Logo />
      {spin ? <div className="spin" aria-hidden="true" /> : null}
      <h1>{title}</h1>
      {text ? <p>{text}</p> : null}
      {back ? <a className="btn" href="/#live">Back to classes</a> : null}
    </div>
  );
}

function useClock(on) {
  const [start] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [on]);
  const s = Math.floor((Date.now() - start) / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? hh + ":" : "") + String(mm).padStart(hh ? 2 : 1, "0") + ":" + String(ss).padStart(2, "0");
}

// ---------- backgrounds ----------
const BACKGROUNDS = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "board", label: "Chessboard", img: "/backgrounds/board.jpg" },
  { id: "sunset", label: "Sunset", img: "/backgrounds/sunset.jpg" },
  { id: "study", label: "Calm", img: "/backgrounds/study.jpg" },
];
// MediaPipe's engine is served from this website, so blockers or a slow CDN can't stop it.
const makeProcessor = (delegate) => BackgroundProcessor({
  mode: "disabled",
  assetPaths: { tasksVisionFileSet: location.origin + "/mediapipe" },
  segmenterOptions: { delegate },
});

function useBackground(notify) {
  const { cameraTrack } = useLocalParticipant();
  const proc = useRef(null);
  const [bg, setBg] = useState("none");
  const [busy, setBusy] = useState(false);
  const supported = useMemo(() => { try { return supportsBackgroundProcessors(); } catch { return false; } }, []);

  const pick = async (b) => {
    const track = cameraTrack && cameraTrack.track;
    if (!track) { notify("Turn your camera on first, then pick a background.", true); return false; }
    setBusy(true);
    try {
      if (!proc.current) {
        try { const p = makeProcessor("GPU"); await track.setProcessor(p); proc.current = p; }
        catch (gpuErr) {
          console.warn("Background on GPU failed, trying CPU", gpuErr);
          try { await track.stopProcessor(); } catch {}
          const p = makeProcessor("CPU"); await track.setProcessor(p); proc.current = p;
        }
      }
      if (b.id === "none") await proc.current.switchTo({ mode: "disabled" });
      else if (b.id === "blur") await proc.current.switchTo({ mode: "background-blur", blurRadius: 14 });
      else await proc.current.switchTo({ mode: "virtual-background", imagePath: b.img });
      setBg(b.id);
      return true;
    } catch (e) {
      console.error("Background failed", e);
      proc.current = null;
      try { await track.stopProcessor(); } catch {}
      notify("Couldn't change the background on this device. Try Chrome on a computer.", true);
      return false;
    } finally { setBusy(false); }
  };
  // A new camera track (after switching camera) starts without the effect.
  useEffect(() => { proc.current = null; setBg("none"); }, [cameraTrack && cameraTrack.trackSid]);
  return { bg, pick, busy, supported };
}

// ---------- raise hand ----------
function useHands() {
  const room = useRoomContext();
  const [hands, setHands] = useState({});
  const [mine, setMine] = useState(false);
  useEffect(() => {
    const onData = (payload, participant, _k, topic) => {
      if (topic !== "hand" || !participant) return;
      let m = null; try { m = JSON.parse(new TextDecoder().decode(payload)); } catch {}
      if (!m) return;
      setHands((h) => { const n = { ...h }; if (m.on) n[participant.identity] = Date.now(); else delete n[participant.identity]; return n; });
      if (m.lowerFor === room.localParticipant.identity) setMine(false);
    };
    const onLeft = (p) => setHands((h) => { const n = { ...h }; delete n[p.identity]; return n; });
    room.on(RoomEvent.DataReceived, onData); room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => { room.off(RoomEvent.DataReceived, onData); room.off(RoomEvent.ParticipantDisconnected, onLeft); };
  }, [room]);
  const send = (msg) => room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true, topic: "hand" });
  const toggle = useCallback(() => {
    const on = !mine; setMine(on); send({ on });
    setHands((h) => { const n = { ...h }; if (on) n[room.localParticipant.identity] = Date.now(); else delete n[room.localParticipant.identity]; return n; });
  }, [mine, room]);
  // The teacher can lower someone's hand after answering.
  const lower = (identity) => { send({ on: false, lowerFor: identity }); setHands((h) => { const n = { ...h }; delete n[identity]; return n; }); };
  useEffect(() => { if (!mine) setHands((h) => { const n = { ...h }; delete n[room.localParticipant.identity]; return n; }); }, [mine, room]);
  return { hands, mine, toggle, lower };
}

// ---------- stage ----------
function Stage({ hands }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false },
  );
  const share = tracks.find((t) => t.source === Track.Source.ScreenShare && t.publication);
  const cams = tracks.filter((t) => t.source === Track.Source.Camera);
  if (share) {
    return (
      <div className="stage stage-share">
        <FocusLayoutContainer>
          <CarouselLayout tracks={cams}><ParticipantTile /></CarouselLayout>
          <FocusLayout trackRef={share} />
        </FocusLayoutContainer>
      </div>
    );
  }
  return (
    <div className="stage">
      <GridLayout tracks={cams}><ParticipantTile /></GridLayout>
    </div>
  );
}

// ---------- people panel ----------
function People({ hands, isTeacher, lower }) {
  const people = useParticipants();
  const sorted = [...people].sort((a, b) => (hands[b.identity] ? 1 : 0) - (hands[a.identity] ? 1 : 0) || (roleOf(b) === "teacher") - (roleOf(a) === "teacher") || (a.name || "").localeCompare(b.name || ""));
  return (
    <ul className="people">
      {sorted.map((p) => {
        const teacher = roleOf(p) === "teacher";
        const mic = p.isMicrophoneEnabled, cam = p.isCameraEnabled;
        return (
          <li key={p.identity} className={hands[p.identity] ? "up" : ""}>
            <span className="av" aria-hidden="true">{(p.name || "?").trim()[0]?.toUpperCase()}</span>
            <span className="pname">{p.name || p.identity}{p.isLocal ? " (you)" : ""}{teacher ? <em>Teacher</em> : null}</span>
            {hands[p.identity] ? (
              isTeacher && !p.isLocal
                ? <button className="chipbtn" onClick={() => lower(p.identity)} title="Lower this hand">✋ Lower</button>
                : <span className="handflag">✋</span>
            ) : null}
            <span className={"dot" + (mic ? " on" : "")} title={mic ? "Microphone on" : "Microphone off"}>{mic ? "mic" : "muted"}</span>
            <span className={"dot" + (cam ? " on" : "")} title={cam ? "Camera on" : "Camera off"}>{cam ? "cam" : "no cam"}</span>
          </li>
        );
      })}
    </ul>
  );
}
function roleOf(p) { try { return JSON.parse(p.metadata || "{}").role; } catch { return ""; } }

// ---------- the classroom ----------
function Classroom({ pass, notify, recording }) {
  const room = useRoomContext();
  const perms = useLocalParticipantPermissions();
  const people = useParticipants();
  const { hands, mine, toggle, lower } = useHands();
  const bgCtl = useBackground(notify);
  const [panel, setPanel] = useState(null); // "chat" | "people" | null
  const [bgOpen, setBgOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const clock = useClock(true);
  const isTeacher = pass.isTeacher;
  const canPub = (s) => perms && perms.canPublish && (!perms.canPublishSources.length || perms.canPublishSources.includes(s));
  const shareAllowed = isTeacher || canPub(3); // 3 = screen share in LiveKit's permission list
  const shareSupported = canShareScreen();
  const handsUp = Object.keys(hands).length;

  // Unread chat count while the chat panel is closed.
  useEffect(() => {
    const onChat = () => { if (panel !== "chat") setUnread((n) => n + 1); };
    room.on(RoomEvent.ChatMessage, onChat);
    return () => room.off(RoomEvent.ChatMessage, onChat);
  }, [room, panel]);
  useEffect(() => { if (panel === "chat") setUnread(0); }, [panel]);
  // Tell the teacher when a hand goes up.
  const prevHands = useRef({});
  useEffect(() => {
    if (isTeacher) for (const id of Object.keys(hands)) if (!prevHands.current[id] && id !== room.localParticipant.identity) {
      const p = people.find((x) => x.identity === id); notify("✋ " + ((p && p.name) || "A student") + " raised a hand");
    }
    prevHands.current = hands;
  }, [hands]);

  const togglePanel = (p) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className={"room" + (panel ? " with-panel" : "")}>
      <header className="rtop">
        <div className="rbrand"><Logo /><div><b>{pass.title || "Live class"}</b><span>Chess Sathi</span></div></div>
        <div className="rmeta">
          <span className="live"><i />LIVE <span className="mono">{clock}</span></span>
          {recording ? <span className="rec" title="This class is being recorded">● REC</span> : null}
          <button className="count" onClick={() => togglePanel("people")} aria-label={people.length + " people in class"}>{I.people}<span>{people.length}</span></button>
        </div>
      </header>

      <div className="rbody">
        <Stage hands={hands} />
        {panel ? (
          <aside className="side" aria-label={panel === "chat" ? "Chat" : "People"}>
            <div className="sidehead">
              <div className="tabs2" role="tablist">
                <button role="tab" aria-selected={panel === "chat"} onClick={() => setPanel("chat")}>Chat</button>
                <button role="tab" aria-selected={panel === "people"} onClick={() => setPanel("people")}>People ({people.length})</button>
              </div>
              <button className="iconbtn" onClick={() => setPanel(null)} aria-label="Close panel">{I.close}</button>
            </div>
            <div className="sidebody">
              {panel === "chat" ? <Chat /> : <People hands={hands} isTeacher={isTeacher} lower={lower} />}
            </div>
          </aside>
        ) : null}
      </div>

      {handsUp && isTeacher && panel !== "people" ? (
        <button className="handsbar" onClick={() => setPanel("people")}>✋ {handsUp} {handsUp === 1 ? "hand" : "hands"} up</button>
      ) : null}

      <footer className="dock">
        <div className="group">
          <div className="combo">
            <TrackToggle source={Track.Source.Microphone} className="dbtn"><span className="lbl">Mic</span></TrackToggle>
            <MediaDeviceMenu kind="audioinput" className="dmenu" aria-label="Choose microphone" title="Choose microphone">{I.chev}</MediaDeviceMenu>
          </div>
          <div className="combo">
            <TrackToggle source={Track.Source.Camera} className="dbtn"><span className="lbl">Camera</span></TrackToggle>
            <MediaDeviceMenu kind="videoinput" className="dmenu" aria-label="Choose camera" title="Choose camera">{I.chev}</MediaDeviceMenu>
          </div>
          {shareAllowed ? (
            shareSupported
              ? <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true, selfBrowserSurface: "include" }} className="dbtn" onDeviceError={() => notify("Screen sharing was blocked or cancelled.", true)}><span className="lbl">Share screen</span></TrackToggle>
              : <button className="dbtn" disabled title="Screen sharing works on a computer (Chrome, Edge or Safari)" onClick={() => {}}>{I.screen}<span className="lbl">Share screen</span></button>
          ) : null}
        </div>
        <div className="group">
          <button className={"dbtn" + (mine ? " on" : "")} aria-pressed={mine} onClick={toggle}>{I.hand}<span className="lbl">{mine ? "Lower hand" : "Raise hand"}</span></button>
          {bgCtl.supported ? (
            <div className="popwrap">
              <button className={"dbtn" + (bgOpen ? " on" : "")} aria-expanded={bgOpen} onClick={() => setBgOpen((o) => !o)}>{I.image}<span className="lbl">Background</span></button>
              {bgOpen ? (
                <div className="bgpanel" role="menu">
                  <div className="bghead">Background {bgCtl.busy ? <span className="spin sm" aria-label="Loading" /> : null}</div>
                  <div className="bggrid">
                    {BACKGROUNDS.map((b) => (
                      <button key={b.id} role="menuitemradio" aria-checked={bgCtl.bg === b.id} disabled={bgCtl.busy} className={"bgopt" + (bgCtl.bg === b.id ? " on" : "")} onClick={async () => { if (await bgCtl.pick(b)) setBgOpen(false); }}>
                        <span className={"bgthumb t-" + b.id} style={b.img ? { backgroundImage: `url(${b.img})` } : {}}>{b.id === "none" ? I.close : null}</span>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <button className={"dbtn" + (panel === "chat" ? " on" : "")} aria-pressed={panel === "chat"} onClick={() => togglePanel("chat")}>{I.chat}<span className="lbl">Chat</span>{unread ? <span className="badge">{unread}</span> : null}</button>
          <button className={"dbtn hide-sm" + (panel === "people" ? " on" : "")} aria-pressed={panel === "people"} onClick={() => togglePanel("people")}>{I.people}<span className="lbl">People</span>{handsUp ? <span className="badge">{handsUp}</span> : null}</button>
        </div>
        <div className="group">
          <button className="dbtn leave" onClick={() => room.disconnect()}>{I.leave}<span className="lbl">{isTeacher ? "End / leave" : "Leave"}</span></button>
        </div>
      </footer>
      <RoomAudioRenderer />
      <StartAudio label="Tap to turn on sound" className="startaudio" />
      <ConnectionStateToast />
    </div>
  );
}

function App() {
  const [pass, setPass] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState(null);
  const [left, setLeft] = useState(false);
  const [recording, setRecording] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    if (!signIn) { setError("Please sign in on the Chess Sathi website first."); return; }
    if (!classId) { setError("This class link is not complete."); return; }
    api("/join", { classId }).then(setPass).catch((e) => setError(e.message));
  }, []);

  const notify = useCallback((text, bad) => setNote({ text, bad, at: Date.now() }), []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);

  if (error) return <Wait title="Can't open this class" text={error} back />;
  if (left) return <Wait title="You left the class" text={pass && pass.isTeacher ? "If recording is switched on, the recording shows up on the Live page a few minutes after the class ends." : "See you next class! Recordings, when available, are on the Live page."} back />;
  if (!pass) return <Wait title="Opening your class…" spin />;

  return (
    <div style={{ height: "100%" }} data-lk-theme="default">
      {note ? <div className={"note" + (note.bad ? " bad" : "")} role="status">{note.text}</div> : null}
      <LiveKitRoom
        serverUrl={pass.serverUrl} token={pass.token} connect
        video={true} audio={pass.isTeacher}
        onConnected={() => {
          // Recording starts automatically when the teacher joins, if it is switched on.
          if (!pass.isTeacher) return;
          api("/record", { classId, action: "start" })
            .then(() => { setRecording(true); notify("● This class is being recorded"); })
            .catch((e) => { if (e.code !== "setup") notify("Recording didn't start: " + e.message, true); });
        }}
        onDisconnected={() => {
          if (pass.isTeacher && !stopped.current) { stopped.current = true; api("/record", { classId, action: "stop" }, { keepalive: true }).catch(() => {}); }
          setLeft(true);
        }}
        onError={(e) => notify(e.message || "Connection problem", true)}
        onMediaDeviceFailure={() => notify("We couldn't use your camera or microphone. Allow them in the browser's address bar.", true)}
        style={{ height: "100%" }}
      >
        <LayoutContextProvider>
          <Classroom pass={pass} notify={notify} recording={recording} />
        </LayoutContextProvider>
      </LiveKitRoom>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
