import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadGoal, loadSettings, modelSpeeds, parseTableZ, saveGoal, taskFields } from "./settings";

describe("agent settings", () => {
  it("sends the tunables as constraints and a budget a pick can finish in", () => {
    const f = taskFields(DEFAULT_SETTINGS);
    expect(f.budget).toEqual({ seconds: 900, llm_calls: 80 });
    expect(f.constraints).toEqual({ model: "claude-opus-5-5", reasoning_effort: "medium", model_speed: "standard", harness: "nori", operator_presence: true, home: true, allow_base: false, record_episode: true, use_learned_entries: true, learn: true, speed_factor: 0.3, depth_model: "unidepth_v2_vits", world_session: false, show_thinking: true, primitives: "position" });
  });
  it("keeps referencing previous entries independent of writing new ones", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ learn: false }) });
    try {
      expect(taskFields(loadSettings()).constraints).toMatchObject({ use_learned_entries: true, learn: false });
      expect(taskFields({ ...DEFAULT_SETTINGS, useLearnedEntries: false }).constraints)
        .toMatchObject({ use_learned_entries: false, learn: true });
    } finally { vi.unstubAllGlobals(); }
  });
  it("disables the voxel map for RGB-only tasks and preserves the saved map preference", () => {
    const settings = { ...DEFAULT_SETTINGS, worldMap: true };
    const { constraints } = taskFields({ ...settings, depthModel: "none" });
    expect(constraints).toMatchObject({ depth: "none", world_session: false });
    expect(constraints).not.toHaveProperty("depth_model");
    expect(taskFields(settings).constraints.world_session).toBe(true);
  });
  it("sends the primitive set and falls back to the new one on an unknown saved value", () => {
    expect(taskFields(DEFAULT_SETTINGS).constraints.primitives).toBe("position");
    expect(taskFields({ ...DEFAULT_SETTINGS, primitives: "jog" }).constraints.primitives).toBe("jog");
    const store: Record<string, string> = { nori_agent_settings: JSON.stringify({ primitives: "planned" }) };
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
    expect(loadSettings().primitives).toBe("position");
    vi.unstubAllGlobals();
  });
  it("offers only the model's processing speeds and keeps effort independent", () => {
    expect(modelSpeeds("claude-sonnet-5-5")).toEqual(["standard"]);
    expect(modelSpeeds("claude-fable-5-2")).toEqual(["standard", "fast"]);
    expect(modelSpeeds("gpt-6.2-sol")).toEqual(["standard", "fast", "ultrafast"]);
    expect(taskFields({ ...DEFAULT_SETTINGS, model: "gpt-6.2-sol", modelSpeed: "ultrafast" }).constraints)
      .toMatchObject({ model_speed: "ultrafast", reasoning_effort: "medium" });
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ model: "claude-sonnet-5-5", modelSpeed: "fast" }) });
    try { expect(loadSettings().modelSpeed).toBe("standard"); } finally { vi.unstubAllGlobals(); }
  });
  it("keeps speed under the worker's 0.8 limit", () => {
    expect(taskFields({ ...DEFAULT_SETTINGS, speed: 1 }).constraints.speed_factor).toBe(0.8);
  });
  it("sends a table height only when one was typed", () => {
    expect(taskFields({ ...DEFAULT_SETTINGS, tableZ: "0.76" }).constraints.table_z).toBe(0.76);
    expect(taskFields(DEFAULT_SETTINGS).constraints).not.toHaveProperty("table_z");
    expect(taskFields(DEFAULT_SETTINGS).constraints).not.toHaveProperty("continue_s");     // off unless asked
    expect(taskFields({ ...DEFAULT_SETTINGS, continueS: 90 }).constraints.continue_s).toBe(90);
    expect(taskFields({ ...DEFAULT_SETTINGS, continueS: 999 }).constraints.continue_s).toBe(300);
  });
  it("calls a bad table height invalid instead of guessing", () => {
    expect(parseTableZ("")).toBeNull();
    expect(parseTableZ("76")).toBe("invalid");
    expect(parseTableZ("abc")).toBe("invalid");
  });

  it("keeps the goal being typed for this tab, and forgets an empty one", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    saveGoal("pick up the box");
    expect(loadGoal()).toBe("pick up the box");
    saveGoal("");
    expect(loadGoal()).toBe("");
    vi.unstubAllGlobals();
    expect(loadGoal()).toBe("");                          // no storage at all: still works, just forgets
  });
});

describe("model-built harnesses", () => {
  it("loads a specific local run only for its account and model", async () => {
    const { saveHarness, listHarnesses } = await import("./harnesses");
    const storage = Object.create({
      getItem(this: Record<string, string>, key: string) { return this[key] ?? null; },
      setItem(this: Record<string, string>, key: string, value: string) { this[key] = value; },
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", new EventTarget());
    try {
      const settings = { ...DEFAULT_SETTINGS, model: "gpt-6.2-astra", effort: "xhigh", harness: "authored" } as const;
      const tool = { name: "offset", description: "Apply offset", source: "return args['x'] + 1" };
      const snapshot = { version: 1, model: settings.model, revision: 2, tools: [tool] } as const;
      const saved = { ...snapshot, tools: [...snapshot.tools] };
      saveHarness("alice", "first", "Pick", saved);
      saveHarness("alice", "second", "Place", saved);
      saveHarness("alice", "first", "Pick", { ...saved, revision: 1 });
      const all = listHarnesses("alice", settings.model);
      expect(all.map((h) => h.id)).toEqual(["first", "second"]);
      expect(listHarnesses("bob", settings.model)).toEqual([]);
      expect(listHarnesses("alice", DEFAULT_SETTINGS.model)).toEqual([]);
      expect(taskFields(settings, all[0].snapshot).constraints).toMatchObject({
        model: settings.model, reasoning_effort: "xhigh", harness: "authored", saved_harness: saved,
      });
      expect(taskFields(settings).constraints).toMatchObject({ harness: "authored", primitives: "authored" });
      expect(taskFields(settings, all[0].snapshot).constraints.primitives).toBe("authored");
      expect(taskFields(settings).constraints).not.toHaveProperty("saved_harness");
      expect(() => taskFields(DEFAULT_SETTINGS, saved)).toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
});
