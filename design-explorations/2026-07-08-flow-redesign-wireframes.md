# MakerLab flow redesign — wireframe exploration spec

Three divergent IA concepts for a flow-based MakerLab, delivered as plain-HTML wireframes
(one self-contained file per concept in `design-explorations/wireframes/`).

## Why (context)

- Current MakerLab is a dense dashboard: the landing screen carries robot controls,
  dataset controls, one training button per policy type, and the whole jobs/models board.
  No journey through the product.
- MakerMods-LeRobot-UI (the wizard app) has flow but is a rigid 8-step funnel and loses
  ports/cameras/calibration on refresh.
- MakerLab already has the right backbone: `RobotRecord` is a persistent backend entity
  (name, single/bimanual mode, ports, calibration file assignments, cameras, motor power).
  All three concepts assume that entity; the redesign is presentation-layer IA.

## Requirements (all concepts)

1. **Robot config is the prerequisite.** First-run (no saved robot) forces robot setup
   front and center. Nothing else is reachable until one robot config is ready.
2. **Robot chip in the header** once configured: compact pill `● <robot-name> ▾` + a gear
   button next to it. Out of the way, always accessible, on every screen.
   - Clicking the pill opens a dropdown panel with two tabs: **Single | Bimanual**,
     each listing saved configs for that mode (name + ready/needs-setup status dot).
     Selecting a row switches the active robot instantly (this must feel instant —
     switching robots to record or run a policy on different hardware is a core flow).
     Panel footer: **“+ New config”** button.
   - Gear opens **Robot Settings** (full screen or slide-over): ports per arm
     (leader/follower, with “Detect (wiggle)” physical-identify button), calibration file
     per arm (dropdown from library + “Calibrate now”), cameras (single canonical camera
     config — today it's duplicated across 3 modals), motor power. Save returns to where
     the user was.
3. **Flow, not wizard.** The product reads as two phases:
   **Phase 1 — Collect: teleoperate + record datasets. Phase 2 — Improve: train + inference.**
   The UI should carry the user forward through those phases (visible next step,
   handoff moments) but never lock navigation the way a wizard does. Gate only on real
   prerequisites (no robot → can't teleop; no dataset → can't train) and always say why
   (disabled control + one-line reason), never hide.
4. **Handoff moments** make the flow: after a recording session ends → “Dataset <name>
   updated · N episodes → Train on this dataset”; after a training job completes →
   “Model ready → Run it on <robot>”.
5. Live sessions (teleop / record / inference) are immersive full-screen states with one
   obvious exit; config never happens on a live screen.

## Wireframe deliverable conventions (hard rules)

- One **self-contained** `.html` file per concept. No frameworks, no design system, no
  external assets, no webfonts, no colors other than grayscale (white bg, #333 text,
  #999 1px borders, #eee fills, dashed borders for placeholders/notes). System
  font stack only. This is a wireframe: gray boxes with labels, not a styled product.
- Small inline `<script>` (vanilla) to switch screen states and toggle the robot dropdown
  / settings panel. No build step; file opens directly with `file://`.
- Fixed strip at the very top of the page: `WIREFRAME <concept name> — screen:` followed
  by one button per screen state (this strip is the wireframe's own nav, clearly not part
  of the design).
- Every concept must include these screen states (plus any concept-specific ones):
  1. `first-run` — no robot exists; robot setup is the whole screen
  2. `home` — the concept's main IA view with a ready robot
  3. `robot-dropdown` — home with the robot chip dropdown open (Single/Bimanual tabs,
     config rows with status dots, “+ New config”)
  4. `robot-settings` — the settings surface (ports / calibration / cameras / motor power)
  5. `live-record` — immersive recording session (camera feeds placeholder, episode
     counter, re-record / stop)
  6. `post-record` — the record→train handoff moment
  7. `train` — training config + running-job monitoring (may be two sub-states)
  8. `inference` — pick model → run on active robot → live monitor
- Use dashed “NOTE:” boxes sparingly to annotate design intent on the wireframe itself
  (e.g. “switching robot here re-targets inference to that hardware”).
- Keep each file under ~700 lines. Clarity over completeness: boxes + labels.

## Concept A — “Pipeline rail” (`concept-a-pipeline.html`)

A persistent horizontal pipeline rail sits under the header on every screen:

```
[1 ROBOT ✓] ──► [2 COLLECT] ──► [3 DATASET] ──► [4 TRAIN] ──► [5 DEPLOY]
```

- The rail is the primary navigation. Each stage is a full page below the rail. Current
  stage highlighted; completed stages get a check; stages with unmet prerequisites are
  grayed with the reason on the stage itself. All stages clickable when their
  prerequisites are met — this is a metro map, not a stepper.
- Stage 1 ROBOT collapses to a check + robot name once configured (details live in the
  header chip/gear); clicking it opens robot settings.
- COLLECT page: two cards — “Teleoperate (practice, nothing saved)” and “Record dataset”
  (dataset picker + new dataset + episode settings summary). Launching either goes to the
  immersive live screen; the rail hides during live sessions.
- DATASET page: dataset list with episode counts; selected dataset shows summary card and
  “Train on this →” which pre-fills stage 4.
- TRAIN page: one policy-type dropdown (not N buttons), essentials form, jobs list with
  inline status; a completed job row shows “→ Deploy”.
- DEPLOY page: model picker (from finished jobs / imports), target = active robot chip
  (switch robot right here via the same dropdown), Run → live monitor state.
- The rail doubles as status-at-a-glance: e.g. `3 DATASET — pick-cube (24 ep)` as a
  subtitle under the stage label.

## Concept B — “Two studios” (`concept-b-studios.html`)

The app is two workspaces with one top-level toggle in the header:

```
logo   [ COLLECT ]  [ TRAIN & DEPLOY ]          ● arm-01 ▾  ⚙
```

- **Collect studio**: left 2/3 = action canvas (Teleoperate card + Record card; the live
  session takes over the canvas), right 1/3 = datasets rail (searchable list, episode
  counts, per-row overflow menu ⋯ instead of button rows). After a session, the handoff
  banner appears across the canvas top: “pick-cube +8 episodes → Train”.
- **Train & Deploy studio**: left 2/3 = canvas that hosts either train config, job
  monitor, or inference monitor; right 1/3 = two stacked rails: Jobs (running/queued with
  status chips) and Models (finished/imported; each row: “Run on <active robot>” and ⋯
  menu with fine-tune/rename/delete).
- Crossing the studio boundary is the phase transition; the “→ Train” handoff banner in
  Collect deep-links into Train & Deploy with the dataset pre-selected.
- Density rule this concept demonstrates: max one primary button per card; everything
  else is in ⋯ overflow menus. This is the calm evolution of the current landing page.

## Concept C — “Mission timeline” (`concept-c-timeline.html`)

One vertically scrolling page — the whole project is a living checklist/notebook.
Sections stack in order; each section collapses to a one-line summary once satisfied and
re-expands on click. The furthest incomplete section is auto-expanded.

```
① Robot        ▸ collapsed: “● arm-01 · single · calibrated”        [change]
② Collect      ▾ expanded: teleop card, record card, session history list
③ Dataset      ▸ “pick-cube · 24 episodes”                          [browse]
④ Train        ▾ policy dropdown + essentials + running job inline log strip
⑤ Deploy       ▸ “no model yet — finish a training run”
```

- Collapsed lines ARE the status dashboard; scanning the page top to bottom answers
  “where am I in this project?”. Section numbers connected by a vertical line (the flow
  made literal).
- Session history inside ② (rows: date, dataset, +N episodes) gives the flow a memory —
  a rerun of record is one click on a history row (“record more like this”).
- Live sessions overlay the full viewport (timeline dims behind), then return and update
  the relevant section (e.g. ② history gains a row, ③ episode count bumps).
- The robot chip still exists in the header (identical behavior to other concepts);
  section ① is the same data presented as project status. NOTE box should acknowledge
  this dual surface.
- One concept-specific extra state: `live-inference` overlay showing the model, robot,
  and a stop control, to demonstrate the overlay pattern applies to phase 2 as well.

## Out of scope for the wireframes

Real API wiring, theming, responsive breakpoints, replay/edit-dataset/upload flows,
HF auth. Mention replay only as a ⋯ menu item on dataset rows.
