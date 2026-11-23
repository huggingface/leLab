// NORI: robot operator alerts (spec daemon/alert.json) as UI state.
//
// The gateway sends `alert` frames for conditions the operator has to act on
// and that no other field carries: a MoveIt Servo halt (self-collision, joint
// bound, singularity: `servo_halt`), the servo thermal band (`servo_thermal`),
// a refused Cartesian jog (`task_jog_limit`). They are STATE keyed on `code`:
// a later frame with the same code replaces the earlier one, `active: false`
// clears it, and the robot may re-send the current state at any time. Until
// 2026-11-23 the app never wired the SDK's onAlert, so every one of these was
// logged and dropped — a self-collision looked like a frozen arm with no reason.
import type { RobotAlert } from "@nori/sdk";

export type AlertMap = Readonly<Record<string, RobotAlert>>;

export const EMPTY_ALERTS: AlertMap = Object.freeze({});

// Fold one frame into the map. Idempotent: re-sent state is a no-op.
export function applyAlert(alerts: AlertMap, alert: RobotAlert): AlertMap {
  if (!alert.code) return alerts;
  if (!alert.active) {
    if (!(alert.code in alerts)) return alerts;
    const next = { ...alerts };
    delete next[alert.code];
    return next;
  }
  const prev = alerts[alert.code];
  if (prev && prev.message === alert.message && prev.severity === alert.severity) return alerts;
  return { ...alerts, [alert.code]: alert };
}

// Render order: critical first, then warning, then info; stable by code within a severity.
const RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export function activeAlerts(alerts: AlertMap): RobotAlert[] {
  return Object.values(alerts).sort((a, b) =>
    (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3) || a.code.localeCompare(b.code));
}

// Operator-facing eyebrow per code; unknown codes get a generic one, and the
// robot's `message` is always rendered verbatim beneath it.
export function alertHeadline(alert: RobotAlert): string {
  switch (alert.code) {
    case "servo_halt": return "Arm stopped by the motion safety monitor";
    case "servo_thermal": return "Servo temperature";
    case "task_jog_limit": return "Cartesian jog limit";
    default: return alert.severity === "critical" ? "Robot alert" : "Robot notice";
  }
}
