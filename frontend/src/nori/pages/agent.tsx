// NORI: "Agent" — the console for the ASPIRE System 2 agent (nori-policy-agent synthesis/aspire_service).
//
// The operator types a GOAL; the page queues a task on the active robot (POST /aspire/tasks) and the HOSTED
// worker runs the look→think→act loop: the model decides, the executor moves the robot through the Nori SDK
// under the bench safety layer. Nothing executes in the browser. The page only supervises:
//
//   transcript   the task's events, polled as JSON (thought / say / step / refused / needs_input / done ...), with
//                every frame a tool returned to the model shown inline -- exactly what the agent looked at (the
//                page cannot open its own video: the task holds the robot's single remote session)
//   STOP/E-STOP  POST .../cancel: the executor zeroes motion, sends E-STOP and waits for the robot to confirm
//                the latch BEFORE the task is reported cancelled. (A connected teleop session, if any, gets a
//                direct estop too.)
//   deadman      AgentTaskContext checks in while a task runs, on every page and in a background tab; a task started
//                with "stop if I close this page" (constraints.operator_presence) is cancelled by the backend when
//                the check-ins stop, so closing the tab stops the robot within a few seconds.

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Play, Square, OctagonX, Bot, Send, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useTeleopSession } from "@/nori/TeleopSessionContext";
import { useNori } from "@/nori/NoriContext";
import { useApi } from "@/contexts/ApiContext";
import { ApiError, friendlyErrorMessage } from "@/lib/apiClient";
import {
  aspireApi, RobotBusyError, TERMINAL,
  type TaskEvent, type TaskRecord, type TaskStatus,
} from "@/nori/aspire/api";
import { CONTINUE_S, DEPTH_MODELS, LLM_CALLS, SECONDS, loadGoal, saveGoal, SPEED, TABLE_Z, loadSettings, parseTableZ, saveSettings, taskFields, type AgentSettings } from "@/nori/aspire/settings";
import { TuneSlider } from "@/nori/remote/TuneSlider";
import { useAgentTask } from "@/nori/aspire/AgentTaskContext";
import { HarnessSettings } from "@/nori/aspire/HarnessSettings";
import { listHarnesses, rememberHarnessTask } from "@/nori/aspire/harnesses";
import { RobotMemory } from "@/nori/aspire/RobotMemory";

const EVENTS_MS = 1500;     // transcript poll
const LOG_LINE_MAX = 240;   // a log line, however much the event carried
const RECORD_MS = 2000;     // task record poll (status, usage, waiting_for_answer)

// A rendered transcript line. Rows are a pure function of the event list (toRows below).
type Row =
  | { kind: "goal"; text: string }
  | { kind: "info"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "think"; text: string }
  | { kind: "say"; text: string }
  | { kind: "call"; tool: string; args: Record<string, unknown>; pending: boolean; status?: string; result?: string }
  | { kind: "frame"; tool: string; src: string }
  | { kind: "refused"; tool: string; reason: string }
  | { kind: "question"; text: string; answered?: string }
  | { kind: "comment"; text: string }
  | { kind: "safety"; text: string }
  | { kind: "verdict"; confidence: number | null; label: string; summary: string; goals: { goal: string; met: string; observed: string }[] }
  | { kind: "learned"; text: string; titles: string[] }
  | { kind: "end"; status: TaskStatus; text: string };

// Event types the transcript renders. Everything else is plumbing — queued/claimed/preflight/armed/table/
// start_check/started/home/safety/record… — and that is exactly what the logs card shows: how the worker
// got to the robot (claim → credentials → session → arming → table) and why it did not, when it did not.
const TRANSCRIPT_TYPES = new Set([
  "thought", "think", "say", "episode_started", "episode_done", "record_warning", "step_start", "step", "frame", "needs_input", "answered", "comment", "instruction_done", "waiting", "continued", "verdict", "advice", "done", "failed", "cancelled",
]);

/** One log line per non-transcript event: `HH:MM:SS type key=value …`, the payload compacted so an unknown
 * event type from a newer worker still reads. `done`/`failed`/`cancelled` are repeated here too so the log ends. */
export function toLogLines(events: TaskEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (TRANSCRIPT_TYPES.has(e.type) && !["failed", "cancelled", "done"].includes(e.type)) continue;
    if (e.type === "episode_sidecar") continue;                // the annotation record, for later, not for reading here
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) {
      if (k === "n" || k === "ts" || k === "type" || k === "jpeg_b64" || v == null) continue;
      rest[k] = typeof v === "string" && v.length > 160 ? v.slice(0, 157) + "…" : v;
    }
    const when = typeof e.ts === "number" ? new Date(e.ts * 1000).toLocaleTimeString([], { hour12: false }) : "--:--:--";
    const body = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
    const line = `${when}  ${e.type}${body ? "  " + body : ""}`;
    out.push(line.length > LOG_LINE_MAX ? line.slice(0, LOG_LINE_MAX - 1) + "…" : line);
  }
  return out;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "queued — waiting for a worker", claiming: "starting", running: "running",
  done: "finished", failed: "failed", cancelled: "stopped",
};

/** Events -> transcript rows. A `step_start` is a pending call until its `step` arrives (same tool, in order); the
 * `frame` events that follow a step are the images that tool returned to the model. */
const BOTTOM_SLACK_PX = 40;   // near enough to the end to count as following it

export function isAtBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
}

function settingsLine(s: Record<string, unknown>): string {
  const n = (v: unknown, unit = "") => (v == null ? "?" : `${String(v)}${unit}`);
  return `speed ${n(s.speed_factor)} · table ${n(s.table_z, " m")} · depth ${n(s.depth_model)} · map ${s.world_session ? "on" : "off"} · base ${s.allow_base ? "on" : "off"} · recording ${s.record_episode ? "on" : "off"}` + (s.harness === "authored" ? " · model-built tools" : s.primitives ? ` · primitives ${String(s.primitives)}` : "")
    + (s.reasoning_effort ? ` · reasoning ${String(s.reasoning_effort)}` : "")
    + (s.model_speed ? ` · model speed ${String(s.model_speed)}` : "");
}

export const COMMENT_MAX = 400;   // the backend keeps the first 400 characters (Nori-Backend repo.py COMMENT_MAX_CHARS)

/** Comments this page sent that the agent has not read yet: each `comment` event (and an `answered` the worker took
 * from comments, joined with " / ") consumes one sent text with the same wording. */
export function pendingComments(sent: string[], events: TaskEvent[]): string[] {
  const read = new Map<string, number>();
  const bump = (t: string) => read.set(t, (read.get(t) ?? 0) + 1);
  for (const e of events) {
    if (e.type === "comment" && typeof e.text === "string") bump(e.text);
    if (e.type === "answered" && e.via === "comment" && typeof e.text === "string") e.text.split(" / ").forEach(bump);
    // a continued task joins the comments that arrived while it waited into one instruction
    if (e.type === "continued" && typeof e.instruction === "string") {
      const instruction = e.instruction;
      sent.filter((t) => instruction.includes(t)).forEach(bump);
    }
  }
  return sent.filter((t) => {
    const n = read.get(t) ?? 0;
    if (n > 0) { read.set(t, n - 1); return false; }
    return true;
  });
}

export function toRows(instruction: string, events: TaskEvent[]): Row[] {
  const rows: Row[] = [{ kind: "goal", text: instruction }];
  const pending: number[] = [];                                  // indexes of unresolved call rows
  const str = (v: unknown, n = 300) => (v == null ? "" : String(v)).slice(0, n);
  for (const e of events) {
    switch (e.type) {
      case "queued": case "claimed": break;                     // plumbing; the status chip shows these
      case "started":
        rows.push({ kind: "info", text: `started on ${str(e.robot)} · model ${str(e.model)} · ${str(e.grant)} session` });
        if (e.settings) rows.push({ kind: "info", text: settingsLine(e.settings as Record<string, unknown>) });
        break;
      case "home":
        rows.push({ kind: "info", text: e.ok ? `homed the ${str(e.side)} arm to the high-side pose (${str(e.duration_s)} s)`
          : `homing skipped: ${str(e.skipped ?? e.reason)}` });
        break;
      case "thought": rows.push({ kind: "thought", text: str(e.text, 2000) }); break;
      case "think": rows.push({ kind: "think", text: str(e.text, 4000) }); break;
      case "say": rows.push({ kind: "say", text: str(e.text) }); break;
      case "episode_started":
        rows.push({ kind: "info", text: `recording ${str(e.episode)}` + (Number(e.free_gb) > 0 ? ` · ${Number(e.free_gb).toFixed(1)} GB free on the robot` : "") });
        break;
      case "episode_done": {
        const v = (e.verification as { label?: string } | undefined)?.label;
        const label = v && v !== "unknown" ? v : (e.success_claim === true ? "success" : "failure");
        rows.push({ kind: "info", text: e.keep ? `recording kept: ${str(e.episode)} as ${label} (${str(e.seconds)} s)` : `recording discarded: ${str(e.episode)}` });
        break;
      }
      case "verdict": {
        // the graded verdict (synthesis/aspire_service/verdict.py): a separate judge on fresh frames, confidence in [0, 1]
        const conf = typeof e.confidence === "number" ? e.confidence : null;
        const goals = Array.isArray(e.goals) ? (e.goals as { goal?: unknown; met?: unknown; observed?: unknown }[]).map((g) => ({
          goal: str(g.goal, 160), met: str(g.met, 10), observed: str(g.observed, 200) })) : [];
        rows.push({ kind: "verdict", confidence: conf, label: str(e.label, 12) || "unknown", summary: str(e.summary, 300), goals });
        break;
      }
      case "advice": {
        // what the agent wrote into the robot's memory at the end of the run (advice.py); the memory card below shows it
        const names = (k: string) => Array.isArray(e[k]) ? (e[k] as unknown[]).map((x) => Array.isArray(x) ? str(x[0], 120) : str(x, 120)) : [];
        const written = names("written"), edited = names("edited"), graded = names("graded"), ctx = names("context");
        const parts = [
          written.length ? `new: ${written.join("; ")}` : "", edited.length ? `edited: ${edited.join("; ")}` : "",
          graded.length ? `graded: ${graded.join("; ")}` : "", ctx.length ? `facts: ${ctx.join("; ")}` : "",
        ].filter(Boolean);
        const text = e.ok === false ? `nothing learned (${str(e.error ?? e.skipped, 160)})`
          : parts.length ? parts.join(" · ") : "nothing new to remember";
        rows.push({ kind: "learned", text, titles: [...written, ...edited] });
        break;
      }
      case "record_warning": rows.push({ kind: "safety", text: `recording problem (${str(e.kind)}): ${str(e.detail)}` }); break;
      case "step_start":
        pending.push(rows.length);
        rows.push({ kind: "call", tool: str(e.tool), args: (e.args as Record<string, unknown>) ?? {}, pending: true });
        break;
      case "step": {
        const i = pending.shift();
        const row = i != null ? rows[i] : null;
        if (row && row.kind === "call" && row.tool === e.tool) {
          rows[i!] = { ...row, pending: false, status: str(e.status), result: str(e.result) };
        } else {
          rows.push({ kind: "call", tool: str(e.tool), args: (e.args as Record<string, unknown>) ?? {}, pending: false, status: str(e.status), result: str(e.result) });
        }
        break;
      }
      case "frame":
        if (typeof e.jpeg_b64 === "string" && e.jpeg_b64) rows.push({ kind: "frame", tool: str(e.tool), src: `data:image/jpeg;base64,${e.jpeg_b64}` });
        break;
      case "refused": rows.push({ kind: "refused", tool: str(e.tool), reason: str(e.reason) }); break;
      case "needs_input": rows.push({ kind: "question", text: str(e.question, 400) }); break;
      case "answered": {
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          if (r.kind === "question" && !r.answered) { rows[i] = { ...r, answered: str(e.text, 400) }; break; }
        }
        break;
      }
      case "comment": rows.push({ kind: "comment", text: str(e.text, 400) }); break;   // emitted when the agent read it
      // a continued task (constraints.continue_s): one instruction finished, the task holds on for the next
      case "instruction_done":
        rows.push({ kind: "end", status: "done", text: `${e.success_claim === true ? "✓" : "✗"} instruction ${str(e.index)} done${e.summary ? ` — ${str(e.summary, 500)}` : ""}` });
        break;
      case "waiting": rows.push({ kind: "info", text: `holding the arms — waiting up to ${str(e.seconds)} s for the next instruction` }); break;
      case "continued": rows.push({ kind: "goal", text: str(e.instruction, 400) }); break;
      case "safety":
        if (e.ok === false) rows.push({ kind: "safety", text: `${str(e.check)}: ${str(e.reason)}` });
        break;
      case "operator_lost": rows.push({ kind: "safety", text: str(e.reason) }); break;
      case "done": {
        // the judge's label when there is one; the agent's own claim beside it only when they disagree
        const v = e.verification as { confidence?: number; label?: string } | undefined;
        const claim = e.success_claim === true;
        const judged = v && typeof v.confidence === "number" && v.label && v.label !== "unknown";
        const head = !judged ? (claim ? "✓ goal reached" : "finished without success")
          : v!.label === "success" ? `✓ goal reached (verdict ${v!.confidence!.toFixed(2)})`
          : v!.label === "failure" ? `finished without success (verdict ${v!.confidence!.toFixed(2)})`
          : `uncertain outcome (verdict ${v!.confidence!.toFixed(2)})`;
        const disagree = judged && ((v!.label === "success") !== claim) && v!.label !== "uncertain" ? ` — the agent said ${claim ? "success" : "failure"}` : "";
        rows.push({ kind: "end", status: "done", text: `${head}${disagree}${e.summary ? ` — ${str(e.summary, 500)}` : ""}` });
        break;
      }
      case "failed": {
        const reason = str(e.reason);
        const message = reason.includes("constraints.primitives must be one of") && reason.includes("got 'authored'")
          ? "This worker needs an update to run model-built tools."
          : reason;
        rows.push({ kind: "end", status: "failed", text: `failed — ${message}` });
        break;
      }
      case "cancelled": rows.push({ kind: "end", status: "cancelled", text: `■ stopped${e.reason ? ` — ${str(e.reason)}` : ""}` }); break;
      default: break;                                             // progress/collect events the page does not show
    }
  }
  return rows;
}

const Agent = () => {
  const {
    teleop, running: appSessionUp, connecting: appSessionJoining, disconnect: closeAppSession,
    heldNote, clearEstopLatch,
  } = useTeleopSession();
  const { activeRobotSerial, customer } = useNori();
  const { baseUrl, fetchWithHeaders } = useApi();
  const api = useMemo(() => aspireApi(baseUrl, fetchWithHeaders), [baseUrl, fetchWithHeaders]);

  const robot = activeRobotSerial ?? customer?.robot_serial_number ?? "";
  const [goal, setGoal] = useState(loadGoal);
  useEffect(() => { saveGoal(goal); }, [goal]);
  const [settings, setSettings] = useState<AgentSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(true);
  const tune = (patch: Partial<AgentSettings>) => setSettings((s) => { const n = { ...s, ...patch }; saveSettings(n); return n; });
  const badTable = parseTableZ(settings.tableZ) === "invalid";
  const { taskId, track, harnessError } = useAgentTask();
  const [selectedHarness, setSelectedHarness] = useState("");
  useEffect(() => setSelectedHarness(""), [customer?.id]);
  const [record, setRecord] = useState<TaskRecord | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [answer, setAnswer] = useState("");
  const [comment, setComment] = useState("");
  const [sentComments, setSentComments] = useState<string[]>([]);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [sendingComment, setSendingComment] = useState(false);
  useEffect(() => { setSentComments([]); setComment(""); setCommentError(null); }, [taskId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sinceRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const [showLog, setShowLog] = useState(false);
  // Page-side notes (what THIS page did: closed its session, attached, cancelled) go in the same log so
  // the order of app actions vs worker events is visible. Stamped like the worker lines.
  const [pageNotes, setPageNotes] = useState<string[]>([]);
  const note = useCallback((text: string) => {
    const when = new Date().toLocaleTimeString([], { hour12: false });
    setPageNotes((prev) => [...prev.slice(-100), `${when}  page  ${text}`]);
  }, []);

  const status = record?.status ?? null;
  const active = !!taskId && status !== null && !TERMINAL.has(status);
  const ended = status !== null && TERMINAL.has(status);
  const rows = useMemo(() => toRows(record?.instruction ?? goal, events), [record?.instruction, goal, events]);
  const memoryRefresh = useMemo(() => events.filter((e) => e.type === "advice").length, [events]);
  const openQuestion = record?.waiting_for_answer && rows.some((r) => r.kind === "question" && !r.answered);
  const queuedComments = useMemo(() => pendingComments(sentComments, events), [sentComments, events]);
  const waitingNext = active && record?.waiting_for_instruction === true;

  // Follow the transcript only while the reader is at the bottom: scrolling up holds the view, scrolling back down resumes.
  const followRef = useRef(true);
  const onTranscriptScroll = useCallback((e: UIEvent<HTMLDivElement>) => { followRef.current = isAtBottom(e.currentTarget); }, []);
  useEffect(() => { if (scrollRef.current && followRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [rows]);

  // The logs card: the worker's plumbing events + this page's notes. NOT the app's own robot-session log — that
  // is the operator's teleop session (Remote page's Robot logs), nothing to do with how the task reached the robot.
  const logText = useMemo(() => [...pageNotes, ...toLogLines(events)], [events, pageNotes]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logText, showLog]);
  useEffect(() => { if (heldNote) note(`robot: ${heldNote}`); }, [heldNote, note]);

  // -- polling while a task is open ----------------------------------------------------------------------------
  useEffect(() => {
    if (!taskId) return;
    let stop = false;
    // One fetch in flight at a time: the immediate first tick and the interval's first tick used to overlap with the
    // same cursor, so the opening events (queued, claimed) arrived twice. The cursor advances only when a fetch returns,
    // and the merge drops anything at or below the last `n` already shown as a second guard.
    let inflight = false;
    const tick = async () => {
      if (stop || inflight) return;
      inflight = true;
      try {
        const evs = await api.events(taskId, sinceRef.current);
        if (evs.length && !stop) {
          sinceRef.current = evs[evs.length - 1].n + 1;
          setEvents((prev) => {
            const last = prev.length ? prev[prev.length - 1].n : -1;
            return [...prev, ...evs.filter((e) => e.n > last)];
          });
        }
      } catch (e) { setError(friendlyErrorMessage(e)); }
      finally { inflight = false; }
    };
    const rec = async () => {
      if (stop) return;
      try { const r = await api.task(taskId); if (!stop) setRecord(r); } catch (e) { setError(friendlyErrorMessage(e)); }
    };
    void tick(); void rec();
    if (ended) return () => { stop = true; };               // one last read for the final events, then nothing changes
    const a = setInterval(tick, EVENTS_MS), b = setInterval(rec, RECORD_MS);
    return () => { stop = true; clearInterval(a); clearInterval(b); };
  }, [api, taskId, ended]);

  // The robot has ONE session. The gateway treats a `ready` from the same operator as a page refresh that replaces
  // the live session, and the hosted worker drives the robot under this customer's identity: with this app still
  // connected, the app and the worker preempt each other every few seconds and the task never gets past the
  // handshake (0003, 2026-10-30). So: close this app's session before a task starts (or before following one that
  // is already running), and refuse to reconnect while it is active (TeleopSessionContext.setYield).
  const [yieldedNote, setYieldedNote] = useState<string | null>(null);
  const yieldRobot = useCallback(async () => {
    if (appSessionUp || appSessionJoining || teleop) {
      await closeAppSession();
      setYieldedNote(`closed this app's session to ${robot || "the robot"}: ASPIRE holds the robot's one session while the task runs; reconnect from Remote when it ends`);
      note(`closed this app's robot session so the task can take ${robot || "the robot"}`);
    }
  }, [appSessionUp, appSessionJoining, teleop, closeAppSession, robot, note]);

  // -- actions ---------------------------------------------------------------------------------------------------
  const attach = (id: string, presence: boolean) => {
    sinceRef.current = 0;
    setEvents([]); setRecord(null); setError(null); track(id, presence);
    note(`following task ${id.slice(0, 8)}`);
  };

  const start = async (clearFirst = false) => {
    if (busy || !goal.trim() || !robot || badTable) return;
    if (latchHint && !clearFirst) { setConfirmClear(true); return; }   // ask once; the dialog calls start(true)
    setBusy(true); setError(null);
    if (clearFirst) {
      note("clearing the E-stop latch before starting");
      try { const r = await clearEstopLatch(); note(r); }
      catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        note(`clear E-stop latch failed: ${m}`); setError(`Could not clear the E-stop latch, not starting: ${m}`); setBusy(false); return;
      }
    }
    note(`start requested on ${robot}`);
    try {
      const saved = selectedHarness && customer && settings.harness === "authored"
        ? listHarnesses(customer.id, settings.model).find((h) => h.id === selectedHarness) : undefined;
      if (selectedHarness && !saved) throw new Error("This local harness is unavailable. Choose another harness.");
      const fields = taskFields(settings, saved?.snapshot);
      await yieldRobot();
      const r = await api.start({
        robot, instruction: goal.trim(), budget: fields.budget,
        constraints: fields.constraints,
        caller: { kind: "lab_agent_page" },
      });
      attach(r.task_id, fields.constraints.operator_presence === true);
      if (settings.harness === "authored" && customer) {
        try { rememberHarnessTask(customer.id, r.task_id); }
        catch { setError("Local storage is unavailable. Keep this tab open to save the harness when storage is available."); }
      }
    } catch (e) {
      note(`start failed: ${friendlyErrorMessage(e)}`);
      if (e instanceof RobotBusyError) {
        setError("This robot already has a task running" + (e.running ? " — showing it." : "."));
        if (e.running) {
          await yieldRobot();
          // The backend enforces presence only when the original task requested it.
          attach(e.running, true);
        }
      } else setError(friendlyErrorMessage(e));
    } finally { setBusy(false); }
  };

  const cancel = async (reason: string) => {
    if (!taskId) return;
    note(`cancel: ${reason}`);
    try { await api.cancel(taskId, reason); } catch (e) { setError(friendlyErrorMessage(e)); }
  };
  const stop = () => void cancel("stopped from the Agent page");
  const estop = () => {
    void cancel("E-STOP from the Agent page");                  // the backend cancels the task; the worker's guard stops the robot
    teleop?.command("estop");                                   // a teleop session open in this app, if any (none during a task: see yieldRobot)
  };

  // A task that fails after its first commanded motion E-stops the robot and the latch stays; the next task would
  // refuse at preflight ("motion daemon offline: estop_latched"). The previous task on this page latched the robot's E-stop: it failed after its first commanded motion (the
  // worker's stop path latches then), or its reason names the latch. Start then offers "clear it and start" as ONE
  // explicit click — never silently: the page cannot tell this latch from one a person set on purpose.
  const lastFailure = [...events].reverse().find((e) => e.type === "failed");
  const latchHint = !active && !!lastFailure && (
    lastFailure.before_motion === false || (typeof lastFailure.reason === "string" && /estop_latched|E-stop/i.test(lastFailure.reason)));
  const [confirmClear, setConfirmClear] = useState(false);

  const sendAnswer = async () => {
    if (!taskId || !answer.trim()) return;
    try { await api.answer(taskId, answer.trim()); setAnswer(""); } catch (e) { setError(friendlyErrorMessage(e)); }
  };

  const sendComment = async () => {
    const text = comment.trim().slice(0, COMMENT_MAX);
    if (!taskId || !text || sendingComment) return;
    setSendingComment(true); setCommentError(null);
    try {
      await api.comment(taskId, text);
      setSentComments((s) => [...s, text]); setComment(""); note(`comment sent: ${text}`);
    } catch (e) {
      setCommentError(e instanceof ApiError && e.status === 404 ? "This backend does not take comments yet." : friendlyErrorMessage(e));
    } finally {
      setSendingComment(false);
    }
  };

  const usage = record?.usage ?? {};
  const statusChip = status
    ? `${STATUS_LABEL[status]}${status === "running" && typeof usage.llm_calls === "number" ? ` · ${usage.llm_calls} turns` : ""}`
    : robot ? `ready · ${robot}` : "no robot paired";

  return (
    <section className="relative -my-6 -mx-[calc(50vw-50%)] min-h-[calc(100vh-3.5rem)] overflow-x-clip px-[calc(50vw-50%)] py-6">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-leaf opacity-70 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-20 top-32 h-64 w-64 rounded-full bg-sticker opacity-60 blur-3xl" aria-hidden />

      <div className="relative space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="flex items-center gap-2 text-3xl font-bold"><Bot className="h-7 w-7" /> Agent</h1>
              <span className="inline-flex -rotate-3 animate-floaty items-center rounded-full bg-sticker px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink shadow-soft">
                {"// beta"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">look → think → act on the robot · the transcript shows what it sees · STOP / E-STOP below</p>
          </div>
          <span className={"inline-flex h-9 items-center rounded-full px-3 font-mono text-xs " + (active ? "bg-nori-h8ab135/25 text-nori-h4d6a1e" : "bg-nori-h14131a/8 text-nori-h857b6b")}>
            ● {statusChip}
          </span>
        </div>

        <div className="grid min-h-[calc(100vh-12rem)] grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: goal + controls + overhead view */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex shrink-0 flex-col gap-2 rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb p-4 text-nori-h14131a shadow-sm">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">// goal</span>
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe the task, e.g. 'Pick up the can on the table. Use the left arm.'"
                className="min-h-[80px] resize-none border-nori-h14131a/12 bg-nori-hfffdf7"
                disabled={active}
              />
              {showSettings && (
                <>
                <fieldset disabled={active || busy} className="space-y-2 rounded border border-nori-h14131a/12 p-3 text-[11px] text-muted-foreground">
                  <HarnessSettings settings={settings} tune={tune} owner={customer?.id}
                    selected={selectedHarness} onSelect={setSelectedHarness} />
                  <TuneSlider label="robot speed" value={settings.speed} min={SPEED.min} max={SPEED.max}
                    title="How fast the robot moves, as a share of its full rate. A jog covers the same distance at any speed; contact is harder at higher speed."
                    onChange={(v) => tune({ speed: v })} />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-1.5" title="The table's height in metres. It is the hand's safety floor, and depth is anchored to it. Empty uses the robot's configured height.">
                      table height (m)
                      <input type="number" step={0.01} min={TABLE_Z.min} max={TABLE_Z.max} value={settings.tableZ} placeholder="robot default"
                        onChange={(e) => tune({ tableZ: e.target.value })}
                        className={`w-24 rounded border bg-transparent px-1 py-0.5 ${badTable ? "border-red-500" : "border-nori-h14131a/20"}`} />
                    </label>
                    <label className="flex items-center gap-1.5" title="The most model calls this task may use before it stops">
                      model calls
                      <input type="number" min={LLM_CALLS.min} max={LLM_CALLS.max} value={settings.llmCalls}
                        onChange={(e) => tune({ llmCalls: Number(e.target.value) })} className="w-16 rounded border border-nori-h14131a/20 bg-transparent px-1 py-0.5" />
                    </label>
                    <label className="flex items-center gap-1.5" title="The longest this task may run before it stops">
                      time limit (s)
                      <input type="number" min={SECONDS.min} max={SECONDS.max} step={60} value={settings.seconds}
                        onChange={(e) => tune({ seconds: Number(e.target.value) })} className="w-20 rounded border border-nori-h14131a/20 bg-transparent px-1 py-0.5" />
                    </label>
                    <label className="flex items-center gap-1.5" title="Which depth model the agent's views use">
                      depth
                      <select value={settings.depthModel} onChange={(e) => tune({ depthModel: e.target.value })} className="rounded border border-nori-h14131a/20 bg-transparent px-1 py-0.5">
                        {DEPTH_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5" title="Build the 3D voxel map on every observe. About 5 s slower each time; only peek and where_to_look use it.">
                      <input type="checkbox" disabled={settings.depthModel === "none"} checked={settings.depthModel !== "none" && settings.worldMap}
                        onChange={(e) => tune({ worldMap: e.target.checked })} />
                      voxel map
                    </label>
                    <label className="flex items-center gap-1.5" title="Cancel the task (robot stopped first) if this tab closes. Switching pages or windows does not count.">
                      <input type="checkbox" checked={settings.stopOnClose} onChange={(e) => tune({ stopOnClose: e.target.checked })} />
                      stop if I close this page
                    </label>
                    <label className="flex items-center gap-1.5" title="Move the working arm from rest to the high-side staging pose before the agent's first turn">
                      <input type="checkbox" checked={settings.homeFirst} onChange={(e) => tune({ homeFirst: e.target.checked })} />
                      home the arm first
                    </label>
                    <label className="flex items-center gap-1.5" title="Let the agent drive the base. Off keeps the robot where it stands, and the agent works within reach. Keep the area around the robot clear.">
                      <input type="checkbox" checked={settings.allowBase} onChange={(e) => tune({ allowBase: e.target.checked })} />
                      allow base movement
                    </label>
                    <label className="flex items-center gap-1.5" title="Record this run as a dataset episode, labelled with the agent's verdict. A cancelled run is discarded. The transcript shows what happened to the recording.">
                      <input type="checkbox" checked={settings.recordEpisode} onChange={(e) => tune({ recordEpisode: e.target.checked })} />
                      record episode
                    </label>
                    <label className="flex items-center gap-1.5" title="Show the agent's reasoning in the transcript">
                      <input type="checkbox" checked={settings.showThinking} onChange={(e) => tune({ showThinking: e.target.checked })} />
                      show thinking
                    </label>
                    <label className="flex items-center gap-1.5" title="After done, keep the robot session and arms (and whatever they hold) this long, so the next instruction carries on in the same task. 0 ends at done.">
                      hold for next
                      <input type="number" min={CONTINUE_S.min} max={CONTINUE_S.max} step={15} value={settings.continueS}
                        onChange={(e) => tune({ continueS: Math.max(CONTINUE_S.min, Math.min(CONTINUE_S.max, Number(e.target.value) || 0)) })}
                        className="w-14 rounded border border-nori-h14131a/12 bg-nori-hfffdf7 px-1 py-0.5" aria-label="Seconds to hold for the next instruction" /> s
                    </label>
                    <label className="flex items-center gap-1.5" title="Include saved facts and advice from earlier runs on this robot in the agent's prompt.">
                      <input type="checkbox" checked={settings.useLearnedEntries} onChange={(e) => tune({ useLearnedEntries: e.target.checked })} />
                      use learned entries
                    </label>
                    <label className="flex items-center gap-1.5" title="Save what the agent learns from this run to the robot's memory.">
                      <input type="checkbox" checked={settings.learn} onChange={(e) => tune({ learn: e.target.checked })} />
                      learn from this run
                    </label>
                  </div>
                  {badTable && <div className="text-red-600">Table height must be between {TABLE_Z.min} and {TABLE_Z.max} m. Leave it empty to use the robot's height.</div>}
                </fieldset>
                <div className="flex justify-end text-[11px] text-muted-foreground">
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => setShowSettings(false)} title="Minimize settings">
                    <ChevronUp className="h-3 w-3" /> minimize
                  </button>
                </div>
                </>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {!showSettings ? (
                  <button type="button" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowSettings(true)}>
                    <ChevronRight className="h-3 w-3" /> settings
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  {!active ? (
                    <Button size="sm" onClick={() => void start()} disabled={busy || !robot || !goal.trim() || badTable}
                      className="rounded-md bg-nori-h8ab135 text-foreground hover:bg-nori-h799c2a" title={robot ? undefined : "Pair a robot first"}>
                      <Play className="mr-2 h-4 w-4" /> Start
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={stop}
                      title={waitingNext ? "End the task now and release the robot (anything held may drop)" : "Cancel the task; the executor stops the robot first"}>
                      <Square className="mr-2 h-4 w-4" /> {waitingNext ? "Release robot" : "Stop"}
                    </Button>
                  )}
                  {/* Clearing a latch the previous task left is Start's job ("Clear latch and start"), so this slot is
                      always the stop control, inert when nothing is running. */}
                  <Button size="sm" variant="destructive" className="font-bold" onClick={estop} disabled={!active && !teleop}
                    title={active || teleop ? "Stop the robot now: zero motion + E-STOP latch, then end the task" : "Nothing is running"}>
                    <OctagonX className="mr-2 h-4 w-4" /> E-STOP
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                {robot && <span>robot {robot}</span>}
                {typeof usage.llm_calls === "number" && <span>· {usage.llm_calls} turns</span>}
                {typeof usage.output_tokens === "number" && usage.output_tokens > 0 && <span>· ~{fmtTokens(usage.output_tokens)} tok out</span>}
                {record?.budget?.seconds && <span>· budget {record.budget.seconds}s / {record.budget.llm_calls} turns</span>}
                {taskId && <span className="truncate">· task {taskId.slice(0, 8)}</span>}
              </div>
            </div>

            {(error || harnessError) && (
              <div className="rounded-md border border-nori-hb4442e/40 bg-nori-hfbecea p-3 text-[11px] text-nori-h8a2f20 shadow-sm">{error || harnessError}</div>
            )}
            {yieldedNote && (
              <div className="rounded-md border border-nori-hd98b3d/50 bg-nori-hfdf3e6 p-3 text-[11px] text-nori-hb06a1c shadow-sm">{yieldedNote}</div>
            )}

            {openQuestion && (
              <div className="flex flex-col gap-2 rounded-md border border-nori-hd98b3d/50 bg-nori-hfdf3e6 p-4 shadow-sm">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">// the agent is asking</span>
                <div className="text-sm">{rows.filter((r) => r.kind === "question").slice(-1).map((r) => (r as { text: string }).text)}</div>
                <div className="flex items-center gap-2">
                  <input value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void sendAnswer(); }}
                    placeholder="Your answer…" className="flex-1 rounded border border-nori-h14131a/12 bg-nori-hfffdf7 px-2 py-1 text-sm" />
                  <Button size="sm" onClick={sendAnswer} disabled={!answer.trim()} className="rounded-md bg-nori-h8ab135 text-foreground hover:bg-nori-h799c2a">
                    <Send className="mr-2 h-4 w-4" /> Answer
                  </Button>
                </div>
              </div>
            )}

            {/* While it runs, the operator can add context or correct it at any time ("the mug is behind the box"). The
                agent reads it on its next step, so a move in progress finishes first; it never stops anything (that is
                Stop / E-STOP). Hidden while a question is open: the answer box above is the one to use then. */}
            {active && !openQuestion && (
              <div className="flex flex-col gap-2 rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb p-4 text-nori-h14131a shadow-sm">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">{waitingNext ? "// next instruction" : "// tell the agent"}</span>
                <div className="flex items-center gap-2">
                  <input value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void sendComment(); }}
                    placeholder={waitingNext ? "What next? e.g. now put it on the shelf" : "Add context or a correction, e.g. the mug is behind the box"}
                    aria-label="Comment for the agent"
                    className="min-w-0 flex-1 rounded border border-nori-h14131a/12 bg-nori-hfffdf7 px-2 py-1 text-sm" />
                  <Button size="sm" onClick={() => void sendComment()} disabled={!comment.trim() || sendingComment}
                    className="rounded-md bg-nori-h8ab135 text-foreground hover:bg-nori-h799c2a">
                    <Send className="mr-2 h-4 w-4" /> {waitingNext ? "Continue" : "Send"}
                  </Button>
                </div>
                {queuedComments.length > 0 && (
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {queuedComments.map((t, i) => <li key={i} className="truncate">queued for the next step: {t}</li>)}
                  </ul>
                )}
                {commentError
                  ? <div className="text-[11px] text-nori-h8a2f20">{commentError}</div>
                  : <div className="text-[11px] text-muted-foreground">{waitingNext
                      ? "The robot is holding still; the agent carries on from here, with what it holds and saw. Release robot ends the task."
                      : "The agent reads it on its next step. To stop, use Stop."}</div>}
              </div>
            )}

            {/* ASPIRE logs: how the worker reached the robot (claim → credentials → session → arming → table) and
                what this page did. The transcript is for what the agent thinks; this is for why a run did or
                did not get going. */}
            <div className={`flex flex-col rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb text-nori-h14131a shadow-sm ${showLog ? "min-h-[16rem] flex-1 gap-2 p-4" : "shrink-0 px-4 py-2"}`}>
              <button type="button" onClick={() => setShowLog((v) => !v)}
                className="flex w-full min-w-0 items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">
                {showLog ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <span className="shrink-0">{"// aspire logs"}</span>
                <span className="ml-2 shrink-0 normal-case tracking-normal text-muted-foreground">{logText.length} lines</span>
                {!showLog && logText.length > 0 && (
                  <span className="ml-2 min-w-0 truncate normal-case tracking-normal text-muted-foreground">{logText[logText.length - 1]}</span>
                )}
              </button>
              {showLog && (
                <div ref={logRef} className="max-h-[70vh] min-h-[12rem] flex-1 overflow-y-auto overflow-x-hidden rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 p-3 font-mono text-[10.5px] leading-relaxed text-nori-h5a5346">
                  {logText.length === 0
                    ? <span className="text-muted-foreground">Worker events (claim, credentials, session, arming, table) and this page's actions appear here as a task starts.</span>
                    : logText.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words py-0.5 leading-snug">{l}</div>)}
                </div>
              )}
            </div>

          </div>

          {/* Right: transcript */}
          <div className="flex min-w-0 flex-col gap-2 rounded-md border border-nori-h14131a/10 bg-nori-hf6f4eb p-4 text-nori-h14131a shadow-sm">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nori-hb06a1c">// transcript</span>
            <div ref={scrollRef} onScroll={onTranscriptScroll} className="h-[calc(100vh-16rem)] min-h-[24rem] min-w-0 space-y-2 overflow-y-auto overflow-x-hidden rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 p-3 text-xs text-nori-h5a5346">
              {!taskId ? (
                <span className="font-mono text-muted-foreground">The agent's thoughts, what it says, its tool calls, their results and the frames it looked at appear here.</span>
              ) : groupRows(rows).map((g, i) => ("row" in g ? <TranscriptRow key={i} row={g.row} /> : <Folded key={i} group={g} />))}
            </div>
            <RobotMemory api={api} robot={robot} refreshKey={memoryRefresh} />
          </div>
        </div>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>The robot's E-stop is latched</AlertDialogTitle>
            <AlertDialogDescription>
              The previous task left {robot || "the robot"}'s software E-stop latched. Starting now would fail at preflight.
              Clear the latch and start? Only do this if nobody stopped the robot on purpose and it is safe to move.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmClear(false); void start(true); }}>Clear latch and start</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

/** The transcript shows the GREEN lines (what the agent said, its tool calls) and keeps the GREY detail folded:
 * the thoughts before a call and the call's result open only when that call line is clicked (2026-11-08).
 * Thoughts with no call after them (the run ended, or a question came) fold under a "thoughts" line of their own. */
export type RowGroup = { call: Row & { kind: "call" }; thoughts: Row[] } | { call: null; thoughts: Row[] } | { row: Row };

export function groupRows(rows: Row[]): RowGroup[] {
  const out: RowGroup[] = []; let pending: Row[] = [];
  for (const r of rows) {
    if (r.kind === "thought" || r.kind === "think") { pending.push(r); continue; }
    if (r.kind === "call") { out.push({ call: r, thoughts: pending }); pending = []; continue; }
    if (pending.length) { out.push({ call: null, thoughts: pending }); pending = []; }
    out.push({ row: r });
  }
  if (pending.length) out.push({ call: null, thoughts: pending });
  return out;
}

const Folded = ({ group }: { group: Exclude<RowGroup, { row: Row }> }) => {
  const [open, setOpen] = useState(false);
  const call = group.call; const n = group.thoughts.length;
  const ok = call?.status === "ok";
  const label = call
    ? `${call.pending ? "… " : "→ "}${call.tool}(${compactArgs(call.args)})`
    : `thoughts (${n})`;
  const hasDetail = n > 0 || (!!call && !call.pending && !!call.result);
  return (
    <div className="break-all font-mono text-[11px]">
      <button type="button" onClick={() => hasDetail && setOpen((o) => !o)}
        className={"w-full text-left " + (call ? (call.pending ? "text-nori-h857b6b" : "text-nori-h4d6a1e") : "text-nori-h857b6b") + (hasDetail ? " cursor-pointer" : " cursor-default")}
        title={hasDetail ? (open ? "hide the thoughts and result" : "show the thoughts and result") : undefined}>
        {hasDetail ? (open ? "▾ " : "▸ ") : ""}{label}{!open && n ? <span className="text-nori-h857b6b"> · {n} thought{n === 1 ? "" : "s"}</span> : null}
      </button>
      {open && (
        <div className="mt-1 space-y-1 border-l border-nori-h14131a/15 pl-2 font-sans text-xs">
          {group.thoughts.map((t, i) => <TranscriptRow key={i} row={t} />)}
          {call && !call.pending && call.result && (
            <div className={"whitespace-pre-wrap font-mono text-[11px] " + (ok ? "text-nori-h857b6b" : "text-nori-hb4442e")}>{ok ? "↳ " : "✗ "}{call.result}</div>
          )}
        </div>
      )}
    </div>
  );
};

const TranscriptRow = ({ row }: { row: Row }) => {
  // Every text row wraps (break-words / break-all) so a long result JSON or an unbroken token can't push the
  // transcript into a horizontal scroll.
  switch (row.kind) {
    case "goal":
      return <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-nori-hb06a1c">▸ goal: {row.text}</div>;
    case "info":
      return <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-nori-h857b6b">· {row.text}</div>;
    case "thought":
      return <div className="whitespace-pre-wrap break-words italic text-nori-h5a5346/80">{row.text}</div>;
    case "think":
      return (
        <details className="text-nori-h5a5346/70">
          <summary className="cursor-pointer select-none font-mono text-[11px]">thinking: {row.text.slice(0, 90)}{row.text.length > 90 ? "…" : ""}</summary>
          <div className="mt-1 whitespace-pre-wrap break-words border-l border-nori-h14131a/15 pl-2 italic">{row.text}</div>
        </details>
      );
    case "say":
      return <div className="whitespace-pre-wrap break-words rounded border border-nori-h8ab135/40 bg-nori-h8ab135/10 px-2 py-1 text-nori-h14131a">🗣 {row.text}</div>;
    case "call": {
      const ok = row.status === "ok";
      return (
        <div className="break-all font-mono text-[11px]">
          <div className={row.pending ? "text-nori-h857b6b" : "text-nori-h4d6a1e"}>
            {row.pending ? "… " : "→ "}{row.tool}({compactArgs(row.args)})
          </div>
          {!row.pending && row.result && (
            <div className={"whitespace-pre-wrap pl-3 " + (ok ? "text-nori-h857b6b" : "text-nori-hb4442e")}>{ok ? "↳ " : "✗ "}{row.result}</div>
          )}
        </div>
      );
    }
    case "frame":
      return <img src={row.src} alt={`what the agent saw (${row.tool})`} className="max-h-48 w-auto rounded border border-nori-h14131a/20" />;
    case "refused":
      return <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-nori-hb4442e">✗ {row.tool} refused — {row.reason}</div>;
    case "question":
      return (
        <div className="whitespace-pre-wrap break-words rounded border border-nori-hd98b3d/50 bg-nori-hfdf3e6 px-2 py-1">
          ? {row.text}{row.answered ? <span className="block text-nori-h4d6a1e">↳ you: {row.answered}</span> : null}
        </div>
      );
    case "comment":
      return <div className="whitespace-pre-wrap break-words rounded border border-nori-h14131a/12 bg-nori-hfffdf7 px-2 py-1 text-nori-h4d6a1e">✎ you: {row.text}</div>;
    case "safety":
      return <div className="whitespace-pre-wrap break-words font-mono text-[11px] font-semibold text-nori-hb4442e">⚠ {row.text}</div>;
    case "verdict": {
      const tone = row.label === "success" ? "border-nori-h8ab135/50 bg-nori-h8ab135/10" : row.label === "failure" ? "border-nori-hb4442e/40 bg-nori-hfbecea" : "border-nori-hd98b3d/50 bg-nori-hfdf3e6";
      const mark = (m: string) => (m === "yes" ? "✓" : m === "partial" ? "~" : m === "no" ? "✗" : "?");
      return (
        <div className={"whitespace-pre-wrap break-words rounded border px-2 py-1 text-nori-h14131a " + tone}>
          <div className="font-mono text-[11px] font-semibold">verdict {row.confidence == null ? "unknown" : row.confidence.toFixed(2)} · {row.label}{row.summary ? ` — ${row.summary}` : ""}</div>
          {row.goals.length > 0 && (
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-nori-h5a5346">
              {row.goals.map((g, i) => <li key={i}>{mark(g.met)} {g.goal}{g.observed ? <span className="text-nori-h857b6b"> — {g.observed}</span> : null}</li>)}
            </ul>
          )}
        </div>
      );
    }
    case "learned":
      return <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-nori-h4d6a1e">✎ learned this run — {row.text}</div>;
    case "end":
      return <div className="whitespace-pre-wrap break-words font-mono text-[11px] font-semibold text-nori-hb06a1c">{row.text}</div>;
  }
};

// Compact token count: 500000 -> "500k", 12345 -> "12.3k", <1000 -> as-is.
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + "k";
}

// Short one-line arg preview for a tool-call chip (full object would wrap the transcript).
function compactArgs(input: Record<string, unknown>): string {
  const s = JSON.stringify(input);
  return s.length <= 90 ? s.slice(1, -1) : s.slice(1, 89) + "…";
}

export default Agent;
