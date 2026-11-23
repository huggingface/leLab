// NORI: Additive file. Presentational status surface for remote teleop (Phase 7 C1–C3).
// Pure/dumb components driven by props from pages/remote.tsx — no session logic lives here.
//   * TelemetryPanel — connection + link mode + loop_hz + safety/watchdog + temp + staleness.
//   * GripForce      — per-motor Present_Current bars (the "virtual tactile" signal), grippers first.
//   * ControlLegend  — mode-aware keybind legend, derived from teleop.ts's exported maps.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { servoThermalThresholds, type ServoThermalThresholds } from "@/nori/robotModels";
import { isPreparing, isStuck } from "@/nori/remote/armPhase";
import { latchedDetail, useActivationLatch } from "@/nori/remote/activationLatch";
import { activeAlerts, alertHeadline, type AlertMap } from "@/nori/remote/alertState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { HelpCircle, Mic, MicOff, Phone, PhoneOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  baseKeyClusters,
  currentMa,
  keybindLegend,
  taskModeLabel,
  CURRENT_FULL_LSB,
  type RobotDescriptor,
  type BaseKeyCluster,
  type CallState,
  type ConnectFailure,
  type ConnectPhase,
  type ConnectStatus,
  type ControlMode,
  type DaemonStatus,
  type TelemetryView,
} from "@nori/sdk";

// A labelled stat chip: dim label over a mono value, with an optional tone.
function Stat({
  label,
  value,
  tone = "default",
  dense = false,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  // dense: tighter chip for one-line status strips (Stage's top bar).
  dense?: boolean;
}) {
  // Tinted chips in the leader-setup palette: outlined neutral, green/amber/red badges.
  // Default tone (no data yet — path / watchdog / temp before a connect) is fill-less: the
  // card's own background with just the hairline outline marking the chip (the earlier tan
  // fill hsl(var(--nori-he5e1d2)) read as unpleasant; 2026-07-16). The border is stronger than the tinted
  // tones' /12 so an outline-only chip still registers. Good tone matches the "connected"
  // status green (hsl(var(--nori-h8ab135)) family) instead of the old cooler/bluer green, so healthy chips
  // and the connected pill read as one signal.
  const toneClass = {
    default: "border-nori-h14131a/20 bg-transparent text-nori-h14131a",
    good: "border-nori-h8ab135/40 bg-nori-h8ab135/15 text-nori-h4d6a1e",
    warn: "border-nori-hdb9346/35 bg-nori-hfdf1de text-nori-h8a5a12",
    // Same recipe as good — brand red at /15 over the card instead of the old solid
    // hsl(var(--nori-hfde7e4)) fill — so the two tones sit at one vibrancy level (muted 2026-07-16).
    bad: "border-nori-hd24a3d/40 bg-nori-hd24a3d/15 text-nori-h8f2318",
  }[tone];
  return (
    <div className={cn("flex flex-col rounded-md border", dense ? "gap-0.5 px-2 py-1" : "gap-1 px-2.5 py-1.5", toneClass)}>
      <span className={cn("font-mono uppercase tracking-[0.14em] text-nori-h857b6b", dense ? "text-[9px]" : "text-[10px]")}>{label}</span>
      <span className={cn("font-mono leading-none", dense ? "text-xs" : "text-sm")}>{value}</span>
    </div>
  );
}

// Map the robot's free-text safety string to a tone. Anything that isn't a plain
// "ok"/"normal"/"-" reads as at least a warning so a latch/hold stands out; "latched" is a
// hard E-STOP that needs an operator action to clear, so it gets the red tone rather than
// sitting at the same amber as a self-clearing "safe_hold".
function safetyTone(safety: string): "good" | "warn" | "bad" | "default" {
  const s = safety.toLowerCase();
  if (s === "-" || s === "") return "default";
  if (s === "ok" || s === "normal" || s === "nominal" || s === "clear") return "good";
  if (s === "latched") return "bad";
  return "warn";
}

// Map the watchdog (control-stream dead-man) to a tone. This used to render EVERY non-"-"
// value as "warn", so a healthy "ok" was styled identically to a motion-blocking "stop" — the
// chip sat permanently amber on a normal robot, which trains operators to ignore exactly the
// indicator that matters. Now: ok = green, warn = amber, stop = red.
// An unrecognized value (newer daemon, open union on WatchdogState) falls through to "warn"
// rather than "good" — an unknown state should be visible, not silently reassuring.
function watchdogTone(watchdog: string): "good" | "warn" | "bad" | "default" {
  const s = watchdog.toLowerCase();
  if (s === "-" || s === "") return "default";
  if (s === "ok") return "good";
  if (s === "stop") return "bad";
  return "warn";
}

// Operator-facing remedy per motor-control offline reason (nori_protocol_schema §5b). The wire
// still carries a machine `reason`/`detail`; neither is shown — this is the what-do-I-do line
// that replaces them, in plain language for a non-technical operator.
const CONTROL_REMEDIES: Record<string, string> = {
  startup_positions:
    "An arm isn't responding — it has likely lost power. Power-cycle (unplug/replug) the arm; the robot reconnects automatically.",
  bus_lost:
    "A motor cable disconnected. The robot is restarting motor control — it should return in about 15 seconds. If it keeps happening, check the cable.",
  unauthorized:
    "The robot rejected the control token (provisioning problem). Contact support — this won't fix itself.",
  motion_disabled:
    "Remote motion isn't enabled on this robot. Video, episodes and calls all work; driving from this page requires enabling motion on the robot itself.",
  unreachable:
    "The robot's motor control is down or restarting. It should return shortly; video keeps working.",
  connection_lost:
    "The robot's motor control restarted. It should return shortly; video keeps working.",
  servo_overheat:
    "A motor is too hot and the robot has stopped moving to protect it. SUPPORT OR LOWER THE ARM — it may go slack. Cooling takes several minutes; video keeps working and control returns on its own once it cools.",
};

// Reasons where "reconnecting" is a LIE: the robot is not coming back on its own
// timescale, and telling an operator to wait is the wrong instruction when the arm
// may be about to sag. Keeps the headline honest without a second banner component.
const NOT_RECONNECTING = new Set(["servo_overheat", "unauthorized", "motion_disabled"]);
export function controlRemedy(reason?: string): string {
  return (reason && CONTROL_REMEDIES[reason]) || CONTROL_REMEDIES.unreachable;
}

// Full-width alert shown while motor control is offline. Fixed headline + the plain-English
// remedy, so a dead-arm refusal loop reads as "power-cycle the arm" instead of random downtime
// with a connected video feed. The raw reason code and the robot's `detail` string are
// deliberately NOT rendered — the remedy above is the operator-facing version of both.
export function ControlOfflineBanner({ status }: { status: DaemonStatus | null }) {
  if (!status || status.state === "online") return null;
  return (
    <div className="rounded-md border border-nori-hd24a3d/35 bg-nori-hfde7e4 px-4 py-3 text-nori-ha3271c">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
        {status.reason === "motion_disabled"
          ? "Remote motion not enabled on this robot"
          : status.reason && NOT_RECONNECTING.has(status.reason)
            ? "Robot motor control stopped"
            : "Robot motor control offline, reconnecting"}
      </p>
      <p className="mt-1 text-sm">{controlRemedy(status.reason)}</p>
    </div>
  );
}

// Persistent over-temp banner (telemetry status.latch_reason = "overtemp:<motor>"). The latch
// holds for the several MINUTES the servo needs to cool below the cut threshold, and reset is
// REFUSED until then — without this banner that reads as a robot that ignores reset presses.
// Driven by latch_reason (not servo_temps) so it exactly tracks the latch lifecycle: appears on
// trip, survives reconnects, drops the moment a reset actually succeeds.
//
// The cut temperature is per-model (L2 58 °C, A3 60 °C) so it is passed in rather than
// written into the copy. The motor name rides in the reason itself ("overtemp:<motor>") —
// naming it beats "at least one servo" when an operator has to go and hold something.
export function OvertempBanner(
  { latchReason, cutC }: { latchReason?: string | null; cutC?: number },
) {
  if (!latchReason?.startsWith("overtemp")) return null;
  const motor = latchReason.slice("overtemp:".length).trim();
  return (
    <div className="rounded-md border border-nori-hd24a3d/35 bg-nori-hfde7e4 px-4 py-3 text-nori-ha3271c">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
        Servo over temperature limit
      </p>
      <p className="mt-1 text-sm">
        {motor ? `${shortMotor(motor)} is` : "At least one servo is"} over the
        {cutC ? ` ${cutC}°C` : ""} temperature limit. Support or lower the arm — it may go
        slack. Cooling takes several minutes, and motion will not unlatch till then.
      </p>
    </div>
  );
}

// Motion-stack activation banner. The robot names EXACTLY what is blocking (or
// occupying) activation — a joint past its limit, E-stop engaged, silent bus —
// and rendering it verbatim ended the "preparing… flashes forever with no
// reason" class (2026-08-26). It lived inline in ArmControl until 2026-08-27,
// where a full "blocked: right_shoulder_roll_joint 2 raw=2151 [32..2111] 8
// STEPS ABOVE MAX" wrecked the telemetry/controls strip it sat in; a banner is
// the only surface wide enough for the robot's own sentence.
//
// Gating reuses armPhase.ts so the tone can never disagree with the `motors: …`
// chip: transitional (arming/running/disarming) is informational, stuck
// (physical_blocked / configuration_fault / failed / anything this build
// doesn't know) is a warning. Nominal ("active"/"inactive"/absent) renders
// nothing, and so does a state with no detail — a headline with no sentence
// under it tells the operator less than the chip already does.
// Hardware E-STOP / physical fault, from the supervisor via daemon_status.
// FIRST in the banner stack: it is the cause of everything else the operator
// is about to read (dead arms, blocked activation, "disarmed" motors). Before
// this existed the physical E-stop was invisible in the app — the arms simply
// stopped and the session looked hung (bench 2026-08-28).
export function EstopBanner({ status }: { status: DaemonStatus | null }) {
  if (!status?.estop) return null;
  return (
    <div className="rounded-md border border-nori-hd24a3d/35 bg-nori-hfde7e4 px-4 py-3 text-nori-ha3271c">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
        Hardware E-STOP engaged — motion stopped
      </p>
      <p className="mt-1 text-sm">
        The robot has dropped arm torque. Release the physical E-STOP, then
        press Arm to bring motion back.
        {status.estop_detail ? ` (${status.estop_detail})` : ""}
      </p>
    </div>
  );
}

// Robot operator alerts (`alert` frames): the conditions the robot itself names
// that no other field carries. Today: a MoveIt Servo halt (`servo_halt`: the
// arm froze because it would self-collide, hit a joint bound or a singularity;
// the message says which arm and how to get out), the servo thermal band, and
// a refused Cartesian jog. Rendered verbatim at the robot's severity, one card
// per code, cleared by the robot. Before 2026-11-23 none of these reached the
// screen: a self-collision on 0003 looked like a frozen arm with no reason.
export function AlertBanner({ alerts }: { alerts: AlertMap }) {
  const active = activeAlerts(alerts);
  if (active.length === 0) return null;
  return (
    <>
      {active.map((alert) => (
        <div
          key={alert.code}
          className={cn(
            "rounded-md border px-4 py-3",
            alert.severity === "info"
              ? "border-nori-h14131a/12 bg-nori-hf3f1e8 text-nori-h14131a"
              : "border-nori-hd24a3d/35 bg-nori-hfde7e4 text-nori-ha3271c",
          )}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
            {alertHeadline(alert)}
          </p>
          {/* Verbatim: the robot names the arm and the way out. */}
          <p className="mt-1 text-sm">{alert.message}</p>
        </div>
      ))}
    </>
  );
}

//
// Latched (2026-11-06): a refused arm drops the buses and the robot settles
// back to "inactive" within ~2 s (physical_blocked -> disarming -> inactive,
// measured on 0003), so gating on the live state alone showed the joint
// sentence for under two seconds — the "message never shows" report. The
// last stuck detail is kept (activationLatch.ts) until an arm succeeds, the
// session ends or the operator dismisses it, and it renders as "blocked" for
// the whole time the robot keeps naming it, through disarming AND inactive.
export function ActivationBanner({ status }: { status: DaemonStatus | null }) {
  const activation = status?.activation ?? "";
  const live = status?.activation_detail ?? "";
  const preparing = isPreparing(activation);
  const stuckNow = isStuck(activation);
  const [latch, dismiss] = useActivationLatch(status);
  const held = latchedDetail(latch);
  // The remembered blocker outranks a transitional headline: "Motion stack
  // activating" over the parked-joint sentence (the disarming frame) read as
  // progress when it was the failure.
  const stuck = stuckNow || held !== "";
  const detail = stuck ? (stuckNow && live ? live : held) : (preparing ? live : "");
  if (!detail) return null;
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-md border px-4 py-3",
      stuck
        ? "border-nori-hd24a3d/35 bg-nori-hfde7e4 text-nori-ha3271c"
        : "border-nori-h14131a/12 bg-nori-hf3f1e8 text-nori-h14131a",
    )}>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
          {stuck ? "Motion activation blocked" : "Motion stack activating"}
        </p>
        {/* Verbatim, always: operators depend on it naming the offending joint. */}
        <p className="mt-1 text-sm">{detail}</p>
        {stuck && !stuckNow && (
          <p className="mt-1 text-xs opacity-80">
            The arm request was refused and the motors returned to disarmed. Clear the cause, then arm again.
          </p>
        )}
      </div>
      {/* Only the remembered cause is dismissable: while the robot is live-reporting
          a stuck state there is nothing to dismiss — it is still true. */}
      {stuck && !stuckNow && (
        <button
          type="button" onClick={dismiss} title="Hide this message until the robot names a different cause"
          className="shrink-0 rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] hover:bg-nori-hd24a3d/10"
        >
          dismiss
        </button>
      )}
    </div>
  );
}

// What the operator is told for each connect failure. Same contract as CONTROL_REMEDIES above:
// headline = what's wrong in their words, body = what to DO about it.
//
// Room-token auth is retired: there is no "wrong access code" failure any more — a non-paired
// operator is refused at the RLS join (they never reach the robot handshake), so the only "nobody
// answered" cause left is a robot that's off / offline / the wrong robot. That retirement also
// removed the only settings-fixable failure, so the banner no longer links back to call settings.
const CONNECT_TROUBLE: Record<ConnectFailure, { headline: string; body: string }> = {
  signaling_unreachable: {
    headline: "Can't reach Nori",
    body: "Your device can't reach Nori's servers. Check your internet connection — the robot is probably fine.",
  },
  robot_not_responding: {
    headline: "Your robot isn't answering",
    body: "Check that the robot is powered on and connected to Wi-Fi. It will connect on its own once it's reachable.",
  },
  ice_failed: {
    headline: "Couldn't open a video connection",
    body: "Your robot answered, but no network path could be opened between you — usually a restrictive firewall or office network. Try a different network, or a phone hotspot, to confirm.",
  },
  negotiation_failed: {
    headline: "The connection failed to start",
    body: "Something went wrong setting up the video link. Disconnect and try again; if it keeps happening, contact support.",
  },
  session_rejected: {
    headline: "The robot refused this session",
    body: "The robot is reachable but wouldn't accept control. This usually means a provisioning problem — contact support.",
  },
  // Gateway precedence (2026-10-30): a hosted ASPIRE task outranks this app. `detail` names the
  // holder / the task; the body is the same remedy either way — wait for the task, then connect.
  robot_held: {
    headline: "Can't connect right now — an ASPIRE task holds the robot",
    body: "The robot is running an agent task and won't take a second session. Stop the task from the Agent page or wait for it to finish, then connect again.",
  },
  evicted: {
    headline: "Disconnected — an ASPIRE task took the robot",
    body: "An agent task started on this robot and the robot handed it the session. Follow it on the Agent page; connect again when it ends.",
  },
};

// What we're doing, while it's still going fine. Only used pre-connection.
const CONNECT_PROGRESS: Partial<Record<ConnectPhase, string>> = {
  joining: "Connecting to Nori…",
  waiting: "Waiting for your robot…",
  negotiating: "Your robot answered — opening the video link…",
};

// The connection surface: a calm progress line while a connect is in flight, a red banner with a
// remedy when it fails. Renders nothing once connected (the chips take over) or when idle.
export function ConnectionBanner({ status }: { status: ConnectStatus }) {
  if (status.phase === "idle" || status.phase === "connected") return null;

  if (status.phase === "failed") {
    const t = status.reason ? CONNECT_TROUBLE[status.reason] : undefined;
    // An unknown reason must still render as a failure rather than vanish.
    const headline = t?.headline ?? "Couldn't connect";
    const body = t?.body ?? "Disconnect and try again; if it keeps happening, contact support.";
    // Held/evicted carry who has the robot in `detail` (the task id); show it, it is what the
    // operator will look for on the Agent page.
    const showDetail = (status.reason === "robot_held" || status.reason === "evicted") && status.detail;
    return (
      <div className="rounded-md border border-nori-hd24a3d/35 bg-nori-hfde7e4 px-4 py-3 text-nori-ha3271c">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em]">{headline}</p>
        <p className="mt-1 text-sm">{body}</p>
        {showDetail && <p className="mt-1 font-mono text-[11px] opacity-80">{status.detail}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-nori-h14131a/12 bg-nori-hf3f1e8 px-4 py-3 text-nori-h14131a">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-nori-h857b6b" />
      <p className="text-sm">{CONNECT_PROGRESS[status.phase] ?? "Connecting…"}</p>
    </div>
  );
}

export function TelemetryPanel({
  connState,
  tel,
  controlActive,
  stale,
  inVr,
  daemonStatus,
  servoThermal = servoThermalThresholds(null),
  dense = false,
}: {
  connState: string;
  tel: TelemetryView;
  controlActive: boolean;
  stale: boolean; // no telemetry frame for a while -> the readouts below are not live
  inVr: boolean;
  daemonStatus?: DaemonStatus | null; // robot-reported motor-control health (null = none received yet)
  // Per-model servo cut point (L2 58 C, A3 60 C). Defaults to the unknown-serial
  // fallback, which is the LOWEST cut and therefore warns earliest.
  servoThermal?: ServoThermalThresholds;
  dense?: boolean; // tighter chips + row gap, for one-line status strips
}) {
  const connected = connState === "connected";
  // loop_hz should sit near 50; flag a sag so a struggling control loop is visible.
  const hzTone = !controlActive || stale ? "default" : tel.loopHz >= 45 ? "good" : tel.loopHz >= 30 ? "warn" : "bad";
  // One honest control readout, gated on all three independent signals — they can disagree:
  //   * controlActive : the command channel is open (transport).
  //   * !stale        : telemetry is still arriving (the robot is actually running the loop).
  //   * motorsOk      : the robot's own motor-control health push.
  // The media bridge can be fully connected while motor control behind it is dead, which used to
  // read as a green "active" chip; requiring all three keeps the chip from lying. A null
  // daemonStatus means the robot never sent one (older bridge) — don't punish that, the
  // staleness timer still catches a genuinely dead controller.
  const motorsOk = !daemonStatus || daemonStatus.state === "online";
  const controlOk = controlActive && !stale && motorsOk;

  // Bare chip row — the page composes this into its combined // telemetry card.
  return (
    <div className={dense ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
      {/* No "link" chip: it mirrored the raw WebRTC state the shell's
          ConnectionChip already shows. path/net below carry the link facts
          that aren't duplicated. */}
      <Stat dense={dense}
        label="path"
        value={tel.linkMode ? tel.linkMode.toUpperCase() : "—"}
        tone={tel.linkMode === "lan" ? "good" : tel.linkMode === "wan" ? "warn" : "default"}
      />
      {/* Video-link health from the ABR loop (SDK videoQuality.ts). Before this chip, a feed
          starved by packet loss hid behind a green "connected" — 70% loss still read as fine.
          "degraded/bad" = the loop is actively cutting bitrate to keep frames flowing. */}
      {tel.videoNet && (
        <Stat dense={dense}
          label="net"
          value={tel.videoNet.quality === "good" ? "OK" : tel.videoNet.quality}
          tone={tel.videoNet.quality === "good" ? "good"
            : tel.videoNet.quality === "degraded" ? "warn" : "bad"}
        />
      )}
      {/* "offline", not "disconnected": this chip is false when ANY of the three signals above
          fails (channel closed, telemetry stale, motors unhealthy), and only the first of those
          is really a disconnection. The vaguer word is the more honest one here. */}
      {/* With no session at all, "offline"/red would be an alarm about nothing —
          every chip in the row goes empty/uncolored until a connection exists. */}
      <Stat dense={dense} label="control" value={connected ? (controlOk ? "online" : "offline") : "—"}
        tone={connected && controlOk ? "good" : connected ? "bad" : "default"} />
      <Stat dense={dense} label="loop" value={connected ? `${tel.loopHz.toFixed(1)} Hz` : "—"} tone={hzTone} />
      <Stat dense={dense} label="safety" value={tel.safety} tone={safetyTone(tel.safety)} />
      <Stat dense={dense} label="watchdog" value={tel.watchdog} tone={watchdogTone(tel.watchdog)} />
      {/* Pi SoC temp: throttling starts at 80. Green below 70 so a healthy reading
          reads as healthy (it was the one chip left uncolored while live); still
          neutral with no reading (0/absent), so a dead sensor can't look "good". */}
      <Stat dense={dense} label="temp" value={tel.tempC > 0 ? `${tel.tempC.toFixed(0)}°C` : "—"}
        tone={tel.tempC <= 0 ? "default" : tel.tempC >= 80 ? "bad" : tel.tempC >= 70 ? "warn" : "good"} />
      {/* Hottest SERVO case temp (telemetry servo_temps, new daemons; "—" on old ones).
          The joint loses torque at the model's cut point — tones track that, not the Pi's
          SoC bands. Hover names the joint; the ServoTemps rows below list every warm one. */}
      {(() => {
        const hot = Object.entries(tel.servoTemps ?? {}).sort((a, b) => b[1] - a[1])[0];
        return (
          <span title={hot ? `hottest joint: ${shortMotor(hot[0])}` : undefined}>
            <Stat dense={dense} label="servo" value={hot ? `${hot[1]}°C` : "—"}
              tone={!hot ? "default"
                : hot[1] >= servoThermal.hotC ? "bad"
                : hot[1] >= servoThermal.warnC ? "warn" : "good"} />
          </span>
        );
      })()}
      {/* Pack state-of-charge from the robot bridge (battery_monitor_integration.md §5). null =
          no monitor / reader down / voltage unknown -> "—", never a scary 0%. Low thresholds
          mirror the kiosk gauge (≤15% ≈ where the 6S SoC table nears the 22V floor). */}
      <Stat dense={dense} label="battery"
        value={tel.batteryPercent != null ? `${tel.batteryPercent}%` : "—"}
        tone={tel.batteryPercent == null ? "default"
          : tel.batteryPercent <= 15 ? "bad" : tel.batteryPercent <= 30 ? "warn" : "good"} />
      {inVr && <Stat dense={dense} label="mode" value="VR" tone="good" />}
    </div>
  );
}

// Prettify a current key like "right_arm_gripper" -> "R gripper" for a compact label.
function shortMotor(key: string): string {
  return key
    .replace(/^left_arm_/, "L ")
    .replace(/^right_arm_/, "R ")
    .replace(/^left_/, "L ")
    .replace(/^right_/, "R ")
    .replace(/_/g, " ");
}

// Which arm a current key belongs to. Motors are keyed "<side>_arm_<joint>" (and "<side>_..."
// for lift/base); anything without a side prefix falls into "other" so it still shows.
function armSide(key: string): "left" | "right" | "other" {
  if (key.startsWith("left_")) return "left";
  if (key.startsWith("right_")) return "right";
  return "other";
}

// One motor's current bar. Bar normalized against CURRENT_FULL_LSB (the same scale VR haptics
// uses, shared from the SDK so the two can't drift); numeric readout converted to mA via
// currentMa() — EE reads this in real current, and a bare LSB count gave no way to judge
// whether a value was thermally reasonable for a given motor size (the ambiguity that hid the
// wrist_roll burnout, 2026-07).
function CurrentBar({ motorKey, raw }: { motorKey: string; raw: number }) {
  const mag = Math.abs(raw);
  const pct = Math.min(100, (mag / CURRENT_FULL_LSB) * 100);
  const isGrip = motorKey.includes("gripper");
  const tone = pct >= 80 ? "bg-nori-hd24a3d" : pct >= 40 ? "bg-nori-hc97929" : "bg-nori-hd98b3d";
  return (
    <div className="grid grid-cols-[minmax(6rem,auto)_1fr_5rem] items-center gap-3 rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 px-3 py-2">
      <span className={cn("truncate font-mono text-xs", isGrip ? "text-nori-h14131a" : "text-nori-h5c564b")}>
        {shortMotor(motorKey)}
      </span>
      <div className="h-1.5 overflow-hidden rounded-full bg-nori-he5e1d2">
        <div className={cn("h-full rounded-full transition-[width] duration-100", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right font-mono text-xs tabular-nums text-nori-h5c564b">
        {currentMa(mag).toFixed(0)} mA
      </span>
    </div>
  );
}

// Per-motor current bars, grouped by arm with a per-arm TOTAL current header. Within a group,
// grippers first (the primary grip-force signal), then the rest. The per-arm total is the sum
// of |Present_Current| across that arm's motors — a whole-arm draw an EE can watch for a joint
// that's quietly pinned against a stop (the wrist_roll failure mode: one joint sustaining ~900
// mA while the arm looks otherwise idle stands out in the total).
export function GripForce({ currents }: { currents: Record<string, number> }) {
  const keys = Object.keys(currents);
  if (keys.length === 0) {
    return <p className="font-mono text-xs text-nori-h857b6b">no current telemetry yet</p>;
  }

  // Order within a side: grippers first, then the rest alphabetically.
  const orderSide = (ks: string[]) => {
    const grip = ks.filter((k) => k.includes("gripper")).sort();
    const rest = ks.filter((k) => !k.includes("gripper")).sort();
    return [...grip, ...rest];
  };
  // Annotate the ARRAY LITERAL (not the .filter() result): filtering an annotated literal only
  // keeps `side` narrow if TS back-propagates the contextual type through the generic .filter
  // call, which it stops doing under enough type-instantiation load — widening `side` to `string`.
  // Typing the literal directly pins the union regardless.
  const allGroups: { side: "left" | "right" | "other"; label: string; keys: string[] }[] = [
    { side: "left", label: "Left arm", keys: orderSide(keys.filter((k) => armSide(k) === "left")) },
    { side: "right", label: "Right arm", keys: orderSide(keys.filter((k) => armSide(k) === "right")) },
    { side: "other", label: "Other", keys: orderSide(keys.filter((k) => armSide(k) === "other")) },
  ];
  const groups = allGroups.filter((g) => g.keys.length > 0);

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const totalRaw = g.keys.reduce((s, k) => s + Math.abs(currents[k] ?? 0), 0);
        return (
          <div key={g.side} className="space-y-1.5">
            <div className="flex items-baseline justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-nori-h857b6b">
                {g.label}
              </span>
              <span className="font-mono text-xs tabular-nums text-nori-h5c564b">
                {(currentMa(totalRaw) / 1000).toFixed(2)} A total
              </span>
            </div>
            {g.keys.map((k) => (
              <CurrentBar key={k} motorKey={k} raw={currents[k] ?? 0} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Per-motor problem state from the robot (telemetry status.motor_faults): each entry is either a
// hardware fault (servo error byte decoded — "overload,overheat (0x24)") or the exact sentinel
// "no response", meaning that motor DIDN'T ANSWER the bus (dropped / lost power). Renders one row
// per problem joint; nothing at all when every expected motor answers and is healthy — so it's
// invisible in normal operation. The distinction matters: a hardware fault (RED) is the servo
// reporting a real condition; "no response" (AMBER) is an absent motor, which would otherwise be
// indistinguishable from healthy — this panel is exactly what makes a dropped motor visible. The
// decoded fault string carries the raw 0xNN hex (authoritative; names are best-effort).
const MOTOR_NO_RESPONSE = "no response"; // sentinel the daemon sends for an unreadable motor

// Servo case temps (telemetry servo_temps, °C, 1 Hz — the robot's own over-temp sweep).
// Silent while everything is comfortably cool; from warnC up it lists the warm joints so an
// operator can watch one climb toward the torque cut and back off BEFORE it fires (cooling
// back under it takes minutes — see SAFETY.md 2026-08-07). Amber = warm, red = within 2 °C
// of the cut. Empty/missing map (old daemon, mock, guard disabled) renders nothing.
// Thresholds are per-model and come from the caller (servoThermalThresholds); the
// defaults are L2's, which is also the safe fallback for an unknown serial because
// its cut point is the lowest and therefore warns earliest.
export function ServoTemps(
  { temps, thresholds = servoThermalThresholds(null) }: {
    temps?: Record<string, number> | null;
    thresholds?: ServoThermalThresholds;
  },
) {
  const warm = temps
    ? Object.entries(temps).filter(([, t]) => t >= thresholds.warnC).sort((a, b) => b[1] - a[1])
    : [];
  if (warm.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-nori-h8f2318">
        {`Motor temperature (torque cuts at ${thresholds.cutC}°C)`}
      </span>
      {warm.map(([k, t]) => {
        const cls = t >= thresholds.hotC
          ? "border-nori-hd24a3d/40 bg-nori-hd24a3d/15 text-nori-h8f2318"
          : "border-nori-hdb9346/40 bg-nori-hfdf1de text-nori-h8a5a12";
        return (
          <div
            key={k}
            className={cn(
              "grid grid-cols-[minmax(6rem,auto)_1fr] items-center gap-3 rounded-md border px-3 py-2",
              cls,
            )}
          >
            <span className="truncate font-mono text-xs">{shortMotor(k)}</span>
            <span className="text-right font-mono text-xs">{t}°C</span>
          </div>
        );
      })}
    </div>
  );
}

// Full-width motor-fault banner, rendered with the other status banners above the
// fold. Faults used to live only as rows inside the telemetry card, where a
// stalled/dropped motor was easy to miss squeezed between the rail gauge and the
// temp list — a hardware fault is incident-grade information, same tier as
// "control offline" / "over temperature". amber = not responding (absent motor),
// red = servo-reported hardware fault (matches the row colors in MotorFaults).
export function MotorFaultsBanner({ faults }: { faults: Record<string, string> }) {
  const keys = faults ? Object.keys(faults).sort() : [];
  if (keys.length === 0) return null;
  const anyHardFault = keys.some((k) => faults[k] !== MOTOR_NO_RESPONSE);
  return (
    <div className={cn(
      "rounded-md border px-4 py-3",
      anyHardFault
        ? "border-nori-hd24a3d/35 bg-nori-hfde7e4 text-nori-ha3271c"
        : "border-nori-hdb9346/40 bg-nori-hfdf1de text-nori-h8a5a12",
    )}>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
        {anyHardFault ? "Motor fault" : "Motor not responding"}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
        {keys.map((k) => (
          <span key={k} className="font-mono">
            {shortMotor(k)}: {faults[k] === MOTOR_NO_RESPONSE ? "not responding" : faults[k]}
          </span>
        ))}
      </p>
    </div>
  );
}

export function MotorFaults({ faults }: { faults: Record<string, string> }) {
  // Defensive: an older SDK/daemon (or a pre-telemetry initial state) may not populate this;
  // never let a missing map crash the whole page.
  const keys = faults ? Object.keys(faults).sort() : [];
  if (keys.length === 0) return null;
  const anyDropped = keys.some((k) => faults[k] === MOTOR_NO_RESPONSE);
  return (
    <div className="space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-nori-h8f2318">
        {anyDropped ? "Motor faults / not responding" : "Motor faults"}
      </span>
      {keys.map((k) => {
        const dropped = faults[k] === MOTOR_NO_RESPONSE;
        // amber = not responding (absent motor), red = servo-reported hardware fault
        const cls = dropped
          ? "border-nori-hdb9346/40 bg-nori-hfdf1de text-nori-h8a5a12"
          : "border-nori-hd24a3d/40 bg-nori-hd24a3d/15 text-nori-h8f2318";
        return (
          <div
            key={k}
            className={cn(
              "grid grid-cols-[minmax(6rem,auto)_1fr] items-center gap-3 rounded-md border px-3 py-2",
              cls,
            )}
          >
            <span className="truncate font-mono text-xs">{shortMotor(k)}</span>
            <span className="text-right font-mono text-xs">
              {dropped ? "not responding" : faults[k]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Rail (lift) height per arm, from telemetry `state` `left_lift.pos`/`right_lift.pos` —
// real millimeters (~115.6 mm per encoder rev, Pi-side multi-turn tracker, m3_m5 §5.5). Zero
// is the pose at DAEMON START (startup-relative until stall-homing lands). The Pi OMITS the
// key whenever its tracker isn't valid (pre-first-read / desynced / that rail's direction
// never calibrated) — render as "unknown".
//
// SETUP ASSUMPTION (2026-07-03): the arms are ALWAYS parked at the TOP of the rails at
// daemon start, so boot pose (h≈0) IS the top and the carriage can only ever travel DOWN.
// That makes the old center-zero bar wrong (it reserved half the bar for "up", which never
// happens). We render a TOP-ANCHORED descent gauge: empty at the top (home), filling as the
// rail dives.
//
// This used to take |h| because the Pi's lift direction was unverified. It no longer is —
// direction is calibrated per unit (lift.hpp) and the Pi publishes depth-below-top directly —
// so railReading() clamps instead of mirroring, and a backwards rail now shows up as an
// obviously-pinned gauge rather than a plausible wrong number. See rail.ts.
//
// railReading() + RAIL_TRAVEL_MM moved to the SDK (packages/nori-sdk/src/rail.ts) when the 3D
// robot became shared with the headset: this gauge, the desktop 3D card and the in-VR model all
// derive the carriage height from that one function, so they can't drift. Re-exported here
// because existing callers import it from this module.
import { railReading, liftAxes, RAIL_TRAVEL_MM } from "@nori/sdk";
export { railReading, RAIL_TRAVEL_MM };

// `descriptor` resolves WHICH lifts this robot has and how far each travels. Omit it and you
// get the L-series pair at the 950 mm default, which is what a robot sending no descriptor is
// — so the frozen fleet renders exactly as before. Pass it and an A-series robot renders its
// one central column against its real advertised travel; without it that column is invisible
// (its key is the bare "lift.pos") and the gauge reads ~24% short.
export function RailHeight({
  state, descriptor,
}: { state: Record<string, number>; descriptor?: RobotDescriptor }) {
  const rails = liftAxes(descriptor);
  if (rails.length === 0) {
    // A robot that advertises no lift: say so, rather than draw a rail pinned at zero.
    return <p className="font-mono text-xs text-nori-h14131a/50">no rail on this robot</p>;
  }
  return (
    <div className="space-y-2">
      {rails.map(({ key, label, travelMm }) => {
        const { known, depthMm, frac } = railReading(state, key, travelMm);
        const pct = frac * 100;
        // orange through descent, darker mid, red as it approaches the bottom hard stop.
        const tone = frac >= 0.85 ? "bg-nori-hd24a3d" : frac >= 0.6 ? "bg-nori-hc97929" : "bg-nori-hd98b3d";
        const atTop = known && depthMm < 3;
        return (
          <div key={key} className="grid grid-cols-[minmax(6rem,auto)_1fr_6rem] items-center gap-3 rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 px-3 py-2">
            <span className="truncate font-mono text-xs text-nori-h14131a">{label}</span>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-nori-he5e1d2">
              {/* top-anchored descent gauge: fills from the left (top/home) as the rail dives */}
              {known && (
                <div
                  className={cn("absolute left-0 top-0 h-full rounded-full transition-[width] duration-100", tone)}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
            <span className="text-right font-mono text-xs text-nori-h5c564b">
              {!known ? "unknown" : atTop ? "top" : `↓ ${depthMm.toFixed(0)} mm`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-joint telemetry readout.
//
// The numeric surface for `tel.state` — until this existed, that dict fed the 3D
// viewer and a boolean ("has any joint telemetry") and nothing else, so "is this
// joint's key still arriving, and what does it actually read in radians?" was
// unanswerable from the UI. All derivation lives in jointTelemetry.ts; this is
// formatting only, in keeping with this file's props-driven rule.
//
// The three columns are three DIFFERENT facts and the labels say so:
//   seen   how recently the key was PRESENT in a frame  -> the flow signal
//   moved  how recently its value CHANGED               -> never an alarm; a
//          parked joint legitimately never changes
//   si     the robot's own calibrated conversion, or "—" when it publishes none
// Nothing here invents a conversion or a tone: with no session, or no data, every
// cell is a neutral dash.
import {
  advertisedStateKeys, buildJointRows, flowTone, groupJointRows, hasSiCalibration, keyCoverage,
  type FlowTone, type JointRow, type TelemetryFlowSample,
} from "@/nori/remote/jointTelemetry";

// Column grid, shared by the caption row and every data row so they line up. The
// table is wider than a 380px rail, so the card scrolls it horizontally rather
// than crushing the numbers (min-w below).
const JOINT_COLS =
  "grid grid-cols-[minmax(6rem,1.3fr)_3.75rem_minmax(2.5rem,1fr)_6.5rem_4.5rem_4rem_4.25rem] items-center gap-2";

const FLOW_TEXT: Record<FlowTone, string> = {
  default: "text-nori-h857b6b",
  good: "text-nori-h4d6a1e",
  warn: "text-nori-h8a5a12",
  bad: "text-nori-h8f2318",
};

// Ages are read at a glance, so sub-second resolution near zero and whole
// seconds once it stops mattering exactly.
function fmtAge(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}

const SI_WHY: Record<string, string> = {
  no_value: "no value for this key yet",
  no_ranges_si: "this robot publishes no calibrated SI bounds (ranges_si) for this key — no conversion is possible, and guessing one would be worse than none",
  bad_bounds: "this robot advertises unusable SI bounds for this key (degenerate or non-finite)",
};

function JointRowView({ row, active }: { row: JointRow; active: boolean }) {
  const tone = flowTone(row.flow?.sinceSeenMs ?? null, active);
  const hz = row.flow?.hz ?? 0;
  // Fresh keys show their RATE (the useful number while it's flowing); stale
  // ones show how long they've been gone (the useful number once it isn't).
  const seenText = tone === "default" ? "—" : tone === "good" ? `${hz.toFixed(0)} Hz` : fmtAge(row.flow?.sinceSeenMs ?? null);
  const si = row.si;
  return (
    <div
      className={cn(
        JOINT_COLS,
        "rounded-md border px-3 py-1.5",
        row.outOfRange
          ? "border-nori-hd24a3d/35 bg-nori-hd24a3d/10"
          : "border-nori-h14131a/10 bg-nori-hf3f1e8",
      )}
      title={
        `${row.key}` +
        (row.range ? ` · normalized ${row.range.lo}…${row.range.hi} (${row.range.source})` : " · no known normalized range") +
        (row.flow?.sinceSeenMs != null ? ` · last seen ${fmtAge(row.flow.sinceSeenMs)} ago at ${hz.toFixed(1)} Hz` : " · never seen") +
        (row.flow?.sinceChangedMs != null ? ` · last changed ${fmtAge(row.flow.sinceChangedMs)} ago` : " · no change observed") +
        (row.advertised ? "" : " · NOT advertised by the descriptor")
      }
    >
      <span className="truncate font-mono text-xs text-nori-h14131a">{row.label}</span>
      <span className="text-right font-mono text-xs tabular-nums text-nori-h5c564b">
        {row.value === null ? "—" : row.value.toFixed(1)}
      </span>
      <div className="h-1.5 overflow-hidden rounded-full bg-nori-he5e1d2">
        {row.barFrac !== null && (
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-150",
              row.outOfRange ? "bg-nori-hd24a3d" : "bg-nori-hd98b3d",
            )}
            style={{ width: `${row.barFrac * 100}%` }}
          />
        )}
      </div>
      <span
        className="text-right font-mono text-xs tabular-nums text-nori-h5c564b"
        title={si.known ? undefined : SI_WHY[si.reason]}
      >
        {/* Unit on every row: the lift is millimetres and everything else is
            radians, so a bare number would be two different quantities in one
            column. */}
        {!si.known ? "—" : si.unit === "mm" ? `${si.value.toFixed(0)} mm` : `${si.value.toFixed(3)} rad`}
      </span>
      <span className="text-right font-mono text-xs tabular-nums text-nori-h5c564b">
        {si.known && si.deg !== null ? `${si.deg.toFixed(1)}°` : "—"}
      </span>
      <span className={cn("text-right font-mono text-xs tabular-nums", FLOW_TEXT[tone])}>{seenText}</span>
      <span className="text-right font-mono text-xs tabular-nums text-nori-h857b6b">
        {fmtAge(row.flow?.sinceChangedMs ?? null)}
      </span>
    </div>
  );
}

/**
 * Per-joint telemetry table: value, physical value, position in range, and
 * whether the key is still FLOWING.
 *
 * `sample` is a THROTTLED snapshot (see the sampler in layout/blocks.tsx) — this
 * component must never be handed the raw 15 Hz stream. `active` = a session is
 * live; with it false every flow tone stays neutral, because "not arriving" is
 * not a fault when nobody is sending.
 */
export function JointTelemetry({
  sample, descriptor, active,
}: {
  sample: TelemetryFlowSample | null;
  descriptor?: RobotDescriptor | null;
  active: boolean;
}) {
  const rows = buildJointRows(sample, descriptor);
  const advertised = advertisedStateKeys(descriptor);
  const coverage = keyCoverage(sample, advertised);
  const groups = groupJointRows(rows);
  // "Nothing ever arrived" and "nothing arrived lately" are different states and
  // only the second one is a fault.
  const everArrived = (sample?.totalFrames ?? 0) > 0;
  const siCalibrated = hasSiCalibration(descriptor);
  const frameHz = sample?.frameHz ?? 0;

  if (rows.length === 0) {
    return (
      <p className="font-mono text-xs text-nori-h857b6b">
        no joint telemetry, and no descriptor describing which joints to expect
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {/* Measured HERE, on frames that actually reached this browser — not the
            robot's own loop_hz claim, which the vitals chips already show. */}
        <Stat
          dense
          label="frames"
          value={everArrived ? `${frameHz.toFixed(1)} Hz` : "—"}
          tone={!active || !everArrived ? "default" : frameHz >= 10 ? "good" : frameHz >= 4 ? "warn" : "bad"}
        />
        <Stat
          dense
          label="keys"
          value={
            everArrived
              ? `${coverage.arriving.length}${advertised.length > 0 ? ` / ${advertised.length}` : ""}`
              : advertised.length > 0 ? `— / ${advertised.length}` : "—"
          }
          tone={
            !active || !everArrived ? "default"
              : coverage.missing.length > 0 ? "bad"
              : advertised.length > 0 ? "good" : "default"
          }
        />
        {/* Not a fault tone in either direction: the frozen L-series fleet never
            ships ranges_si, and that is a fact about the robot, not a problem.
            Blank with no session — pre-connect the descriptor is a serial-derived
            stand-in, which carries no calibration and must not be read as the
            robot having declined to send one. */}
        <Stat dense label="si units" value={!active ? "—" : siCalibrated ? "calibrated" : "not advertised"} />
      </div>

      {!everArrived && (
        <p className="font-mono text-xs text-nori-h857b6b">
          {active
            ? "no telemetry frames received yet — the rows below are the joints this robot advertises"
            : "not connected — the rows below are the joints this robot advertises, with no readings"}
        </p>
      )}

      {/* The failure this panel exists for: a joint the robot promised whose key
          has stopped arriving. Named explicitly, never just counted. */}
      {active && everArrived && coverage.missing.length > 0 && (
        <p className="rounded-md border border-nori-hd24a3d/35 bg-nori-hd24a3d/15 px-3 py-2 font-mono text-xs text-nori-h8f2318">
          not arriving: {coverage.missing.join(", ")}
        </p>
      )}
      {coverage.unadvertised.length > 0 && (
        <p className="font-mono text-[11px] text-nori-h857b6b">
          arriving but not advertised: {coverage.unadvertised.join(", ")}
        </p>
      )}
      {active && !siCalibrated && (
        <p className="font-mono text-[11px] text-nori-h857b6b">
          this robot publishes no calibrated SI bounds (ranges_si) — normalized values only, no
          radians. Nothing is substituted for them.
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[36rem] space-y-3">
          <div className={cn(JOINT_COLS, "px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-nori-h857b6b")}>
            <span>joint</span>
            <span className="text-right">norm</span>
            <span>range</span>
            <span className="text-right">si</span>
            <span className="text-right">deg</span>
            <span className="text-right" title="how recently this key was PRESENT in a frame — the flow signal">seen</span>
            <span className="text-right" title="how recently this key's VALUE changed. A joint held still legitimately never changes; this is never treated as a fault.">moved</span>
          </div>
          {groups.map((g) => (
            <div key={g.side} className="space-y-1.5">
              <span className="px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-nori-h857b6b">
                {g.label}
              </span>
              {g.rows.map((r) => (
                <JointRowView key={r.key} row={r} active={active} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Hover question mark carrying the rail-gauge explainer — rendered next to the card
// heading (pages/remote.tsx) so the card itself stays compact.
export function RailHeightHelp() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-nori-h857b6b hover:text-nori-h14131a" aria-label="How to read the rail gauge">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs">
        0 = top of rail (start pose); bar fills as the carriage descends. Full scale ={" "}
        {RAIL_TRAVEL_MM} mm travel. “unknown” = tracker not valid.
      </TooltipContent>
    </Tooltip>
  );
}

// A pulsing "on air" dot + label. Bright red when live, dim otherwise.
function OnAir({ live, label }: { live: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          live ? "animate-pulse bg-red-500" : "bg-muted-foreground/40"
        )}
      />
      <span className={live ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}

// Two-way call bar (Phase 7 §B/C5). Deliberately minimal — the front-end team will redo the
// visuals; this exists so every control + indicator we need is wired and exercisable:
//   join/leave, mic mute, operator + robot "on air" indicators, and (M6-gated) camera toggle.
// `micSending === false` while active means the robot hasn't offered an audio uplink yet
// (Pi M3 pending) — surfaced so it's obvious the mic is captured but not transmitting.
export function CallBar({
  call,
  running,
  connected,
  m6,
  volume,
  onVolumeChange,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleCamera,
  recording = false,
}: {
  call: CallState;
  running: boolean;
  connected: boolean;
  m6: boolean;
  volume: number; // robot inbound audio playback gain, 0..1
  onVolumeChange: (v: number) => void;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  recording?: boolean; // robot recorder capturing an episode — joining a call is blocked
}) {
  // Speaker icon toggles a compact inline slider; opening it widens the group so the
  // you/nori indicators shift slightly left.
  const [volumeOpen, setVolumeOpen] = useState(false);
  // In-call the three buttons + the you/nori indicators have to share a 400px rail, so once the
  // call is up the labels shorten ("Leave call" -> "Leave") and the icon gap tightens. The
  // pre-call state has only one button and keeps its full label. Titles carry the long form.
  return (
    <div className="flex flex-wrap items-center gap-2 text-nori-h14131a">
      {/* Status on the left, actions on the right — same hand as the // controls strip, where the
          mode pills sit right-aligned. */}
      <div className="flex flex-wrap items-center gap-3">
        {/* "you" = your mic is hot (unmuted); the badge below says whether it reaches the robot.
            The mic glyph mirrors the outbound mic state at a glance. */}
        <span className="flex items-center gap-1.5">
          <OnAir live={call.active && !call.micMuted} label="you" />
          {call.active && !call.micMuted
            ? <Mic className="h-3.5 w-3.5 text-nori-h14131a" />
            : <MicOff className="h-3.5 w-3.5 text-muted-foreground/60" />}
        </span>
        <span className="flex items-center gap-1.5">
          {/* robotAudio only says a track is ATTACHED — a robot-side mute (W2.5: robots
              boot muted) still drops the audio, so don't glow "on air" while muted. */}
          <OnAir live={(call.robotMicLive || call.robotAudio) && !call.robotMicMuted} label="nori" />
          {/* Same two tones as the mic glyph beside "you": ink when audible, dim when muted. */}
          <button
            type="button"
            className={volume === 0 ? "text-muted-foreground/60 hover:text-nori-h14131a" : "text-nori-h14131a"}
            title="Robot audio volume"
            onClick={() => setVolumeOpen((v) => !v)}
          >
            {volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          {volumeOpen && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-nori-h14131a"
              title="Robot audio volume"
            />
          )}
        </span>
        {call.active && !call.micMuted && !call.micSending && (
          <Badge variant="outline" className="text-[10px]">mic local-only (Pi M3 pending)</Badge>
        )}
        {/* W2.5 consent UX: robots ship muted-by-default; only someone physically at the
            robot can unmute (kiosk / mute button). Tell the operator that instead of
            leaving a silently dead robot mic. */}
        {call.robotMicMuted && (
          <Badge
            variant="outline"
            // whitespace-nowrap so the long copy can't wrap INSIDE the badge — that's what made it
            // balloon to two/three lines once a call filled the row. The short label fits on one
            // line; the full explanation moved to the tooltip.
            className="whitespace-nowrap text-[10px]"
            title="The robot's microphone is muted on the robot itself. Only a person at the robot can unmute it — from the robot's screen or its mute button."
          >
            <MicOff className="mr-1 h-3 w-3" /> Robot muted: unmute on the robot
          </Badge>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {!call.active ? (
          recording ? (
            // Recording a training dataset: a call starting mid-capture risks the P10S amp's
            // inrush tripping USB over-current and browning out the cameras (rpi5/media/README.md
            // "USB power budget"), which would corrupt the take — so block it and say why.
            // A native title won't show on a disabled control, so use the (?) HelpTip tooltip
            // pattern with the trigger on the wrapping span (a disabled Pill can't emit hover).
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={0}>
                  <Pill
                    disabled
                    aria-disabled
                    className="inline-flex items-center pointer-events-none opacity-50"
                  >
                    <Phone className="mr-2 h-4 w-4" /> Join call
                  </Pill>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-xs">
                Call is disabled while recording training datasets.
              </TooltipContent>
            </Tooltip>
          ) : (
            // Same Pill as the Keyboard / Leader arm / VR mode strip below — this is the audio
            // card's one action, and it sits in the same right-hand column, so it should read as
            // the same kind of control rather than a differently-shaped button.
            <Pill
              onClick={onJoin}
              disabled={!running || !connected}
              title="Capture your mic and join the two-way audio call"
              className="inline-flex items-center"
            >
              <Phone className="mr-2 h-4 w-4" /> Join call
            </Pill>
          )
        ) : (
          <>
            <Button size="sm" variant="destructive" onClick={onLeave} title="Leave the audio call">
              <PhoneOff className="mr-1.5 h-4 w-4" /> Leave
            </Button>
            <Button size="sm" variant={call.micMuted ? "secondary" : "default"} onClick={onToggleMute}
              title={call.micMuted ? "Unmute your mic" : "Mute your mic"}>
              {call.micMuted
                ? <><MicOff className="mr-1.5 h-4 w-4" /> Unmute</>
                : <><Mic className="mr-1.5 h-4 w-4" /> Mute</>}
            </Button>
            {m6 && (
              <Button size="sm" variant={call.cameraOn ? "default" : "secondary"} onClick={onToggleCamera}
                title={call.cameraOn ? "Turn your camera off" : "Turn your camera on"}>
                {call.cameraOn
                  ? <><VideoOff className="mr-1.5 h-4 w-4" /> Camera</>
                  : <><Video className="mr-1.5 h-4 w-4" /> Camera</>}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// A single key cap.
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-b-2 bg-muted px-1.5 py-0.5 font-mono text-xs leading-none">
      {children}
    </kbd>
  );
}

// DOF names arrive straight from the SDK's axis maps, which are code identifiers
// ("shoulder_pan"). Underscores are for the wire, not the operator.
const dofLabel = (dof: string) => dof.replace(/_/g, " ");

export function ControlLegend({ mode, jointShorts, descriptor }: {
  mode: ControlMode;
  // Descriptor-driven joints (L3): the legend renders the SAME dynamic map
  // the jog stream uses. Omitted/null (every L2) -> the legacy legend.
  jointShorts?: string[] | null;
  // Full descriptor (A3): with jog_scale.task advertised the task legend shows
  // yaw/z. Omitted/null (every L2) -> the legacy cylindrical legend.
  descriptor?: RobotDescriptor | null;
}) {
  const legend = keybindLegend(mode, jointShorts, descriptor);
  const taskLabel = taskModeLabel(descriptor);
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">Arm</span>
        <span className="whitespace-nowrap text-muted-foreground">press <Key>M</Key> to toggle mode</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-nori-h857b6b hover:text-nori-h14131a" aria-label="What the two modes mean">
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-xs">
            {taskLabel === "cartesian"
              ? "Cartesian jogs x/y/z (yaw turns); Motor allows per-motor control"
              : "Cylindrical maps to x/y/z; Motor allows per-motor control"}
          </TooltipContent>
        </Tooltip>
      </div>
      {/* No whitespace-nowrap here: the DOF names come from the SDK's axis maps and the long ones
          ("shoulder_pan") overflowed their grid cell and ran under the next cell's keycaps.
          Letting the label wrap inside its own cell keeps it legible instead of hidden. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {legend.arm.map((r) => (
          <div key={r.dof} className="flex min-w-0 items-center gap-1.5">
            <Key>{r.posKey.toUpperCase()}</Key><Key>{r.negKey.toUpperCase()}</Key>
            <span className="text-muted-foreground">{dofLabel(r.dof)}</span>
          </div>
        ))}
      </div>
      <BaseCommandLegend />
      <p className="text-muted-foreground">
        Click the video first so the page has keyboard focus. Keys are ignored while typing in a field.
      </p>
    </div>
  );
}

// One base drive cluster rendered as a physical keypad — forward on top, turn-left /
// reverse / turn-right below (the traditional WASD inverted-T).
function BaseKeypad({ cluster }: { cluster: BaseKeyCluster }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Key>{cluster.forward.toUpperCase()}</Key>
      <div className="flex gap-1">
        <Key>{cluster.left.toUpperCase()}</Key>
        <Key>{cluster.back.toUpperCase()}</Key>
        <Key>{cluster.right.toUpperCase()}</Key>
      </div>
    </div>
  );
}

// Base + lift + command keybinds only — shared between the keyboard legend above and the
// Leader card (where the arms follow the leader hardware but base/lift/commands stay on
// the keyboard). These bindings don't vary with the arm control mode.
// `wasd` also shows the WASD alias keypad — only pass it where WASD really reaches the
// base (the Leader card): with the keyboard driving the arms, WASD belongs to the arm.
export function BaseCommandLegend({ hint, wasd }: { hint?: string; wasd?: boolean }) {
  const legend = keybindLegend("cylindrical");
  const clusters = wasd ? baseKeyClusters() : baseKeyClusters().slice(0, 1);
  return (
    <div className="space-y-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="w-full font-medium">Base</span>
        {clusters.map((c, i) => (
          <div key={c.forward} className="flex items-center gap-3">
            {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
            <BaseKeypad cluster={c} />
          </div>
        ))}
        <span className="text-muted-foreground">forward / reverse, turn left / right</span>
        <div className="flex items-center gap-1.5">
          <Key>{legend.lift.posKey.toUpperCase()}</Key><Key>{legend.lift.negKey.toUpperCase()}</Key>
          <span className="text-muted-foreground">{dofLabel(legend.lift.dof)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">Commands</span>
        {legend.commands.map((c) => (
          <div key={c.key} className="flex items-center gap-1.5 whitespace-nowrap">
            <Key>{c.key}</Key><span className="text-muted-foreground">{c.label}</span>
          </div>
        ))}
        {/* ENTER switches the active follower arm. It's a UI selection, not a robot command, so
            it isn't in the SDK's keybind legend — but the operator doesn't care about that
            distinction, and it belongs with the other keys they can press. */}
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <Key>ENTER</Key><span className="text-muted-foreground">switch arm</span>
        </div>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
