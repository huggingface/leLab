# @nori/sdk

Robot-local teleoperation SDK for the **Nori daemon**. Connect to a robot over WebRTC, receive its
video + telemetry, and drive it — from the browser, in ~20 lines.

```
┌ your app ┐        ┌ @nori/sdk ┐   WebRTC    ┌ Pi bridge ┐  NDJSON  ┌ nori daemon ┐
│ video el │  ◄───► │RemoteTeleop│ ◄────────► │webrtc_robot│ ◄─────► │ 50Hz control │
│ keyboard │        └───────────┘  data chan  └───────────┘  :7777   │ safety stack │
└──────────┘         signaling ▲                                     └──────────────┘
                     (Supabase or BYO)
```

> **Safety.** The daemon defends itself — clamping, watchdog, E-STOP, rate-limits and the motor
> torque lifecycle are all on the robot. **No message this SDK can send makes the robot unsafe.**
> That invariant is what makes a client SDK safe to hand out. Targets **nori-protocol v1**
> (`NORI_PROTOCOL_VERSION`); a daemon on a different major rejects the connection.

## Install

Not on public npm yet — that lands with the open-source release. Until then, install from the
release tarball we send you, or from the GitHub release URL if you have repo access:

```bash
npm i ./nori-sdk-<version>.tgz
# optional peers, only if you use them:
npm i @supabase/supabase-js   # for the reference signaling transport (@nori/sdk/supabase)
npm i three                   # for VR (@nori/sdk/vr)
```

The **core** (`@nori/sdk`) has zero runtime dependencies. VR and Supabase signaling live behind
their own subpath imports so you never pull them unless you ask for them.

## Quick start (Supabase signaling)

The fastest path: use the reference **Supabase** transport with the shared signaling project we
host — you do **not** need your own Supabase account.

These two values are **public** — the same ones our own web app ships in every browser build, and
the anon key grants nothing on its own (signaling rooms are RLS-gated). Paste them directly:

```ts
const SUPABASE_URL = "https://qgqamrqacvkzgdduebdd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFncWFtcnFhY3ZremdkZHVlYmRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDkzNDEsImV4cCI6MjA5NjQyNTM0MX0.f0dD_hWsWixOLTsrO0B-8AaJZQWjYwd_o08LiLlgpvM";
```

What you still need from us, per robot: the **room + token** we provision for you (and, for a robot
on a private room, to be signed in as its paired owner). See
["Connectivity"](#connectivity-lan-stun-turn) for that and for when you'd add TURN values.

```ts
import { RemoteTeleop } from "@nori/sdk";
import { SupabaseSignaling } from "@nori/sdk/supabase";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // the public values above
const video = document.querySelector("video")!;

const teleop = new RemoteTeleop({
  // Joins the robot's PRIVATE room by default — the fleet is private-only (RLS-gated).
  // Only a legacy public dev room needs an explicit opt-out: `{ private: false }`.
  signaling: new SupabaseSignaling(supabase, ROOM, (...m) => console.log(...m)),
  videoEl: video,
  stun: "stun:stun.l.google.com:19302",
  // TURN is optional and currently not issued by default (see "Connectivity" below).
  // If we've sent you relay credentials, add: turnUrls: [TURN_URL], turnUser, turnCred.
  forceRelay: false,
  arm: "right",             // which arm keyboard/jog drives
  onLog: (m) => console.log(m),
  onConnState: (s) => console.log("conn:", s),
  onTelemetry: (t) => {     // live: loopHz, safety, tempC, batteryPercent, per-joint state{}, lift height mm…
    console.log("safety:", t.safety, "state:", t.state);
  },
  onMode: (mode) => console.log("mode:", mode),
  onControlActive: (a) => console.log("control:", a),
});

await teleop.start();       // subscribes, answers the robot's offer, opens the control channel
```

Video now flows into your `<video>` element and `onTelemetry` fires ~50×/s.

Each `TelemetryView` also carries **`batteryPercent`** — the robot's battery charge as a whole
number from `0` to `100`. It is `null` when the robot has no battery monitor fitted, or when the
charge can't currently be read; render a placeholder such as `—` in that case rather than `0%`.
Treat it as an at-a-glance gauge, not a precise fuel level: it is derived from pack voltage and
sags under load. The field is present only while a session is connected (telemetry only flows
once connected).

## Develop without a robot (mock mode)

`@nori/sdk/mock` ships a fake robot so you can build and CI-test **with zero hardware, zero
cloud, and zero network** — no Supabase, no credentials, no robot time. Swap only the
signaling option; everything else is the identical SDK path (real WebRTC in-page, real
handshake/ack, real frame parsing), so code developed against the mock talks to a real Nori
by changing one line:

```ts
import { RemoteTeleop } from "@nori/sdk";
import { createMockRobot } from "@nori/sdk/mock";

const robot = createMockRobot();          // the fake robot, living in your page
const teleop = new RemoteTeleop({
  signaling: robot.signaling,             // <- the ONLY line that differs from production
  videoEl: document.querySelector("video")!,
  stun: "", turnUrls: [], turnUser: "", turnCred: "", forceRelay: false,
  arm: "right",
  onLog: console.log,
  onConnState: (s) => console.log("conn:", s),
  onTelemetry: (t) => console.log(t.safety, t.state["right_arm_shoulder_pan.pos"]),
  onMode: () => {}, onControlActive: () => {},
});
await teleop.start();                     // connects in ~a second, telemetry + video flowing
// later: robot.restart() simulates a robot reboot; robot.stop() tears it down.
```

What the mock gives you:

- **A drivable robot**: jog (keyboard/`setExternalJog`), absolute `sendAction` targets with the
  full `accepted -> active -> done|clamped|blocked` action-status lifecycle, range clamping
  (clamp-don't-reject, like the daemon), `estop`/`reset_latch` latching, and an arrival-keyed
  watchdog that stops motion when your control frames go silent — so your error handling is
  testable, not just your happy path. `sendPose` is accepted too (the mock advertises
  `pose_targets`) but is **protocol-only** — no IK, a nudge on one joint. Subclass
  `MockDaemonSim` and override `handleFrame` to make it geometric (the Lab's `A3MockSim` does
  exactly this with `solveWristPoint` from `@nori/sdk/vr`).
- **Test-pattern video**: a canvas-drawn composite honoring the `camera_layout` grid, so
  `videoStream()`, `cameraView(role)`, `captureFrame`/`snapshot(role)` all work. Tiles move
  when you jog (a dot tracks `shoulder_pan`), so "is my view wired up" is answerable by eye.
  Bring your own feed with `createMockRobot({ videoStream })` — any `MediaStream` (e.g. a
  `canvas.captureStream()` of rendered scenes) tiled in the sim's `camera_layout` order.
- **The real handshake**: `onReady`/`robotInfo()` deliver a descriptor (12 joints, 4 cameras,
  ranges) shaped exactly like a real robot's.
- **Determinism for CI**: the simulation core (`MockDaemonSim`) is pure and seeded — no
  `Date.now`/`Math.random` — and can be driven tick-by-tick in Node unit tests without any
  browser at all (`sim.handleFrame(...)` / `sim.tick(ms)`).

## Named navigation

Robots advertising `named_navigation` expose map-bound destinations through `RemoteTeleop`:

```ts
await teleop.rememberWaypoint("charging station");
const started = await teleop.navigateToWaypoint("charging station");
if (!started.ok || !started.goalId) throw new Error(started.error);
const result = await teleop.awaitNavigation(started.goalId, { timeoutMs: 120_000 });
```

The remaining methods are `listWaypoints()`, `deleteWaypoint()`,
`cancelNavigation(goalId?)`, `getNavigationStatus()`, and
`latestNavigationStatus()`. `onNavigationStatus` receives unsolicited progress and terminal
snapshots. Waypoints are tied to the active saved map; Nav2, localization, software E-stop
checks, and single-goal ownership stay on the robot. A session disconnect cancels only that
session's goal.

Any of these can resolve with `unreachable: true`, meaning the client never got a reply and the
robot's state is **unknown** — not that it stopped. A `navigateToWaypoint()` that resolves
unreachable may still be driving. Branch on `unreachable` before reading `state` or `active`.

## LiDAR and IMU

Robots advertising `sensor_streams` expose opt-in, rate-limited sensor data:

```ts
const status = await teleop.configureSensorStreams({
  lidarHz: 5,
  imuHz: 20,
  lidarMaxPoints: 360,
});
```

Receive typed samples with `onLidarScan` and `onImu`, or read the caches with
`latestLidarScan()` and `latestImuSample()`. `getSensorStreamStatus()` reports effective
settings and current ROS publisher presence. Set a rate to zero to stop it. LiDAR is capped
at 10 Hz and 1,440 readings; IMU is capped at 50 Hz. Non-finite ROS readings become `null`.
The mock produces deterministic scans and stationary IMU samples after the same configuration.

The mock speaks the same room handshake as the real robot (`robot_here` -> `ready` -> offer, with rate-limited nack/announce). Room-token HMAC auth is retired — the real robot gates private-room access via Supabase RLS — so the operator just handshakes and no token is sent.

**Planned next** (committed direction, no dates): auto-reconnecting sessions that ride out
robot restarts and network blips, with link-quality metrics exposed on the session. The
headless/ML tooling (env wrapper, policy runner, CLI diagnostics) lands Python-first in
`nori-sdk` on PyPI.

Honest limits (v1): no audio tracks (`joinCall()` degrades to local-only), no perception frames (use `injectPerception()`), motion is *plausible, not kinematically true* — cylindrical dofs nudge a fixed joint mapping so telemetry visibly responds. Never use mock trajectories to validate motion or train anything. `createMockRobot()` needs a browser (WebRTC + canvas); `MockDaemonSim` alone runs anywhere.

One gotcha worth knowing (it applies to real robots too, so the mock reproduces it):

- **`onTelemetry` fires for more than daemon frames.** RemoteTeleop also emits a view on its
  ~1 Hz video/ABR tick, and that one carries an **empty `state`**. Wait for the field you need
  (`t.state["right_arm_shoulder_pan.pos"] !== undefined`), not merely the first callback.

## Connectivity: LAN, STUN, TURN

How the media/control connection is established, and what you need for each situation:

- **Same LAN as the robot** (e.g. working on-site): peers connect directly via local host
  candidates. The STUN default is harmless but not even needed. Nothing to configure.
- **Over the internet (WAN)**: the default public **STUN** server lets both peers discover
  their public addresses and connect **directly** — no traffic flows through any third party,
  and this works on typical home/office networks. This is the current default deployment mode.
- **Strict networks** (corporate/university firewalls, hotel or co-working Wi-Fi, CGNAT mobile
  carriers, VPNs): direct connection can be impossible. The symptom is a session stuck at
  ICE/`connecting` that never reaches `connected` — nothing is wrong with your code. This is
  the one case that needs a **TURN relay** (`turnUrls`/`turnUser`/`turnCred`). We do not issue
  TURN credentials by default yet — **if you hit this, tell us and we'll provision relay
  credentials for you**; they slot into the three options above with no other change.
  (`forceRelay: true` then forces all traffic through the relay — useful to *verify* the TURN
  path, not something to leave on.)
- **A VPN or overlay network on YOUR machine** (Tailscale, WireGuard, corporate VPN): disable
  it — or exclude its interface — while driving robots. ICE can pick the tunnel path even when
  robot and laptop share a desk, and the tunnel's small MTU silently drops the protocol's
  larger messages. The symptom is distinctive: the session **connects and shows video, but the
  handshake never completes** (no robot descriptor, commands ignored) — nothing is wrong with
  your code.

Note the relay never sees your media in the clear — WebRTC is DTLS-SRTP end-to-end encrypted;
a TURN server only ever observes IPs and traffic volume.

> **On the robot's LAN and want frames as data (not a browser)?** Multi-camera robots also
> publish raw per-camera MJPEG frames over ZeroMQ — no WebRTC involved. See the nori-protocol
> `CLIENTS.md` § "Camera frames over the LAN" for the port scheme and a ~15-line Python client.

## Handshake: what the robot tells you on connect

Shortly after the control channel opens, the daemon sends its **ack** — a self-description of
the robot you just connected to. Read it at use-time with `robotInfo()` (null until it arrives)
or subscribe with the `onReady` option:

```ts
const teleop = new RemoteTeleop({
  /* ...options as above... */
  onReady: (info) => {
    if (!info.accepted) { console.error("robot refused session:", info.error); return; }
    console.log("protocol v" + info.protocolVersion, "units:", info.normMode);
    console.log("joints:", info.descriptor?.joints);
    console.log("cameras:", info.descriptor?.cameras);   // same roles as the CameraLayout tiles
    console.log("gripper range:", info.descriptor?.ranges?.["right_arm_gripper.pos"]);
  },
});
```

What's in a `RobotInfo`:

| Field | Meaning |
|---|---|
| `accepted` | `false` = the daemon refused the session (`error` says why). The connection stays up so you can see logs/telemetry, but control frames are ignored. |
| `protocolVersion` | The daemon's nori-protocol major. Compared against this SDK's `NORI_PROTOCOL_VERSION`; a difference sets `versionMismatch`. |
| `normMode` | Units of every `.pos` value in state/action: `"range_m100_100"` (normalized) or `"degrees"`. |
| `watchdogProfile` | `{ t_warn_ms, t_stop_ms }` — control-frame silence beyond these slows, then stops, the robot. **Disclosure, not negotiation**: the daemon picks it from the measured link; you can't change it. |
| `descriptor` | What the robot is: `joints` (every drivable `<motor>.pos` key), `base`, `aux` (e.g. lifts), `cameras` (roles, matching the composite layout tiles), `ranges` — the authoritative `[min, max]` per key (out-of-range values are **clamped robot-side, never rejected**, so use `ranges` to scale your inputs, not to pre-validate) — and two optional maps: `jog_scale`, the nominal commanded scale of a full-deflection jog per namespace (never achieved velocity; absent on the frozen L2 fleet forever — its `task` table now names `yaw` as the canonical angular-z verb, with `shoulder_pan` kept as a deprecated alias), and `ranges_si`, the calibrated SI bounds per normalized key (radians/metres; bounds may be inverted where calibration reverses an axis — interpolate as written, never sort; absent means unknown, don't substitute a guess). |
| `initialState` | The joint pose at session start. |
| `versionMismatch` | **Advisory.** Mixed daemon versions exist across the fleet, so the SDK warns and proceeds — unknown frame types are ignored by both sides, so a mismatch means vocabulary gaps, never unsafe behavior. |
| `model` | **Advisory label** ("L2", "A3") for logs and dataset provenance. Don't branch on it — branch on `descriptor` and `capabilities` (nori-protocol MODELS.md) — with ONE sanctioned exception the SDK already handles internally: the frozen L2 fleet's base-angular wire sign (see "Driving the robot → Base"). Deployed L2 daemons predate this field and never send it, so absence is not evidence of a non-L2 robot. |
| `capabilities` | Optional verbs this robot honours beyond the core (`"task_jog"`, `"pose_targets"`, `"record"`, …). **Three-valued** — check with `supportsCapability(info, cap)`, which returns `true`/`false` when declared and `undefined` when the ack predates the field; `undefined` means *unknown, probe or assume legacy*, never *no*. An explicitly empty `[]` means none. |

Old daemons may send a bare ack — every field except `accepted` is optional, so null-check what
you read. The ack is re-sent on every daemon (re)connect (a robot restart mid-session refreshes
`robotInfo()`). The raw parse is exported as `parseAck(frame)` if you need it standalone.

One rejection worth knowing by name: `accepted:false` with `error:"unauthorized"` is the robot's
**internal** agent token (its own bridge authenticating to its daemon) being missing or stale —
a robot-side provisioning problem. It has nothing to do with your access to the room (private
rooms are gated by the robot via Supabase RLS; you'd never get an offer if you couldn't join).
If you see `unauthorized`, nothing on your end fixes it — report it to us.

## Driving the robot

Two input paths — both ride the **same** wire (the daemon's jog → IK → clamp → motor path is
identical regardless of source):

**Keyboard** — hand key events to the client (see `keybindLegend(mode)` for the live key map):

```ts
window.addEventListener("keydown", (e) => { if (teleop.onKeyDown(e)) e.preventDefault(); });
window.addEventListener("keyup",   (e) => teleop.onKeyUp(e));
```

**Programmatic jog** — push normalized rates in `[-1, 1]` per DOF (streamed at 50 Hz):

```ts
teleop.setExternalJog({
  right_arm: { shoulder_pan: 0.5, elbow_flex: -0.3 },
  right_lift: 0.2,        // per-arm lift velocity
});
teleop.setExternalJog(null); // stop
```

**Base** — the mobile base rides the same jog stream under the `base` group, normalized rates
with **REP-103 signs: +`linear` drives forward, +`angular` turns LEFT** (counter-clockwise).
Emit that convention and nothing else — never negate client-side:

```ts
teleop.setExternalJog({ base: { linear: 0.4, angular: -0.2 } }); // forward, turning right
```

The frozen L2 fleet's firmware turns opposite on `angular` and can never be updated, so the
SDK flips that one sign on the wire for a **positively-matched L2 only** (resolved from
`ack.model`, else the transport room's fleet serial) — your code stays sign-blind either way.
For an L2 living in a room the auto-detection can't classify (a non-fleet dev room), pass
`baseSigns: "l2-legacy"` to `RemoteTeleop`; everything else is already the default
(`"rep103"`). Unknown never resolves to the legacy branch, so a future model can't inherit
the quirk by omission.

**Commands & mode:**

```ts
teleop.command("estop");        // also: "reset_latch" | "reset"
teleop.setArm("left");          // switch which arm is driven
teleop.toggleMode();            // task-space <-> per-joint (label reads "cartesian" on
                                // robots advertising jog_scale.task, "cylindrical" otherwise)
```

**Teardown:**

```ts
await teleop.stop();            // tells the robot to restart cleanly, tears down the peer
```

## The safety contract

The core promise, stated precisely: **every safety mechanism lives on the robot, and none of
them are negotiable from this SDK.** Clamping, watchdog, E-STOP, stall handling, and the motor
torque lifecycle all run in the robot's control daemon; no message you can send — malformed,
malicious, or buggy — disables or loosens them. Limits are **disclosed, not negotiated**: the
handshake tells you what they are (`robotInfo().watchdogProfile`, `descriptor.ranges`), and
there is deliberately no API to change them. If your use case genuinely needs different
limits, that's a conversation with us, not a parameter.

What the robot enforces, and how you see it in telemetry:

**`telemetry.safety`** (typed as `SafetyState`):

| Value | What the robot is doing | What you do |
|---|---|---|
| `"ok"` | Normal operation. | Carry on. |
| `"safe_hold"` | Refusing motion to protect itself — either the Pi is too hot or your control frames went silent past the watchdog stop threshold. Not a latch. | Fix the cause (let it cool / restore your control stream); it clears itself. |
| `"latched"` | **E-STOP is latched** (operator command or the robot's physical button). Motion blocked, motors torque-limited. | Clear deliberately with `command("reset_latch")` once the situation is safe. |

**`telemetry.watchdog`** (typed as `WatchdogState`): `"ok"` → `"warn"` (your control frames
went quiet past `t_warn_ms`, or the robot is shedding thermal load) → `"stop"` (quiet past
`t_stop_ms`; motion blocked until frames resume). The thresholds are per-link (LAN vs WAN) and
arrive in the handshake — you can read them, not set them.

**Stalls are deliberately NOT a safety state.** When a joint is pushed against something, the
robot cuts torque **on that joint only** and keeps everything else running; it self-clears when
you jog the stalled joint *away* from the obstruction. You'll see it as an `action_status`
with `reason: "stall:<joint>"`, not as a global stop. Reason strings follow the
pattern `"<cause>:<detail>"` — e.g. `"stall:right_arm_elbow_flex"`, `"estop:button"`.

**The three commands** (`command(...)` on `RemoteTeleop`, also bound to keys):

| Command | Effect |
|---|---|
| `"estop"` | Trip the E-STOP latch now (safety → `"latched"`). Always available; never rate-limited. |
| `"reset_latch"` | Clear the E-STOP and any stall latches, restore normal torque. Deliberate act — nothing else clears a latch. |
| `"reset"` | Return the arm(s) to their neutral pose (a motion command, not a latch operation — refused while latched). |

One more disclosure: **out-of-range targets are clamped, never rejected.** Sending a `.pos`
beyond `descriptor.ranges` moves the joint to the boundary and (for tagged actions) reports
`clamped` in the action status. Use `ranges` to scale your inputs, not to pre-validate.

## Video: attach a sink, and pause to save power

The robot's inbound video is one media track on the peer connection. You can attach it to a
`<video>` element at construction (`videoEl`) **or** re-point it at any time — useful when one
long-lived session renders on different pages:

```ts
teleop.setVideoEl(myVideoEl);   // point the live stream at this element (null to detach)
teleop.setAudioEl(myAudioEl);   // same for the robot's inbound audio sink
```

Detaching with `null` stops *rendering* but the robot keeps encoding + sending. On a Pi 5 (no
hardware H.264 encoder — video is software x264, often the biggest power draw) that's wasteful when
nothing is watching. Pause the **encoder itself**, not just the sink:

```ts
teleop.pauseVideo();            // robot drops frames BEFORE the encoder -> it goes idle (power saved)
teleop.resumeVideo();           // re-enable; the robot forces a keyframe so video reappears at once
```

Notes: pause/resume ride the control data channel (no renegotiation, fast resume) and are safe to
call before the channel is open — the desired state is applied on open (so "pause on connect, resume
only while a viewer is mounted" works). Control + telemetry are a separate transport, so pausing
video never affects jog/telemetry. A fresh session starts flowing at the defaults.

**Grab a still frame** (e.g. to feed a vision model) without a `<video>` element — reads the live
track directly:

```ts
const blob = await teleop.captureFrame();   // JPEG Blob, or null if no video is arriving
// If the encoder may be paused, use snapshot(): it resumes, waits for a frame, grabs, re-pauses:
const still = await teleop.snapshot();       // JPEG Blob, or null
```

**Per-camera stills.** Both take an optional camera `role` (from the layout — see "Per-camera
views" below) to crop one tile out of the composite; this is what a per-camera LLM `look` maps to:

```ts
const wrist = await teleop.snapshot(500, "left_wrist");     // one tile, or null
const over  = await teleop.captureFrame("image/jpeg", 0.7, "overhead");
```

⚠️ **Unknown role -> `null`, never the full composite.** Deliberate: if your caller labeled the
frame (e.g. told a vision model "this is left_wrist"), a silent fallback would hand it a mislabeled
image. On `null` with a role set, report the valid roles (`cameraLayoutInfo()?.tiles`) instead.
Single-camera robots send no layout, so any `role` returns `null` there — use the bare calls.
The role→rect mapping itself is exported as `cameraTileRect(layout, role, w, h)` (pure,
unit-tested) if you need the same math elsewhere.

**The raw stream, no DOM required** — for canvas pipelines, ML/CV consumers, or
`MediaRecorder`:

```ts
const stream = teleop.videoStream();        // MediaStream | null (null until the track arrives)
// e.g. record it:
const rec = new MediaRecorder(stream!);
// Do NOT stop() its tracks — they belong to the peer connection. Just drop your reference.
```

**Per-camera views.** The robot sends **one composite track** (all cameras tiled into a grid —
see "What to expect" below). The bridge announces which camera is in which tile
(`cameraLayoutInfo()` / `onCameraLayout`), and `cameraView(role)` crops a tile into its own
`MediaStream` so you never do quadrant math:

```ts
teleop.cameraLayoutInfo();                       // {cols, rows, tiles} | null (also: onCameraLayout)
const view = teleop.cameraView("left_wrist");    // CameraViewHandle | null
if (view) {
  myVideoEl.srcObject = view.stream;             // or feed it to CV / MediaRecorder
  // later:
  view.stop();                                   // ends the crop loop (composite unaffected)
}
```

`cameraView` returns `null` until both the video track **and** the layout frame have arrived,
or if the role isn't in the layout. Single-camera robots send no layout — use `videoStream()`.
Each live view runs a canvas draw loop (per decoded frame when the browser supports
`requestVideoFrameCallback`), so `stop()` views you're not showing.

### Video-only quick start

"Watch the robot" in its entirety — no jog, no telemetry:

```ts
import { RemoteTeleop } from "@nori/sdk";
import { SupabaseSignaling } from "@nori/sdk/supabase";

const teleop = new RemoteTeleop({
  signaling: new SupabaseSignaling(supabase, room, console.log),
  videoEl: document.querySelector("video")!,
  stun, turnUrls, turnUser, turnCred, forceRelay: false,
  arm: "right", onLog: console.log, onConnState: console.log,
  onTelemetry: () => {}, onMode: () => {}, onControlActive: () => {},
});
teleop.start();                                  // video appears in the element when connected
// teleop.stop() to tear down.
```

### What to expect from the feed (read before filing a video issue)

- **One H.264 track, composite grid** of all robot cameras (typically 320×240 per tile at
  15 fps as of 2026-07-08). There are no per-camera tracks on the wire — `cameraView()` is
  the supported per-camera access. This is a deliberate design (one encode on the robot).
- **The ceiling is robot power, not the protocol**: the Pi 5 has no hardware H.264 encoder,
  so encode pixels×fps directly hits the robot's power budget. Resolution/fps are tuned to
  measured hardware limits and will improve when the robot's supply hardware does. A
  live-switchable resolution API is designed and lands when that headroom exists.
- `setVideoQuality("low"|"normal")` changes **bitrate only** (bandwidth, not robot CPU);
  `pauseVideo()` is the control that actually saves robot power.
- WAN delivery is typically ~15 fps; the encoder doesn't send more than the link carries.

> **Status:** `setVideoEl`/`setAudioEl`, `pauseVideo`/`resumeVideo`, `captureFrame`/`snapshot`,
> `videoStream`, and `cameraView` are implemented and typecheck/build-clean, but **pending
> on-robot verification** (encoder power drop + clean keyframe resume + frame grab + tile-crop
> against a real composite). The inbound video feed itself is hardware-verified and stable.

## Perception — structured world-state

Separate from the video track (human eyes) and the one-shot LLM-vision still: `perceive()` returns
the latest **structured** detections from the daemon's on-Pi perception process, so a *running*
program can react to what the robot sees.

```ts
const world = teleop.perceive();               // PerceptionView | null (null = no frame yet)
const cup = world?.objects.find((o) => o.label === "cup");
if (cup?.xyz && (teleop.perceptionAgeMs() ?? Infinity) < 500) {
  // cup.xyz is [x,y,z] in robot-base meters; cup.bbox is normalized [x,y,w,h]. Both optional —
  // present depends on the detector (2D vs depth). Check age: a dead detector leaves a stale frame.
}
```

Subscribe instead of polling with the `onPerception` option. `objects: []` is an explicit "nothing
seen" — distinct from `null` ("no frame"). Frames ride the control channel (`type:"perception"`,
nori-protocol `perception.json`).

> **Status:** the SDK parse/cache/`perceive()`/`injectPerception()` surface is implemented and
> unit-tested, but the **on-robot detector that emits `perception` frames does not exist yet** —
> `perceive()` returns `null` on real hardware today. `injectPerception()` feeds synthetic frames
> through the same path for development.

## Action completion

Tag an absolute move with an `action_id` and the daemon reports its lifecycle back
(`accepted → active → done | clamped | blocked | timeout`), so a script can await what *actually*
happened instead of guessing from telemetry:

```ts
const id = teleop.nextActionId();
teleop.sendAction({ "right_arm_shoulder_pan.pos": 30 }, id);   // tag the frame(s)
const status = await teleop.awaitAction(id, { timeoutMs: 5000 });
// status.state: "done" | "clamped" | "blocked" | "timeout" (+ status.reason for blocked/timeout)
```

`actionStatus(id)` returns the latest status seen (any state) — the executor uses it to detect whether
the daemon is participating. `awaitAction` self-resolves to a synthetic `timeout` if the daemon is an
older build without action completion, so it never hangs; `onActionStatus` streams every transition
for logging. The executor's `nori.moveTo(...)` uses all of this internally and returns the daemon's verdict.

> **Status:** SDK + executor implemented and unit-tested. The daemon that emits `action_status`
> is built but **not yet deployed to every robot**, with tolerances still being tuned on hardware;
> until a robot has it, `moveTo` transparently falls back to its client-side heuristic.

## Cartesian pose targets — `sendPose` (capability `pose_targets`)

`sendPose(side, positionM, orientationXyzw?, actionId?)` commands an absolute gripper-TCP pose
and the **robot solves the IK on-board** — the wire never carries joint solutions, so every
client shares one IK implementation instead of each shipping its own. Metres in
`base_footprint` (fixed to the robot, stable
across lift travel), REP-103 axes (+x forward, +y left, +z up), optional ROS-order quaternion
`[x, y, z, w]` — omit it for "get the gripper to this point, any wrist angle" (v1 solves at the
robot's current wrist, so a position-only failure is worth retrying with an explicit
orientation). The lifecycle rides the same `action_status` path as `sendAction`:

```ts
if (supportsCapability(teleop.robotInfo(), "pose_targets")) {
  const id = teleop.nextActionId();
  teleop.sendPose("right", [0.42, -0.18, 0.95], undefined, id);
  const status = await teleop.awaitAction(id, { timeoutMs: 15000 });
  // "done" — or "blocked" with a reason that says what to do next:
  //   no_ik_solution  full pose: unreachable at this lift height, don't retry
  //   ik_timeout / ik_no_reply   solver busy or silent — retry
  //   config_jump     the solve needed an elbow flip — split the move into waypoints
  //   lift_moved      the lift moved since the solve — re-send to re-solve
  //   limit:<joint> / singularity / collision / frame:<name>
  // The reason set is OPEN: render unknown values verbatim, never fail on one.
}
```

Three contracts worth knowing:

- **Capability-gated, three-valued.** A robot without `pose_targets` ignores the frame
  *silently*, so `sendPose` **throws** on an explicitly missing capability rather than letting
  a script hang to its timeout. A legacy ack (no capabilities field at all) passes through —
  probe-or-assume-legacy is the ack contract. The mock **advertises `pose_targets` and serves
  it** (its default capability set matches a healthy A3 gateway), so `sendPose` against mock
  mode goes through the full `accepted -> active -> done` lifecycle — but the stock mock does
  no IK: an accepted pose just nudges one joint so telemetry visibly responds. Protocol
  rehearsal, not geometry. To rehearse the throw, trim the set:
  `new MockDaemonSim({ capabilities: ["task_jog", "record"] })`.
- **Terminal states come from observed motion**, never from the solver returning: the
  intermediate `active` means solved-and-tracking, and a pose that stops progressing ends
  `blocked` with the live Servo status named. There is no accepted-then-nothing state.
- **One arm per call** (arms fail independently — a dual-arm pose is two calls); the gripper
  stays on `sendAction`; the lift never moves implicitly — a pose out of reach at the current
  lift height is a refusal, never a surprise lift move.

> **Status:** SDK side implemented and unit-tested against the spec fixtures; the A3 gateway
> is bench-verified through the full lifecycle, and the Python SDK's identical pose path has
> run end-to-end over a live WebRTC session. This browser-SDK path itself has **not yet run
> end-to-end against a live robot**.

## Recording training data (on-robot episodes)

Recording captures the robot's full-quality frames, observations and commanded
actions. The browser stream is a preview; it is not the training copy.

Use a fresh, read-only status request to discover review support:

```ts
const status = await teleop.recordStatus();
if (status.reviewSupported) {
  const recovered = await teleop.recordConfirmed("review_status");
  // Restore any active/pending owned take before starting another recording.
} else {
  // Older L3 and L2 robots retain the legacy command flow below.
}
```

`recordStatus()` sends one `status` request without a request ID and accepts a
legacy status reply. Concurrent probes share one promise. No response within
1.5 seconds is a connection/status error; it is not evidence that review is
unsupported. Recorder refusals also remain errors. A successful reply with
missing/false review support selects legacy recording. Discovery never starts,
stops, or discards an episode and cannot acknowledge a mutation.

For a supporting robot, opt into durable review and target the stable ID:

```ts
await teleop.recordConfirmed("session_start", { task: "fold the towel" });
const take = await teleop.recordConfirmed("episode_start", {
  task: "fold the towel", reviewRequired: true,
});
if (!take.episodeId) throw new Error("Robot omitted the review episode ID");
// ...drive a demonstration...
await teleop.recordConfirmed("episode_stop", { episodeId: take.episodeId });
await teleop.recordConfirmed("episode_keep", { episodeId: take.episodeId });
// Or episode_reject for that same ID; do not send both decisions.
await teleop.recordConfirmed("session_end");
```

Stop holds an opted-in take out of the upload queue. Acknowledged Keep releases
it; acknowledged Reject removes it from shipping and quarantines it for cleanup.
`recordConfirmed()` matches request IDs and retries the identical request.
Never let an unrelated legacy reply acknowledge Keep, Reject, or another
mutation. A mutation timeout has an uncertain result: recover status before
issuing another mutation, particularly Start.

For robots without review support, keep using the one-shot legacy API:

```ts
teleop.record("session_start", "fold the towel");
teleop.record("episode_start", "fold the towel");
// ...drive a demonstration...
teleop.record("episode_stop");
// Keep is a local UI choice; Reject sends the legacy command:
// teleop.record("episode_discard");
teleop.record("session_end");
```

Legacy commands do not require review UUIDs or correlated replies and do not
send `review_required`. Observe replies through `onRecord` / `recordState()`;
there is no reliable acknowledgement/retry guarantee on those peers. Do not use
`recordConfirmed()` as a legacy fallback simply by removing `review_required`:
an old robot may execute Start without ever completing the correlated waiter.

Legacy firmware semantics differ. Old L3 Stop immediately makes a take eligible
for upload; its `episode_discard` finalizes an active take with a retained
DISCARDED outcome and cannot delete an already-stopped take. L2 retains its
existing session/discard behavior. The app labels this mode "Review unavailable
on this robot" and does not guarantee deletion through legacy Reject. Session
discard aliases must not substitute for targeted review deletion.

Keep each take's recording mode through reconnects. A held modern take must wait
for modern review support to return; it must never fall back to legacy discard.
A legacy take cannot acquire a review hold after it was recorded. The SDK's
existing `record()` API remains available to other clients such as VR workflows.

`RecordState` includes `ok`, `error`, `recording`, optional `sessionOpen`,
`episodesKept`, display-only `episode`, `freeGb`, and `stereo`. Review-capable
replies additionally provide stable `episodeId`, `pendingReviews`,
`activeReviewEpisodeId`, and `episodeRemoved`. `reviewSupported` is true only
when explicitly advertised by the robot. A status response is not upload status.

## Streaming audio to the robot speaker

`sendClipAudio` streams an arbitrary audio **track** to the robot's speaker over the same
reserved uplink the two-way call uses (renegotiation-free `replaceTrack`). It's transport-only —
you supply the `MediaStreamTrack`; the SDK does not fetch, decode, or set levels.

```ts
// Build a track from an audio file WITHOUT playing it on the laptop (route through a
// MediaStream sink only, never ctx.destination), and CAP THE LEVEL (see the caveat):
const ctx = new AudioContext();
const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
const src = ctx.createBufferSource(); src.buffer = buf;
const gain = ctx.createGain(); gain.gain.value = 0.7;     // ← cap output level (see below)
const dest = ctx.createMediaStreamDestination();
src.connect(gain); gain.connect(dest);

await teleop.sendClipAudio(dest.stream.getAudioTracks()[0]); // reserve uplink + start
src.start();
src.onended = () => { void teleop.sendClipAudio(null); ctx.close(); }; // hand uplink back / detach
```

**Requirements & caveats — read before you ship audio:**

- **Robot voice downlink must be ON** (`webrtc_robot.py --voice` / `NORI_VOICE` + a speaker):
  only then is the audio m-line `sendrecv` and does the robot play what you send. Otherwise
  `sendClipAudio` returns `false` and nothing transmits.
- **One audio m-line** — a clip and the mic share it. A clip takes the uplink; `sendClipAudio(null)`
  hands it back to the mic (if a call is active) or detaches.
- **Real-time Opus, not a file transfer** — audio plays as it streams; a network drop drops it.
  The caller owns the track's lifetime (stop it when the source ends).
- **Clips don't ring the robot.** Robots gate their room microphone behind a local accept
  prompt (a person AT the robot must consent before an operator can hear the room). A clip is
  speaker-only — nobody is asking to listen — so `sendClipAudio` announces itself as a clip and
  plays immediately: no accept prompt, and the robot's mic stays shut. `joinCall()` is the one
  that rings: on a consent-gated robot expect silence (no room audio) until someone at the robot
  accepts. Older robot builds ignore the clip marker and may ring anyway — harmless.
- **Output level is capped ON THE ROBOT** (self-defending — you don't have to trust the client):
  the robot clamps downlink playback to `NORI_SPEAKER_GAIN` (default **0.7**) with a `volume`
  element before the sink, so no track you send can overdrive the speaker. This exists because a
  near-full-scale clip drives the speaker amp far harder than call speech and can brown out some
  USB speaker hardware mid-stream. You *may* still attenuate client-side (defense-in-depth), but
  the guarantee lives on the robot; for loud playback also prefer a powered USB hub + a robust speaker.
- **Speaker device must be name-stable** — set `NORI_SPEAKER` to a **dmix alias (`nori_out`) or
  `hw:CARD=<name>`, never `hw:<number>`**. A device that re-enumerates comes back as a *new*
  card number, so a numbered device is unrecoverable after any reset.

> The code sample above is the reference pattern (fetch/decode, gain-cap at `0.7`, and uplink
> lifecycle) — copy it as your starting point.

## VR (`@nori/sdk/vr`)

WebXR immersive control. A `VrSession` runs the controller→jog mapper and drives an existing
`RemoteTeleop`. Peer dependency: `three`.

```ts
import { VrSession, DEFAULT_BINDINGS } from "@nori/sdk/vr";

if (await VrSession.isSupported()) {
  const session = new VrSession({
    teleop,                     // a started RemoteTeleop
    videoEl: video,             // same element the robot stream is attached to
    onLog: (m) => console.log(m),
    onEnd: () => console.log("VR ended"),
  });
  // feed telemetry/currents in for the in-VR HUD + haptics:
  //   teleop options onTelemetry -> session.setTelemetry(t)
  //   teleop options onCurrents  -> session.setCurrents(c)
  await session.start();        // enters immersive-vr
}
```

Grip = squeeze-to-move (clutch), trigger = that arm's gripper; see `DEFAULT_BINDINGS` for the map.

## Advanced: bring your own signaling

`SupabaseSignaling` is just one implementation of the `SignalingTransport` contract. To run
without Supabase (your own WebSocket, a different SaaS, even manual copy/paste), implement the
interface — the WebRTC/auth/jog logic is transport-agnostic:

```ts
import type { SignalingTransport, SignalingHandlers } from "@nori/sdk";

class MySignaling implements SignalingTransport {
  async connect(h: SignalingHandlers) {
    // wire your transport to: h.onSdp, h.onIce, h.onRobotHere, h.onOpen
  }
  sendReady(p: { mac?: string }) { /* broadcast 'ready' */ }
  sendSdp(p) { /* broadcast our SDP answer */ }
  sendIce(p) { /* broadcast a local ICE candidate */ }
  sendBye() { /* best-effort 'leaving'; never throw */ }
  async close() { /* tear down; idempotent */ }
}
```

The robot side (`webrtc_robot.py`) must exchange the same named events (`sdp`, `ice`,
`robot_here`, `ready`, `bye`). The event *shapes* are the `SdpPayload` / `IcePayload` /
`RobotHerePayload` types exported from `@nori/sdk`.

## Entry points

| Import | Contains | Extra dep |
|---|---|---|
| `@nori/sdk` | `RemoteTeleop`, navigation/telemetry/jog/keybind types, `SignalingTransport` contract, `NORI_PROTOCOL_VERSION` | none |
| `@nori/sdk/vr` | `VrJogMapper`, `VrSession`, `DEFAULT_BINDINGS`, VR types | `three` |
| `@nori/sdk/supabase` | `SupabaseSignaling` (reference transport) | `@supabase/supabase-js` |
| `@nori/sdk/mock` | `createMockRobot`, `MockDaemonSim`, `createLoopbackSignaling` (dev/CI fake robot) | none |

## License & lineage

Apache-2.0 (see `LICENSE`). Developed within Nori's fork of
[huggingface/leLab](https://github.com/huggingface/lelab) (Apache-2.0); the SDK package files
are Nori-original additions, marked with `// NORI:` header comments.

## Status

v1 (see `package.json` for the exact release). The core teleop + VR surface is stable and the wire base-sign convention is pinned to
the nori-protocol fixture (spec REP-103 everywhere; the L2 legacy flip lives behind a positive
model match — see "Driving the robot → Base"). The two-way **call** API
(`joinCall`/`leaveCall`/mic/camera on `RemoteTeleop`) is present but **experimental** and may
change. **Cartesian pose targets** (`sendPose` +
`supportsCapability`) are new (2026-08-24): wire shape pinned to the nori-protocol fixtures and
unit-tested, robot side bench-verified, browser end-to-end still pending its first live run. Note the robot-side consent gate: `joinCall()`
rings an accept prompt at the robot and room audio stays silent until a person there accepts
(clips via `sendClipAudio` are exempt — see "Streaming audio").
