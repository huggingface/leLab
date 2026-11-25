import { describe, expect, it } from "vitest";
import { groupRows, isAtBottom, pendingComments, toLogLines, toRows } from "@/nori/pages/agent";
import type { TaskEvent } from "@/nori/aspire/api";

const ev = (n: number, type: string, rest: Record<string, unknown> = {}): TaskEvent => ({ n, type, ...rest });

describe("toRows", () => {
  it("renders the executor's event stream as a transcript, pairing step_start with its step", () => {
    const rows = toRows("pick up the can", [
      ev(0, "queued"), ev(1, "claimed"),
      ev(2, "started", { robot: "NORI-A3-0003", model: "m", grant: "backend_task" }),
      ev(3, "home", { ok: true, side: "left", duration_s: 12.5 }),
      ev(4, "thought", { text: "Looking first." }),
      ev(5, "say", { text: "I'll look at the table." }),
      ev(6, "step_start", { tool: "observe", args: {} }),
      ev(7, "step", { tool: "observe", args: {}, result: "{\"status\": \"ok\"}", status: "ok" }),
      ev(8, "frame", { tool: "observe", jpeg_b64: "QUJD" }),
      ev(9, "frame", { tool: "observe", jpeg_b64: "" }),                       // an empty image is skipped
      ev(10, "step_start", { tool: "jog_arm", args: { x: 1, seconds: 2 } }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["goal", "info", "info", "thought", "say", "call", "frame", "call"]);
    expect(rows[5]).toMatchObject({ kind: "call", tool: "observe", pending: false, status: "ok" });
    expect(rows[6]).toMatchObject({ kind: "frame", tool: "observe", src: "data:image/jpeg;base64,QUJD" });
    expect(rows[7]).toMatchObject({ kind: "call", tool: "jog_arm", pending: true });
    expect(rows[2]).toMatchObject({ text: "homed the left arm to the high-side pose (12.5 s)" });
  });

  it("shows refusals, questions with their answers, safety trips and the end", () => {
    const rows = toRows("x", [
      ev(0, "step_start", { tool: "lift", args: { height: 0.9 } }),
      ev(1, "step", { tool: "lift", args: { height: 0.9 }, result: "{\"status\": \"geofence\"}", status: "ok" }),
      ev(2, "refused", { tool: "lift", reason: "lift 0.900 m outside [0.05, 0.55]" }),
      ev(3, "needs_input", { question: "Which can?" }),
      ev(4, "answered", { text: "the red one" }),
      ev(5, "safety", { check: "geofence", ok: false, reason: "hand x=0.132 m outside" }),
      ev(6, "safety", { check: "step", ok: true }),
      ev(7, "operator_lost", { reason: "operator_lost: the supervising page stopped checking in" }),
      ev(8, "cancelled", { reason: "operator_lost" }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["goal", "call", "refused", "question", "safety", "safety", "end"]);
    expect(rows[3]).toMatchObject({ kind: "question", text: "Which can?", answered: "the red one" });
    expect(rows[6]).toMatchObject({ kind: "end", status: "cancelled", text: "■ stopped — operator_lost" });
  });

  it("labels the outcome", () => {
    expect(toRows("x", [ev(0, "done", { success_claim: true, summary: "Picked it up." })]).at(-1))
      .toMatchObject({ kind: "end", status: "done", text: "✓ goal reached — Picked it up." });
    expect(toRows("x", [ev(0, "done", { success_claim: false })]).at(-1)).toMatchObject({ text: "finished without success" });
    expect(toRows("x", [ev(0, "failed", { reason: "budget:llm_calls" })]).at(-1)).toMatchObject({ text: "failed — budget:llm_calls" });
    const oldWorker = "ValueError: constraints.primitives must be one of ('position', 'jog'), got 'authored'";
    expect(toRows("x", [ev(0, "failed", { reason: oldWorker })]).at(-1))
      .toMatchObject({ text: "failed — This worker needs an update to run model-built tools." });
  });

  it("shows the agent's thinking and the settings a run used", () => {
    const rows = toRows("x", [
      ev(0, "started", { robot: "r", model: "m", grant: "g", settings: { speed_factor: 0.6, table_z: 0.76, depth_model: "default", world_session: false, allow_base: true } }),
      ev(1, "think", { text: "the box is left of the gripper" }),
    ]);
    expect(rows[2]).toMatchObject({ kind: "info", text: "speed 0.6 · table 0.76 m · depth default · map off · base on · recording off" });
    expect(rows[3]).toMatchObject({ kind: "think", text: "the box is left of the gripper" });
  });

  it("keeps a log line short however much the event carried", () => {
    const [line] = toLogLines([ev(0, "video", { rtp: "x".repeat(150), more: "y".repeat(150), again: "z".repeat(150) })]);
    expect(line.length).toBeLessThanOrEqual(240);
  });

  it("shows what happened to the recording", () => {
    const rows = toRows("x", [
      ev(0, "episode_started", { episode: "episode-0001", free_gb: 41.2 }),
      ev(1, "episode_done", { episode: "episode-0001", keep: true, success_claim: false, seconds: 212.4 }),
      ev(2, "episode_done", { episode: "episode-0002", keep: false }),
      ev(3, "record_warning", { kind: "refused", detail: "already recording an episode" }),
    ]);
    expect(rows.slice(1).map((r) => ("text" in r ? r.text : ""))).toEqual([
      "recording episode-0001 · 41.2 GB free on the robot",
      "recording kept: episode-0001 as failure (212.4 s)",
      "recording discarded: episode-0002",
      "recording problem (refused): already recording an episode",
    ]);
    expect(rows[4].kind).toBe("safety");
  });

  it("leaves out a free-space figure the robot did not report", () => {
    expect(toRows("x", [ev(0, "episode_started", { episode: "episode-0001", free_gb: 0 })])[1]).toMatchObject({ text: "recording episode-0001" });
  });

  it("follows the transcript only near the bottom", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 570, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })).toBe(false);
  });
});

describe("toRows: the graded verdict and what the agent learned", () => {
  it("renders the verdict row with its goals, the done row by the verdict, and the learned row", () => {
    const rows = toRows("put the box in the bowl", [
      ev(0, "verdict", { confidence: 0.78, label: "success", summary: "In the bowl, leaning.",
        goals: [{ goal: "box inside the bowl", met: "yes", observed: "inside" }, { goal: "upright", met: "partial", observed: "leaning" }] }),
      ev(1, "advice", { ok: true, written: ["Lift to 0.48 before the carry"], edited: [["Reach gap", "what"]], graded: [["Old one", "useful"]], context: ["table_z"] }),
      ev(2, "done", { success_claim: false, summary: "I think it tipped", verification: { confidence: 0.78, label: "success" } }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["goal", "verdict", "learned", "end"]);
    expect(rows[1]).toMatchObject({ kind: "verdict", confidence: 0.78, label: "success", goals: [{ met: "yes" }, { met: "partial" }] });
    expect(rows[2]).toMatchObject({ kind: "learned", titles: ["Lift to 0.48 before the carry", "Reach gap"] });
    expect((rows[2] as { text: string }).text).toContain("new: Lift to 0.48 before the carry");
    expect((rows[3] as { text: string }).text).toBe("✓ goal reached (verdict 0.78) — the agent said failure — I think it tipped");
  });

  it("falls back to the agent's claim without a verdict, and says when nothing was learned", () => {
    const rows = toRows("x", [
      ev(0, "advice", { ok: false, error: "ValueError: no JSON object" }),
      ev(1, "episode_done", { keep: true, episode: "e1", success_claim: true, seconds: 40, verification: { label: "uncertain" } }),
      ev(2, "done", { success_claim: true, summary: "done" }),
    ]);
    expect((rows[1] as { text: string }).text).toBe("nothing learned (ValueError: no JSON object)");
    expect((rows[2] as { text: string }).text).toBe("recording kept: e1 as uncertain (40 s)");
    expect((rows[3] as { text: string }).text).toBe("✓ goal reached — done");
  });
});

describe("comments", () => {
  it("shows a comment in the transcript when the agent read it", () => {
    const rows = toRows("x", [ev(0, "comment", { text: "it's behind the box" })]);
    expect(rows.map((r) => r.kind)).toEqual(["goal", "comment"]);
    expect(rows[1]).toMatchObject({ kind: "comment", text: "it's behind the box" });
  });

  it("keeps a sent comment queued until the agent reads it, one per send", () => {
    const sent = ["slowly", "behind the box", "slowly"];
    expect(pendingComments(sent, [])).toEqual(sent);
    expect(pendingComments(sent, [ev(0, "comment", { text: "slowly" })])).toEqual(["behind the box", "slowly"]);
    // the worker answers an open question with the comments it took, joined with " / "
    expect(pendingComments(sent, [ev(0, "comment", { text: "slowly" }), ev(1, "answered", { via: "comment", text: "behind the box / slowly" })])).toEqual([]);
    expect(pendingComments(["the red one"], [ev(0, "answered", { text: "the red one" })])).toEqual(["the red one"]);   // a typed answer is not a comment
  });
});

describe("continued tasks", () => {
  it("shows each instruction's end, the wait and the next instruction", () => {
    const rows = toRows("pick up the cup", [
      ev(0, "instruction_done", { index: 1, success_claim: true, summary: "Picked it up." }),
      ev(1, "waiting", { seconds: 90 }),
      ev(2, "continued", { index: 2, instruction: "now put it on the shelf" }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["goal", "end", "info", "goal"]);
    expect(rows[1]).toMatchObject({ text: "✓ instruction 1 done — Picked it up." });
    expect(rows[2]).toMatchObject({ text: "holding the arms — waiting up to 90 s for the next instruction" });
    expect(rows[3]).toMatchObject({ kind: "goal", text: "now put it on the shelf" });
  });

  it("clears comments a continued task took as its next instruction", () => {
    expect(pendingComments(["now the shelf", "slowly"], [ev(0, "continued", { instruction: "now the shelf slowly" })])).toEqual([]);
  });
});


describe("groupRows", () => {
  it("folds the grey thoughts under the next green call line and leaves the rest alone", () => {
    const rows = toRows("x", [
      ev(0, "say", { text: "Starting." }),
      ev(1, "thought", { text: "Need to locate first." }),
      ev(2, "think", { text: "long reasoning" }),
      ev(3, "step_start", { tool: "locate", args: { view: "overhead", u: 1, v: 2 } }),
      ev(4, "step", { tool: "locate", args: { view: "overhead", u: 1, v: 2 }, status: "ok", result: "{}" }),
      ev(5, "thought", { text: "Done, nothing after me." }),
      ev(6, "done", { success_claim: false, summary: "gave up" }),
    ]);
    const g = groupRows(rows);
    expect(g.map((x) => ("row" in x ? x.row.kind : x.call ? "call:" + x.call.tool : "thoughts"))).toEqual(["goal", "say", "call:locate", "thoughts", "end"]);
    const call = g[2] as Extract<ReturnType<typeof groupRows>[number], { call: unknown }>;
    expect(call.thoughts.map((r) => r.kind)).toEqual(["thought", "think"]);
    expect((g[3] as { thoughts: unknown[] }).thoughts).toHaveLength(1);
  });
});
