// NORI: Additive file (SDK v1 mock mode — docs/sdk_v1_finalization.md item 1).
// MockDaemonSim: a pure, deterministic emulation of the daemon+bridge WIRE BEHAVIOR — the
// frames a client sees, not the physics. It speaks the nori-protocol vocabulary (ack /
// telemetry / action_status, consuming control / command), integrates jog rates into a
// plausible joint state, honors ranges by clamping (the daemon's clamp-don't-reject rule),
// and emulates E-STOP latching and the per-connection watchdog so error paths are testable.
//
// Deliberately NOT kinematically accurate: cylindrical task-space dofs (x/y/pitch) nudge a
// fixed joint mapping so telemetry visibly responds — good enough for UI/3D/dev-loop work,
// never for training or motion validation. Time is caller-supplied (no Date.now/Math.random)
// so tests are reproducible; "randomness" is a seeded LCG.
//
// Environment: pure TS — no DOM, no WebRTC, no timers. Safe to import and unit-test in Node.
// The browser shell around it is mock/robot.ts.

import type { RobotDescriptor, WatchdogProfile } from "../teleop";

export interface MockSimOptions {
  descriptor?: RobotDescriptor;
  watchdog?: WatchdogProfile;
  initialState?: Record<string, number>;
  protocolVersion?: number;
  seed?: number;
  // Full-rate jog speed in normalized units/s (state units are lerobot-normalized, ~degrees).
  jogUnitsPerS?: number;
  // Slew speed for absolute `action` targets, units/s.
  actionUnitsPerS?: number;
  // The optional verbs this double honours — and it honours exactly these: pose is served
  // only when "pose_targets" is advertised, so the ack can never over- or under-claim.
  // Default matches what a healthy A3 gateway sends with motion, recorder and
  // the named-navigation adapter up. Trim it to
  // rehearse the capability gate: new MockDaemonSim({ capabilities: ["task_jog","record"] })
  // makes the SDK's sendPose gate throw pre-flight, exactly as a capability-less robot would.
  capabilities?: string[];
}

// The SO101-shaped default: 2 arms x 6 joints, diff base, two lifts, four cameras — mirrors
// the nori-protocol ack golden fixture, extended to the full camera rig.
const ARM_JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];

function defaultDescriptor(): RobotDescriptor {
  const joints: string[] = [];
  const ranges: Record<string, [number, number]> = {};
  for (const side of ["left", "right"]) {
    for (const j of ARM_JOINTS) {
      const key = `${side}_arm_${j}.pos`;
      joints.push(key);
      ranges[key] = j === "gripper" ? [0, 100] : [-100, 100];
    }
  }
  ranges["left_lift.pos"] = [0, 600];
  ranges["right_lift.pos"] = [0, 600];
  return {
    buses: ["bus1", "bus2"],
    joints,
    base: ["x.vel", "theta.vel"],
    aux: ["left_lift", "right_lift"],
    cameras: ["front", "left_wrist", "right_wrist", "overhead"],
    ranges,
  };
}

// Cylindrical task-space dofs the real daemon resolves through IK. The mock maps them onto
// single joints so motion is VISIBLE, with no claim of geometric truth.
const TASK_DOF_TO_JOINT: Record<string, string> = {
  x: "elbow_flex",
  y: "shoulder_lift",
  pitch: "wrist_flex",
  // Canonical angular-z verb (A3 vocabulary); alias of the deprecated shoulder_pan, which
  // already resolves directly as a joint name (the `key in this.st` branch above the map).
  yaw: "shoulder_pan",
};

interface PendingAction {
  id: string;
  targets: Record<string, number>; // key -> clamped target
  clamped: boolean;
  announcedActive: boolean;
}

type Frame = Record<string, unknown>;

export class MockDaemonSim {
  readonly descriptor: RobotDescriptor;
  readonly watchdog: WatchdogProfile;
  readonly protocolVersion: number;
  readonly capabilities: string[];

  private st: Record<string, number> = {};
  private initial: Record<string, number> = {};
  private jog: Frame | null = null;
  private pending: PendingAction[] = [];
  private safety: "ok" | "latched" = "ok";
  private latchReason: string | null = null;
  private wdState: "ok" | "warn" | "stop" = "ok"; // last tick's watchdog verdict (edge detect)
  private lastControlMs: number | null = null;
  private lastTickMs: number | null = null;
  private moved = new Set<string>(); // joints that moved last tick (drives fake currents)
  private rng: number;
  private readonly jogRate: number;
  private readonly actionRate: number;
  // Motor whose idle holding current is always reported; null on a jointless descriptor.
  private readonly idleCurrentMotor: string | null;

  constructor(opts?: MockSimOptions) {
    this.descriptor = opts?.descriptor ?? defaultDescriptor();
    this.watchdog = opts?.watchdog ?? { t_warn_ms: 300, t_stop_ms: 1000 };
    this.protocolVersion = opts?.protocolVersion ?? 1;
    this.rng = (opts?.seed ?? 42) >>> 0 || 42;
    this.jogRate = opts?.jogUnitsPerS ?? 60;
    this.actionRate = opts?.actionUnitsPerS ?? 120;
    this.capabilities = opts?.capabilities ?? [
      "task_jog", "pose_targets", "record", "named_navigation", "sensor_streams",
    ];

    const joints = this.descriptor.joints ?? [];
    this.idleCurrentMotor = joints.length ? joints[joints.length - 1].replace(/\.pos$/, "") : null;
    for (const j of joints) this.st[j] = j.includes("gripper") ? 30 : 0;
    for (const b of this.descriptor.base ?? []) this.st[b] = 0;
    for (const a of this.descriptor.aux ?? []) this.st[`${a}.pos`] = 100;
    Object.assign(this.st, opts?.initialState);
    this.initial = { ...this.st };
  }

  // ---- frames the shell sends on channel open -------------------------------------------

  ackFrame(): Frame {
    return {
      type: "ack",
      accepted: true,
      protocol_version: this.protocolVersion,
      // Advisory label so logs name the double honestly (never branch on it).
      model: "SIM",
      // The TRUTHFUL set of optional verbs this double honours — advertise-and-serve, so
      // the ack can never over- or under-claim (handlePose is gated on this same list).
      // The default matches the fleet: the A3 gateway advertises pose_targets and serves
      // it, so a plain sim must too — omitting it made pose() throw here while working on
      // hardware, the exact more/less-capable-than-the-fleet lie a double must not tell.
      capabilities: [...this.capabilities],
      norm_mode: "range_m100_100",
      watchdog_profile: { ...this.watchdog },
      descriptor: JSON.parse(JSON.stringify(this.descriptor)),
      initial_state: { ...this.initial },
    };
  }

  cameraLayoutFrame(): Frame | null {
    const tiles = this.descriptor.cameras ?? [];
    if (tiles.length < 2) return null; // single-camera robots send no layout (matches the bridge)
    const cols = Math.ceil(Math.sqrt(tiles.length));
    return { type: "camera_layout", cols, rows: Math.ceil(tiles.length / cols), tiles: [...tiles] };
  }

  daemonStatusFrame(state: "online" | "offline" = "online"): Frame {
    return { type: "daemon_status", state };
  }

  // ---- inbound --------------------------------------------------------------------------

  // Consume one client frame; returns frames to send back immediately (may be empty).
  handleFrame(frame: Frame, nowMs: number): Frame[] {
    if (!frame || typeof frame !== "object") return [];
    const t = frame.type;
    if (t === "control") return this.handleControl(frame, nowMs);
    if (t === "command") return this.handleCommand(frame);
    if (t === "record") return this.handleRecord(frame);
    if (t === "navigation") return this.handleNavigation(frame, nowMs);
    if (t === "sensor_stream") return this.handleSensorStream(frame);
    // call / video / link / unknown: a real robot ignores unknown vocabulary too.
    return [];
  }

  // The gateway remembers only the last REQUEST_HISTORY replies per session and evicts
  // oldest-first (nori_gateway protocol.py NAVIGATION_REQUEST_HISTORY / SENSOR_REQUEST_HISTORY).
  // Match it exactly: an unbounded cache here would make every retry look idempotent
  // forever, hiding the real robot's behaviour when a retry lands after its reply was
  // evicted (a re-sent delete_waypoint then genuinely re-runs and answers "not found").
  private static readonly REQUEST_HISTORY = 256;

  // The gateway DROPS a request whose id is not a UUID — silently, no reply. Enforced here
  // so code that mints its own ids fails against the double rather than on hardware.
  private static isUuid(value: unknown): value is string {
    return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private rememberReply(cache: Map<string, Frame>, requestId: string, reply: Frame): void {
    cache.delete(requestId);          // re-insert so Map order stays least-recent-first
    cache.set(requestId, reply);
    while (cache.size > MockDaemonSim.REQUEST_HISTORY) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  private navWaypoints = new Map<string, { name: string; savedAt: number }>();
  private navActive: { goalId: string; name: string; startedMs: number } | null = null;
  private navCache = new Map<string, Frame>();
  private readonly navMapSha = "a".repeat(64);
  private sensorLidarHz = 0;
  private sensorImuHz = 0;
  private sensorLidarMaxPoints = 360;
  private sensorLastLidarMs: number | null = null;
  private sensorLastImuMs: number | null = null;
  private sensorCache = new Map<string, Frame>();

  private handleNavigation(frame: Frame, nowMs: number): Frame[] {
    if (!this.capabilities.includes("named_navigation")) return [];
    const requestId = frame.request_id;
    if (!MockDaemonSim.isUuid(requestId)) return [];
    const cached = this.navCache.get(requestId);
    if (cached) return [{ ...cached }];
    const base = (): Frame => ({
      type: "navigation_status",
      request_id: requestId,
      ok: true,
      state: this.navActive ? "navigating" : "idle",
      active: this.navActive !== null,
      ...(this.navActive
        ? { goal_id: this.navActive.goalId, name: this.navActive.name }
        : {}),
      map_sha256: this.navMapSha,
    });
    const action = frame.action;
    let result = base();
    if (action === "list_waypoints") {
      result.waypoints = [...this.navWaypoints.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((waypoint) => ({
          name: waypoint.name,
          saved_at_unix: waypoint.savedAt,
        }));
    } else if (action === "remember_waypoint") {
      const name = String(frame.name ?? "").trim();
      if (!name || this.navActive) {
        result = { ...base(), ok: false,
          error: !name ? "waypoint name must not be empty" : "navigation is active" };
      } else {
        const key = name.toLocaleLowerCase();
        const replaced = this.navWaypoints.has(key);
        this.navWaypoints.set(key, { name, savedAt: nowMs / 1000 });
        result = { ...base(), name, replaced };
      }
    } else if (action === "delete_waypoint") {
      const name = String(frame.name ?? "").trim();
      const deleted = !this.navActive && this.navWaypoints.delete(name.toLocaleLowerCase());
      result = { ...base(), ok: deleted, name, deleted,
        ...(!deleted ? { error: this.navActive ? "navigation is active" : "waypoint not found" } : {}) };
    } else if (action === "start") {
      const name = String(frame.name ?? "").trim();
      const goalId = String(frame.goal_id ?? "");
      const waypoint = this.navWaypoints.get(name.toLocaleLowerCase());
      if (!waypoint || this.navActive || !goalId) {
        result = { ...base(), ok: false,
          error: !waypoint ? "waypoint not found" : this.navActive ? "navigation is active" : "goal_id missing" };
      } else {
        this.navActive = { goalId, name: waypoint.name, startedMs: nowMs };
        result = { ...base(), state: "navigating", active: true,
          goal_id: goalId, name: waypoint.name };
      }
    } else if (action === "cancel") {
      const requestedGoal = String(frame.goal_id ?? "");
      if (this.navActive && (!requestedGoal || requestedGoal === this.navActive.goalId)) {
        result = { ...base(), state: "canceled", active: false,
          goal_id: this.navActive.goalId, name: this.navActive.name };
        this.navActive = null;
      } else {
        result = { ...base(), ok: false, error: "navigation goal_id does not match" };
      }
    } else if (action !== "status") {
      result = { ...base(), ok: false, error: `unknown navigation action ${String(action)}` };
    }
    this.rememberReply(this.navCache, requestId, result);
    return [{ ...result }];
  }

  private sensorStatus(requestId: string, ok = true, error?: string): Frame {
    return {
      type: "sensor_stream_status",
      request_id: requestId,
      ok,
      lidar_hz: this.sensorLidarHz,
      imu_hz: this.sensorImuHz,
      lidar_max_points: this.sensorLidarMaxPoints,
      lidar_available: true,
      imu_available: true,
      ...(error ? { error } : {}),
    };
  }

  private handleSensorStream(frame: Frame): Frame[] {
    if (!this.capabilities.includes("sensor_streams")) return [];
    const requestId = frame.request_id;
    if (!MockDaemonSim.isUuid(requestId)) return [];
    const cached = this.sensorCache.get(requestId);
    if (cached) return [{ ...cached }];
    let result: Frame;
    if (frame.action === "configure") {
      if (typeof frame.lidar_hz === "number") this.sensorLidarHz = frame.lidar_hz;
      if (typeof frame.imu_hz === "number") this.sensorImuHz = frame.imu_hz;
      if (typeof frame.lidar_max_points === "number")
        this.sensorLidarMaxPoints = frame.lidar_max_points;
      result = this.sensorStatus(requestId);
    } else if (frame.action === "status") {
      result = this.sensorStatus(requestId);
    } else {
      result = this.sensorStatus(
        requestId, false, `unknown sensor stream action ${String(frame.action)}`);
    }
    this.rememberReply(this.sensorCache, requestId, result);
    return [{ ...result }];
  }

  private sensorStamp(nowMs: number): {sec: number; nanosec: number} {
    const sec = Math.floor(nowMs / 1000);
    return { sec, nanosec: Math.floor((nowMs - sec * 1000) * 1_000_000) };
  }

  private lidarFrame(nowMs: number): Frame {
    const points = Math.min(360, this.sensorLidarMaxPoints);
    const increment = 2 * Math.PI / Math.max(1, points);
    return {
      type: "lidar_scan",
      stamp: this.sensorStamp(nowMs),
      frame_id: "laser",
      angle_min_rad: -Math.PI,
      angle_max_rad: -Math.PI + increment * Math.max(0, points - 1),
      angle_increment_rad: increment,
      time_increment_s: 0.1 / Math.max(1, points),
      scan_time_s: 0.1,
      range_min_m: 0.05,
      range_max_m: 12,
      source_points: 360,
      ranges_m: Array.from({ length: points }, (_, index) =>
        Number((2 + 0.25 * Math.sin(index * increment)).toFixed(4))),
      intensities: Array.from({ length: points }, () => 10),
    };
  }

  private imuFrame(nowMs: number): Frame {
    return {
      type: "imu",
      stamp: this.sensorStamp(nowMs),
      frame_id: "imu_link",
      orientation_xyzw: [0, 0, 0, 1],
      orientation_covariance: Array.from({ length: 9 }, () => 0.01),
      angular_velocity_rad_s: [0, 0, 0],
      angular_velocity_covariance: Array.from({ length: 9 }, () => 0.01),
      linear_acceleration_m_s2: [0, 0, 9.81],
      linear_acceleration_covariance: Array.from({ length: 9 }, () => 0.04),
    };
  }

  // W2.11 on-robot recorder emulation: the bridge relays {type:"record"} to the
  // always-on recorder and answers with a record_status (recorder.py _status shape).
  // Enough state to exercise the SDK's record()/onRecord path and a UI toggle.
  // Two-tier session/episode emulation (W2.11 one-bundle-per-session).
  private recSessionOpen = false;
  private recEpisode: string | null = null;   // open episode id, or null
  private recKept = 0;                         // episodes kept in the open session
  private recSeq = 0;
  // Stereo-view enforcement (session-scoped): taken from `stereo: true` on
  // session_start (or on the episode_start that auto-opens a session after a
  // dropped session_start — same recovery as `task`), echoed in every
  // record_status while the session is open, cleared when it closes. A real
  // robot enforces one matched frame rate on the front + overhead cameras.
  private recStereo = false;
  private recReviewRequired = false;
  private recPending = new Map<string, { task: string }>();
  private recDecisions = new Map<string, string>();
  private recReplies = new Map<string, Frame[]>();
  private recTask = "";

  private handleRecord(frame: Frame): Frame[] {
    const id = typeof frame.request_id === "string" ? frame.request_id : "";
    if (id && this.recReplies.has(id)) return this.recReplies.get(id)!;
    const replies = this.handleRecordInner(frame).map((reply) => id ? { ...reply, request_id: id } : reply);
    if (id) {
      this.recReplies.set(id, replies);
      if (this.recReplies.size > 128) this.recReplies.delete(this.recReplies.keys().next().value!);
    }
    return replies;
  }

  private handleRecordInner(frame: Frame): Frame[] {
    const status = (ok: boolean, error?: string): Frame => {
      const s: Frame = {
        type: "record_status", ok, recording: this.recEpisode !== null,
        session_open: this.recSessionOpen, episode: this.recEpisode ?? undefined,
        episodes_kept: this.recKept, free_gb: 42.0, review_supported: true,
        episode_id: this.recEpisode ?? undefined,
        active_review_episode_id: this.recReviewRequired ? this.recEpisode ?? "" : "",
        pending_reviews: [...this.recPending].map(([episode_id, item]) => ({ episode_id, task: item.task })),
      };
      if (this.recStereo) s.stereo = true;
      if (error) s.error = error;
      return s;
    };
    const a = frame.action;
    if (a === "review_status") {
      if (this.recPending.size || this.recEpisode) this.recSessionOpen = true;
      return [status(true)];
    }
    if (a === "episode_keep" || a === "episode_reject") {
      const id = String(frame.episode_id ?? "");
      const decision = a === "episode_keep" ? "keep" : "reject";
      const prior = this.recDecisions.get(id);
      if (prior) return [status(prior === decision, prior === decision ? undefined : "episode already has a different review decision")];
      if (!this.recPending.has(id)) return [status(false, "episode is not awaiting review")];
      this.recPending.delete(id);
      this.recDecisions.set(id, decision);
      if (decision === "keep") this.recKept += 1;
      return [{ ...status(true), episode_id: id }];
    }
    // --- session/episode protocol ---
    if (a === "session_start" || a === "start") {
      if (this.recSessionOpen) return [status(false, "session already open")];
      this.recSessionOpen = true;
      this.recKept = 0;
      this.recStereo = frame.stereo === true;
      if (a === "start") { this.recSeq += 1; this.recEpisode = this.epId(); }  // alias
      return [status(true)];
    }
    if (a === "episode_start") {
      // Resilience: auto-open a session if session_start was dropped (matches
      // recorder.py _episode_start).
      if (!this.recSessionOpen) {
        this.recSessionOpen = true;
        this.recKept = 0;
        this.recStereo = frame.stereo === true;
      }
      if (this.recEpisode !== null) return [status(false, "already recording an episode")];
      this.recSeq += 1;
      this.recEpisode = this.epId();
      this.recReviewRequired = frame.review_required === true;
      this.recTask = String(frame.task ?? "");
      return [status(true)];
    }
    if (a === "episode_stop") {
      if (this.recEpisode === null) return [status(false, "not recording an episode")];
      const id = this.recEpisode;
      if (frame.episode_id && frame.episode_id !== id) return [status(false, "episode does not match active recording")];
      if (this.recReviewRequired) this.recPending.set(id, { task: this.recTask });
      else this.recKept += 1;
      this.recEpisode = null;
      this.recReviewRequired = false;
      return [{ ...status(true), episode_id: id }];
    }
    if (a === "episode_discard") {
      if (!this.recSessionOpen) return [status(false, "no session open")];
      if (this.recEpisode !== null) this.recEpisode = null;  // drop in-progress
      else if (this.recKept > 0) this.recKept -= 1;          // drop just-stopped
      else return [status(false, "no episode to discard")];
      return [status(true)];
    }
    if (a === "session_end" || a === "stop") {
      if (!this.recSessionOpen) return [status(false, "no session open")];
      if (a === "stop" && this.recEpisode !== null) { this.recEpisode = null; this.recKept += 1; }
      this.recSessionOpen = false;
      this.recEpisode = null;
      const closing = status(true);
      this.recStereo = false;
      return [closing];
    }
    if (a === "session_discard" || a === "discard" || a === "discard_last") {
      if (!this.recSessionOpen) return [status(false, "nothing to discard")];
      this.recSessionOpen = false;
      this.recEpisode = null;
      this.recKept = 0;
      const closing = status(true);
      this.recStereo = false;
      return [closing];
    }
    if (a === "status") return [status(true)];
    return [status(false, `unknown action ${String(a)}`)];
  }

  private epId(): string {
    return `mock-session/episode-${String(this.recSeq).padStart(4, "0")}`;
  }

  private handleControl(frame: Frame, nowMs: number): Frame[] {
    this.lastControlMs = nowMs;
    const out: Frame[] = [];

    if (frame.jog && typeof frame.jog === "object") this.jog = frame.jog as Frame;

    if (frame.reset && typeof frame.reset === "object") {
      for (const [armKey, on] of Object.entries(frame.reset as Record<string, unknown>)) {
        if (!on) continue;
        // Derived from the state this descriptor seeded, not a hardcoded joint list — a
        // custom-descriptor sim resets ALL of that arm's joints, exactly what it advertised.
        const targets: Record<string, number> = {};
        const prefix = `${armKey}_`;
        for (const key of Object.keys(this.initial)) {
          if (key.startsWith(prefix) && key.endsWith(".pos")) targets[key] = this.initial[key];
        }
        this.pending.push({ id: "", targets, clamped: false, announcedActive: true });
      }
    }

    if (frame.pose && typeof frame.pose === "object") {
      out.push(...this.handlePose(frame.pose as Frame, frame));
    }

    if (frame.action && typeof frame.action === "object") {
      const id = typeof frame.action_id === "string" ? frame.action_id : "";
      if (this.safety === "latched") {
        // The gateway's string (apply_action: "estop_latched"), NOT the telemetry safety
        // STATE "latched" — two vocabularies, and clients classify on this one.
        if (id) out.push(this.actionStatus(id, "blocked", "estop_latched"));
        return out;
      }
      // Gateway-verbatim vocabulary (apply_action, nori_ws motion.py:305-337): the keymap is
      // the descriptor's joint list; unknown keys and non-numeric values collect; known keys
      // still apply (partial miss = accepted); a TOTAL miss with an action_id refuses with
      // ONE terminal frame. `.vel` keys are not in any keymap — the old instant-velocity
      // easter egg reported motion the gateway would have refused as unknown_joint.
      const vocab = new Set(this.descriptor.joints ?? []);
      const targets: Record<string, number> = {};
      const unknown: string[] = [];
      let clamped = false;
      for (const [key, v] of Object.entries(frame.action as Record<string, unknown>)) {
        if (typeof v !== "number" || !vocab.has(key)) {
          unknown.push(String(key));
          continue;
        }
        const c = this.clampKey(key, v);
        if (c !== v) clamped = true;
        targets[key] = c;
      }
      if (id && !Object.keys(targets).length) {
        out.push(this.actionStatus(id, "blocked",
          unknown.length ? "unknown_joint:" + unknown.sort().join(",") : "empty_action"));
        return out;
      }
      this.pending.push({ id, targets, clamped, announcedActive: false });
      if (id) out.push(this.actionStatus(id, "accepted"));
    }
    return out;
  }

  // control.pose — served only when advertised (the ack's advertise-and-serve contract).
  // No IK here: the shape and lifecycle are gateway-verbatim (apply_pose, nori_ws
  // motion.py:340-420 — refusal order estop_latched -> empty_pose -> one_arm_per_pose ->
  // frame:<name> -> bad_pose), and an accepted pose teleports a plausible nudge on a joint
  // that arm actually HAS, then rides the normal accepted -> active -> done slew. Geometry
  // truth lives on the robot; this rehearses PROTOCOL flow only.
  private handlePose(pose: Frame, frame: Frame): Frame[] {
    if (!this.capabilities.includes("pose_targets")) return []; // unadvertised: dropped in silence
    const id = typeof frame.action_id === "string" ? frame.action_id : "";
    const refuse = (reason: string): Frame[] => (id ? [this.actionStatus(id, "blocked", reason)] : []);
    if (this.safety === "latched") return refuse("estop_latched");
    // Sides = the arms this robot HAS that the payload addresses (gateway: self.arms).
    const armOf = (k: string) => k.slice(0, -"_arm".length);
    const hasArm = (side: string) =>
      (this.descriptor.joints ?? []).some((j) => j.startsWith(`${side}_arm_`));
    const sides = Object.keys(pose).filter((k) => k.endsWith("_arm") && hasArm(armOf(k))).map(armOf);
    if (!sides.length) return refuse("empty_pose");
    if (sides.length > 1) return refuse("one_arm_per_pose");
    const side = sides[0];
    const target = pose[`${side}_arm`] as Record<string, unknown>;
    if (!target || typeof target !== "object") return refuse("bad_pose");
    const frameName = String(target.frame ?? "");
    if (frameName !== "base_footprint") return refuse(`frame:${frameName || "missing"}`);
    const position = target.position_m;
    if (!Array.isArray(position) || position.length !== 3
        || !position.every((v) => typeof v === "number")) return refuse("bad_pose");
    const orientation = target.orientation_xyzw;
    if (orientation !== undefined && (!Array.isArray(orientation) || orientation.length !== 4
        || !orientation.every((v) => typeof v === "number"))) return refuse("bad_pose");
    const jointKey = (this.descriptor.joints ?? []).find((j) => j.startsWith(`${side}_arm_`))!;
    this.pending.push({
      id,
      targets: { [jointKey]: this.clampKey(jointKey, (this.st[jointKey] ?? 0) - 5) },
      clamped: false,
      announcedActive: false,
    });
    return id ? [this.actionStatus(id, "accepted")] : [];
  }

  private handleCommand(frame: Frame): Frame[] {
    // Two wire shapes exist: {name:"estop"} (protocol fixture) and {estop:true} (SDK keyboard
    // path); accept both, like the daemon does. NOT "reset": the SDK's reset command travels as
    // a control frame's `reset` field (handleControl), never as a command — listing it here
    // implied an emulation that doesn't exist.
    const name =
      typeof frame.name === "string"
        ? frame.name
        : ["estop", "reset_latch"].find((k) => frame[k] === true) ?? "";
    if (name === "estop") {
      this.safety = "latched";
      this.latchReason = "estop";
      this.jog = null;
      this.zeroVelocities();
      // Every open action ends NOW with the gateway's reason string (motion.py estop():
      // "estop_latched") — an operator who e-stops must not find lifecycle waits hanging.
      const out = this.pending
        .filter((p) => p.id)
        .map((p) => this.actionStatus(p.id, "blocked", "estop_latched"));
      this.pending = [];
      return out;
    }
    if (name === "reset_latch") {
      this.safety = "ok";
      this.latchReason = null;
    }
    return [];
  }

  // ---- time -----------------------------------------------------------------------------

  // Advance the sim to nowMs and return the frames due (one telemetry + any terminal
  // action_status). Call at your telemetry rate; dt is derived, so rate is caller's choice.
  tick(nowMs: number): Frame[] {
    const dt = this.lastTickMs === null ? 0 : Math.max(0, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;
    const out: Frame[] = [];
    this.moved.clear();

    if (this.sensorLidarHz > 0 &&
        (this.sensorLastLidarMs === null ||
         nowMs - this.sensorLastLidarMs >= 1000 / this.sensorLidarHz)) {
      this.sensorLastLidarMs = nowMs;
      out.push(this.lidarFrame(nowMs));
    }
    if (this.sensorImuHz > 0 &&
        (this.sensorLastImuMs === null ||
         nowMs - this.sensorLastImuMs >= 1000 / this.sensorImuHz)) {
      this.sensorLastImuMs = nowMs;
      out.push(this.imuFrame(nowMs));
    }

    if (this.navActive) {
      const elapsed = Math.max(0, nowMs - this.navActive.startedMs);
      const remaining = Math.max(0, 1.5 - elapsed / 1000);
      if (remaining === 0) {
        out.push({
          type: "navigation_status", ok: true, state: "succeeded", active: false,
          goal_id: this.navActive.goalId, name: this.navActive.name,
          map_sha256: this.navMapSha, distance_remaining_m: 0,
          estimated_time_remaining_s: 0, number_of_recoveries: 0,
        });
        this.navActive = null;
      } else {
        out.push({
          type: "navigation_status", ok: true, state: "navigating", active: true,
          goal_id: this.navActive.goalId, name: this.navActive.name,
          map_sha256: this.navMapSha, distance_remaining_m: remaining * 0.4,
          estimated_time_remaining_s: remaining, number_of_recoveries: 0,
        });
      }
    }

    // Watchdog: arrival-keyed like the real one — armed by the first control frame, trips on
    // silence. On the TRANSITION to stop the gateway drops ALL intent and fails every open
    // action with timeout/"watchdog_stop" (motion.py _update_watchdog + _drop_all_intent): a
    // stale target must never resume on its own — the app re-commands after frames return.
    // This sim used to freeze-and-RESUME pending actions instead, which taught link-loss
    // recovery code the exact opposite of hardware behavior. Nothing latches (safe hold, not
    // an E-STOP): motion verbs work again the moment control frames resume.
    let wd: "ok" | "warn" | "stop" = "ok";
    if (this.lastControlMs !== null) {
      const silence = nowMs - this.lastControlMs;
      if (silence > this.watchdog.t_stop_ms) wd = "stop";
      else if (silence > this.watchdog.t_warn_ms) wd = "warn";
    }
    if (wd === "stop" && this.wdState !== "stop") {
      this.jog = null;
      this.zeroVelocities();
      for (const p of this.pending) {
        if (p.id) out.push(this.actionStatus(p.id, "timeout", "watchdog_stop"));
      }
      this.pending = [];
    }
    this.wdState = wd;

    if (this.safety !== "latched" && wd !== "stop" && dt > 0) {
      this.integrateJog(dt);
      out.push(...this.slewActions(dt));
    }

    out.push(this.telemetryFrame(nowMs, wd));
    return out;
  }

  private integrateJog(dt: number) {
    if (!this.jog) return;
    for (const side of ["left_arm", "right_arm"]) {
      const arm = this.jog[side];
      if (!arm || typeof arm !== "object") continue;
      for (const [dof, rateU] of Object.entries(arm as Record<string, unknown>)) {
        const rate = typeof rateU === "number" ? Math.max(-1, Math.min(1, rateU)) : 0;
        if (!rate) continue;
        const key = `${side}_${dof}.pos`;
        const mapped = key in this.st ? key : `${side}_${TASK_DOF_TO_JOINT[dof] ?? ""}.pos`;
        if (!(mapped in this.st)) continue;
        this.setJoint(mapped, this.st[mapped] + rate * this.jogRate * dt);
      }
    }
    // Base velocities are re-commanded by every jog frame, so an ABSENT base key means "no base
    // command" = stop — not "keep the last one". The SDK's keyboard path omits `base` entirely
    // once no base key is held (teleop.ts jogTick), so treating absence as latch made a released
    // key drive the base forever: the exact runaway the real daemon is built to prevent.
    const base = this.jog.base;
    const b = (base && typeof base === "object" ? base : {}) as Record<string, unknown>;
    if ("x.vel" in this.st) this.st["x.vel"] = typeof b.linear === "number" ? b.linear : 0;
    if ("theta.vel" in this.st) this.st["theta.vel"] = typeof b.angular === "number" ? b.angular : 0;
    if (this.st["x.vel"] || this.st["theta.vel"]) this.moved.add("base");
    for (const lift of this.descriptor.aux ?? []) {
      const rate = this.jog[lift];
      if (typeof rate === "number" && rate) {
        this.setJoint(`${lift}.pos`, this.st[`${lift}.pos`] + Math.max(-1, Math.min(1, rate)) * 40 * dt);
      }
    }
  }

  private slewActions(dt: number): Frame[] {
    const out: Frame[] = [];
    const step = this.actionRate * dt;
    this.pending = this.pending.filter((p) => {
      let reached = true;
      for (const [key, target] of Object.entries(p.targets)) {
        const cur = this.st[key];
        const d = target - cur;
        if (Math.abs(d) <= step) this.setJoint(key, target);
        else {
          this.setJoint(key, cur + Math.sign(d) * step);
          reached = false;
        }
      }
      if (!reached && p.id && !p.announcedActive) {
        p.announcedActive = true;
        out.push(this.actionStatus(p.id, "active"));
      }
      if (reached && p.id) out.push(this.actionStatus(p.id, p.clamped ? "clamped" : "done"));
      return !reached;
    });
    return out;
  }

  private telemetryFrame(nowMs: number, wd: "ok" | "warn" | "stop"): Frame {
    const currents: Record<string, number> = {};
    for (const key of this.moved) {
      if (key === "base") continue;
      currents[key.replace(/\.pos$/, "")] = 60 + Math.floor(this.noise() * 80);
    }
    // One idle holding current so the field is never empty (real motors always draw something).
    // Keyed off a joint the DESCRIPTOR actually has — a hardcoded name invented a phantom
    // actuator on custom descriptors, which anything cross-checking currents against joints reads
    // as a real motor.
    if (this.idleCurrentMotor) currents[this.idleCurrentMotor] ??= 20 + Math.floor(this.noise() * 20);
    return {
      type: "telemetry",
      ts_ns: Math.round(nowMs * 1e6),
      state: Object.fromEntries(Object.entries(this.st).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      currents,
      loop_hz: Math.round((49.6 + this.noise() * 0.8) * 10) / 10,
      errors: 0,
      stalled: [],
      pi_temp_c: Math.round((54 + this.noise() * 4) * 10) / 10,
      throttle_flags: 0,
      status: {
        safety: this.safety,
        latch_reason: this.latchReason,
        link: "mock",
        watchdog: wd,
        rtt_ms: 1.0,
      },
    };
  }

  // ---- introspection (tests, canvas renderer) --------------------------------------------

  state(): Record<string, number> {
    return { ...this.st };
  }
  safetyState(): string {
    return this.safety;
  }

  // ---- helpers ---------------------------------------------------------------------------

  private actionStatus(id: string, state: string, reason?: string): Frame {
    const f: Frame = { type: "action_status", action_id: id, state, ts_ns: this.lastTickMs === null ? 0 : Math.round(this.lastTickMs * 1e6) };
    if (reason) f.reason = reason;
    return f;
  }

  private clampKey(key: string, v: number): number {
    const r = this.descriptor.ranges?.[key];
    return r ? Math.max(r[0], Math.min(r[1], v)) : v;
  }

  private setJoint(key: string, v: number) {
    const nv = this.clampKey(key, v);
    if (nv !== this.st[key]) this.moved.add(key);
    this.st[key] = nv;
  }

  private zeroVelocities() {
    for (const b of this.descriptor.base ?? []) if (b in this.st) this.st[b] = 0;
  }

  // Deterministic [0,1) noise (LCG) — seeded, so identical runs produce identical telemetry.
  private noise(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 0x100000000;
  }
}
