import React, { act } from "react";
import Reconciler from "react-reconciler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTeleop, type RecordState } from "@nori/sdk";

type SessionStub = { teleop: RemoteTeleop; running: boolean; connState: string; controlActive: boolean; recordState: RecordState | null };
type RequestFrame = { type: string; action: string; request_id?: string; episode_id?: string; review_required?: boolean; [key: string]: unknown };

const store = vi.hoisted(() => ({ value: null as SessionStub | null, listeners: new Set<() => void>() }));
vi.mock("@/nori/TeleopSessionContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useTeleopSession: () => useSyncExternalStore(
    (listener) => { store.listeners.add(listener); return () => store.listeners.delete(listener); },
    () => store.value) };
});
vi.mock("@/contexts/ApiContext", () => ({ useApi: () => ({ baseUrl: "http://test.invalid", fetchWithHeaders: vi.fn() }) }));
vi.mock("@/components/ui/button", async () => {
  const { createElement } = await import("react");
  return { Button: (props: React.ComponentProps<"button">) => createElement("button", props, props.children) };
});
vi.mock("@/components/ui/switch", async () => {
  const { createElement } = await import("react");
  return { Switch: (props: { checked?: boolean }) => createElement("input", { role: "switch", checked: props.checked }) };
});
vi.mock("@/nori/remote/episodePreview", () => ({ EphemeralEpisodeRecorder: class {
  diagnostic = "Synthetic preview";
  start() {}
  async stop() { return null; }
  cancel() {}
} }));
vi.mock("@/nori/remote/pendingEpisodeNames", () => ({
  addPendingNames: vi.fn(), applyPendingNames: async () => ({ pending: 0, applied: 0 }), pendingNameCount: () => 0,
}));

import { DatasetCaptureCard } from "./DatasetCaptureCard";

// Real React reconciliation, hooks, effects and subscriptions, with a minimal
// in-memory host. No browser, network, camera or robot is contacted.
type HostProps = Record<string, unknown> & { disabled?: boolean; placeholder?: string; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void };
type Host = { type: string; props: HostProps; children: Host[]; text?: string };
const rootContext = {};
function append(parent: Host, child: Host) {
  const existing = parent.children.indexOf(child);
  if (existing >= 0) parent.children.splice(existing, 1);
  parent.children.push(child);
}
const renderer = Reconciler({
  now: () => Date.now(), isPrimaryRenderer: true, supportsMutation: true,
  supportsPersistence: false, supportsHydration: false,
  getRootHostContext: () => rootContext, getChildHostContext: () => rootContext,
  getPublicInstance: (node: Host) => node, prepareForCommit: () => null,
  resetAfterCommit() {}, shouldSetTextContent: () => false,
  createInstance: (type: string, props: HostProps) => ({ type, props, children: [] }),
  createTextInstance: (text: string) => ({ type: "#text", props: {}, children: [], text }),
  appendInitialChild: append, appendChild: append, appendChildToContainer: append,
  finalizeInitialChildren: () => false, prepareUpdate: (_n: Host, _t: string, _o: HostProps, props: HostProps) => props,
  commitUpdate: (node: Host, props: HostProps) => { node.props = props; },
  commitTextUpdate: (node: Host, _old: string, text: string) => { node.text = text; },
  removeChild: (parent: Host, child: Host) => { parent.children.splice(parent.children.indexOf(child), 1); },
  removeChildFromContainer: (parent: Host, child: Host) => { parent.children.splice(parent.children.indexOf(child), 1); },
  insertBefore: (parent: Host, child: Host, before: Host) => {
    const existing = parent.children.indexOf(child);
    if (existing >= 0) parent.children.splice(existing, 1);
    parent.children.splice(parent.children.indexOf(before), 0, child);
  },
  clearContainer: (parent: Host) => { parent.children = []; },
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  getCurrentEventPriority: () => 16, getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {}, afterActiveInstanceBlur() {}, preparePortalMount() {},
  detachDeletedInstance() {},
} as unknown as Parameters<typeof Reconciler>[0]);

function text(node: Host): string { return node.text ?? node.children.map(text).join(""); }
function nodes(node: Host): Host[] { return [node, ...node.children.flatMap(nodes)]; }
type Raw = { dcSend(frame: RequestFrame): boolean; ingestRecordStatus(frame: Record<string, unknown>): void;
  recordRequests: { close(): void }; recordStatusProbe: { close(): void } };
type Kind = "modern" | "old-l3" | "l2";
type Pending = { episode_id: string; task: string; decision?: "keep" | "reject" };

class Robot {
  sent: RequestFrame[] = [];
  pending: Pending[] = [];
  recording = false;
  current = "";
  session = false;
  kept = 0;
  seq = 0;
  reviewRequired = false;
  silent = false;
  constructor(public kind: Kind) {}
  response(frame: RequestFrame) {
    const supported = this.kind === "modern";
    let ok = true, error: string | undefined, resolved = "";
    switch (frame.action) {
      case "status": break;
      case "review_status":
        if (!supported) { ok = false; error = "unknown action review_status"; }
        break;
      case "session_start": this.session = true; this.kept = 0; break;
      case "session_end": this.session = false; break;
      case "episode_start":
        if (this.recording) { ok = false; error = "already recording an episode"; break; }
        this.session = this.recording = true;
        this.reviewRequired = supported && frame.review_required === true;
        this.current = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
        break;
      case "episode_stop":
        resolved = this.current;
        this.recording = false;
        if (this.reviewRequired) this.pending.push({ episode_id: this.current, task: "compatibility" });
        else this.kept++;
        this.reviewRequired = false;
        this.current = "";
        break;
      case "episode_keep":
      case "episode_reject":
        if (!supported) { ok = false; error = `unknown action ${frame.action}`; break; }
        resolved = frame.episode_id ?? "";
        this.pending = this.pending.filter((p) => p.episode_id !== frame.episode_id);
        if (frame.action === "episode_keep") this.kept++;
        break;
      case "episode_discard":
        if (this.kind === "old-l3" && !this.recording) { ok = false; error = "not recording"; }
        else { this.recording = false; this.kept = Math.max(0, this.kept-1); }
        break;
    }
    return { type: "record_status", ok, ...(error ? { error } : {}), recording: this.recording,
      session_open: this.session, episodes_kept: this.kept, free_gb: 40,
      episode: this.recording ? (this.kind === "l2" ? "session-test/episode-0001" : "episode-0001") : null,
      ...(supported ? { request_id: frame.request_id, review_supported: true,
        episode_id: resolved || this.current, pending_reviews: this.pending,
        active_review_episode_id: this.reviewRequired ? this.current : "" } : {}) };
  }
}

const mounts: { root: ReturnType<typeof renderer.createContainer>; client: RemoteTeleop }[] = [];
async function flush() { await act(async () => { await Promise.resolve(); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function publish(patch: Partial<SessionStub>) {
  if (!store.value) throw new Error("Missing test session");
  store.value = { ...store.value, ...patch };
  store.listeners.forEach((listener) => listener());
}
async function mount(robot: Robot) {
  const client = new RemoteTeleop({ arm: "right", onLog: () => {}, onRecord: (state: RecordState) => {
    publish({ recordState: state });
  } } as never);
  const raw = client as unknown as Raw;
  raw.dcSend = (frame) => {
    robot.sent.push({ ...frame });
    if (!robot.silent) queueMicrotask(() => raw.ingestRecordStatus(robot.response(frame)));
    return true;
  };
  client.videoStream = () => ({}) as MediaStream;
  store.value = { teleop: client, running: true, connState: "connected", controlActive: true,
    recordState: null };
  // The Remote page already seeds the legacy read-only status on connect.
  client.record("status");
  await Promise.resolve();
  const container: Host = { type: "root", props: {}, children: [] };
  const root = renderer.createContainer(container, 0, null, false, null, "", (e: Error) => { throw e; }, null);
  mounts.push({ root, client });
  await act(async () => renderer.updateContainer(React.createElement<{ defaultOpen?: boolean }>(
    DatasetCaptureCard, { defaultOpen: true }), root, null));
  await flush();
  const button = (label: string) => {
    const node = nodes(container).find((n) => n.type === "button" && text(n).trim() === label);
    expect(node, `missing button ${label}; UI=${text(container)}`).toBeDefined();
    return node!;
  };
  const click = async (label: string) => {
    const node = button(label);
    expect(node.props.disabled, `${label} unexpectedly disabled; UI=${text(container)}`).toBeFalsy();
    await act(async () => { node.props.onClick!(); await Promise.resolve(); });
    await flush();
  };
  const task = async () => {
    const node = nodes(container).find((n) => n.type === "input" && String(n.props.placeholder).startsWith("task for"))!;
    await act(async () => node.props.onChange!({ target: { value: "compatibility" } }));
  };
  return { client, raw, container, button, click, task, ui: () => text(container) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
});
afterEach(async () => {
  for (const { root, client } of mounts.splice(0)) {
    await act(async () => renderer.updateContainer(null, root, null));
    (client as unknown as Raw).recordRequests.close();
    (client as unknown as Raw).recordStatusProbe.close();
  }
  await flush();
  store.listeners.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("compatibility acceptance criteria", () => {
  it.each(["old-l3", "l2"] as Kind[])("%s retains the complete legacy recording flow", async (kind) => {
    const robot = new Robot(kind);
    const ui = await mount(robot);
    await tick(10000);
    await ui.task();
    expect(ui.button("Start session").props.disabled, ui.ui()).toBe(false);
    await ui.click("Start session");
    await ui.click("Start episode");
    await ui.click("Stop episode");
    expect(ui.ui()).toMatch(/Reject may not delete the robot's copy/i);
    expect(ui.ui()).not.toMatch(/robot copy is held|reject deletes it/i);
    await ui.click("Keep");
    await ui.click("Start episode");
    await ui.click("Stop episode");
    await ui.click("Reject");
    await ui.click("Finish session");
    expect(robot.sent.some((f) => f.review_required)).toBe(false);
    expect(robot.sent.filter((f) => /episode_(keep|reject)/.test(f.action))).toEqual([]);
    expect(robot.sent.some((f) => f.action === "episode_discard")).toBe(true);
    expect(robot.sent.filter((f) => !["status", "review_status"].includes(f.action))
      .every((f) => !f.request_id && !f.episode_id)).toBe(true);
  });

  it("legacy status promptly selects legacy mode without unsupported probes", async () => {
    const robot = new Robot("old-l3");
    const ui = await mount(robot);
    await tick(1000);
    await ui.task();
    expect(ui.button("Start session").props.disabled, ui.ui()).toBe(false);
    expect(ui.ui()).toMatch(/review (?:is )?unavailable/i);
    expect(ui.ui()).not.toMatch(/timed out|requires a robot software update/i);
    expect(robot.sent.filter((f) => f.action === "review_status")).toHaveLength(0);
  });

  it.each(["missing", "false"])("a status response with %s review_supported preserves legacy recording", async (flag) => {
    const robot = new Robot("old-l3");
    const original = robot.response.bind(robot);
    robot.response = (frame) => frame.action === "status"
      ? { ...original({ type: "record", action: "status" }), request_id: frame.request_id,
          ...(flag === "false" ? { review_supported: false } : {}) }
      : original(frame);
    const ui = await mount(robot);
    await ui.task();
    expect(ui.button("Start session").props.disabled, ui.ui()).toBe(false);
    expect(ui.ui()).toMatch(/review (?:is )?unavailable/i);
  });

  it("updated robots retain acknowledged Keep and targeted Reject", async () => {
    const robot = new Robot("modern");
    const ui = await mount(robot);
    await ui.task();
    await ui.click("Start session");
    await ui.click("Start episode");
    const first = robot.current;
    await ui.click("Stop episode");
    await ui.click("Keep");
    await ui.click("Start episode");
    const second = robot.current;
    await ui.click("Stop episode");
    await ui.click("Reject");
    expect(robot.sent.find((f) => f.action === "episode_keep")?.episode_id).toBe(first);
    expect(robot.sent.find((f) => f.action === "episode_reject")?.episode_id).toBe(second);
    expect(robot.sent.filter((f) => f.action === "episode_start").every((f) => f.review_required === true)).toBe(true);
    expect(robot.kept).toBe(1);
    await ui.click("Finish session");
  });

  it("reconnect restores the same held episode and rejects that identity", async () => {
    const robot = new Robot("modern");
    const eid = "00000000-0000-4000-8000-000000000099";
    robot.pending = [{ episode_id: eid, task: "held" }];
    const ui = await mount(robot);
    expect(ui.ui()).toContain("Keep this episode?");
    await act(async () => publish({ running: false, connState: "disconnected", controlActive: false }));
    expect(ui.button("Reject").props.disabled).toBe(true);
    await act(async () => publish({ running: true, connState: "connected", controlActive: true }));
    await flush();
    await ui.click("Reject");
    expect(robot.sent.find((f) => f.action === "episode_reject")?.episode_id).toBe(eid);
  });

  it("a held review never downgrades to legacy discard when support disappears", async () => {
    const robot = new Robot("modern");
    const eid = "00000000-0000-4000-8000-000000000088";
    robot.pending = [{ episode_id: eid, task: "held" }];
    const ui = await mount(robot);
    await act(async () => publish({ running: false, connState: "disconnected", controlActive: false }));
    robot.kind = "old-l3";
    await act(async () => publish({ running: true, connState: "connected", controlActive: true }));
    await tick(10000);
    expect(ui.ui()).toContain("Keep this episode?");
    expect(robot.sent.some((f) => f.action === "episode_discard")).toBe(false);
    expect(robot.pending[0].episode_id).toBe(eid);
    expect(ui.button("Keep").props.disabled).toBe(true);
    expect(ui.button("Reject").props.disabled).toBe(true);
  });

  it("a legacy take stays legacy when review becomes available after reconnect", async () => {
    const robot = new Robot("old-l3");
    const ui = await mount(robot);
    await ui.task();
    await ui.click("Start session");
    await ui.click("Start episode");
    await act(async () => publish({ running: false, connState: "disconnected", controlActive: false }));
    robot.kind = "modern";
    await act(async () => publish({ running: true, connState: "connected", controlActive: true }));
    await flush();
    await ui.click("Stop episode");
    await ui.click("Reject");
    expect(robot.sent.some((f) => f.action === "episode_discard")).toBe(true);
    expect(robot.sent.some((f) => ["episode_keep", "episode_reject"].includes(f.action))).toBe(false);
    expect(robot.sent.find((f) => f.action === "episode_stop")?.request_id).toBeUndefined();
  });

  it("a silent peer reports a connection error and does not select legacy mode", async () => {
    const robot = new Robot("old-l3");
    robot.silent = true;
    const ui = await mount(robot);
    await tick(1500);
    await ui.task();
    expect(ui.button("Start session").props.disabled).toBe(true);
    expect(ui.ui()).toContain("Recorder status unavailable; check the robot connection");
    expect(ui.ui()).not.toMatch(/review unavailable|reconnect to recover/i);
    expect(robot.sent.every((f) => f.action === "status")).toBe(true);
  });

  it("a modern recovery refusal does not silently start legacy recording", async () => {
    const robot = new Robot("modern");
    const original = robot.response.bind(robot);
    robot.response = (frame) => frame.action === "review_status"
      ? { ...original(frame), ok: false, error: "review service unavailable" } : original(frame);
    const ui = await mount(robot);
    await ui.task();
    expect(ui.button("Start session").props.disabled).toBe(true);
    expect(ui.ui()).toContain("review service unavailable");
    expect(ui.ui()).not.toContain("Using legacy recording");
    expect(robot.sent.every((f) => ["status", "review_status"].includes(f.action))).toBe(true);
  });

  it.each(["old-l3", "modern"] as Kind[])("capability discovery does not mutate an active %s agent recording", async (kind) => {
    const robot = new Robot(kind);
    robot.recording = robot.session = true;
    robot.current = "agent-existing-take";
    await mount(robot);
    await tick(1000);
    expect(robot.sent.every((f) => ["status", "review_status"].includes(f.action))).toBe(true);
    expect(robot.recording).toBe(true);
    expect(robot.current).toBe("agent-existing-take");
  });
});

describe("current-behavior diagnosis and matching safeguards", () => {
  it("old gateway uses one-shot status discovery without unsupported probes or mutation retries", async () => {
    const robot = new Robot("old-l3");
    const ui = await mount(robot);
    await tick(10000);
    const probes = robot.sent.filter((f) => f.action === "review_status");
    expect(probes).toHaveLength(0);
    expect(robot.sent.filter((f) => f.action === "status")).toHaveLength(2); // Page seed + fresh card probe.
    expect(ui.ui()).toMatch(/review unavailable/i);
    expect(ui.ui()).not.toMatch(/timed out|software update/i);
  });

  it.each(["old-l3", "l2"] as Kind[])("the existing SDK record API still accepts %s replies", async (kind) => {
    const robot = new Robot(kind);
    const client = new RemoteTeleop({ arm: "right", onLog: () => {} } as never);
    const raw = client as unknown as Raw;
    raw.dcSend = (frame) => { robot.sent.push(frame); raw.ingestRecordStatus(robot.response(frame)); return true; };
    client.record("session_start", "compatibility");
    client.record("episode_start", "compatibility");
    expect(client.recordState()?.recording).toBe(true);
    client.record("episode_stop");
    expect(client.recordState()?.episodesKept).toBe(1);
    expect(robot.sent.every((f) => !f.request_id && !f.review_required)).toBe(true);
  });

  it("omitting review_required still lets correlated Start time out after the old robot has started", async () => {
    const robot = new Robot("old-l3");
    const client = new RemoteTeleop({ arm: "right", onLog: () => {} } as never);
    const raw = client as unknown as Raw;
    raw.dcSend = (frame) => {
      robot.sent.push(frame);
      queueMicrotask(() => raw.ingestRecordStatus(robot.response(frame)));
      return true;
    };
    const result = client.recordConfirmed("episode_start", { task: "legacy-without-review" });
    const refused = expect(result).rejects.toThrow(/timed out/);
    await tick(10000);
    await refused;
    expect(robot.recording).toBe(true);
    expect(robot.seq).toBe(1);
    expect(robot.sent).toHaveLength(14);
    expect(robot.sent.every((f) => !("review_required" in f))).toBe(true);
    expect(client.recordState()?.recording).toBe(true);
  });

  it("an unrelated legacy reply cannot acknowledge a Keep mutation", async () => {
    const client = new RemoteTeleop({ arm: "right", onLog: () => {} } as never);
    const raw = client as unknown as Raw;
    raw.dcSend = () => true;
    let settled = false;
    const result = client.recordConfirmed("episode_keep", { episodeId: "held-id" }, 100)
      .then(() => { settled = true; }, () => { settled = true; });
    raw.ingestRecordStatus({ type: "record_status", ok: true, recording: false });
    await Promise.resolve();
    expect(settled).toBe(false);
    await tick(100);
    await result;
  });
});
