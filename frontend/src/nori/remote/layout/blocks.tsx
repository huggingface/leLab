// NORI: Additive file. Building blocks for the Remote page's selectable layouts.
//
// The page (pages/remote.tsx) keeps ALL state, effects and drivers — a layout is
// pure arrangement. Blocks read the page's state through RemoteUiContext instead
// of a 30-prop drill, so a layout file is nothing but grid + block composition.
//
// The media elements (video/self-view) are created by the PAGE and passed down as
// refs; blocks only place them. Layout switching is locked while a session is
// running (see the picker in remote.tsx), so a block remounting between layouts
// never has a live stream to lose.

import { createContext, memo, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { TuneSlider } from "@/nori/remote/TuneSlider";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ArmSide, ControlMode, RemoteTeleop, TelemetryView, CallState, DaemonStatus, ConnectStatus, RecordState } from "@nori/sdk";
import { taskModeLabel, l3JointShorts } from "@nori/sdk";
import type { ServoThermalThresholds } from "@/nori/robotModels";
import { VrHandoff } from "@/nori/components/VrHandoff";
import {
  TelemetryPanel, GripForce, MotorFaultsBanner, ServoTemps, OvertempBanner, ControlLegend,
  BaseCommandLegend, CallBar, ConnectionBanner, ControlOfflineBanner, ActivationBanner, AlertBanner,
  EstopBanner, RailHeight, RailHeightHelp, JointTelemetry,
} from "@/nori/remote/TeleopStatus";
import type { AlertMap } from "@/nori/remote/alertState";
import { TelemetryFlowTracker, type TelemetryFlowSample } from "@/nori/remote/jointTelemetry";
import { Robot3D, hasJointTelemetry } from "@/nori/remote/Robot3D";
import RobotUrdfViewer from "@/nori/components/RobotUrdfViewer";
import { usesStylisedSchematic, displayDescriptor } from "@/nori/robotModels";
import LeaderSetup from "@/nori/pages/leader-setup";
import { DatasetCaptureCard } from "@/nori/remote/DatasetCaptureCard";
import { PolicyDeployCard } from "@/nori/remote/PolicyDeployCard";
import { RunOnRobotCloud } from "@/nori/remote/RunOnRobotCloud";
import { isCloudServeEnabled } from "@/nori/remote/flags";
import { ArmControlView } from "@/nori/remote/ArmControl";
import type { LeaderDriver } from "@/nori/remote/LeaderDriver";

// ---------------------------------------------------------------------------
// context

export type RemoteUi = {
  // session (from TeleopSessionContext, via the page)
  teleop: RemoteTeleop | null;
  running: boolean;
  connecting: boolean;
  connected: boolean;
  connState: string;
  tel: TelemetryView;
  stale: boolean;
  controlActive: boolean;
  mode: ControlMode;
  call: CallState;
  daemonStatus: DaemonStatus | null;
  alerts: AlertMap;
  connectStatus: ConnectStatus;
  recordState: RecordState | null;
  logLines: string[];
  settings: { arm: ArmSide; kbSpeed: number; vrSensitivity: number; vrGripperOpen: number; vrWristGain: number; room: string };
  set: (key: never, value: never) => void; // page passes its typed setter; blocks cast at the call site
  connect: () => void;
  requestDisconnect: () => void;
  connectBlocked: string | null;
  toggleControlMode: () => void;
  servoThermal: ServoThermalThresholds;
  status: string;

  // page-local
  videoRef: RefObject<HTMLVideoElement>;
  selfViewRef: RefObject<HTMLVideoElement>;
  logRef: RefObject<HTMLDivElement>;
  m6: boolean;
  cameraTiles: string[];
  selectedCamera: string;
  setSelectedCamera: (v: string) => void;
  volume: number;
  setVolume: (v: number) => void;
  clipName: string | null;
  stopClip: () => void;
  playClipFile: (f: File) => void;
  joinCall: () => void;
  leaveCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  controlMode: "keyboard" | "vr" | "leader";
  selectKeyboard: () => void;
  selectVr: () => void;
  selectLeader: () => void;
  inVr: boolean;
  xrSupported: boolean | null;
  enterVr: () => void;
  leaderRef: RefObject<LeaderDriver | null>;
  leaderActive: boolean;
  leaderCount: number;
  leaderSides: ArmSide[];
  leaderEngaged: boolean;
  leaderWarnings: string[];
  leaderCalibrating: boolean;
  showKeyboardCard: boolean; setShowKeyboardCard: (f: (v: boolean) => boolean) => void;
  showLeaderCard: boolean; setShowLeaderCard: (f: (v: boolean) => boolean) => void;
  showVrCard: boolean; setShowVrCard: (f: (v: boolean) => boolean) => void;
  showLog: boolean; setShowLog: (f: (v: boolean) => boolean) => void;
};

const RemoteUiContext = createContext<RemoteUi | null>(null);
export const RemoteUiProvider = RemoteUiContext.Provider;

export function useRemoteUi(): RemoteUi {
  const ctx = useContext(RemoteUiContext);
  if (!ctx) throw new Error("Remote layout blocks must render inside RemoteUiProvider");
  return ctx;
}

// The house panel recipe, verbatim from the page it came from.
export const PANEL = "rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 p-4 text-nori-h14131a shadow-sm";
export const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c";
// House dropdown recipe, matching leader-setup's FIELD/SELECT classes but
// compact (these live in dense chrome, not forms).
export const SELECT_TRIGGER_CLASS =
  "h-8 w-auto gap-1.5 rounded-md border-nori-h14131a/12 bg-nori-hfffdf7 px-2.5 font-mono text-[11px] text-nori-h14131a focus:ring-nori-hd98b3d";
export const SELECT_CONTENT_CLASS =
  "border-nori-h14131a/12 bg-nori-hfffdf7 font-mono text-[11px] text-nori-h14131a";
export const SELECT_ITEM_CLASS = "text-[11px] focus:bg-nori-hebe8db focus:text-nori-h14131a";

// ---------------------------------------------------------------------------
// small shared widgets

// Left/right arm toggle, rendered in whichever control card is active.
export const ArmPills = ({ value, onChange }: { value: ArmSide; onChange: (arm: ArmSide) => void }) => (
  <div className="flex items-center gap-1.5">
    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">arm</span>
    {(["left", "right"] as ArmSide[]).map((arm) => (
      <Pill key={arm} size="sm" active={value === arm} onClick={() => onChange(arm)}>{arm}</Pill>
    ))}
  </div>
);

export { TuneSlider };

// On-screen E-STOP. Sends the same wire commands as the SPACE / P keybindings
// (CMD_KEYS in the SDK): estop to latch, reset_latch to clear. The keyboard
// bindings keep working exactly as before — this is an additional surface, for
// layouts where reaching for SPACE mid-incident is one step too many.
export const EStopButton = ({ compact = false }: { compact?: boolean }) => {
  const { teleop, connected, tel } = useRemoteUi();
  const latched = tel.safety === "latched";
  return (
    <button
      type="button"
      disabled={!connected}
      onClick={() => teleop?.command(latched ? "reset_latch" : "estop")}
      title={latched
        ? `Latched (${tel.latchReason ?? "estop"}) — click (or press P) to reset`
        : "Emergency stop — halts all motion and latches (same as SPACE)"}
      className={
        "rounded-xl font-mono font-semibold uppercase tracking-[0.1em] transition-colors disabled:pointer-events-none disabled:opacity-40 " +
        (compact ? "px-3 py-1.5 text-[11px] " : "px-4 py-2 text-xs ") +
        (latched
          ? "bg-nori-h14131a text-background hover:bg-nori-h14131a/85"
          : "bg-nori-hd24a3d text-white shadow-[0_2px_0_theme(colors.nori.h8f2318)] hover:bg-nori-hd24a3d/90 active:translate-y-px active:shadow-none")
      }
    >
      {latched ? "latched — reset" : "e-stop ⎵"}
    </button>
  );
};

// ---------------------------------------------------------------------------
// blocks

// Page header: title, status pill, connect/disconnect. `extra` lets a layout put
// mode pills / E-STOP / the layout picker on the same row.
export const PageHeader = ({ extra, showStatus = true }: { extra?: ReactNode; showStatus?: boolean }) => {
  const { connected, status, running, connecting, connect, requestDisconnect, connectBlocked } = useRemoteUi();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-bold">Remote Operation</h1>
      <div className="flex flex-wrap items-center gap-3">
        {extra}
        {/* showStatus=false for layouts whose header sits directly under the
            shell's ConnectionChip — two identical pills a row apart read as a
            glitch. Classic keeps it: its header is deeper into the page. */}
        {showStatus && (
        <span
          className={
            "inline-flex h-9 items-center rounded-full px-3 font-mono text-xs " +
            (connected ? "bg-nori-h8ab135/25 text-nori-h4d6a1e" : "bg-nori-h14131a/8 text-nori-h857b6b")
          }
        >
          ● {status}
        </span>
        )}
        {running ? (
          <Button size="sm" variant="destructive" onClick={requestDisconnect}>Disconnect</Button>
        ) : (
          <Button
            size="sm" variant="secondary" onClick={connect}
            disabled={connecting || !!connectBlocked} title={connectBlocked ?? undefined}
          >
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
    </div>
  );
};

// Arm/disarm lives in remote/ArmControl.tsx so the Agent page can render the SAME control
// (it has no RemoteUi context). This wrapper is the context-reading half.
export const ArmControl = ({ compact = false }: { compact?: boolean }) => {
  const { teleop, running, daemonStatus } = useRemoteUi();
  return <ArmControlView teleop={teleop} running={running} daemonStatus={daemonStatus} compact={compact} />;
};

// The status banners. Rendered by every layout, above the fold.
export const Banners = () => {
  const { connectStatus, running, daemonStatus, alerts, tel, servoThermal } = useRemoteUi();
  return (
    <>
      <EstopBanner status={daemonStatus} />
      {/* Robot-named conditions (Servo halt, thermal, jog limit) right under the
          E-stop: a frozen arm needs its reason before anything about the link. */}
      {running && <AlertBanner alerts={alerts} />}
      <ConnectionBanner status={connectStatus} />
      {running && <ControlOfflineBanner status={daemonStatus} />}
      {running && <OvertempBanner latchReason={tel.latchReason} cutC={servoThermal.cutC} />}
      {running && <MotorFaultsBanner faults={tel.motorFaults} />}
      {/* Last: a blocked activation is often DOWNSTREAM of the faults above (a
          dead bus, a hot latched servo), so the cause reads before the symptom. */}
      {running && <ActivationBanner status={daemonStatus} />}
    </>
  );
};

// The main video surface: <video> + camera picker + self-view PIP. The layout
// controls the box (aspect/height) via className; the video letterboxes inside.
// `overlay` renders on top (Cockpit's HUD chips).
export const VideoSurface = ({
  className = "", fill = false, overlay,
}: { className?: string; fill?: boolean; overlay?: ReactNode }) => {
  const { videoRef, selfViewRef, m6, call, cameraTiles, selectedCamera, setSelectedCamera, connected } = useRemoteUi();
  const boxRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void boxRef.current?.requestFullscreen?.().catch(() => {});
  };
  return (
    <div ref={boxRef} className={"relative " + className}>
      {/* NO native controls (2026-11-02). This is a live robot feed: pausing it
          only freezes the operator's view of a robot that keeps moving, and the
          native bar's timestamp means nothing on a live stream. The one useful
          native control, fullscreen, is the button below, and it fullscreens
          the whole surface so the camera picker and HUD come along.
          onPause re-plays while connected, because a feed can still be paused
          without the bar: keyboard media keys, the OS media controls, or
          picture-in-picture. Idle, the box is a plain slab of the bars'
          unfilled-track grey (nori-he5e1d2), not the page background, which
          read as a broken white screen. */}
      <video
        ref={videoRef} autoPlay playsInline muted disablePictureInPicture
        onPause={(e) => { if (connected) void e.currentTarget.play().catch(() => {}); }}
        className={
          "w-full rounded-md " +
          (fill ? "h-full object-contain " : "") +
          // Dark override: the track token goes warm olive in dark mode,
          // which reads as sickly at video-panel size. Neutral grey, a shade
          // lighter than the cards (~13-15% L), keeps the slab quiet.
          (connected ? "bg-background" : "bg-nori-he5e1d2 dark:bg-[hsl(240_4%_20%)]")
        }
        style={fill ? undefined : { aspectRatio: "4 / 3" }}
      />
      {cameraTiles.length > 1 && (
        <div
          className="absolute left-2 top-2 z-10"
          title="Choose which camera to view. The robot always sends the full composite; this crops one tile locally."
        >
          <Select
            value={cameraTiles.includes(selectedCamera) ? selectedCamera : "composite"}
            onValueChange={setSelectedCamera}
          >
            <SelectTrigger className={SELECT_TRIGGER_CLASS + " border-background/40 bg-background/85 shadow backdrop-blur"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={SELECT_CONTENT_CLASS}>
              <SelectItem value="composite" className={SELECT_ITEM_CLASS}>all cameras (composite)</SelectItem>
              {cameraTiles.map((role) => (
                <SelectItem key={role} value={role} className={SELECT_ITEM_CLASS}>{role}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <video
        ref={selfViewRef} autoPlay playsInline muted
        className={
          "absolute bottom-2 right-2 w-32 rounded border-2 border-background bg-background shadow " +
          (m6 && call.cameraOn ? "" : "hidden")
        }
        style={{ aspectRatio: "4 / 3" }}
      />
      {connected && (
        <button
          type="button"
          onClick={toggleFullscreen}
          // Bottom-right, clear of the schematic over the top-right. When the
          // self-view PIP occupies that corner (w-32 at right-2), sit just left of it.
          className={
            "absolute bottom-2 z-10 rounded-md border border-background/40 bg-background/85 p-1.5 text-foreground shadow backdrop-blur hover:bg-background "
            + (m6 && call.cameraOn ? "right-[8.75rem]" : "right-2")
          }
          title={isFullscreen ? "Exit full screen" : "Full screen"}
          aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      )}
      {overlay}
    </div>
  );
};

// Vitals chips row (the TelemetryPanel), reusable bare — for HUDs and strips.
export const VitalsChips = ({ dense = false }: { dense?: boolean }) => {
  const { running, connState, tel, controlActive, stale, inVr, daemonStatus, servoThermal } = useRemoteUi();
  return (
    <TelemetryPanel
      dense={dense}
      connState={running ? connState : "idle"}
      tel={tel}
      controlActive={controlActive}
      stale={stale}
      inVr={inVr}
      daemonStatus={running ? daemonStatus : null}
      servoThermal={servoThermal}
    />
  );
};

// Rail height + grip force + faults + temps — telemetry minus the chip row,
// for layouts that split vitals from the deep numbers.
export const TelemetryDetail = () => {
  const { tel, teleop, settings, servoThermal } = useRemoteUi();
  return (
    <>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">Rail height <RailHeightHelp /></h2>
      {/* displayDescriptor: before the ack arrives an A3 room must show its ONE
          central column, not the L-series L/R rail pair fallback. */}
      <div className="mt-2"><RailHeight state={tel.state} descriptor={displayDescriptor(teleop?.robotInfo()?.descriptor, settings.room) ?? undefined} /></div>
      <h2 className="mt-4 text-sm font-semibold">Grip force / motor current</h2>
      <div className="mt-2"><GripForce currents={tel.currents} /></div>
      {/* Motor faults moved to the banner row (MotorFaultsBanner in Banners) —
          incident-grade info was easy to miss squeezed into this card. */}
      <div className="mt-2"><ServoTemps temps={tel.servoTemps} thresholds={servoThermal} /></div>
      {/* Per-joint numbers live HERE, not in a card of their own. They were
          added (2026-08-28) as a separate card on the grounds of density, which
          split one question — "what is this robot doing right now" — across two
          surfaces the operator had to know to look in. Density is handled by the
          section staying COLLAPSED, which also keeps the sampling gate below. */}
      <div className="mt-4"><JointTelemetrySection /></div>
    </>
  );
};

// ---------------------------------------------------------------------------
// per-joint telemetry

// How often the joint table actually re-renders. Telemetry lands at ~15 Hz and
// the table is ~17 rows x 7 cells; re-rendering it per frame is pure churn on
// the page that also has to keep a WebRTC feed smooth. 250 ms is well past the
// rate at which a human can read a changing number, and it is the same
// build-once / mutate / render-slowly shape used elsewhere in this codebase.
const JOINT_SAMPLE_MS = 250;

// Feeds every telemetry frame into a ref-held tracker and returns a snapshot on
// a slow interval.
//
// Ingest is an effect keyed on `tel.state` IDENTITY: the SDK re-parses that dict
// per frame (teleop.ts), and a telemetry frame carrying no `state` leaves the
// old object in place — so identity change is exactly "a new joint-state frame
// arrived", which is what the measured frame rate should count. The effect
// writes no React state, so the 15 Hz path costs no renders.
//
// `enabled` is false whenever the card is collapsed or no session is running:
// nothing is tracked, no interval runs, and the tracker is dropped so a
// reconnect starts from a clean window rather than inheriting a dead one.
function useJointFlowSample(enabled: boolean): TelemetryFlowSample | null {
  const { tel } = useRemoteUi();
  const trackerRef = useRef<TelemetryFlowTracker | null>(null);
  const lastStateRef = useRef<Record<string, number> | null>(null);
  const [sample, setSample] = useState<TelemetryFlowSample | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Guard the identity we already ingested: React 18 StrictMode re-runs mount
    // effects in dev, which would otherwise double-count the first frame.
    if (lastStateRef.current === tel.state) return;
    lastStateRef.current = tel.state;
    if (!trackerRef.current) trackerRef.current = new TelemetryFlowTracker();
    trackerRef.current.observe(tel.state, Date.now());
  }, [enabled, tel.state]);

  useEffect(() => {
    if (!enabled) {
      trackerRef.current = null;
      lastStateRef.current = null;
      setSample(null);
      return;
    }
    const id = window.setInterval(() => {
      setSample(trackerRef.current ? trackerRef.current.sample(Date.now()) : null);
    }, JOINT_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  return sample;
}

// memo so the table only re-renders when the throttled snapshot changes. The
// surrounding block re-renders at the telemetry rate like every other consumer
// of the session context; the expensive child does not, because `sample` is a
// new object only every JOINT_SAMPLE_MS and `descriptor` is a stable reference
// (the ack object, or the module-level display stand-in).
const MemoJointTelemetry = memo(JointTelemetry);

// Per-joint telemetry, as a SECTION of the telemetry card — the numeric
// counterpart to the 3D schematic, and the deepest layer of the same readout
// the rail/grip/temp blocks above it start.
//
// A section, not a card, so there is ONE telemetry surface: an operator asking
// "what is this robot doing" should not have to know that half the answer is in
// a second panel (or, in the drawer layouts, behind a second tab).
//
// NOT separately collapsible. It used to be, and its collapsed state gated the
// sampler — but every surface that renders it is ALREADY behind a collapse
// (Drawers unmounts a closed drawer's body outright; Classic shows the card
// whole), so the inner toggle only hid live data behind a second click nobody
// expected. On the bench that read as "telemetry is not flowing" when in fact
// it had never been asked for (2026-09-03).
//
// The sampler is therefore gated on `running` alone. Cost is unchanged where it
// matters: in the drawer layouts a closed drawer does not mount this at all, and
// in Classic it costs what an expanded section always cost — ingest into a ref at
// telemetry rate, one throttled render at JOINT_SAMPLE_MS.
export const JointTelemetrySection = () => {
  const { teleop, settings, running } = useRemoteUi();
  const sample = useJointFlowSample(running);
  // displayDescriptor: gives the table its shape (which joints to expect) before
  // the ack lands, and returns null for an L2 — which correctly leaves the table
  // driven purely by whatever keys actually arrive, with no advertised list and
  // therefore no missing-key claims we cannot substantiate.
  const descriptor = displayDescriptor(teleop?.robotInfo()?.descriptor, settings.room);
  return (
    <>
      <h2 className="text-sm font-semibold">Per-joint telemetry</h2>
      <div className="mt-2">
        <MemoJointTelemetry sample={sample} descriptor={descriptor} active={running} />
      </div>
    </>
  );
};

// The whole telemetry readout in one card: vitals chips, then rail/grip/temps,
// then the per-joint table. "Combined" is now literal — the joint table used to
// be a sibling card.
export const TelemetryCard = () => (
  <div className={PANEL}>
    <p className={EYEBROW}>// telemetry</p>
    <div className="mt-3"><VitalsChips /></div>
    <div className="mt-4"><TelemetryDetail /></div>
  </div>
);

// Audio: clip-to-speaker on the eyebrow row, CallBar below.
export const AudioCard = () => {
  const {
    clipName, stopClip, playClipFile, connected, call, running, connState, m6,
    recordState, joinCall, leaveCall, toggleMute, toggleCamera, volume, setVolume,
  } = useRemoteUi();
  return (
    <div className={PANEL}>
      <div className="flex min-h-5 flex-wrap items-center gap-2">
        <p className={EYEBROW}>// audio</p>
        <div className="ml-auto flex min-w-0 flex-nowrap items-center gap-2">
          {clipName ? (
            <>
              <span className="flex min-w-0 items-center gap-1 text-xs text-nori-h4d6a1e" title={clipName}>
                <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-nori-h8ab135" />
                Clip <span className="max-w-[7rem] truncate font-medium">{clipName}</span> playing
              </span>
              <Button size="sm" variant="secondary" onClick={stopClip}>Stop clip</Button>
            </>
          ) : (
            <>
              <span className="text-xs text-nori-h857b6b">Play clip</span>
              <label
                className={
                  "rounded border border-nori-h14131a/20 px-2 py-0.5 text-xs " +
                  (connected ? "cursor-pointer hover:bg-nori-h14131a/5" : "pointer-events-none opacity-50")
                }
                title="Play an audio file out of the robot's speaker"
              >
                Choose file…
                <input
                  type="file" accept="audio/*" className="hidden" disabled={!connected}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void playClipFile(f);
                  }}
                />
              </label>
            </>
          )}
        </div>
      </div>
      <div className="mt-3">
        <CallBar
          call={call} running={running} connected={connState === "connected"} m6={m6}
          recording={recordState?.recording ?? false}
          onJoin={joinCall} onLeave={leaveCall} onToggleMute={toggleMute} onToggleCamera={toggleCamera}
          volume={volume} onVolumeChange={setVolume}
        />
      </div>
    </div>
  );
};

// Just the three mode pills — for layouts that park them in the header.
export const ModePills = () => {
  const { controlMode, selectKeyboard, selectLeader, selectVr, inVr } = useRemoteUi();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill active={controlMode === "keyboard"} onClick={selectKeyboard} title="Drive with the keyboard (default)">Keyboard</Pill>
      <Pill
        active={controlMode === "leader"} onClick={selectLeader}
        title="Drive the robot's arms from the physical dual leader arms (base + lift stay on the keyboard). Selectable offline for hardware setup."
      >
        Leader arm
      </Pill>
      <Pill active={controlMode === "vr"} onClick={selectVr} title="Drive with a VR headset (AR passthrough) on this same session">
        {inVr ? "In VR" : "VR"}
      </Pill>
    </div>
  );
};

// The classic `// controls` strip: eyebrow + pills in a panel.
// The controls strip is also the safety cluster's home: mode pills, then
// arm/disarm, then E-STOP — grouped here rather than scattered through the
// header, where three differently-styled buttons next to Connect read as
// clutter. Wraps to two rows in narrow rails.
export const ControlsStrip = () => (
  // Eyebrow on its own line, content rows left-aligned below it: this strip
  // only lives in narrow rails, where the old right-aligned ml-auto group
  // wrapped into ragged rows that started mid-panel.
  <div className="min-h-16 rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 p-4 text-nori-h14131a shadow-sm">
    <p className={EYEBROW}>// controls</p>
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <ModePills />
      <ArmControl compact />
      <EStopButton compact />
    </div>
  </div>
);

// The active control-mode card (keyboard legend / leader setup / VR entry) —
// content identical to the classic page, so behavior can't drift per layout.
// `wide` marks a full-page-width placement (Cockpit/Stage put the leader card
// below the video): the embedded leader setup then lays its left/right panes
// side by side instead of the sidebar stack.
export const ActiveModeCard = ({ wide = false }: { wide?: boolean }) => {
  const ui = useRemoteUi();
  const {
    controlMode, connected, inVr, xrSupported, enterVr, settings, set, teleop, mode,
    toggleControlMode, leaderRef, leaderActive, leaderCount, leaderSides, leaderEngaged,
    leaderWarnings, leaderCalibrating,
    showKeyboardCard, setShowKeyboardCard, showLeaderCard, setShowLeaderCard, showVrCard, setShowVrCard,
  } = ui;
  const setArm = (arm: ArmSide) => (set as (k: "arm", v: ArmSide) => void)("arm", arm);
  const setNum = (k: "kbSpeed" | "vrSensitivity" | "vrGripperOpen" | "vrWristGain", v: number) =>
    (set as (k: string, v: number) => void)(k, v);

  if (controlMode === "vr") {
    return (
      <div className="rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 px-4 pb-4 pt-3 text-nori-h14131a shadow-sm">
        <div className="flex min-h-9 cursor-pointer items-center justify-between" onClick={() => setShowVrCard((v) => !v)}>
          <h3 className="text-base font-semibold leading-none tracking-tight">VR control</h3>
          <span className="text-sm text-muted-foreground">{showVrCard ? "▲ hide" : "▼ show"}</span>
        </div>
        {showVrCard && (
          <div className="mt-3 space-y-3">
            {xrSupported && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={enterVr} disabled={!connected || inVr} title="Open the headset (AR passthrough) on this same session">
                  {inVr ? "In VR" : "Enter VR"}
                </Button>
                {!connected && <span className="text-sm text-nori-h6f6858">connect to the robot first</span>}
              </div>
            )}
            <div className="space-y-2">
              <TuneSlider
                label="motion" value={settings.vrSensitivity} min={0.25} max={2}
                title="How much the robot moves per hand movement (100% = hardware-tuned default)"
                onChange={(v) => setNum("vrSensitivity", v)}
              />
              <TuneSlider
                label="grip speed" value={settings.vrGripperOpen} min={0.05} max={1}
                title="How fast the gripper moves while the trigger is held (A3: same speed opening and closing)"
                onChange={(v) => setNum("vrGripperOpen", v)}
              />
              <TuneSlider
                label="wrist" value={settings.vrWristGain} min={0.5} max={2.5}
                title="How far the gripper turns per degree your hand turns (100% = mirror). Motion scales arm travel only."
                onChange={(v) => setNum("vrWristGain", v)}
              />
            </div>
            <VrHandoff />
          </div>
        )}
      </div>
    );
  }

  if (controlMode === "leader") {
    return (
      <div className="rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 px-4 pb-4 pt-3 shadow-sm">
        {leaderActive && (
          <p className="mb-2 rounded bg-nori-h14131a/5 px-2 py-1 text-xs font-medium text-nori-h4d463a">
            {leaderCount}/{leaderSides.length === 1 ? 6 : 12} leader joints readable ·{" "}
            {leaderEngaged
              ? leaderSides.length === 1 ? `engaged → ${settings.arm} arm` : "engaged"
              : "standby (monitor-only)"}
          </p>
        )}
        {leaderActive && leaderWarnings.length > 0 && (
          <p className="mb-2 rounded bg-nori-hd24a3d/10 px-2 py-1 text-xs font-semibold text-nori-h8f2318">
            Calibration problems — recalibrate before engaging. Details in Leader setup below.
          </p>
        )}
        {leaderActive && leaderSides.length === 1 && (
          <p className="mb-2 rounded bg-nori-h8ab135/15 px-2 py-1 text-xs text-nori-h4d6a1e">
            One leader arm connected ({leaderSides[0]}) — {leaderEngaged ? "driving" : "will drive"} the{" "}
            <strong>{settings.arm}</strong> follower arm. Use the arm pills to switch sides.
          </p>
        )}
        {leaderActive && leaderSides.length === 0 && (
          <p className="mb-2 rounded bg-nori-hb06a1c/15 px-2 py-1 text-xs text-nori-h7a4a13">
            Leader mode is on but no leader joints are readable — nothing is being sent to
            the robot. Check the USB connection and that this machine has a leader
            calibration for the configured ID.
          </p>
        )}
        <LeaderSetup
          embedded
          wide={wide}
          collapsed={!showLeaderCard}
          onToggleCollapse={() => setShowLeaderCard((v) => !v)}
          titleExtra={
            <Button
              size="sm"
              variant={leaderEngaged ? "destructive" : "default"}
              onClick={() => leaderRef.current?.setEngaged(!leaderEngaged)}
              disabled={!leaderActive || (!leaderEngaged && (leaderCount === 0 || leaderCalibrating))}
              className={leaderEngaged ? "rounded-md" : "rounded-md bg-nori-h8ab135 text-foreground hover:bg-nori-h799c2a"}
              title={
                !leaderActive
                  ? "Connect to the robot first — engage sends leader poses to the arms"
                  : leaderEngaged
                    ? "Robot arms are following the leaders — disengage before letting go of them"
                    : leaderCalibrating
                      ? "Calibration in progress — engagement is locked until it finishes"
                      : leaderCount === 0
                        ? "Waiting for readable leader joints"
                        : "Hold the leaders near the robot's current pose, then engage; the arms will move to match"
              }
            >
              {leaderEngaged ? "Disengage" : "Engage"}
            </Button>
          }
          headerExtra={<ArmPills value={settings.arm} onChange={setArm} />}
          headerBelow={
            <div className="rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb p-3">
              <BaseCommandLegend
                wasd
                hint="Base + lift stay on the keyboard while the leaders drive the arms; once engaged, WASD drives the base too (until then it still jogs the arm). Click the video first so keys register."
              />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <Card className="border-nori-h14131a/10 bg-nori-hf3f1e8 text-nori-h14131a">
      <CardHeader
        className={`cursor-pointer px-4 pt-3 ${showKeyboardCard ? "pb-0" : "pb-4"}`}
        onClick={() => setShowKeyboardCard((v) => !v)}
      >
        <CardTitle className="flex min-h-9 items-center justify-between text-base font-semibold">
          Keyboard controls
          <span className="text-sm font-normal text-muted-foreground">{showKeyboardCard ? "▲ hide" : "▼ show"}</span>
        </CardTitle>
      </CardHeader>
      {showKeyboardCard && (
        <CardContent className="p-4 pt-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <ArmPills value={settings.arm} onChange={setArm} />
            <Button
              variant="outline" size="sm" onClick={toggleControlMode}
              title={taskModeLabel(displayDescriptor(teleop?.robotInfo()?.descriptor, settings.room)) === "cartesian"
                ? "Switch between cartesian (task-space) and per-motor control"
                : "Switch between cylindrical (rpi4 feel) and per-motor control"}
            >
              Mode: {mode === "joint" ? "per-motor" : taskModeLabel(displayDescriptor(teleop?.robotInfo()?.descriptor, settings.room))}
            </Button>
          </div>
          <div className="mb-3">
            <TuneSlider
              label="sensitivity" value={settings.kbSpeed} min={0.1} max={1}
              title="How fast held keys jog the robot (arm, base and lift), as a fraction of full speed"
              onChange={(v) => setNum("kbSpeed", v)}
            />
          </div>
          <ControlLegend
            mode={mode}
            jointShorts={teleop?.armJointShorts()
              ?? l3JointShorts(displayDescriptor(null, settings.room), settings.arm)}
            descriptor={displayDescriptor(teleop?.robotInfo()?.descriptor, settings.room)}
          />
        </CardContent>
      )}
    </Card>
  );
};

// 3D schematic panel. Layouts size it (h-64 rail thumb / tall split view) and
// decide interactivity: the tall variants earn orbit controls + the graded
// post chain, the rail thumb stays the cheap static render.
export const SchematicCard = ({
  heightClass = "h-64", interactive = false, bare = false,
}: { heightClass?: string; interactive?: boolean; bare?: boolean }) => {
  const { tel, settings, teleop } = useRemoteUi();
  const body = usesStylisedSchematic(settings.room) ? (
    <Robot3D state={tel.state} activeArm={settings.arm} />
  ) : (
    <RobotUrdfViewer
      className={`${heightClass} w-full`}
      interactive={interactive}
      frameless={bare}
      liveState={tel.state}
      descriptor={teleop?.robotInfo()?.descriptor}
    />
  );
  if (bare) return body;
  return (
    <div className={PANEL}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={EYEBROW}>// 3d schematic</p>
        {!hasJointTelemetry(tel.state) && (
          <span className="text-[11px] text-muted-foreground">waiting for joint telemetry…</span>
        )}
      </div>
      <div className="mt-3">{body}</div>
    </div>
  );
};

// Robot logs, collapsible card (classic form).
export const LogsCard = () => {
  const { showLog, setShowLog } = useRemoteUi();
  return (
    <Card className="border-nori-h14131a/10 bg-nori-hf3f1e8 text-nori-h14131a">
      <CardHeader className={`cursor-pointer px-4 pt-3 ${showLog ? "pb-0" : "pb-4"}`} onClick={() => setShowLog((v) => !v)}>
        <CardTitle className="flex min-h-9 items-center justify-between text-base font-semibold">
          Robot logs
          <span className="text-sm font-normal text-muted-foreground">{showLog ? "▲ hide" : "▼ show"}</span>
        </CardTitle>
      </CardHeader>
      {showLog && (
        <CardContent className="p-4 pt-3">
          <LogBox />
        </CardContent>
      )}
    </Card>
  );
};

// The bare scrolling log box, for tabs/drawers that provide their own chrome.
export const LogBox = () => {
  const { logRef, logLines } = useRemoteUi();
  return (
    <div
      ref={logRef}
      className="max-h-96 min-h-44 overflow-auto whitespace-pre-wrap rounded border border-nori-h14131a/10 bg-nori-hf3f1e8 p-2 font-mono text-xs"
    >
      {logLines.length > 0 ? logLines.join("\n") : (
        <span className="text-muted-foreground">Connect to Nori to view logs</span>
      )}
    </div>
  );
};

// Record / deploy / cloud. `open` pre-expands the cards for layouts that put
// them behind a drawer/tab of their own — a second collapsed header inside an
// already-opened drawer reads as broken.
export const RecordBlock = ({ open = false }: { open?: boolean }) => (
  <DatasetCaptureCard defaultOpen={open} />
);
export const DeployBlock = ({ open = false }: { open?: boolean }) => (
  <>
    <PolicyDeployCard
      defaultOpen={open}
      unavailableNote={
        open ? (
          <p className="text-sm text-nori-h6f6858">
            Policy deploy needs the local lelab app — nothing answered on this machine.
          </p>
        ) : undefined
      }
    />
    {isCloudServeEnabled() && <RunOnRobotCloud />}
  </>
);

// ---------------------------------------------------------------------------
// arrangement helpers

// Accordion drawer bar: a row of headers, at most one body open below the row.
export const Drawers = ({ items }: { items: { id: string; label: ReactNode; body: ReactNode }[] }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setOpenId((cur) => (cur === i.id ? null : i.id))}
            className={
              // min-w keeps a label from being crushed mid-word: in a narrow
              // column the row wraps to a second line of centered headers
              // instead of clipping.
              "min-w-[8.5rem] flex-1 whitespace-nowrap rounded-md border px-3 py-2 text-center font-mono text-[11px] uppercase tracking-[0.08em] transition-colors " +
              (openId === i.id
                ? "border-nori-h14131a/20 bg-nori-hf6f4eb text-nori-h14131a"
                : "border-nori-h14131a/10 bg-nori-hf3f1e8 text-nori-h6f6858 hover:border-nori-h14131a/25")
            }
          >
            {openId === i.id ? "▾ " : "▸ "}{i.label}
          </button>
        ))}
      </div>
      {open && <div className="mt-2">{open.body}</div>}
    </div>
  );
};

// Stage/PIP switcher (Cockpit, Stage): the stage and the PIP swap places on a
// click of the PIP, and the PIP can be COLLAPSED into a small restore pill so
// the schematic gets out of the way entirely. Both children stay mounted in a
// fixed order through every state — only classes move — so the <video> element
// inside is never re-created (a display:none video keeps its stream).
export const StageSwitcher = ({
  video, schematic, className = "",
}: { video: ReactNode; schematic: ReactNode; className?: string }) => {
  const [stageIs3d, setStageIs3d] = useState(false);
  const [pipHidden, setPipHidden] = useState(false);
  const stageCls = "absolute inset-0";
  // The expanded 3D view is a centred SQUARE of the stage's height, not the
  // video's wide aspect — a robot is taller than it is wide, and the wide
  // frame stranded it between dead margins. The stage box itself keeps the
  // video aspect so the page doesn't jump when swapping.
  const stage3dCls = "absolute inset-y-0 left-1/2 aspect-square h-full -translate-x-1/2";
  // aspect gives the PIP box a height of its own — its children size with
  // h-full, which would collapse in a width-only box. The 3D PIP is SQUARE
  // (like its expanded form — the robot is portrait); the camera PIP keeps
  // the feed's 4:3.
  const pipBase = "group absolute right-3 top-3 z-10 cursor-pointer overflow-hidden rounded-md border-2 border-background/60 shadow-lg transition-transform hover:scale-[1.03] [&_video]:!rounded-none ";
  const pipLabel = stageIs3d ? "camera" : "3d";
  const cls = (isStage: boolean, is3d: boolean) =>
    isStage ? (is3d ? stage3dCls : stageCls)
    : pipHidden ? "hidden"
    : pipBase + (is3d ? "aspect-square w-44" : "aspect-[4/3] w-56");
  const pipProps = (isStage: boolean) =>
    isStage ? {} : {
      onClick: () => setStageIs3d((v) => !v),
      title: `Click to make the ${pipLabel} the stage`,
    };
  const collapseButton = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setPipHidden(true); }}
      title={`Collapse the ${pipLabel} view`}
      className="absolute right-1 top-1 z-20 hidden h-5 w-5 items-center justify-center rounded bg-nori-h14131a/70 font-mono text-xs leading-none text-background group-hover:flex"
    >
      –
    </button>
  );
  return (
    <div className={"relative " + className}>
      <div className={cls(!stageIs3d, false)} {...pipProps(!stageIs3d)}>
        {video}
        {stageIs3d && !pipHidden && collapseButton}
      </div>
      <div className={cls(stageIs3d, true)} {...pipProps(stageIs3d)}>
        {schematic}
        {!stageIs3d && !pipHidden && collapseButton}
      </div>
      {pipHidden && (
        <button
          type="button"
          onClick={() => setPipHidden(false)}
          title={`Restore the ${pipLabel} view`}
          className="absolute right-3 top-3 z-10 rounded-full border border-background/50 bg-nori-h14131a/75 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-background shadow hover:bg-nori-h14131a/90"
        >
          ▸ {pipLabel}
        </button>
      )}
    </div>
  );
};

// Full-bleed breakout: the NoriLayout shell caps <main> at max-w-5xl; wide
// layouts escape it with the center-translate trick rather than a shell change,
// so every other page keeps its cap.
// `width` lets a layout pick how far it escapes (Stage runs narrower so a 4:3
// feed doesn't strand huge pillar bars in a 16:9 stage).
export const Breakout = ({ children, width = "w-[min(96vw,1480px)]" }: { children: ReactNode; width?: string }) => (
  <div className={"relative left-1/2 -translate-x-1/2 " + width}>{children}</div>
);
