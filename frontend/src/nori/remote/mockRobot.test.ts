// NORI: Additive (SDK v1 mock mode). Node-side coverage for the mock's pure halves:
// MockDaemonSim (wire behavior: ack shape, jog integration, clamps, E-STOP latch, watchdog,
// action lifecycle) and the loopback signaling bus (delivery, ordering, close semantics).
// The browser shell (mock/robot.ts: WebRTC + canvas) is exercised by the examples/mock page,
// not here — Node has no RTCPeerConnection.
import { describe, expect, it } from "vitest";
import { MockDaemonSim, createLoopbackSignaling } from "@nori/sdk/mock";
import { parseAck } from "@nori/sdk";

const jogFrame = (arm: Record<string, number>, base?: { linear: number; angular: number }) => ({
  type: "control",
  seq: 1,
  jog: { right_arm: arm, ...(base ? { base } : {}) },
});

// Advance the sim from `fromMs` to `toMs`, refreshing a (neutral) control frame each slice so the
// watchdog stays fed — i.e. what a connected operator's 50 Hz jog stream does. Tests that just
// jump the clock are testing the watchdog, not the behavior under test.
function drive(sim: MockDaemonSim, fromMs: number, toMs: number, stepMs = 50): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    sim.handleFrame({ type: "control", seq: t, jog: {} }, t);
    out.push(...sim.tick(t));
  }
  return out;
}

describe("MockDaemonSim ack", () => {
  it("emits a fixture-shaped ack the SDK's parseAck accepts", () => {
    const sim = new MockDaemonSim();
    const info = parseAck(sim.ackFrame());
    expect(info.accepted).toBe(true);
    expect(info.protocolVersion).toBe(1);
    expect(info.normMode).toBe("range_m100_100");
    expect(info.watchdogProfile).toEqual({ t_warn_ms: 300, t_stop_ms: 1000 });
    expect(info.descriptor?.joints).toHaveLength(12);
    expect(info.descriptor?.cameras).toEqual(["front", "left_wrist", "right_wrist", "overhead"]);
    expect(info.initialState?.["right_arm_gripper.pos"]).toBe(30);
  });

  it("camera layout covers every camera in a grid", () => {
    const layout = new MockDaemonSim().cameraLayoutFrame()!;
    expect(layout.cols).toBe(2);
    expect(layout.rows).toBe(2);
    expect(layout.tiles).toHaveLength(4);
  });

  it("single-camera robots send no layout (matches the bridge)", () => {
    const sim = new MockDaemonSim({
      descriptor: { joints: ["right_arm_gripper.pos"], cameras: ["front"], ranges: {} },
    });
    expect(sim.cameraLayoutFrame()).toBeNull();
  });

  it("reports currents only for motors the descriptor actually has", () => {
    const sim = new MockDaemonSim({
      descriptor: { joints: ["left_arm_gripper.pos"], cameras: ["front"], ranges: {} },
    });
    const tel = sim.tick(0).find((f) => f.type === "telemetry")!;
    expect(Object.keys(tel.currents as Record<string, number>)).toEqual(["left_arm_gripper"]);
  });
});

describe("MockDaemonSim sensors", () => {
  it("advertises, configures, and rate-limits deterministic LiDAR/IMU frames", () => {
    const sim = new MockDaemonSim();
    expect(sim.ackFrame().capabilities).toContain("sensor_streams");
    const reply = sim.handleFrame({
      type: "sensor_stream",
      request_id: "f4283fa1-5a3b-4295-99d5-3f6baf87b04d",
      action: "configure",
      lidar_hz: 5,
      imu_hz: 20,
      lidar_max_points: 32,
    }, 0)[0];
    expect(reply).toMatchObject({
      type: "sensor_stream_status", ok: true,
      lidar_hz: 5, imu_hz: 20, lidar_max_points: 32,
    });
    const first = sim.tick(0);
    expect(first.find((frame) => frame.type === "lidar_scan")?.ranges_m)
      .toHaveLength(32);
    expect(first.find((frame) => frame.type === "imu"))
      .toMatchObject({ frame_id: "imu_link", linear_acceleration_m_s2: [0, 0, 9.81] });
    expect(sim.tick(20).some((frame) => frame.type === "imu")).toBe(false);
    expect(sim.tick(50).some((frame) => frame.type === "imu")).toBe(true);
    expect(sim.tick(100).some((frame) => frame.type === "lidar_scan")).toBe(false);
    expect(sim.tick(200).some((frame) => frame.type === "lidar_scan")).toBe(true);
  });
});

describe("MockDaemonSim navigation request history", () => {
  const nav = (sim: MockDaemonSim, requestId: string, extra: Record<string, unknown>) =>
    sim.handleFrame({ type: "navigation", request_id: requestId, ...extra }, 0)[0];
  // UUID-shaped, because the real gateway drops a request_id that is not a UUID.
  const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

  it("drops a request_id that is not a UUID, as the gateway does", () => {
    const sim = new MockDaemonSim();
    expect(nav(sim, "not-a-uuid", { action: "status" })).toBeUndefined();
    expect(sim.handleFrame(
      { type: "sensor_stream", request_id: "nope", action: "status" }, 0)).toEqual([]);
  });

  it("replays a cached reply, then re-runs once the gateway would have evicted it", () => {
    const sim = new MockDaemonSim();
    const id = uuid(1);

    expect(nav(sim, id, { action: "remember_waypoint", name: "Dock" }))
      .toMatchObject({ ok: true, name: "Dock", replaced: false });
    // A retry inside the history window is idempotent — the same reply, not a re-run.
    expect(nav(sim, id, { action: "remember_waypoint", name: "Dock" }))
      .toMatchObject({ ok: true, replaced: false });

    // Push that reply out of the 256-entry window the gateway actually keeps.
    for (let i = 0; i < 256; i++) nav(sim, uuid(100 + i), { action: "status" });

    // Same request_id, but the robot no longer remembers answering it, so it runs
    // again — and the waypoint exists now. This is the real retry edge the mock used
    // to hide behind an unbounded cache.
    expect(nav(sim, id, { action: "remember_waypoint", name: "Dock" }))
      .toMatchObject({ ok: true, replaced: true });
  });
});

describe("MockDaemonSim motion", () => {
  it("integrates a joint-mode jog at the configured rate and reports it in telemetry", () => {
    const sim = new MockDaemonSim({ jogUnitsPerS: 60 });
    sim.tick(0);
    sim.handleFrame(jogFrame({ shoulder_pan: 1.0 }), 0);
    const frames = sim.tick(100); // 0.1 s at rate 1 -> +6 units
    const tel = frames.find((f) => f.type === "telemetry")!;
    const state = tel.state as Record<string, number>;
    expect(state["right_arm_shoulder_pan.pos"]).toBeCloseTo(6, 1);
    expect((tel.currents as Record<string, number>)["right_arm_shoulder_pan"]).toBeGreaterThan(0);
  });

  it("maps cylindrical task dofs onto joints so motion is visible", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    sim.handleFrame(jogFrame({ x: 1.0 }), 0);
    sim.tick(100);
    expect(sim.state()["right_arm_elbow_flex.pos"]).toBeGreaterThan(0);
  });

  it("clamps at descriptor ranges (clamp-don't-reject)", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    // Keep control frames fresh (inside the watchdog window) while driving well past the
    // [0,100] gripper ceiling: 3 s at full rate would be +180 unclamped.
    for (let t = 0; t <= 3000; t += 100) {
      sim.handleFrame(jogFrame({ gripper: 1.0 }), t);
      sim.tick(t + 50);
    }
    expect(sim.state()["right_arm_gripper.pos"]).toBe(100);
  });

  it("applies base jog as velocities, not integration", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    sim.handleFrame(jogFrame({}, { linear: 0.3, angular: 0 }), 0);
    sim.tick(50);
    expect(sim.state()["x.vel"]).toBe(0.3);
  });

  it("stops the base when a jog frame omits `base` (released key must not latch)", () => {
    // The SDK's keyboard path drops the base key entirely once no base key is held, so absence
    // means stop. Latching here would drive the mock's base away forever.
    const sim = new MockDaemonSim();
    sim.tick(0);
    sim.handleFrame(jogFrame({}, { linear: 0.5, angular: 0.2 }), 0);
    sim.tick(50);
    expect(sim.state()["x.vel"]).toBe(0.5);
    sim.handleFrame(jogFrame({ shoulder_pan: 0 }), 100); // key released: no base key at all
    sim.tick(150);
    expect(sim.state()["x.vel"]).toBe(0);
    expect(sim.state()["theta.vel"]).toBe(0);
  });
});

describe("MockDaemonSim safety", () => {
  it("estop latches (both wire shapes), freezes motion, reset_latch clears", () => {
    for (const cmd of [{ type: "command", name: "estop" }, { type: "command", estop: true }]) {
      const sim = new MockDaemonSim();
      sim.tick(0);
      sim.handleFrame(jogFrame({ shoulder_pan: 1.0 }, { linear: 0.5, angular: 0 }), 0);
      sim.tick(100);
      sim.handleFrame(cmd, 100);
      const before = sim.state()["right_arm_shoulder_pan.pos"];
      sim.handleFrame(jogFrame({ shoulder_pan: 1.0 }), 150);
      const frames = sim.tick(300);
      const status = (frames.find((f) => f.type === "telemetry")!.status ?? {}) as Record<string, unknown>;
      expect(status.safety).toBe("latched");
      expect(status.latch_reason).toBe("estop");
      expect(sim.state()["right_arm_shoulder_pan.pos"]).toBe(before);
      expect(sim.state()["x.vel"]).toBe(0);

      sim.handleFrame({ type: "command", name: "reset_latch" }, 400);
      const after = sim.tick(500).find((f) => f.type === "telemetry")!;
      expect((after.status as Record<string, unknown>).safety).toBe("ok");
    }
  });

  it("watchdog stops the base after control silence and recovers on the next frame", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    sim.handleFrame(jogFrame({}, { linear: 0.5, angular: 0 }), 0);
    sim.tick(100);
    expect(sim.state()["x.vel"]).toBe(0.5);
    const frames = sim.tick(1500); // > t_stop_ms of silence
    const status = (frames.find((f) => f.type === "telemetry")!.status ?? {}) as Record<string, unknown>;
    expect(status.watchdog).toBe("stop");
    expect(sim.state()["x.vel"]).toBe(0);
    sim.handleFrame(jogFrame({}, { linear: 0.2, angular: 0 }), 1600);
    const rec = sim.tick(1700).find((f) => f.type === "telemetry")!;
    expect((rec.status as Record<string, unknown>).watchdog).toBe("ok");
  });

  it("watchdog stop drops all intent and fails the in-flight action with timeout/watchdog_stop", () => {
    // The gateway drops ALL intent on the stop transition and emits a timeout verdict for
    // every open action (motion.py _update_watchdog + _drop_all_intent): a stale target must
    // never resume on its own. This sim used to freeze-and-RESUME instead, which taught
    // link-loss recovery code the exact opposite of hardware behavior.
    const sim = new MockDaemonSim({ actionUnitsPerS: 20 });
    sim.tick(0);
    sim.handleFrame({ type: "control", action: { "right_arm_shoulder_pan.pos": 90 }, action_id: "w1" }, 0);
    sim.tick(100);
    const posAtStop = sim.state()["right_arm_shoulder_pan.pos"];
    // Go silent well past t_stop_ms: motion halts and the action gets ONE timeout verdict.
    const frames = [...sim.tick(2000), ...sim.tick(4000), ...sim.tick(6000)];
    expect((frames.find((f) => f.type === "telemetry")!.status as Record<string, unknown>).watchdog).toBe("stop");
    expect(frames.filter((f) => f.type === "action_status")).toEqual([
      expect.objectContaining({ action_id: "w1", state: "timeout", reason: "watchdog_stop" }),
    ]);
    expect(sim.state()["right_arm_shoulder_pan.pos"]).toBe(posAtStop);

    // Control returns -> safe hold clears (no latch), but the DEAD action must not resume:
    // the arm stays put until the app re-commands.
    const resumed = drive(sim, 6100, 12000);
    expect(resumed.filter((f) => f.type === "action_status")).toEqual([]);
    expect(sim.state()["right_arm_shoulder_pan.pos"]).toBe(posAtStop);
    const last = resumed.filter((f) => f.type === "telemetry").at(-1)!;
    expect((last.status as Record<string, unknown>).watchdog).toBe("ok");
  });
});

describe("MockDaemonSim actions", () => {
  it("runs the accepted -> active -> done lifecycle and slews to target", () => {
    const sim = new MockDaemonSim({ actionUnitsPerS: 100 });
    sim.tick(0);
    const replies = sim.handleFrame(
      { type: "control", action: { "right_arm_shoulder_pan.pos": 50 }, action_id: "a1" },
      0
    );
    expect(replies).toEqual([expect.objectContaining({ type: "action_status", action_id: "a1", state: "accepted" })]);
    const mid = sim.tick(100).filter((f) => f.type === "action_status");
    expect(mid).toEqual([expect.objectContaining({ action_id: "a1", state: "active" })]);
    const end = drive(sim, 150, 1500).filter((f) => f.type === "action_status");
    expect(end).toEqual([expect.objectContaining({ action_id: "a1", state: "done" })]);
    expect(sim.state()["right_arm_shoulder_pan.pos"]).toBe(50);
  });

  it("reports clamped when a target exceeds the range", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    sim.handleFrame({ type: "control", action: { "right_arm_gripper.pos": 250 }, action_id: "a2" }, 0);
    const end = drive(sim, 50, 2000).filter((f) => f.type === "action_status");
    expect(end).toContainEqual(expect.objectContaining({ action_id: "a2", state: "clamped" }));
    expect(sim.state()["right_arm_gripper.pos"]).toBe(100);
  });

  it("blocks actions while latched, with the gateway's reason string", () => {
    const sim = new MockDaemonSim();
    sim.handleFrame({ type: "command", name: "estop" }, 0);
    const replies = sim.handleFrame(
      { type: "control", action: { "right_arm_gripper.pos": 50 }, action_id: "a3" },
      10
    );
    // "estop_latched" is what the gateway emits (motion.py apply_action) — NOT the telemetry
    // safety STATE "latched"; clients classify refusals on this exact string.
    expect(replies).toEqual([
      expect.objectContaining({ action_id: "a3", state: "blocked", reason: "estop_latched" }),
    ]);
  });

  it("refuses an all-unknown action with the gateway's sorted unknown_joint reason", () => {
    // Gateway apply_action: unknown keys and non-numeric values collect; a TOTAL miss with an
    // action_id gets ONE terminal frame. The sim used to drop unknown keys and report `done`
    // for the empty remainder — vocabulary misses confirmed as success.
    const sim = new MockDaemonSim();
    sim.tick(0);
    const replies = sim.handleFrame(
      { type: "control", action: { "zzz.pos": 5, "aaa.pos": 5 }, action_id: "u1" }, 10,
    );
    expect(replies).toEqual([
      expect.objectContaining({ state: "blocked", reason: "unknown_joint:aaa.pos,zzz.pos" }),
    ]);
    // ...and no later tick may resurrect it as done.
    expect(drive(sim, 50, 2000).filter((f) => f.type === "action_status")).toEqual([]);
  });

  it("refuses an empty action as empty_action and accepts a partial-miss", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    expect(sim.handleFrame({ type: "control", action: {}, action_id: "e1" }, 10)).toEqual([
      expect.objectContaining({ state: "blocked", reason: "empty_action" }),
    ]);
    // Known + unknown keys: the known one applies and the action is ACCEPTED (gateway rule).
    const replies = sim.handleFrame(
      { type: "control", action: { "right_arm_gripper.pos": 50, "bogus.pos": 1 }, action_id: "p1" }, 20,
    );
    expect(replies).toEqual([expect.objectContaining({ action_id: "p1", state: "accepted" })]);
    const end = drive(sim, 50, 2000).filter((f) => f.type === "action_status");
    expect(end.at(-1)).toEqual(expect.objectContaining({ action_id: "p1", state: "done" }));
    expect(sim.state()["bogus.pos"]).toBeUndefined(); // no invented telemetry key
  });

  it("counts .vel keys as unknown instead of applying them instantly", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    const replies = sim.handleFrame(
      { type: "control", action: { "x.vel": 0.5 }, action_id: "v1" }, 10,
    );
    expect(replies).toEqual([
      expect.objectContaining({ state: "blocked", reason: "unknown_joint:x.vel" }),
    ]);
    expect(sim.state()["x.vel"]).toBe(0);
  });
});

describe("MockDaemonSim pose (capability pose_targets)", () => {
  const POSE = { frame: "base_footprint", position_m: [0.4, -0.1, 0.9] };

  it("advertises pose_targets by default (what the A3 gateway sends) and serves the verb", () => {
    const sim = new MockDaemonSim();
    expect(sim.ackFrame().capabilities as string[]).toEqual([
      "task_jog",
      "pose_targets",
      "record",
      "named_navigation",
      "sensor_streams",
    ]);
    sim.tick(0);
    const replies = sim.handleFrame(
      { type: "control", pose: { right_arm: POSE }, action_id: "pp1" }, 10,
    );
    expect(replies).toEqual([expect.objectContaining({ action_id: "pp1", state: "accepted" })]);
    const frames = drive(sim, 50, 2000).filter((f) => f.type === "action_status");
    expect(frames.at(-1)).toEqual(expect.objectContaining({ action_id: "pp1", state: "done" }));
  });

  it("drops pose in silence when the capability is trimmed (advertise-and-serve)", () => {
    const sim = new MockDaemonSim({ capabilities: ["task_jog", "record"] });
    sim.tick(0);
    expect(sim.handleFrame(
      { type: "control", pose: { right_arm: POSE }, action_id: "pp2" }, 10,
    )).toEqual([]);
  });

  it("refuses gateway-verbatim: estop_latched, empty_pose, one_arm_per_pose, frame, bad_pose", () => {
    const sim = new MockDaemonSim();
    sim.tick(0);
    const send = (pose: Record<string, unknown>, id: string) =>
      sim.handleFrame({ type: "control", pose, action_id: id }, 10);
    // An arm this robot doesn't have -> empty_pose (gateway draws sides from its own arms).
    expect(send({ middle_arm: POSE }, "r1")).toEqual([
      expect.objectContaining({ state: "blocked", reason: "empty_pose" }),
    ]);
    expect(send({ left_arm: POSE, right_arm: POSE }, "r2")).toEqual([
      expect.objectContaining({ state: "blocked", reason: "one_arm_per_pose" }),
    ]);
    expect(send({ right_arm: { ...POSE, frame: "map" } }, "r3")).toEqual([
      expect.objectContaining({ state: "blocked", reason: "frame:map" }),
    ]);
    expect(send({ right_arm: { frame: "base_footprint", position_m: [1, 2] } }, "r4")).toEqual([
      expect.objectContaining({ state: "blocked", reason: "bad_pose" }),
    ]);
    sim.handleFrame({ type: "command", name: "estop" }, 20);
    expect(send({ right_arm: POSE }, "r5")).toEqual([
      expect.objectContaining({ state: "blocked", reason: "estop_latched" }),
    ]);
  });
});

describe("loopback signaling", () => {
  it("delivers the room handshake both ways, asynchronously", async () => {
    const { transport, robot } = createLoopbackSignaling();
    const seen: string[] = [];
    robot.onOperatorOpen(() => seen.push("open"));
    robot.onReady((p) => seen.push("ready:" + (p.mac ?? "")));
    robot.onBye(() => seen.push("bye"));

    let robotHere = 0;
    await transport.connect({
      onSdp: () => {},
      onIce: () => {},
      onRobotHere: () => { robotHere++; },
      onOpen: () => transport.sendReady({}),
    });
    expect(seen).toEqual([]); // nothing delivered synchronously
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["open", "ready:"]);

    robot.announce({ nonce: "n1" });
    transport.sendBye();
    await new Promise((r) => setTimeout(r, 20));
    expect(robotHere).toBe(1);
    expect(seen).toContain("bye");
  });

  it("drops sends made after close", async () => {
    const { transport, robot } = createLoopbackSignaling();
    let opened = false;
    robot.onReady(() => { opened = true; });
    await transport.connect({ onSdp: () => {}, onIce: () => {}, onRobotHere: () => {}, onOpen: () => {} });
    await transport.close();
    transport.sendReady({});
    await new Promise((r) => setTimeout(r, 20));
    expect(opened).toBe(false);
  });

  it("still delivers a bye sent immediately before close (RemoteTeleop.stop's exact shape)", async () => {
    // teleop.stop() calls sendBye() and close() in the same synchronous task. Dropping that bye
    // leaves the mock robot's timers and peer running forever and breaks the next start().
    const { transport, robot } = createLoopbackSignaling();
    let byes = 0;
    robot.onBye(() => { byes++; });
    await transport.connect({ onSdp: () => {}, onIce: () => {}, onRobotHere: () => {}, onOpen: () => {} });
    transport.sendBye();
    await transport.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(byes).toBe(1);
  });
});

describe("MockDaemonSim record (W2.11 one-bundle-per-session emulation)", () => {
  const rec = (sim: MockDaemonSim, action: string, task?: string) =>
    sim.handleFrame({ type: "record", action, ...(task ? { task } : {}) }, 0)[0];

  it("session -> multiple episodes -> end, with record_status replies", () => {
    const sim = new MockDaemonSim();
    expect(rec(sim, "status")).toMatchObject({ type: "record_status", ok: true, recording: false, session_open: false });

    expect(rec(sim, "session_start", "fold")).toMatchObject({ ok: true, session_open: true, recording: false });
    // episode 1
    let out = rec(sim, "episode_start");
    expect(out).toMatchObject({ ok: true, recording: true });
    expect(String(out.episode)).toMatch(/episode-\d{4}$/);
    expect(rec(sim, "episode_stop")).toMatchObject({ ok: true, recording: false, episodes_kept: 1 });
    // episode 2
    rec(sim, "episode_start");
    expect(rec(sim, "episode_stop")).toMatchObject({ ok: true, episodes_kept: 2 });
    // end the session
    expect(rec(sim, "session_end")).toMatchObject({ ok: true, session_open: false, recording: false });
  });

  it("episode_start auto-opens a session (dropped session_start resilience)", () => {
    const sim = new MockDaemonSim();
    // No session_start first — a dropped one. episode_start opens one anyway.
    expect(rec(sim, "episode_start")).toMatchObject({ ok: true, recording: true, session_open: true });
    // A late/duplicate session_start on the now-open session is rejected.
    expect(String(rec(sim, "session_start").error)).toContain("session already open");
  });

  it("episode_discard drops the just-stopped episode, keeps the rest", () => {
    const sim = new MockDaemonSim();
    rec(sim, "session_start", "task");
    rec(sim, "episode_start"); rec(sim, "episode_stop");   // kept 1
    rec(sim, "episode_start"); rec(sim, "episode_stop");   // kept 2
    expect(rec(sim, "episode_discard")).toMatchObject({ ok: true, episodes_kept: 1 });
    expect(rec(sim, "status")).toMatchObject({ episodes_kept: 1, session_open: true });
  });

  it("legacy start/stop aliases still round-trip one-episode sessions", () => {
    const sim = new MockDaemonSim();
    expect(rec(sim, "start", "legacy")).toMatchObject({ ok: true, recording: true });
    expect(rec(sim, "stop")).toMatchObject({ ok: true, recording: false, session_open: false });
    expect(rec(sim, "stop")).toMatchObject({ ok: false });   // nothing open
  });

  it("stereo: session_start {stereo:true} is echoed in every status until close", () => {
    const sim = new MockDaemonSim();
    const start = sim.handleFrame(
      { type: "record", action: "session_start", task: "fold", stereo: true }, 0)[0];
    expect(start).toMatchObject({ ok: true, session_open: true, stereo: true });
    // Echoed on episode replies too — the UI reads it from any status.
    expect(rec(sim, "episode_start")).toMatchObject({ ok: true, stereo: true });
    expect(rec(sim, "episode_stop")).toMatchObject({ ok: true, stereo: true });
    // session_end still reports the closing session's stereo state...
    expect(rec(sim, "session_end")).toMatchObject({ ok: true, stereo: true });
    // ...and a NEW session without the flag reports none (state was cleared).
    const plain = rec(sim, "session_start", "fold2");
    expect(plain.ok).toBe(true);
    expect(plain.stereo).toBeUndefined();
  });

  it("stereo: episode_start carries the flag when it auto-opens a session", () => {
    const sim = new MockDaemonSim();
    // Dropped session_start: the flag rides episode_start, same as task.
    const out = sim.handleFrame(
      { type: "record", action: "episode_start", task: "fold", stereo: true }, 0)[0];
    expect(out).toMatchObject({ ok: true, session_open: true, stereo: true });
  });

  it("stereo: session parameters are fixed at open — a mid-session flag is ignored", () => {
    const sim = new MockDaemonSim();
    rec(sim, "session_start", "fold");   // no stereo
    const out = sim.handleFrame(
      { type: "record", action: "episode_start", stereo: true }, 0)[0];
    expect(out.ok).toBe(true);
    expect(out.stereo).toBeUndefined();
  });

});


describe("MockDaemonSim explicit episode review", () => {
  it("holds after Stop, retries by ID, and counts only acknowledged Keep", () => {
    const sim = new MockDaemonSim();
    const send = (action: string, extra: Record<string, unknown> = {}) =>
      sim.handleFrame({ type: "record", action, ...extra }, 0)[0];
    const first = send("episode_start", { review_required: true, task: "test", request_id: "start-1" });
    expect(send("episode_start", { review_required: true, request_id: "start-1" })).toEqual(first);
    const id = first.episode_id;
    expect(send("episode_stop", { episode_id: id })).toMatchObject({ episodes_kept: 0 });
    expect(send("review_status").pending_reviews).toEqual([{ episode_id: id, task: "test" }]);
    expect(send("episode_reject", { episode_id: id })).toMatchObject({ ok: true, episodes_kept: 0 });
    expect(send("episode_reject", { episode_id: id }).ok).toBe(true);
    expect(send("episode_keep", { episode_id: id }).ok).toBe(false);
    const second = send("episode_start", { review_required: true });
    send("episode_stop");
    expect(send("episode_keep", { episode_id: second.episode_id }).episodes_kept).toBe(1);
    expect(send("episode_keep", { episode_id: second.episode_id }).episodes_kept).toBe(1);
  });
});
