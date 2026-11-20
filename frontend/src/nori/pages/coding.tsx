// NORI: "Run Nori with code" — the Tier-1 script console (docs/llm_integration_plan.md).
//
// The editor drives the SAME persistent teleop session the Remote page connects (via
// TeleopSessionProvider), so the connection survives navigating here from Remote. Run executes
// the code in a sandboxed Web Worker → ScriptDriver → the live RemoteTeleop (identical wire to
// keyboard/VR teleop). The code text and the session both persist across page changes.
//
// Safety: this can move the robot. The operator is the supervisor — live video is on the Remote
// page, E-STOP is here and on Remote, and the daemon watchdog safe-stops if the tab dies. Timed
// jogs (reach/joint/grip) are open-loop; moveTo waits for the daemon's arrival result (done/blocked/
// clamped/timeout). The robot's own clamps/watchdog are the real boundary (the daemon defends
// itself), which is why this ships without a client-side gate.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThemeProviderContext } from "@/contexts/ThemeContext";
import { Play, Square, OctagonX } from "lucide-react";
import { useTeleopSession } from "@/nori/TeleopSessionContext";
import { useNori } from "@/nori/NoriContext";
import { aspireApi, TERMINAL, type TaskEvent } from "@/nori/aspire/api";
import { ScriptSession } from "@/nori/remote/ScriptSession";
import { startMockPerception, type MockPerceptionHandle } from "@/nori/remote/mockPerception";
import { useApi } from "@/contexts/ApiContext";
import { isDirectBackend } from "@/nori/api/client";
import { hostedGenerateStream, hostedGenerateWithSkills, hostedRobotAdvice } from "@/nori/llm/hostedLlm";
import { useConnectGate } from "@/nori/components/ConnectionPanel";

const CODE_EXTENSIONS = [javascript({ typescript: true }), EditorView.lineWrapping];
const PY_EXTENSIONS = [python(), EditorView.lineWrapping];

// Python-mode starter: a primitive policy (System-2 RealA3Task surface). Runs server-side (M3);
// for now it is generate + review only (Python mode Run is disabled until the runner is wired).
const PY_STARTER = `# Primitive policy — runs server-side on the robot's RealA3Task (not wired yet: M3).
# Metric, closed-loop. Observe, locate, then grasp — never assume a coordinate.
task.observe()
loc = task.locate_object(view="overhead", xyz=[0.24, -0.16, 0.95])
task.move_to([loc["xyz"][0], loc["xyz"][1], loc["grasp_hand_z"] + 0.04], fingers="down")
task.descend_until_contact()
task.gripper("right", "close")
task.done(task.grasped("right")["holding"], "picked (or not)")
`;

// Lenient client-side fence strip for the STREAMED output (the model is told not to fence, but
// unwrap gracefully if it does — incrementally: drop a leading ```lang line, and a trailing ```).
function stripFences(s: string): string {
  let out = s;
  if (out.startsWith("```")) {
    const nl = out.indexOf("\n");
    out = nl >= 0 ? out.slice(nl + 1) : "";
  }
  const close = out.lastIndexOf("```");
  if (close >= 0 && out.slice(close).trim() === "```") out = out.slice(0, close);
  return out;
}

// Does `src` parse as the body of an async function (how the worker runs it)? Compiling via the
// AsyncFunction constructor throws SyntaxError on bad code WITHOUT executing it — a pure parse check.
const AsyncFunctionCtor = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => unknown;
function isValidScript(src: string): boolean {
  // Same parameter list as the worker's runner ("nori" + legacy "robot" alias), so the parse
  // check compiles exactly what will run.
  try { new AsyncFunctionCtor("nori", "robot", src); return true; } catch { return false; }
}

// Blob -> bare base64 (no "data:image/jpeg;base64," prefix) for the LLM image block.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Shown when the editor is empty, so a first-time user has something runnable.
const STARTER = `// Drive the robot with the injected \`nori\` API. Timed jogs; moveTo waits for arrival.
// The robot moves only while a script runs; you are the supervisor (E-STOP below).

await nori.joint("left", { elbow_flex: 0.3 }, 800);   // per-joint jog, held 800ms
await nori.wait(300);
await nori.grip("left", "open");
nori.log("done");
`;

const Coding = () => {
  const {
    teleop, connState, connecting, connect, tel, scriptSource, setScriptSource, setSessionBusy, heldNote, setYield,
  } = useTeleopSession();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { activeRobotSerial, customer } = useNori();
  const robotSerial = activeRobotSerial ?? customer?.robot_serial_number ?? null;
  const aspire = useMemo(() => aspireApi(baseUrl, fetchWithHeaders), [baseUrl, fetchWithHeaders]);
  const connectBlocked = useConnectGate();

  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState(""); // live LLM tokens while generating
  const [attachVision, setAttachVision] = useState(false); // Part 3: send a camera still to the model
  const [cameraLayout, setCameraLayout] = useState(() => {
    try { return localStorage.getItem("nori_camera_layout") ?? ""; } catch { return ""; }
  });
  const [lastFrame, setLastFrame] = useState<string | null>(null); // data URL of the last attached frame
  const [mockPerception, setMockPerception] = useState(false); // dev: feed synthetic nori.perceive() frames
  // Two SDK modes: "ts" = the JS teleop console (default, runs in the Worker); "python" = policies
  // against the System-2 primitive surface / raw nori_sdk (runs server-side — M3, not wired yet).
  const [mode, setMode] = useState<"ts" | "python">(() => {
    try { return localStorage.getItem("nori_coding_mode") === "python" ? "python" : "ts"; } catch { return "ts"; }
  });
  const [flavor, setFlavor] = useState<"primitives" | "sdk">(() => {
    try { return localStorage.getItem("nori_coding_flavor") === "sdk" ? "sdk" : "primitives"; } catch { return "primitives"; }
  });
  // python-mode buffer (ts uses the shared scriptSource, which persists via the teleop context). Persist
  // this to localStorage so it survives navigating to another Lab page + back, like the TS buffer does.
  const [pySource, setPySource] = useState(() => {
    try { return localStorage.getItem("nori_coding_py_source") ?? PY_STARTER; } catch { return PY_STARTER; }
  });
  useEffect(() => { try { localStorage.setItem("nori_coding_py_source", pySource); } catch { /* ignore */ } }, [pySource]);
  // Python run target: "sim" (the SimSession runner) or "real" (the robot via the ASPIRE worker's TASK
  // session — it EVICTS the teleop session when it runs; see M4).
  const [target, setTarget] = useState<"sim" | "real">(() => {
    try { return localStorage.getItem("nori_coding_target") === "real" ? "real" : "sim"; } catch { return "sim"; }
  });
  useEffect(() => { try { localStorage.setItem("nori_coding_mode", mode); } catch { /* ignore */ } }, [mode]);
  useEffect(() => { try { localStorage.setItem("nori_coding_flavor", flavor); } catch { /* ignore */ } }, [flavor]);
  useEffect(() => { try { localStorage.setItem("nori_coding_target", target); } catch { /* ignore */ } }, [target]);
  // Table height (m) for a robot run: passed as constraints.table_z so the worker anchors the monocular
  // depth to the real table (else locate_object's heights drift). The robot's measured table height.
  const [tableZ, setTableZ] = useState(() => { try { return localStorage.getItem("nori_coding_table_z") || "0.73"; } catch { return "0.73"; } });
  useEffect(() => { try { localStorage.setItem("nori_coding_table_z", tableZ); } catch { /* ignore */ } }, [tableZ]);
  const sessionRef = useRef<ScriptSession | null>(null);
  const pyRunRef = useRef<{ runId: string | null; taskId: string | null; abort: AbortController } | null>(null); // active python/server/task run
  const skillsRef = useRef<string | undefined>(undefined); // skill-library text fetched before a python generate
  const adviceRef = useRef<string | undefined>(undefined); // robot advice/context (aspire_robot_notes), injected like the agent (P2)
  const mockPerceptionRef = useRef<MockPerceptionHandle | null>(null);
  const outRef = useRef<HTMLDivElement>(null);

  const code = mode === "python" ? pySource : scriptSource;
  const setCode = mode === "python" ? setPySource : setScriptSource;
  const connected = connState === "connected";
  const status = connected
    ? `connected · ${Math.round(tel.loopHz)} Hz`
    : connecting ? "connecting…" : "not connected";

  // Seed the editor once if it's empty (persisted afterwards).
  useEffect(() => {
    if (!scriptSource) setScriptSource(STARTER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [output]);

  // Keep nori.telemetry() current inside a running script.
  useEffect(() => { sessionRef.current?.setTelemetry(tel); }, [tel]);

  // Stop a running script if we navigate away (the SESSION persists; only the script stops).
  useEffect(() => () => sessionRef.current?.stop(), []);

  // A script run is hands-off by design — the operator watches video on Remote and never touches
  // the mouse — so hold off the idle auto-disconnect for its duration. The cleanup also clears the
  // flag when the page unmounts mid-run, which is correct: the unmount effect above stops the run.
  useEffect(() => {
    setSessionBusy("coding:script", scriptRunning);
    return () => setSessionBusy("coding:script", false);
  }, [scriptRunning, setSessionBusy]);

  // Dev: start/stop the synthetic perception feed so nori.perceive() returns data before the on-Pi
  // detector exists (Phase F). Off by default; injects through the same path a real frame takes.
  useEffect(() => {
    if (mockPerception && teleop) {
      mockPerceptionRef.current = startMockPerception(teleop);
      append("🫧 perception ON — nori.perceive() now returns objects (synthetic mock scene)");
    }
    return () => { mockPerceptionRef.current?.stop(); mockPerceptionRef.current = null; };
  }, [mockPerception, teleop]);

  const { theme } = useContext(ThemeProviderContext);
  const editorTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : theme;

  const append = (line: string) => setOutput((prev) => [...prev.slice(-300), line]);

  // LLM codegen: ask the server-side Claude proxy for a routine and drop it into the editor. The
  // generated code is fully editable — the operator reviews, then Runs. The API key stays on the
  // server (see docs/llm_codegen_design.md); the browser never sees it. One streamed request →
  // the finished (fence-stripped) code, live-updating the editor buffer.
  //
  // DESKTOP: POST to LeLab's `/nori/llm/generate/stream` (LeLab assembles + forwards). HOSTED
  // (LeLab-free): assemble in-browser and hit Nori-Backend's proxy directly (see hostedLlm.ts) —
  // baseUrl points at a dead localhost there, so the LeLab route isn't reachable.
  const runGeneration = async (
    robotState: Record<string, number>, imageB64: string | undefined, retryNote?: string,
  ): Promise<string> => {
    const req = {
      prompt, current_code: code, robot_state: robotState, image_b64: imageB64,
      // Operator text overrides; else the bridge-derived layout (which tile is which camera); else
      // nothing (the model is told not to assume). So vision knows which feed is which arm by default.
      camera_layout: imageB64 ? (cameraLayout.trim() || teleop?.cameraLayout() || undefined) : undefined,
      // Whether nori.perceive() is live RIGHT NOW (a frame in the last 2 s — real detector or
      // the "provide perception" mock), so the model only writes perceive()-polling loops when
      // they'll actually see data.
      perception_active: (teleop?.perceptionAgeMs() ?? Infinity) < 2000,
      retry_note: retryNote,
      mode,
      flavor: mode === "python" ? flavor : undefined,
      skills: mode === "python" ? skillsRef.current : undefined,
      advice: mode === "python" ? adviceRef.current : undefined,
    };
    // HOSTED primitive codegen: the model CHOOSES skills (index + read_skill tool loop), like the agent
    // worker — not a pre-injected top-N. Non-streaming (the loop must see tool_use), so show read events.
    if (isDirectBackend() && mode === "python" && flavor === "primitives") {
      setStreamBuffer("");
      const chosen = await hostedGenerateWithSkills(req, (name) => append(`📖 read skill: ${name}`));
      return stripFences(chosen);
    }
    const res = isDirectBackend()
      ? await hostedGenerateStream(req)
      : await fetchWithHeaders(`${baseUrl}/nori/llm/generate/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
    if (!res.ok || !res.body) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail?.detail || res.statusText);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    setStreamBuffer("");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setStreamBuffer(stripFences(acc));
    }
    return stripFences(acc);
  };

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    try {
      // DESKTOP (python/primitives): fetch the trigger-matched skills (policy_server) so LeLab injects
      // them. HOSTED uses the index + read_skill loop instead (the model chooses — see runGeneration),
      // so skip this fetch there (it has no /nori/skills endpoint anyway). Best-effort.
      skillsRef.current = undefined;
      if (!isDirectBackend() && mode === "python" && flavor === "primitives") {
        try {
          const sres = await fetchWithHeaders(`${baseUrl}/nori/skills?prompt=${encodeURIComponent(prompt)}`);
          if (sres.ok) {
            const sj = await sres.json();
            skillsRef.current = sj?.text || undefined;
            if (sj?.names?.length) append(`📚 skills consulted: ${sj.names.join(", ")}`);
          }
        } catch { /* skills are optional grounding */ }
      }
      // HOSTED (python/primitives): inject the robot's LEARNED ADVICE (aspire_robot_notes) — the channel
      // that actually drives the live agent (grasp heights, reach walls, real-perception deltas). This is
      // the parity step; skills stay index+read_skill like the agent. See docs/codegen-agent-parity-design.md P2.
      adviceRef.current = undefined;
      if (isDirectBackend() && mode === "python" && flavor === "primitives" && robotSerial) {
        try {
          const adv = await hostedRobotAdvice(robotSerial);
          adviceRef.current = adv || undefined;
          if (adv) append(`🧠 advice injected: ${robotSerial}'s learned context`);
        } catch { /* advice is optional grounding */ }
      }
      // 9a — proprioceptive grounding: hand the model the CURRENT pose so it can plan relative to
      // where the arm actually is ("pan is at +20 → jog negative to center") instead of guessing.
      const robotState = Object.fromEntries(
        Object.entries(tel.state ?? {}).map(([k, v]) => [k, Math.round(v * 10) / 10]),
      );
      // Part 3: optionally attach a camera still (snapshot() resumes the encoder if paused, grabs one
      // frame, re-pauses) + show the operator a thumbnail of what the model actually saw.
      let imageB64: string | undefined;
      if (attachVision && teleop) {
        const blob = await teleop.snapshot();
        if (blob) {
          imageB64 = await blobToBase64(blob);
          setLastFrame("data:image/jpeg;base64," + imageB64);
          append("📷 attached a camera frame");
        } else {
          setLastFrame(null);
          append("⚠ no camera frame (video not arriving) — sending without vision");
        }
      }
      // #3 — validate the result parses as JS; auto-retry ONCE with a firmer hint if the model
      // slipped in uncommented prose. (Parse-check is client-side — the browser is the JS engine.)
      let generated = await runGeneration(robotState, imageB64);
      // The parse check is JS-only (the browser is the JS engine). In Python mode we can't parse
      // here, so accept and let the server-side runner / review catch problems.
      const looksValid = (s: string) => mode === "python" || isValidScript(s);
      if (!looksValid(generated)) {
        append("⚠ generated code had a syntax error — regenerating once…");
        generated = await runGeneration(robotState, imageB64,
          "Your previous output had a JavaScript syntax error (often uncommented prose). Output ONLY valid JS; put any explanation in // comments.");
      }
      // An empty generation is not a one-line program: keep the editor as it was and say so
      // ("".split("\n").length is 1, which used to read as "generated 1 lines").
      if (!generated.trim()) {
        append("⚠ generate returned no code — the editor is unchanged; try again");
        return;
      }
      setCode(generated);
      append(looksValid(generated)
        ? `✎ generated ${generated.split("\n").length} lines — review, then Run`
        : `⚠ generated ${generated.split("\n").length} lines but it still won't parse — review before Run`);
    } catch (e) {
      append("⚠ generate failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGenerating(false);
    }
  };

  // M5 — target="real": run the policy through the ASPIRE TASK pipeline (backend /aspire/tasks, mode
  // "code_policy"). The worker claims the robot with a task grant, EVICTS this teleop app, runs the
  // source in policy_runner's sandbox against RealA3Task, and streams `step` events. E-STOP = cancel.
  // This is the production path (grant + eviction + arbitration + the executor's stop/E-STOP), unlike
  // the sim target's direct server-side runner.
  const runRobotTask = async () => {
    if (!robotSerial) { append("⚠ no robot selected — pair or select a robot first"); return; }
    setOutput([]);
    setScriptRunning(true);
    append(`▶ starting code-policy task on ${robotSerial}…`);
    const abort = new AbortController();
    pyRunRef.current = { runId: null, taskId: null, abort };
    try {
      const { task_id } = await aspire.start({
        robot: robotSerial, mode: "code_policy", source: code, flavor, budget: { seconds: 120 },
        // Coding mode: the executor does NOT home the arm first (home:false) — the policy owns homing, so
        // call task.home() yourself if you want the staging pose. (table_z anchors the depth when set.)
        constraints: { home: false, ...(Number(tableZ) > 0 ? { table_z: Number(tableZ) } : {}) },
      });
      if (pyRunRef.current) pyRunRef.current.taskId = task_id;
      setYield("coding-task", `code policy running on ${robotSerial} (coding page)`);
      append(`▶ task ${task_id} — the worker claims ${robotSerial}; this teleop session is evicted`);
      let since = 0;
      for (;;) {
        if (abort.signal.aborted) break;
        let evs: TaskEvent[] = [];
        try { evs = await aspire.events(task_id, since); } catch { /* transient; retry next tick */ }
        for (const ev of evs) {
          since = (typeof ev.n === "number" ? ev.n : since) + 1;
          if (ev.type === "step") {
            if (ev.api === "log") append("   log: " + String(ev.line ?? ""));
            else append(`   [${ev.seq ?? "?"}] ${String(ev.api ?? "")} → ${String(ev.status ?? "?")} ${ev.duration_ms ?? "?"}ms`);
          } else if (ev.type === "started") {
            append(`▶ ${String(ev.instruction ?? "code policy")} (grant ${String(ev.grant ?? "?")})`);
          } else if (ev.type !== "done" && ev.type !== "failed" && ev.type !== "cancelled") {
            append(`   · ${ev.type}`);   // armed / home / table / preflight / safety / operator_lost
          }
        }
        let rec: Awaited<ReturnType<typeof aspire.task>> | null = null;
        try { rec = await aspire.task(task_id); } catch { /* transient; retry */ }
        if (rec && TERMINAL.has(rec.status)) {
          append(`${rec.status === "done" ? "✓" : "⚠"} task ${rec.status}${rec.outcome ? " — " + JSON.stringify(rec.outcome) : ""}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (e) {
      append("⚠ task error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setScriptRunning(false);
      setYield("coding-task", null);
      pyRunRef.current = null;
    }
  };

  // Python mode: run the policy on the server-side runner (M3), streaming its NDJSON trace into the
  // output panel. target="sim" today; a real target is gated behind the runner's safety stack (M4).
  const runPython = async () => {
    if (scriptRunning || pyRunRef.current) return;
    if (target === "real") {
      // Real run → the ASPIRE task pipeline. No confirm dialog; the run is gated downstream by the task
      // grant + the operator's E-STOP + supervisor presence (the robot button is already a deliberate choice).
      await runRobotTask();
      return;
    }
    setOutput([]);
    setScriptRunning(true);
    append(`▶ running policy (server-side runner, target=${target})…`);
    const abort = new AbortController();
    pyRunRef.current = { runId: null, taskId: null, abort };
    try {
      const res = await fetchWithHeaders(`${baseUrl}/nori/policy/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: code, flavor, target }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) { append("⚠ policy run failed: " + res.statusText); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let o: Record<string, unknown>;
          try { o = JSON.parse(line); } catch { continue; }
          if (o.type === "started") {
            if (pyRunRef.current) pyRunRef.current.runId = o.run_id as string;
            append(`▶ run ${o.run_id} (${o.target})`);
          } else if (o.type === "event") {
            if (o.api === "log") append("   log: " + String(o.line));
            else append(`   [${o.seq}] ${o.api} → ${o.status} ${o.duration_ms ?? "?"}ms`);
          } else if (o.type === "result") {
            append(o.ok
              ? `✓ done in ${o.elapsed_s}s${o.done ? " — " + JSON.stringify(o.done) : ""}`
              : `⚠ ${o.stopped ? "stopped" : "error"}: ${o.error ?? ""}`);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") append("⚠ policy run error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setScriptRunning(false);
      pyRunRef.current = null;
    }
  };

  const stopPython = async () => {
    const r = pyRunRef.current;
    if (!r) return;
    r.abort.abort();
    if (r.taskId) {
      // M5 robot run: cancel the task — the executor stops motion (zero jog + E-STOP) before it ends.
      try { await aspire.cancel(r.taskId, "E-STOP from the coding page"); } catch { /* best-effort; the lease also expires */ }
    } else if (r.runId) {
      try {
        await fetchWithHeaders(`${baseUrl}/nori/policy/stop`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_id: r.runId }),
        });
      } catch { /* best-effort stop; the abort already closed the stream */ }
    }
    pyRunRef.current = null;
    setScriptRunning(false);
  };

  const run = () => {
    if (mode === "python") { void runPython(); return; }
    if (sessionRef.current) return;
    if (!teleop || !connected) { append("⚠ not connected — press Connect (or connect on Remote) first"); return; }
    setOutput([]);
    const session = new ScriptSession({
      teleop,
      onLog: (line) => append(line),
      onError: (message) => append("⚠ " + message),
      onDone: () => { setScriptRunning(false); sessionRef.current = null; },
    });
    sessionRef.current = session;
    session.setTelemetry(tel);
    setScriptRunning(true);
    append("▶ running…");
    session.run(code);
  };

  const stop = () => {
    if (pyRunRef.current) { void stopPython(); return; }
    sessionRef.current?.stop();
    sessionRef.current = null;
    setScriptRunning(false);
  };

  // Real safety path: latch the daemon + kill the worker + zero motion, at once.
  const estop = () => {
    append("■ E-STOP");
    if (pyRunRef.current) { void stopPython(); return; } // server-side run: /policy/stop + abort the stream
    sessionRef.current?.estop();
    if (!sessionRef.current) teleop?.command("estop");
    sessionRef.current = null;
    setScriptRunning(false);
  };

  return (
    // Marketplace-hero wash over the whole page: dot grid + blurred leaf/custard blobs
    // behind the cards. The 50vw-50% negative margins bleed the wash past the centered
    // content column to the viewport edges (padding restores the column); the content
    // wrapper is positioned so it paints above the absolute layers.
    <section className="relative -my-6 -mx-[calc(50vw-50%)] min-h-[calc(100vh-3.5rem)] overflow-hidden px-[calc(50vw-50%)] py-6">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-leaf opacity-70 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-20 top-32 h-64 w-64 rounded-full bg-sticker opacity-60 blur-3xl"
        aria-hidden
      />
      <div className="relative space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Run Nori with code</h1>
        {/* Connection status — the session is shared with the Remote page and persists. Grouped
            on the far right for consistency with the Agent page header. */}
        <div className="flex items-center gap-3">
          <span
            className={
              "inline-flex h-9 items-center rounded-full px-3 font-mono text-xs " +
              (connected ? "bg-nori-h8ab135/25 text-nori-h4d6a1e" : "bg-nori-h14131a/8 text-nori-h857b6b")
            }
          >
            ● {status}
          </span>
          {!connected && (
            <Button
              size="sm"
              variant="secondary"
              onClick={connect}
              disabled={connecting || !!connectBlocked}
              title={connectBlocked ?? undefined}
            >
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid h-[calc(100vh-12rem)] grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: LLM prompt (codegen — D3, not wired yet) + run output log */}
        {/* min-w-0 so the mono output log can't force the grid column past the viewport width
            (grid items default to min-width:auto). Matches the Agent page's columns. */}
        <div className="flex h-full min-w-0 min-h-0 flex-col gap-4">
          <div className="flex flex-1 min-h-0 flex-col gap-2 rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb p-4 text-nori-h14131a shadow-sm">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">// prompt</span>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what the robot should do…"
              className="flex-1 resize-none border-nori-h14131a/12 bg-nori-hfffdf7"
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    title="Attach a still from the robot camera so Claude can see the scene">
                    <input type="checkbox" checked={attachVision}
                      onChange={(e) => setAttachVision(e.target.checked)} />
                    attach camera view
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    title="Feed nori.perceive() frames so reactive scripts can see objects (synthetic drifting-cup scene until the on-Pi detector ships — Phase F)">
                    <input type="checkbox" checked={mockPerception}
                      onChange={(e) => setMockPerception(e.target.checked)} />
                    provide perception
                  </label>
                </div>
                <Button size="sm" onClick={generate} disabled={generating || !prompt.trim()}
                  title="Generate a routine with Claude and drop it into the editor"
                  className="rounded-md bg-nori-hd98b3d text-foreground hover:bg-nori-hc97929">
                  {generating ? "Generating…" : "Generate"}
                </Button>
              </div>
              {attachVision && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={cameraLayout}
                      onChange={(e) => {
                        setCameraLayout(e.target.value);
                        try { localStorage.setItem("nori_camera_layout", e.target.value); } catch { /* ignore */ }
                      }}
                      placeholder={
                        teleop?.cameraLayout()
                          ? "camera layout — auto-detected from the robot; type only to override"
                          : "camera layout — e.g. 'left tile = front cam; right tile = right-arm wrist cam'"
                      }
                      title="Which camera tile is which view/arm. Auto-detected from the robot in composite mode; type to override."
                      className="flex-1 rounded border border-nori-h14131a/20 bg-nori-hfffdf7 px-2 py-1 text-[11px]"
                    />
                    {lastFrame && (
                      <img src={lastFrame} alt="last frame sent to Claude" title="what Claude saw"
                        className="h-12 w-auto rounded border border-nori-h14131a/20" />
                    )}
                  </div>
                  {teleop?.cameraLayout() && !cameraLayout.trim() && (
                    <span className="text-[10px] text-muted-foreground" title="Sent to Claude with the frame">
                      auto: {teleop.cameraLayoutInfo()?.tiles.join(", ")}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-1 min-h-0 flex-col gap-2 rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb p-4 text-nori-h14131a shadow-sm">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">// run output</span>
            <div ref={outRef} className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 p-3 font-mono text-xs text-nori-h5a5346">
              {output.length > 0 ? output.join("\n") : "Run output + nori.log() appear here."}
            </div>
          </div>
        </div>

        {/* Right: code editor + run / stop / e-stop */}
        <div className="flex h-full min-w-0 min-h-0 flex-col gap-2 rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb p-4 text-nori-h14131a shadow-sm">
          {heldNote && (
            <div className="rounded-md border border-nori-hd98b3d/50 bg-nori-hd98b3d/15 px-3 py-1.5 text-[11px] text-nori-hb06a1c">
              ⚠ teleop {heldNote} — the robot is held by a policy / task run; this page is video-only until it ends.
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {/* Row 1: section label + SDK language (TypeScript in-browser vs Python server-side) */}
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">// code</span>
              <div className="flex items-center gap-1.5 text-[11px]">
                {(["ts", "python"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    disabled={scriptRunning || generating}
                    className={`rounded px-2 py-0.5 font-mono ${mode === m ? "bg-nori-hd98b3d text-foreground" : "bg-nori-h14131a/8 text-nori-h857b6b"}`}
                    title={m === "python" ? "Python SDK — primitive policies / raw nori_sdk (runs server-side)" : "TypeScript SDK — the nori teleop console (runs in the browser)"}
                  >
                    {m === "ts" ? "TypeScript" : "Python"}
                  </button>
                ))}
              </div>
            </div>
            {/* Row 2 (Python): surface + target + table height, wrapping so it stays inside the card */}
            {mode === "python" && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                <span className="font-mono uppercase tracking-wider text-nori-h857b6b">surface</span>
                {(["primitives", "sdk"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFlavor(f)}
                    disabled={scriptRunning || generating}
                    className={`rounded px-2 py-0.5 font-mono ${flavor === f ? "bg-nori-h8ab135/30 text-nori-h4d6a1e" : "bg-nori-h14131a/8 text-nori-h857b6b"}`}
                    title={f === "primitives" ? "System-2 primitives (RealA3Task)" : "raw nori_sdk"}
                  >
                    {f === "primitives" ? "primitives" : "nori_sdk"}
                  </button>
                ))}
                <span className="ml-1 font-mono uppercase tracking-wider text-nori-h857b6b">target</span>
                {(["sim", "real"] as const).map((tg) => (
                  <button
                    key={tg}
                    type="button"
                    onClick={() => setTarget(tg)}
                    disabled={scriptRunning || generating}
                    className={`rounded px-2 py-0.5 font-mono ${target === tg ? (tg === "real" ? "bg-nori-hd98b3d text-foreground" : "bg-nori-h8ab135/30 text-nori-h4d6a1e") : "bg-nori-h14131a/8 text-nori-h857b6b"}`}
                    title={tg === "real" ? "Run on the ROBOT via the ASPIRE worker (task session — it evicts the teleop session)" : "Run in the simulator (SimSession)"}
                  >
                    {tg === "sim" ? "sim" : "robot"}
                  </button>
                ))}
                {target === "real" && (
                  <label className="flex items-center gap-1 font-mono text-nori-h857b6b"
                    title="Table height in metres: anchors the robot's depth so locate_object heights are accurate">
                    <span className="ml-1 uppercase tracking-wider">table_z</span>
                    <input type="number" step="0.01" min="0" value={tableZ}
                      onChange={(e) => setTableZ(e.target.value)} disabled={scriptRunning || generating}
                      className="w-16 rounded border border-nori-h14131a/15 bg-nori-h14131a/8 px-1.5 py-0.5 text-foreground" />
                    <span className="text-nori-h857b6b/70">m</span>
                  </label>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-nori-h14131a/12">
            <CodeMirror
              value={generating ? streamBuffer : code}
              onChange={setCode}
              extensions={mode === "python" ? PY_EXTENSIONS : CODE_EXTENSIONS}
              theme={editorTheme}
              placeholder="// Write code here"
              height="100%"
              style={{ height: "100%" }}
              editable={!scriptRunning && !generating}
              className="h-full text-[11px] [&_.cm-editor]:h-full"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{mode === "python" ? `Python policy · ${target === "real" ? "ROBOT via the ASPIRE worker (evicts teleop)" : "server-side runner (sim)"} · E-STOP stops it` : "moveTo reports arrival · timed jogs · half-speed limit · supervisor required"}</span>
            <div className="flex items-center gap-2">
              {!scriptRunning ? (
                <Button size="sm" onClick={run} disabled={mode === "python" ? false : !connected}
                  title={mode === "python" ? "Run the policy on the server-side runner (target=sim)" : undefined}
                  className="rounded-md bg-nori-h8ab135 text-foreground hover:bg-nori-h799c2a">
                  <Play className="mr-2 h-4 w-4" /> Run
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={stop}>
                  <Square className="mr-2 h-4 w-4" /> Stop
                </Button>
              )}
              <Button size="sm" variant="destructive" className="font-bold" onClick={estop}
                title="Stop the robot + kill the script + zero motion, immediately">
                <OctagonX className="mr-2 h-4 w-4" /> E-STOP
              </Button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
};

export default Coding;
