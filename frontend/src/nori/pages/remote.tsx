// NORI: Additive file. Remote-mode page (M1 §e: laptop app as the single control
// client). Drives the Pi robot over WAN — live WebRTC video + keyboard control over a
// data channel, brokered by Supabase signaling. The heavy lifting lives in
// nori/remote/teleop.ts (the RemoteTeleop class); this page is settings + video + status.
//
// LAYOUTS: the page's state, effects and drivers all live HERE; what gets drawn is a
// selectable arrangement from remote/layout/layouts.tsx built out of the blocks in
// remote/layout/blocks.tsx (field-test set — expected to narrow to 1-2). The picker is
// locked while a session is live, so a layout never has to survive an active stream,
// and the choice persists per browser.
//
// The Supabase project (URL/anon key) is the one already initialized by NoriContext from
// /nori/config, so there are no paste boxes for it here — only the remote-session
// settings (room, ICE/TURN) which must match the Pi's .env.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNori } from "@/nori/NoriContext";
import { useApi } from "@/contexts/ApiContext";
import { type ArmSide, type CameraViewHandle } from "@nori/sdk";
import { VrSession } from "@nori/sdk/vr";
import { useConnectGate } from "@/nori/components/ConnectionPanel";
import { servoThermalThresholds } from "@/nori/robotModels";
import { LeaderDriver } from "@/nori/remote/LeaderDriver";
import { playAudioFile, type ClipHandle } from "@/nori/remote/audioClip";
import { isM6VideoEnabled } from "@/nori/remote/flags";
import { prefersMobileDrive, readViewport } from "@/nori/remote/mobileRoute";
import { useTeleopSession } from "@/nori/TeleopSessionContext";
import { RemoteUiProvider, type RemoteUi, SELECT_TRIGGER_CLASS, SELECT_CONTENT_CLASS, SELECT_ITEM_CLASS } from "@/nori/remote/layout/blocks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  REMOTE_LAYOUTS, loadRemoteLayout, saveRemoteLayout, type RemoteLayoutId,
} from "@/nori/remote/layout/layouts";

const Remote = () => {
  const { ready, error: noriError } = useNori();
  // A phone that lands here (a shared link, the nav, a bookmark) gets the drive pad
  // instead: this page is a keyboard console and none of it survives a 390 px screen.
  // Mount only, and `replace` so Back doesn't bounce between the two. The pad's
  // "full console" link sets the escape hatch that turns this off for the visit.
  const navigate = useNavigate();
  useEffect(() => {
    if (prefersMobileDrive(readViewport())) navigate("/nori/mobile", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const connectBlocked = useConnectGate();
  const { baseUrl, fetchWithHeaders } = useApi();
  // The session now lives in TeleopSessionProvider so it survives navigation (Remote <-> Coding).
  // This page is a consumer: it renders video/telemetry/settings and drives VR/leader/clip, but
  // it no longer owns the RemoteTeleop instance and must NOT stop it on unmount.
  const {
    teleop, running, connecting, connState, tel, stale, controlActive, mode, call, daemonStatus,
    connectStatus, recordState,
    logLines, appendLog, settings, setSetting: set, connect, disconnect: sessionDisconnect,
    toggleControlMode, setCurrentsListener, yieldedFor, heldNote,
  } = useTeleopSession();

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const selfViewRef = useRef<HTMLVideoElement>(null);
  const vrRef = useRef<VrSession | null>(null);
  const leaderRef = useRef<LeaderDriver | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const m6 = isM6VideoEnabled();

  // Which arrangement draws the page. Persisted per browser; switchable only
  // while no session is running (see the picker below), so layouts never have
  // to keep a live stream alive across a re-arrangement.
  const [layoutId, setLayoutId] = useState<RemoteLayoutId>(loadRemoteLayout);
  const layout = REMOTE_LAYOUTS.find((l) => l.id === layoutId) ?? REMOTE_LAYOUTS[0];

  const [showLog, setShowLog] = useState(false);
  // Servo cut point differs by generation (L2 58 C, A3 60 C) and the ack carries no
  // model field, so it comes from the serial -- and the session's room IS the active
  // robot's serial (same reasoning as the 3D schematic).
  const servoThermal = servoThermalThresholds(settings.room);
  // Each control-mode card (keyboard / leader / VR) collapses like Robot logs;
  // expanded by default, remembered per mode while on the page.
  const [showKeyboardCard, setShowKeyboardCard] = useState(true);
  const [showLeaderCard, setShowLeaderCard] = useState(true);
  const [showVrCard, setShowVrCard] = useState(true);
  // Playback volume of the robot's inbound audio (the hidden <audio> sink), 0..1.
  const [volume, setVolume] = useState(1);
  const [inVr, setInVr] = useState(false);
  const [xrSupported, setXrSupported] = useState<boolean | null>(null);
  // Leader-arm control: when active the physical dual leaders drive the robot's arms
  // (absolute leader_action_deg); base + lift stay on the keyboard. leaderCount is how many
  // motors fed the last frame (0 = arms unplugged / bus paused). leaderSides is which
  // leader arms produced usable targets — with exactly one, the driver solo-routes it to
  // the SELECTED follower arm (the arm pills), so the UI must say where it's going.
  const [leaderActive, setLeaderActive] = useState(false);
  const [leaderCount, setLeaderCount] = useState(0);
  const [leaderSides, setLeaderSides] = useState<ArmSide[]>([]);
  // SAFETY GATE: the driver auto-starts in monitor-only mode (polls + shows live joints,
  // sends NOTHING). The robot only follows the leaders after the operator presses Engage —
  // so connecting mid-setup / pre-calibration can never slam the arms to garbage targets.
  const [leaderEngaged, setLeaderEngaged] = useState(false);
  // Calibration-health messages from the live frame (stale wrap schema, corrupted spans).
  const [leaderWarnings, setLeaderWarnings] = useState<string[]>([]);
  const [leaderCalibrating, setLeaderCalibrating] = useState(false);
  // Control mode SELECTION is independent of the session: leader doubles as the hardware
  // setup surface and VR as the headset entry point, so both are selectable while
  // disconnected. The actual drivers (leaderActive / inVr) only run on a live session.
  const [selectedMode, setSelectedMode] = useState<"keyboard" | "vr" | "leader">("keyboard");
  // Per-camera view (P4.6): the Pi always sends ONE composite track; this picks which tile to show.
  // "composite" = the full grid; a role = a live client-side crop of that tile (no Pi-side change).
  const [selectedCamera, setSelectedCamera] = useState("composite");
  const [cameraTiles, setCameraTiles] = useState<string[]>([]); // roles from the bridge layout, "" if none
  const cameraViewRef = useRef<CameraViewHandle | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines, showLog]);

  // Attach THIS page's media elements to the persistent session, and detach (not stop) on leave.
  // The SDK remembers the inbound stream and re-points these elements, so video survives a
  // round-trip to another page. Also RESUME the robot video encoder while Remote is showing video,
  // and PAUSE it on leave — the encoder is idle (and the Pi draws less power) whenever no page is
  // watching. The session default is paused (set in the provider), so other pages get no video.
  // layoutId is a dep: a layout switch remounts the <video> element, so re-point the
  // session at the NEW element (the switch is gated to no-session, but teleop can
  // outlive a disconnect and would otherwise hold the old element on reconnect).
  useEffect(() => {
    if (!teleop) return;
    teleop.setVideoEl(videoRef.current);
    teleop.setAudioEl(audioRef.current);
    teleop.resumeVideo();
    return () => { teleop.setVideoEl(null); teleop.setAudioEl(null); teleop.pauseVideo(); };
  }, [teleop, layoutId]);

  // Track which camera tiles the composite carries (the bridge sends the layout ~2 s after connect,
  // re-sent a few times). Poll rather than subscribe — the provider owns onCameraLayout — and reset
  // the picker to composite when the layout goes away (disconnect).
  useEffect(() => {
    if (!teleop || connState !== "connected") { setCameraTiles([]); setSelectedCamera("composite"); return; }
    const read = () => {
      const tiles = teleop.cameraLayoutInfo()?.tiles ?? [];
      setCameraTiles((prev) => (prev.length === tiles.length && prev.every((t, i) => t === tiles[i]) ? prev : tiles));
    };
    read();
    const id = setInterval(read, 1500);
    return () => clearInterval(id);
  }, [teleop, connState]);

  // Point the <video> at either the full composite or a live per-tile crop. cameraView() crops the
  // named tile from the SAME composite track into its own canvas-captured stream (client-side; the Pi
  // is unaware), so switching costs nothing on the robot. Falls back to composite if the crop can't be
  // built yet (track/layout not ready) or the selected role vanished.
  useEffect(() => {
    if (!teleop) return;
    cameraViewRef.current?.stop();
    cameraViewRef.current = null;
    if (selectedCamera === "composite" || !cameraTiles.includes(selectedCamera)) {
      teleop.setVideoEl(videoRef.current); // re-points srcObject back to the composite
      return;
    }
    const handle = teleop.cameraView(selectedCamera);
    if (handle && videoRef.current) {
      videoRef.current.srcObject = handle.stream;
      cameraViewRef.current = handle;
    } else {
      teleop.setVideoEl(videoRef.current);
    }
    return () => { cameraViewRef.current?.stop(); cameraViewRef.current = null; };
  }, [teleop, selectedCamera, cameraTiles, connState]);

  // Keep the robot-audio sink at the chosen volume (also re-applies after re-attach above).
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, teleop]);

  // Feed gripper currents (haptics) + telemetry into the in-VR HUD while VR is active. Currents
  // arrive via a session-level listener (only one page registers at a time); telemetry mirrors
  // the value we already read from the context.
  useEffect(() => {
    setCurrentsListener((c) => vrRef.current?.setCurrents(c));
    return () => setCurrentsListener(null);
  }, [setCurrentsListener]);
  useEffect(() => { vrRef.current?.setTelemetry(tel); }, [tel]);
  // Keep the HUD's control row honest about motor health (same rule as the 2D chip). No status
  // yet = treat as online; the HUD's own staleness timer still catches a dead controller.
  useEffect(() => {
    vrRef.current?.setMotorsOnline(!daemonStatus || daemonStatus.state === "online");
    // Arm state for the in-VR motors panel. Both fields: they disagree in time by design
    // (armPhase.ts), and `armed: undefined` means "gateway predates remote arming", which the
    // panel renders differently from disarmed.
    vrRef.current?.setArmState(daemonStatus?.armed, daemonStatus?.activation ?? "",
      daemonStatus?.activation_detail ?? "");
  }, [daemonStatus]);

  // VR is an optional mode on top of the same session: detect headset support, and on any
  // link drop require a fresh squeeze before VR drive resumes (re-clutch-on-resume).
  useEffect(() => { VrSession.isSupported().then(setXrSupported); }, []);
  useEffect(() => {
    if (connState === "failed" || connState === "disconnected") vrRef.current?.reclutch();
  }, [connState]);
  // Apply the VR sensitivity sliders live to a running headset session (they also seed a
  // new session at enterVr, since this only fires on changes).
  useEffect(() => {
    vrRef.current?.setTuning({
      sensitivity: settings.vrSensitivity,
      gripperOpenRate: settings.vrGripperOpen,
      wristGain: settings.vrWristGain,
    });
  }, [settings.vrSensitivity, settings.vrGripperOpen, settings.vrWristGain]);

  // Connect/disconnect the session itself live in the provider. This page's disconnect also
  // stops the page-local drivers (leader / VR / clip) first, then tears the session down.
  const disconnect = useCallback(async () => {
    leaderRef.current?.stop();
    leaderRef.current = null;
    setLeaderActive(false);
    setLeaderCount(0);
    setLeaderSides([]);
    setLeaderEngaged(false);
    setLeaderCalibrating(false);
    await vrRef.current?.stop();
    vrRef.current = null;
    setInVr(false);
    await sessionDisconnect();
  }, [sessionDisconnect]);

  // End collection bookkeeping before disconnecting. Kept episodes upload
  // independently; unresolved reviews stay held for recovery on reconnect.
  const [confirmFinish, setConfirmFinish] = useState(false);
  const sessionOpen = recordState?.sessionOpen ?? false;
  const requestDisconnect = useCallback(() => {
    if (sessionOpen) setConfirmFinish(true);
    else void disconnect();
  }, [sessionOpen, disconnect]);
  const finishAndDisconnect = useCallback(() => {
    teleop?.record("session_end");   // does not Keep an unresolved review
    setConfirmFinish(false);
    void disconnect();
  }, [teleop, disconnect]);

  // Enter the immersive (AR-passthrough) headset session on top of the live link. Reuses
  // the same RemoteTeleop + video element; VR feeds `jog` exactly like the keyboard.
  const enterVr = async () => {
    if (!teleop || !videoRef.current) return;
    const session = new VrSession({
      teleop,
      videoEl: videoRef.current,
      onLog: appendLog,
      onEnd: () => { setInVr(false); vrRef.current = null; },
      tuning: {
        sensitivity: settings.vrSensitivity, gripperOpenRate: settings.vrGripperOpen,
        wristGain: settings.vrWristGain,
      },
      // In-VR poke-panel changes persist to the same settings the sliders edit (the
      // settings-change effect then echoes the same values back — harmless no-op).
      onTuningChange: (t) => {
        set("vrSensitivity", t.sensitivity);
        set("vrGripperOpen", t.gripperOpenRate);
        set("vrWristGain", t.wristGain);
      },
    });
    vrRef.current = session;
    // Seed with the robot state we already have — the effects above only push on CHANGE, and
    // the SDK de-duplicates daemon_status, so a still robot pushes nothing after the session
    // exists and the in-VR motors panel would stay greyed on `armed: undefined`.
    session.setMotorsOnline(!daemonStatus || daemonStatus.state === "online");
    session.setArmState(daemonStatus?.armed, daemonStatus?.activation ?? "",
      daemonStatus?.activation_detail ?? "");
    if (tel) session.setTelemetry(tel);
    try {
      await session.start();
      setInVr(true);
    } catch (e) {
      appendLog("enter VR failed: " + (e instanceof Error ? e.message : String(e)));
      vrRef.current = null;
    }
  };

  // ---- leader-arm control -------------------------------------------------
  // Start/stop the physical dual leader arms driving the robot's arms over the same live
  // session. The driver polls /nori/leader/live and feeds absolute targets to RemoteTeleop;
  // base + lift keep working on the keyboard. Toggling off releases the arms to the keyboard.
  const stopLeader = useCallback(() => {
    leaderRef.current?.stop();
    leaderRef.current = null;
    setLeaderActive(false);
    setLeaderCount(0);
    setLeaderSides([]);
    setLeaderEngaged(false);
    setLeaderCalibrating(false);
  }, []);

  const enterLeader = useCallback(() => {
    if (!teleop) return;
    const driver = new LeaderDriver({
      teleop,
      baseUrl,
      fetcher: fetchWithHeaders,
      onFrame: (count, frame) => {
        setLeaderCount(count);
        setLeaderWarnings(frame.warnings ?? []);
        setLeaderCalibrating(Boolean(frame.calibrating));
        // Which leader arms produced usable targets this frame — drives the solo-routing
        // hint ("left leader -> right arm") and the no-targets warning below.
        setLeaderSides(
          (["left", "right"] as ArmSide[]).filter((s) =>
            Object.values(frame.leaders?.[s]?.motors ?? {}).some(
              (m) => m.ok && m.target !== null && m.target !== undefined,
            ),
          ),
        );
      },
      onError: (msg) => appendLog("leader read paused: " + msg),
      onEngagedChange: (engaged, reason) => {
        setLeaderEngaged(engaged);
        appendLog(`leader ${engaged ? "ENGAGED — robot arms following leaders" : `disengaged${reason ? ` (${reason})` : ""}`}`);
      },
    });
    leaderRef.current = driver;
    driver.start();
    setLeaderActive(true);
  }, [teleop, baseUrl, fetchWithHeaders, appendLog]);

  // Keep the leader driver's lifecycle tied to (mode, session) instead of the click that
  // selected the mode. Previously the driver only started if you clicked "Leader arm"
  // while ALREADY connected — pick Leader first, then Connect (the natural order), and
  // nothing ever drove the arms. This effect starts it whenever leader mode is selected
  // on a live session, and stops it when the session drops (a reconnect re-enters here
  // with a driver bound to the CURRENT teleop instance, not a stale one).
  useEffect(() => {
    if (selectedMode === "leader" && connState === "connected" && teleop && !leaderRef.current) {
      enterLeader();
    } else if (connState !== "connected" && leaderRef.current) {
      stopLeader();
    }
  }, [selectedMode, connState, teleop, enterLeader, stopLeader]);

  // ---- two-way audio call (Phase 7 §B) ------------------------------------
  const joinCall = async () => {
    try {
      await teleop?.joinCall();
    } catch (e) {
      appendLog("join call failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };
  const leaveCall = () => teleop?.leaveCall();
  const toggleMute = () => teleop?.setMicMuted(!call.micMuted);

  // ---- on-robot episode recording (W2.11) ----------------------------------
  // The controls live in DatasetCaptureCard ("Record training dataset") — episode
  // start/stop there drives BOTH the browser catcher and the robot's recorder.
  // This page only probes once per session so the card reflects reality (a
  // recording-disabled robot answers "recorder unreachable", not silence).
  useEffect(() => {
    if (connState === "connected" && controlActive) teleop?.record("status");
  }, [connState, controlActive, teleop]);

  // ---- clip audio (laptop file -> robot speaker; reuses the M3b downlink) ----
  const clipRef = useRef<ClipHandle | null>(null);
  // The name of the clip currently streaming to the robot speaker, or null when none is. Doubles
  // as the "is a clip playing?" flag it used to be, and feeds the "Clip … playing" label.
  const [clipName, setClipName] = useState<string | null>(null);
  const stopClip = useCallback(() => {
    clipRef.current?.stop();
    clipRef.current = null;
    setClipName(null);
    teleop?.setVideoQuality("normal"); // restore camera bitrate
  }, [teleop]);
  const playClipFile = async (file: File) => {
    const t = teleop;
    if (!t) return;
    stopClip(); // one clip at a time (single audio uplink)
    try {
      const handle = await playAudioFile(t, file);
      clipRef.current = handle;
      setClipName(file.name);
      t.setVideoQuality("low"); // free Pi headroom while the clip streams
      appendLog(`clip: streaming "${file.name}" to robot speaker`);
      handle.done.then(() => { // clears when the clip ends naturally or is stopped
        if (clipRef.current === handle) {
          clipRef.current = null;
          setClipName(null);
          teleop?.setVideoQuality("normal"); // covers natural end (stopClip not called)
        }
      });
    } catch (e) {
      appendLog("clip failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };
  // Tear the clip down the moment the session drops — src.onended only fires on a clip's
  // NATURAL end, so a mid-clip disconnect would otherwise leak the AudioContext + track and
  // leave the SDK re-attaching a stale track on every reconnect.
  useEffect(() => {
    if (clipName && connState !== "connected") stopClip();
  }, [clipName, connState, stopClip]);
  const toggleCamera = async () => {
    const t = teleop;
    if (!t) return;
    try {
      if (call.cameraOn) {
        t.disableCamera();
        if (selfViewRef.current) selfViewRef.current.srcObject = null;
      } else {
        const stream = await t.enableCamera(); // M6-gated in the UI; capture is built now
        if (selfViewRef.current) selfViewRef.current.srcObject = stream;
      }
    } catch (e) {
      appendLog("camera toggle failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Keyboard control: only while a session is running. The class ignores keys typed in
  // form fields and only emits jog when the control channel is open.
  useEffect(() => {
    if (!running) return;
    const down = (e: KeyboardEvent) => { if (teleop?.onKeyDown(e)) e.preventDefault(); };
    const up = (e: KeyboardEvent) => teleop?.onKeyUp(e);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [running, teleop]);

  // Enter toggles the active follower arm — same as the left/right pills — in the modes that
  // scope by it (keyboard + leader). Kept out of the SDK jog keymap since it's a UI selection,
  // not a jog. Ignored while typing in a field so it never hijacks form input.
  useEffect(() => {
    if (selectedMode !== "keyboard" && selectedMode !== "leader") return;
    const onEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      set("arm", settings.arm === "left" ? "right" : "left");
      e.preventDefault();
    };
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, [selectedMode, settings.arm, set]);

  // On unmount / navigate away, stop only the PAGE-LOCAL drivers (leader / VR / clip) and detach
  // media. The session itself lives in TeleopSessionProvider and stays connected across pages —
  // do NOT stop it here (that was the old bug that killed the link on every navigation).
  useEffect(() => () => { clipRef.current?.stop(); leaderRef.current?.stop(); vrRef.current?.stop(); }, []);

  const connected = running && connState === "connected";
  // The pill speaks the connect PHASE, not the raw WebRTC state: `connState` is "idle" for the
  // whole waiting-for-the-robot window, so the old pill read "conn: idle" while the real answer
  // was "waiting for your robot" (or, after the deadline, "couldn't connect").
  const PHASE_PILL: Record<string, string> = {
    joining: "connecting…",
    waiting: "waiting for robot…",
    negotiating: "connecting…",
    connected: "connected",
    failed: "couldn't connect",
  };
  const status = connected
    ? "connected"
    : running || connecting ? (PHASE_PILL[connectStatus.phase] ?? "connecting…")
    : yieldedFor ? `not connected — ${yieldedFor}`
    : heldNote ? `not connected — ${heldNote}` : "not connected";
  const controlMode = selectedMode;
  const selectKeyboard = useCallback(async () => {
    setSelectedMode("keyboard");
    stopLeader();
    await vrRef.current?.stop(); // onEnd clears inVr
  }, [stopLeader]);
  const selectVr = useCallback(async () => {
    setSelectedMode("vr");
    stopLeader();
    // Entering the headset itself is the card's "Enter VR" button — not automatic.
  }, [stopLeader]);
  const selectLeader = useCallback(async () => {
    setSelectedMode("leader");
    await vrRef.current?.stop();
    // The lifecycle effect above starts the arm driver once (mode=leader, connected) holds —
    // whether the session is live now or connects later. Offline the card is setup-only.
  }, []);

  // Everything the layout blocks read. Deliberately not memo-tuned per field —
  // the page re-renders on telemetry anyway; useMemo just keeps the object
  // identity stable within a render pass.
  const ui: RemoteUi = useMemo(() => ({
    teleop, running, connecting, connected, connState, tel, stale, controlActive, mode, call,
    daemonStatus, connectStatus, recordState, logLines, settings,
    set: set as RemoteUi["set"],
    connect, requestDisconnect, connectBlocked, toggleControlMode, servoThermal, status,
    videoRef, selfViewRef, logRef, m6,
    cameraTiles, selectedCamera, setSelectedCamera,
    volume, setVolume, clipName, stopClip, playClipFile,
    joinCall, leaveCall, toggleMute, toggleCamera,
    controlMode, selectKeyboard, selectVr, selectLeader, inVr, xrSupported, enterVr,
    leaderRef, leaderActive, leaderCount, leaderSides, leaderEngaged, leaderWarnings, leaderCalibrating,
    showKeyboardCard, setShowKeyboardCard, showLeaderCard, setShowLeaderCard,
    showVrCard, setShowVrCard, showLog, setShowLog,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    teleop, running, connecting, connected, connState, tel, stale, controlActive, mode, call,
    daemonStatus, connectStatus, recordState, logLines, settings, connectBlocked, servoThermal,
    status, m6, cameraTiles, selectedCamera, volume, clipName, controlMode, inVr, xrSupported,
    leaderActive, leaderCount, leaderSides, leaderEngaged, leaderWarnings, leaderCalibrating,
    showKeyboardCard, showLeaderCard, showVrCard, showLog,
    requestDisconnect, selectKeyboard, selectVr, selectLeader, stopClip,
  ]);

  const LayoutComponent = layout.Component;
  const layoutLocked = running || connecting;

  return (
    <section className="space-y-4">
      {!ready && (
        <p className="text-sm text-destructive">
          Nori auth/config not ready{noriError ? ` — ${noriError}` : " — sign in first (Supabase config comes from the laptop server)."}{" "}
          <span className="text-nori-h6f6858">(laptop server: {baseUrl})</span>
        </p>
      )}

      <RemoteUiProvider value={ui}>
        <LayoutComponent />
      </RemoteUiProvider>

      {/* Layout picker — a field-test affordance, parked at the page's tail so
          it never competes with operating controls. Locked during a session so
          a switch never has to carry live media/drivers across arrangements. */}
      <div className="flex items-center justify-end gap-2 border-t border-nori-h14131a/10 pt-3">
        <label
          htmlFor="remote-layout"
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
        >
          preferred layout:
        </label>
        <div title={layoutLocked ? "Disconnect to change the page layout" : "Choose how this page is arranged"}>
          <Select
            value={layoutId}
            disabled={layoutLocked}
            onValueChange={(id) => {
              setLayoutId(id as RemoteLayoutId);
              saveRemoteLayout(id as RemoteLayoutId);
            }}
          >
            <SelectTrigger id="remote-layout" className={SELECT_TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={SELECT_CONTENT_CLASS}>
              {REMOTE_LAYOUTS.map((l) => (
                <SelectItem key={l.id} value={l.id} className={SELECT_ITEM_CLASS}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Robot inbound audio — always mounted at page level (layouts move the
          video around; the audio sink must never remount with them). */}
      <audio ref={audioRef} autoPlay className="hidden" />

      <AlertDialog open={confirmFinish} onOpenChange={setConfirmFinish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finished recording dataset?</AlertDialogTitle>
            <AlertDialogDescription>
              You still have a training session open{
                recordState?.episodesKept
                  ? ` with ${recordState.episodesKept} episode${recordState.episodesKept === 1 ? "" : "s"} saved`
                  : ""
              }. Kept episodes upload to My Stuff when Nori is idle. Episodes awaiting review
              remain on Nori until you reconnect and Keep or Reject them. Keep Nori powered on
              until kept episodes land.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Return</AlertDialogCancel>
            <AlertDialogAction onClick={finishAndDisconnect}>End session and disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default Remote;
