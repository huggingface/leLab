// NORI: tests for alertState.ts — alert frames are state keyed on code.
import { describe, expect, it } from "vitest";
import type { RobotAlert } from "@nori/sdk";
import { EMPTY_ALERTS, activeAlerts, alertHeadline, applyAlert } from "./alertState";

const halt = (message: string, active = true): RobotAlert =>
  ({ code: "servo_halt", severity: active ? "warning" : "info", active, message });

describe("servo_halt on 0003, 2026-11-23 07:29", () => {
  // Gateway sequence: right arm collision halt, then left, then both clear.
  const RIGHT = "right arm stopped: it would collide with itself or the robot body. Jog it away from the contact to continue.";
  const LEFT = "left arm stopped: it would collide with itself or the robot body. Jog it away from the contact to continue.";

  it("shows the halt, replaces it under the same code, and clears on active:false", () => {
    let alerts = applyAlert(EMPTY_ALERTS, halt(RIGHT));
    expect(activeAlerts(alerts).map((a) => a.message)).toEqual([RIGHT]);
    alerts = applyAlert(alerts, halt(LEFT));          // same code: replaced, not stacked
    expect(activeAlerts(alerts).map((a) => a.message)).toEqual([LEFT]);
    alerts = applyAlert(alerts, halt("Arm motion resumed", false));
    expect(activeAlerts(alerts)).toEqual([]);
    expect(alerts).toBe(applyAlert(alerts, halt("Arm motion resumed", false))); // clear twice: no-op
  });

  it("is idempotent on re-sent state", () => {
    const once = applyAlert(EMPTY_ALERTS, halt(RIGHT));
    expect(applyAlert(once, halt(RIGHT))).toBe(once);
  });

  it("orders critical before warning before info and keeps codes independent", () => {
    let alerts = applyAlert(EMPTY_ALERTS, halt(RIGHT));
    alerts = applyAlert(alerts, { code: "servo_thermal", severity: "critical", active: true, message: "left elbow at 61 C" });
    alerts = applyAlert(alerts, { code: "task_jog_limit", severity: "info", active: true, message: "solving" });
    expect(activeAlerts(alerts).map((a) => a.code)).toEqual(["servo_thermal", "servo_halt", "task_jog_limit"]);
    alerts = applyAlert(alerts, { code: "servo_thermal", severity: "info", active: false, message: "ok" });
    expect(activeAlerts(alerts).map((a) => a.code)).toEqual(["servo_halt", "task_jog_limit"]);
  });

  it("names the condition for known codes and stays generic for unknown ones", () => {
    expect(alertHeadline(halt(RIGHT))).toMatch(/motion safety/);
    expect(alertHeadline({ code: "something_new", severity: "warning", active: true, message: "x" })).toBe("Robot notice");
    expect(alertHeadline({ code: "something_new", severity: "critical", active: true, message: "x" })).toBe("Robot alert");
  });

  it("ignores frames without a code", () => {
    expect(applyAlert(EMPTY_ALERTS, { code: "", severity: "warning", active: true, message: "x" })).toBe(EMPTY_ALERTS);
  });
});
