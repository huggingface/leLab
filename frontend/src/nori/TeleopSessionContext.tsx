// NORI: Additive file. A teleop session that OUTLIVES page navigation.
//
// The RemoteTeleop peer connection used to live in a useRef inside the Remote page, so routing
// away unmounted the page and tore the session down (its cleanup called teleop.stop() -> robot
// `bye`). That made the Coding page's scripts run against a dead session, and dropped the video
// on every navigation. This provider hoists the whole session up to the /nori parent route
// element (mounted in App.tsx just inside NoriProvider, outside NoriLayout), so it survives every
// /nori/* child navigation (Remote <-> Coding <-> …) and only tears down on explicit Disconnect
// or when the user leaves /nori entirely.
//
// Pages become thin consumers: they read connState/telemetry/logs, call connect()/disconnect(),
// and — for the page that shows video — attach their <video>/<audio> via teleop.setVideoEl()
// (the SDK remembers the inbound stream and re-points a fresh element). No page owns the session.

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import {
  RemoteTeleop,
  type ArmSide, type CallState, type ConnectStatus, type ControlMode, type DaemonStatus,
  type RobotAlert,
  type RecordState, type TelemetryView,
} from "@nori/sdk";
import { EMPTY_ALERTS, applyAlert, type AlertMap } from "@/nori/remote/alertState";
import { SupabaseSignaling } from "@nori/sdk/supabase";
import { getSupabase } from "@/nori/auth/supabase";
import { getAccessToken } from "@/nori/auth/session";
import { useNori } from "@/nori/NoriContext";
import { useApi } from "@/contexts/ApiContext";
import { getTurnCredentials } from "@/nori/api/client";
import { isTurnMintEnabled, isPrivateRoomEnabled } from "@/nori/remote/flags";
import { useIdleDisconnect } from "@/nori/useIdleDisconnect";
import IdleDisconnectDialog from "@/nori/components/IdleDisconnectDialog";

const DEFAULT_STUN = "stun:stun.l.google.com:19302";

// Remote-session settings persist in localStorage (must match the Pi's .env).
export type Settings = {
  room: string;
  stun: string;
  turn: string;
  turnUser: string;
  turnCred: string;
  forceRelay: boolean;
  arm: ArmSide;
  // Sensitivity tuning (per-browser, like everything else here). kbSpeed scales every
  // held-key jog rate (RemoteTeleop.setKeyboardSpeed); the vr* fields feed
  // VrJogMapper.setTuning. Defaults reproduce the hardware-tuned behavior exactly.
  kbSpeed: number;       // (0..1] fraction of the daemon's full per-tick step
  vrSensitivity: number; // multiplier on VR hand-motion response
  vrGripperOpen: number; // (0..1] VR gripper opening rate; close is always 1.5× this (capped)
  vrWristGain: number;   // A3 wrist: gripper degrees per hand degree (1 = mirror)
};

const DEFAULTS: Settings = {
  room: "", stun: DEFAULT_STUN, turn: "", turnUser: "", turnCred: "", forceRelay: false, arm: "right",
  kbSpeed: 1, vrSensitivity: 1, vrGripperOpen: 0.25, vrWristGain: 1,
};

const LS_SETTINGS = "nori_remote_settings";
const LS_SCRIPT = "nori_script_source";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    // turnCred is memory-only: it's supplied per-session by minting (nori_turn_mint),
    // or a stale static value the use-auth-secret relay rejects. Never rehydrate it from
    // localStorage — drops any secret persisted by older builds.
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), turnCred: "" };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

const EMPTY_TEL: TelemetryView = {
  loopHz: 0, safety: "-", watchdog: "-", tempC: 0, active: false, linkMode: null, currents: {},
  state: {}, videoNet: null, batteryPercent: null, motorFaults: {},
};

const EMPTY_CALL: CallState = {
  active: false, micMuted: true, micSending: false, robotAudio: false, robotMicLive: false,
  robotMicMuted: false, cameraOn: false,
};

export interface TeleopSessionValue {
  teleop: RemoteTeleop | null; // the live instance (null until connected)
  running: boolean; // a session exists (connected or connecting-through)
  connecting: boolean;
  connState: string;
  tel: TelemetryView;
  stale: boolean;
  controlActive: boolean;
  mode: ControlMode;
  call: CallState;
  // Robot-daemon health from the Pi bridge (daemon_status frames), null until one arrives.
  // Distinguishes "robot online but daemon down/restarting/refusing" from a healthy session —
  // connState alone cannot (the media bridge stays connected while the daemon is dead).
  daemonStatus: DaemonStatus | null;
  // Active robot operator alerts (`alert` frames, spec daemon/alert.json), keyed on code:
  // a Servo halt (self-collision / joint bound / singularity), thermal band, jog limit.
  // Per-session like daemonStatus. See remote/alertState.ts.
  alerts: AlertMap;
  // On-robot episode recorder state (W2.11 record_status replies), null until the first
  // reply — recording-disabled robots answer {ok:false, error:"recorder unreachable"}.
  recordState: RecordState | null;
  // What the connect attempt is doing, and why it failed if it did (see ConnectStatus in the SDK).
  // connState is the raw WebRTC state and is "idle" for the whole waiting-for-the-robot window,
  // so it cannot answer "what is wrong" — this can.
  connectStatus: ConnectStatus;
  logLines: string[];
  appendLog: (msg: string) => void;
  settings: Settings;
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  // Flip cylindrical <-> per-motor. Works offline too: the choice is kept here and passed
  // to the next session at connect, so the displayed mode is always the mode you get.
  toggleControlMode: () => void;
  // Pages that want gripper-current haptics (VR) register a listener; only one at a time.
  setCurrentsListener: (fn: ((c: Record<string, number>) => void) | null) => void;
  // Dataset capture (browser catcher) taps: full-rate telemetry rows and every outbound
  // control frame. One listener each, same single-consumer contract as currents above.
  setTelemetryListener: (fn: ((t: TelemetryView) => void) | null) => void;
  setControlSentListener: (fn: ((frame: Record<string, unknown>, tWallMs: number) => void) | null) => void;
  // The pasted/generated script text, persisted so it survives navigation + reload.
  scriptSource: string;
  setScriptSource: (s: string) => void;
  // Idle auto-disconnect opt-out. A page running something hands-off (a script, an agent goal)
  // registers itself busy for as long as the run lasts, which suppresses the "Are you still
  // there?" timer — those are exactly the sessions where nobody touches the mouse for minutes
  // on purpose. Keyed so concurrent registrants can't clobber each other; always unregister in
  // an effect cleanup so a page that unmounts mid-run can't wedge the timer off forever.
  setSessionBusy: (key: string, busy: boolean) => void;
  // Signal genuine operator presence from a surface the DOM-based idle timer can't observe —
  // specifically the in-headset VR loop, whose WebXR controller input fires no pointer/key
  // events. The VR page forwards real controller input here so an actively-driving operator
  // isn't wrongly flagged idle and disconnected mid-drive.
  noteActivity: () => void;
  // Idle "Are you still there?" prompt state, surfaced so an immersive surface (VR) can mirror
  // the countdown in-headset — the 2D dialog is invisible under an active WebXR session.
  idlePromptOpen: boolean;
  idleSecondsLeft: number;
  // Yield the robot to someone else's session. The gateway serves ONE WebRTC session per robot and
  // treats a `ready` from the same operator as a page refresh that replaces the live session; the
  // hosted ASPIRE worker drives the robot under THIS customer's identity, so while an ASPIRE task
  // runs, a session from this app and the worker's would keep preempting each other (0003,
  // 2026-10-30: a ten-second respawn loop, the task never got past the handshake). A page that
  // starts or follows a task registers a yield for the task's duration: connect() refuses with the
  // reason, and the Remote page shows it. Keyed like setSessionBusy; clear in an effect cleanup.
  setYield: (key: string, reason: string | null) => void;
  yieldedFor: string | null;
  // The ROBOT's answer when a hosted ASPIRE task holds it (gateway precedence, nori_ws PR #23):
  // our live session was evicted (`alert session_evicted`) or our connect was refused (nack
  // `robot_held`). The SDK session is torn down — the robot will not take us back until the task
  // ends — but the connect banner keeps the failure, and this note feeds the status pill. Cleared
  // by the next connect(). Unlike yieldedFor this covers every device of the customer, not just
  // the tab that pressed Start.
  heldNote: string | null;
  // Clear the robot's software E-stop latch without leaving the current page: open this app's robot session, send
  // reset_latch once the control channel is up, wait for the robot to report motion online, close the session.
  // Built for the Agent page (2026-10-30): a hosted ASPIRE task that fails after its first commanded motion E-stops
  // the robot and the latch persists, and the only way to clear it was to go to Remote, connect, reset, disconnect.
  // Resolves to a one-line result for the log; rejects with the reason when the session cannot be opened. Refuses
  // while this app already has a session (clear it from that page instead).
  clearEstopLatch: () => Promise<string>;
}

const TeleopSessionContext = createContext<TeleopSessionValue | undefined>(undefined);

export const TeleopSessionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { activeRobotSerial, customer } = useNori();
  const { baseUrl, fetchWithHeaders } = useApi();

  const teleopRef = useRef<RemoteTeleop | null>(null);
  const [teleop, setTeleop] = useState<RemoteTeleop | null>(null);
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connState, setConnState] = useState("idle");
  const [controlActive, setControlActive] = useState(false);
  const [mode, setMode] = useState<ControlMode>("cylindrical");
  const [tel, setTel] = useState<TelemetryView>(EMPTY_TEL);
  const [stale, setStale] = useState(false);
  const [call, setCall] = useState<CallState>(EMPTY_CALL);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [alerts, setAlerts] = useState<AlertMap>(EMPTY_ALERTS);
  const [recordState, setRecordState] = useState<RecordState | null>(null);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({ phase: "idle" });
  const [logLines, setLogLines] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [scriptSource, setScriptSourceState] = useState<string>(() => {
    try { return localStorage.getItem(LS_SCRIPT) ?? ""; } catch { return ""; }
  });

  const lastTelRef = useRef(0);
  const currentsListenerRef = useRef<((c: Record<string, number>) => void) | null>(null);
  const [heldNote, setHeldNote] = useState<string | null>(null);
  // disconnect() is defined after connect(); the eviction handler inside connect() reaches it
  // through this ref (assigned every render).
  const disconnectRef = useRef<() => Promise<void>>(async () => {});
  const yieldRef = useRef<Map<string, string>>(new Map());
  const [yieldedFor, setYieldedFor] = useState<string | null>(null);
  const setYield = useCallback((key: string, reason: string | null) => {
    const m = yieldRef.current;
    if (reason) m.set(key, reason);
    else m.delete(key);
    setYieldedFor((m.values().next().value as string | undefined) ?? null);
  }, []);

  const appendLog = useCallback((msg: string) => {
    setLogLines((prev) => {
      // Collapse consecutive duplicates into one line with a counter ("… (x12)") — a daemon
      // refusal loop re-sends the same fatal error every ~1 s, which used to bury everything
      // else in the log box. Only CONSECUTIVE repeats collapse, so interleaved events keep
      // their order.
      const last = prev[prev.length - 1];
      const m = last?.match(/^(.*) \(x(\d+)\)$/);
      const lastBase = m ? m[1] : last;
      if (lastBase === msg) {
        const n = m ? parseInt(m[2], 10) + 1 : 2;
        return [...prev.slice(0, -1), `${msg} (x${n})`];
      }
      return [...prev.slice(-300), msg];
    });
  }, []);

  const setSetting = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings((s) => {
      const next = { ...s, [k]: v };
      // Persist everything EXCEPT the TURN credential — it's minted per-session or dead,
      // so it must not sit in localStorage in plaintext (retires the earlier finding).
      try {
        const { turnCred: _omit, ...persist } = next;
        localStorage.setItem(LS_SETTINGS, JSON.stringify(persist));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const setScriptSource = useCallback((s: string) => {
    setScriptSourceState(s);
    try { localStorage.setItem(LS_SCRIPT, s); } catch { /* ignore */ }
  }, []);

  const setCurrentsListener = useCallback((fn: ((c: Record<string, number>) => void) | null) => {
    currentsListenerRef.current = fn;
  }, []);

  const telemetryListenerRef = useRef<((t: TelemetryView) => void) | null>(null);
  const setTelemetryListener = useCallback((fn: ((t: TelemetryView) => void) | null) => {
    telemetryListenerRef.current = fn;
  }, []);
  const controlSentListenerRef = useRef<((frame: Record<string, unknown>, tWallMs: number) => void) | null>(null);
  const setControlSentListener = useCallback(
    (fn: ((frame: Record<string, unknown>, tWallMs: number) => void) | null) => {
      controlSentListenerRef.current = fn;
    }, []);

  const onTelemetry = useCallback((t: TelemetryView) => {
    lastTelRef.current = Date.now();
    setStale(false);
    setTel(t);
    telemetryListenerRef.current?.(t);
  }, []);

  // Telemetry can dry up while control still reads "active"; flag it stale (matches old page logic).
  useEffect(() => {
    if (!running) { setStale(false); return; }
    const id = setInterval(() => {
      if (lastTelRef.current && Date.now() - lastTelRef.current > 1500) setStale(true);
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  // Keep the session room pointed at the active paired robot. For a signed-in operator the room
  // IS their active robot's serial — the manual room field was retired (room-token auth is gone,
  // so you can only join a robot your account owns). Re-sync whenever the active robot changes so
  // a stale/persisted room can't linger and mislead the consumers that read it (connect() below
  // and the VR hand-off link). Anonymous LAN pages (drive/vr) have no serial, so their hand-typed
  // room is left untouched.
  const serial = activeRobotSerial ?? customer?.robot_serial_number ?? "";
  useEffect(() => {
    if (serial && settings.room !== serial) setSetting("room", serial);
  }, [serial, settings.room, setSetting]);

  // Live-update the active session's arm without reconnecting.
  useEffect(() => {
    teleopRef.current?.setArm(settings.arm);
  }, [settings.arm]);

  // Live-update keyboard speed the same way (also applied at connect for a new session,
  // since this effect only fires on slider changes).
  useEffect(() => {
    teleopRef.current?.setKeyboardSpeed(settings.kbSpeed);
  }, [settings.kbSpeed]);

  const connect = useCallback(async () => {
    if (teleopRef.current) return; // already have a session
    const yielded = yieldRef.current.values().next().value as string | undefined;
    if (yielded) {               // the robot is lent out (an ASPIRE task from this app); see setYield
      appendLog(`not connecting: ${yielded}`);
      return;
    }
    setConnecting(true);
    setLogLines([]);
    setDaemonStatus(null);
    setAlerts(EMPTY_ALERTS);
    setRecordState(null);
    setHeldNote(null);
    setConnectStatus({ phase: "joining" });
    let turnUrls = settings.turn.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    let turnUser = settings.turnUser.trim();
    let turnCred = settings.turnCred.trim();
    // §2.4 minted TURN creds: fetch short-lived coturn credentials at session start
    // instead of using the static typed/persisted ones. The relay cutover to
    // use-auth-secret is done (2026-07-15), so minting is now driven by whether the
    // operator is SIGNED IN — the mint endpoint (GET /api/v1/turn/credentials) needs a
    // provisioned-customer JWT and 401s anonymously, so an anonymous LAN session (the
    // hosted /nori/drive quick-start) correctly skips the fetch and stays on STUN. The
    // isTurnMintEnabled() flag remains as a manual override for dev/testing. ANY failure
    // falls back to the configured creds, so this can never make connect worse than before.
    const room = settings.room.trim() || serial || "nori-dev";
    // Pentest V1: pre-generate the DTLS cert so its fingerprint can bind the robot-session
    // grant to THIS peer. Must exist before the TURN/grant fetch (the fingerprint is a mint
    // input) and be reused to construct the RTCPeerConnection. Anonymous LAN sessions skip
    // this (no grant); any failure degrades to the un-bound path — never worse than before.
    let sessionCert: RTCCertificate | undefined;
    let sessionGrant: string | undefined;
    const signedIn = !!(await getAccessToken());
    if (isTurnMintEnabled() || signedIn) {
      let bind: { robotSerial: string; dtlsFp: string } | undefined;
      if (signedIn && room) {
        try {
          sessionCert = await RTCPeerConnection.generateCertificate({
            name: "ECDSA", namedCurve: "P-256",
          } as unknown as AlgorithmIdentifier);
          const sha = sessionCert.getFingerprints().find((f) => f.algorithm === "sha-256");
          if (sha?.value) {
            bind = { robotSerial: room, dtlsFp: `sha-256:${sha.value.replace(/:/g, "").toLowerCase()}` };
          }
        } catch (e) {
          appendLog("V1 grant: cert pre-gen unavailable, session stays un-bound — " + (e instanceof Error ? e.message : String(e)));
          sessionCert = undefined;
        }
      }
      try {
        const c = await getTurnCredentials(baseUrl, fetchWithHeaders, bind);
        turnUrls = c.urls;
        turnUser = c.username;
        turnCred = c.credential;
        sessionGrant = c.grant;
        appendLog(`TURN: using minted credentials (ttl ${c.ttl}s)` + (c.grant ? " + robot-session grant" : ""));
      } catch (e) {
        appendLog("TURN: mint failed, using configured creds — " + (e instanceof Error ? e.message : String(e)));
      }
    }
    // Only pin the cert when it actually carries a grant — an un-bound cert gains nothing and
    // would needlessly diverge from the legacy auto-gen path.
    if (!sessionGrant) sessionCert = undefined;
    // getSupabase() throws when the app never got its config. That throw used to happen OUTSIDE
    // the try below (it's an argument to the constructor), so `connecting` was never cleared and
    // the button sat on "Connecting…" forever with no error.
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch (e) {
      appendLog("start failed: " + (e instanceof Error ? e.message : String(e)));
      setConnectStatus({ phase: "failed", reason: "signaling_unreachable" });
      setConnecting(false);
      return;
    }
    const t = new RemoteTeleop({
      signaling: new SupabaseSignaling(supabase, room, appendLog, { private: isPrivateRoomEnabled() }),
      // No videoEl/audioEl here: the session is page-independent. The page that shows video
      // attaches its elements via teleop.setVideoEl()/setAudioEl() on mount.
      stun: settings.stun.trim() || DEFAULT_STUN,
      turnUrls,
      turnUser,
      turnCred,
      cert: sessionCert,
      sessionGrant,
      forceRelay: settings.forceRelay,
      arm: settings.arm,
      // Honor the CURRENT UI selection: a fresh RemoteTeleop defaults to cylindrical, which
      // used to silently override a pre-connect (or previous-session) per-motor choice.
      mode,
      onLog: appendLog,
      onConnState: setConnState,
      onTelemetry,
      onMode: setMode,
      onControlActive: setControlActive,
      onCurrents: (c) => currentsListenerRef.current?.(c),
      onControlSent: (f, t) => controlSentListenerRef.current?.(f, t),
      onCall: setCall,
      // Note which cameras the composite is showing, once, on connect. (Per-move completion is
      // surfaced by moveTo itself in the script output, so action_status isn't logged here.)
      onCameraLayout: (l) => appendLog(`camera layout: ${l.tiles.join(", ")}`),
      // Daemon health transitions (the SDK already appends them to the log; this drives the
      // banner/chip so "daemon down/restarting" never reads as random dead control).
      onDaemonStatus: setDaemonStatus,
      // Robot operator alerts: Servo halts (self-collision / joint bound / singularity),
      // thermal band, Cartesian jog limit. State keyed on code; rendered by AlertBanner.
      // Never wired before 2026-11-23: a self-collision was a frozen arm with no reason.
      onAlert: (a: RobotAlert) => setAlerts((prev) => applyAlert(prev, a)),
      // On-robot recorder replies (W2.11) — drives the CallBar record control.
      onRecord: setRecordState,
      // The connect-phase machine — drives the connection banner. Two failures mean the robot
      // is deliberately not ours right now (a hosted ASPIRE task holds it): tear the dead SDK
      // session down so Connect is offered again, but keep the failure on the banner — a
      // disconnect() alone would wipe it to idle and the operator would never learn why.
      onConnectStatus: (st) => {
        setConnectStatus(st);
        if (st.phase === "failed" && (st.reason === "evicted" || st.reason === "robot_held")) {
          setHeldNote(st.reason === "evicted"
            ? `an ASPIRE task took the robot${st.detail ? ` — ${st.detail}` : ""}`
            : `held by ${st.detail || "an ASPIRE task"}`);
          void disconnectRef.current().then(() => setConnectStatus(st));
        }
      },
      // The handshake ack. It was never wired, so a robot that REFUSED the session (accepted:false)
      // or spoke a different protocol version left no trace outside the collapsed log box. The SDK
      // turns a refusal into a `session_rejected` phase; this is here for the advisory mismatch.
      onReady: (info) => {
        if (info.versionMismatch) {
          appendLog("this robot is running different software than the app expects");
        }
      },
    });
    teleopRef.current = t;
    setTeleop(t);
    t.setKeyboardSpeed(settings.kbSpeed);
    // Default video OFF for power: the robot's software x264 encoder is idle until a page that
    // shows video resumes it (the Remote page does, on mount). Applied when the control channel
    // opens even though it's set here pre-connect.
    t.pauseVideo();
    try {
      await t.start();
      setRunning(true);
    } catch (e) {
      appendLog("start failed: " + (e instanceof Error ? e.message : String(e)));
      teleopRef.current = null;
      setTeleop(null);
    } finally {
      setConnecting(false);
    }
  }, [settings, serial, appendLog, onTelemetry, mode, baseUrl, fetchWithHeaders]);

  const toggleControlMode = useCallback(() => {
    const t = teleopRef.current;
    if (t) t.toggleMode(); // onMode callback updates `mode`
    else setMode((m) => (m === "joint" ? "cylindrical" : "joint"));
  }, []);

  const disconnect = useCallback(async () => {
    const t = teleopRef.current;
    teleopRef.current = null;
    setTeleop(null);
    if (t) await t.stop();
    setRunning(false);
    setControlActive(false);
    setConnState("idle");
    setTel(EMPTY_TEL);
    setCall(EMPTY_CALL);
    setDaemonStatus(null);  // health is per-session; don't show a stale banner next connect
    setAlerts(EMPTY_ALERTS);  // same: a halt belongs to the session that drove into it
    setRecordState(null);   // same: recorder state is a per-session probe
    setConnectStatus({ phase: "idle" });
  }, []);

  disconnectRef.current = disconnect;

  const clearEstopLatch = useCallback(async (): Promise<string> => {
    if (teleopRef.current) throw new Error("this app already has a robot session — clear the latch from the Remote page");
    // Once this app has lent the robot to a task (setYield), it opens NO session for anything until the task ends:
    // the connect+disconnect this helper does would broadcast into the room the task now holds (2026-11-01).
    const yielded = yieldRef.current.values().next().value as string | undefined;
    if (yielded) throw new Error(`not touching the robot while it is lent out (${yielded}); clear the latch when the task ends`);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await connect();
    const t = teleopRef.current as RemoteTeleop | null;
    if (!t) throw new Error("could not open a robot session (see the session log)");
    try {
      const until = Date.now() + 25_000;
      for (;;) {
        const st = t.connectStatus();
        if (st.phase === "connected") break;
        if (st.phase === "failed") throw new Error(`could not connect: ${st.reason ?? "unknown"}${st.detail ? ` (${st.detail})` : ""}`);
        if (Date.now() > until) throw new Error("the robot did not connect within 25 s");
        await sleep(250);
      }
      // reset_latch rides the control channel and drops silently before it opens; the first daemon_status frame
      // arrives right after the channel's ack, so its presence is the "channel is up" signal.
      const chan = Date.now() + 8_000;
      while (t.daemonStatus() === null) {
        if (Date.now() > chan) throw new Error("connected, but the control channel never opened");
        await sleep(200);
      }
      const before = t.daemonStatus();
      t.command("reset_latch");
      appendLog("reset_latch sent (clear E-stop latch)");
      const settle = Date.now() + 8_000;
      while (Date.now() < settle) {
        const ds = t.daemonStatus();
        if (ds?.state === "online") return `E-stop latch cleared — motion online${before?.state !== "online" ? ` (was ${before?.state}${before?.reason ? `: ${before.reason}` : ""})` : ""}`;
        await sleep(250);
      }
      const ds = t.daemonStatus();
      return `reset sent, but the robot still reports motion ${ds?.state ?? "unknown"}${ds?.reason ? ` (${ds.reason}${ds.detail ? `: ${ds.detail}` : ""})` : ""}`;
    } finally {
      await disconnect();
    }
  }, [connect, disconnect, appendLog]);

  // Leaving /nori entirely unmounts this provider — tear the session down cleanly (robot `bye`).
  useEffect(() => () => { teleopRef.current?.stop(); }, []);

  // ── Idle auto-disconnect ────────────────────────────────────────────────────────────────
  const busyKeysRef = useRef<Set<string>>(new Set());
  const [busyCount, setBusyCount] = useState(0);
  const setSessionBusy = useCallback((key: string, busy: boolean) => {
    const keys = busyKeysRef.current;
    if (busy) keys.add(key);
    else keys.delete(key);
    setBusyCount(keys.size);
  }, []);

  // "Mid-activity" = anything that means the operator is legitimately hands-off rather than gone:
  // a page-registered run (script/agent), live control frames, or an open recording session
  // (disconnecting under one would auto-close it on the robot — see remote.tsx's confirm dialog).
  const sessionBusy =
    busyCount > 0 || controlActive || !!recordState?.sessionOpen || !!recordState?.recording;

  const idle = useIdleDisconnect({
    armed: running,
    busy: sessionBusy,
    onTimeout: () => { void disconnect(); },
  });

  const value = useMemo<TeleopSessionValue>(() => ({
    teleop, running, connecting, connState, tel, stale, controlActive, mode, call, daemonStatus,
    alerts, recordState, connectStatus,
    logLines, appendLog, settings, setSetting, connect, disconnect, toggleControlMode,
    setCurrentsListener, setTelemetryListener, setControlSentListener, scriptSource, setScriptSource,
    setSessionBusy, setYield, yieldedFor, heldNote, clearEstopLatch,
    noteActivity: idle.noteActivity,
    idlePromptOpen: idle.promptOpen,
    idleSecondsLeft: idle.secondsLeft,
  }), [
    teleop, running, connecting, connState, tel, stale, controlActive, mode, call, daemonStatus,
    alerts, recordState, connectStatus,
    logLines, appendLog, settings, setSetting, connect, disconnect, toggleControlMode,
    setCurrentsListener, setTelemetryListener, setControlSentListener, scriptSource, setScriptSource,
    setSessionBusy, setYield, yieldedFor, heldNote, clearEstopLatch,
    idle.noteActivity, idle.promptOpen, idle.secondsLeft,
  ]);

  return (
    <TeleopSessionContext.Provider value={value}>
      {children}
      <IdleDisconnectDialog
        open={idle.promptOpen}
        secondsLeft={idle.secondsLeft}
        onConfirm={idle.confirmPresent}
        onDisconnect={() => { idle.confirmPresent(); void disconnect(); }}
      />
    </TeleopSessionContext.Provider>
  );
};

export const useTeleopSession = (): TeleopSessionValue => {
  const ctx = useContext(TeleopSessionContext);
  if (ctx === undefined) throw new Error("useTeleopSession must be used within a TeleopSessionProvider");
  return ctx;
};
