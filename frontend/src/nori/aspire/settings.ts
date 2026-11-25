// The Agent page's per-task settings. The worker validates every value again and refuses anything out of range
// (synthesis/aspire_service/executor.py task_settings), so these bounds are a convenience, not the safety limit.
import type { HarnessSnapshot } from "./harnesses";
import type { StartBody } from "./api";

export const SPEED = { min: 0.1, max: 0.8 };
export const LLM_CALLS = { min: 10, max: 80 };        // the backend's BUDGET_MAX
export const SECONDS = { min: 60, max: 1800 };
export const TABLE_Z = { min: 0.3, max: 1.2 };
export const CONTINUE_S = { min: 0, max: 300 };   // worker: executor.py CONTINUE_MAX_S
export const DEPTH_MODELS = [
  { id: "unidepth_v2_vits", label: "UniDepth ViT-S (fast)" },
  { id: "unidepth_v2_vitl", label: "UniDepth ViT-L" },
  { id: "depth_anything_v2_large", label: "Depth Anything V2 L (metric)" },   // Apache-2.0; no intrinsics; 84 ms vs 55 ms on A10G
  { id: "depth_anything_v2_small", label: "Depth Anything V2 S (metric)" },
  { id: "none", label: "None (RGB only)" },
] as const;
// The agent's primitive set (worker: synthesis/real/position.py). "position" = the target-based tools (move_to as a jog
// servo, locate_object, descend_until_contact, grasped, placed) next to the jog tools, with the position pick-and-place
// skill; "jog" = the jog surface alone with the jog pick-and-place skill, as before 2026-11-06. Per task, no deploy.
export const PRIMITIVES = [
  { id: "position", label: "new (position)" },
  { id: "jog", label: "old (jog)" },
] as const;
export type Primitives = (typeof PRIMITIVES)[number]["id"];

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "Anthropic" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", provider: "Anthropic" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "Anthropic" },
  { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", provider: "OpenAI" },
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "OpenAI" },
] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ModelSpeed = "standard" | "fast" | "ultrafast";
export function modelSpeeds(model: AgentSettings["model"]): ModelSpeed[] {
  if (model.startsWith("gpt-")) return ["standard", "fast", "ultrafast"];
  if (model === "claude-sonnet-5-5") return ["standard"];
  return ["standard", "fast"];
}

export interface AgentSettings {
  model: (typeof MODELS)[number]["id"];
  effort: (typeof EFFORTS)[number];
  modelSpeed: ModelSpeed;
  harness: "nori" | "authored";
  speed: number;
  llmCalls: number;
  seconds: number;
  tableZ: string;              // text so the field can be empty: empty = the robot's configured table height
  depthModel: string;
  worldMap: boolean;
  showThinking: boolean;
  stopOnClose: boolean;
  homeFirst: boolean;
  allowBase: boolean;
  recordEpisode: boolean;
  useLearnedEntries: boolean;
  learn: boolean;                // the agent writes its end-of-run report into the robot's memory
  primitives: Primitives;
  continueS: number;             // after done, hold the session and arms this long for a follow-up (0 = end at done)
}

// Budget defaults sized for a pick and place: real runs take 45-67 tool calls, the API's default of 30 ends them early.
export const DEFAULT_SETTINGS: AgentSettings = {
  model: MODELS[0].id, effort: "medium", modelSpeed: "standard", harness: "nori",
  speed: 0.3, llmCalls: 80, seconds: 900, tableZ: "", depthModel: DEPTH_MODELS[0].id, worldMap: false, showThinking: true,
  stopOnClose: true, homeFirst: true, allowBase: false, recordEpisode: true, useLearnedEntries: true, learn: true, primitives: "position", continueS: 0,
};

const KEY = "nori_agent_settings";
const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));

export function loadSettings(): AgentSettings {
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as AgentSettings;
    const primitives = PRIMITIVES.some((p) => p.id === s.primitives) ? s.primitives : DEFAULT_SETTINGS.primitives;
    const model = MODELS.find((m) => m.id === s.model)?.id ?? DEFAULT_SETTINGS.model;
    const effort = EFFORTS.includes(s.effort) ? s.effort : DEFAULT_SETTINGS.effort;
    const harness = s.harness === "authored" ? "authored" : "nori";
    const modelSpeed = modelSpeeds(model).includes(s.modelSpeed) ? s.modelSpeed : DEFAULT_SETTINGS.modelSpeed;
    return { ...s, primitives, model, effort, modelSpeed, harness, speed: clamp(Number(s.speed) || DEFAULT_SETTINGS.speed, SPEED) };
  } catch { return DEFAULT_SETTINGS; }
}

export function saveSettings(s: AgentSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* a convenience: the page works without it */ }
}

/** A typed table height, or null for empty, or "invalid": the page refuses to start on a bad number. */
export function parseTableZ(text: string): number | null | "invalid" {
  if (!text.trim()) return null;
  const v = Number(text);
  return Number.isFinite(v) && v >= TABLE_Z.min && v <= TABLE_Z.max ? v : "invalid";
}

/** The request fields these settings add to a task. */
export function taskFields(s: AgentSettings, saved?: HarnessSnapshot): Pick<StartBody, "budget"> & { constraints: Record<string, unknown> } {
  if (saved && (s.harness !== "authored" || saved.model !== s.model)) throw new Error("Choose a harness for this model.");
  const table = parseTableZ(s.tableZ);
  const depth = s.depthModel === "none"
    ? { depth: "none", world_session: false }
    : { depth_model: s.depthModel, world_session: s.worldMap };
  return {
    budget: { seconds: clamp(s.seconds, SECONDS), llm_calls: clamp(s.llmCalls, LLM_CALLS) },
    constraints: {
      operator_presence: s.stopOnClose, home: s.homeFirst, allow_base: s.allowBase, record_episode: s.recordEpisode, learn: s.learn,
      use_learned_entries: s.useLearnedEntries,
      speed_factor: clamp(s.speed, SPEED), ...depth, show_thinking: s.showThinking,
      model: s.model, reasoning_effort: s.effort, model_speed: s.modelSpeed, harness: s.harness,
      // Older workers validate primitives before opening the robot but ignore the harness field.
      primitives: s.harness === "authored" ? "authored" : s.primitives,
      ...(saved ? { saved_harness: saved } : {}),
      ...(typeof table === "number" ? { table_z: table } : {}),
      ...(s.continueS > 0 ? { continue_s: clamp(Math.round(s.continueS), CONTINUE_S) } : {}),
    },
  };
}

// The goal being typed, kept for this browser tab: switching pages or reloading keeps it, closing the tab clears it.
const GOAL_KEY = "nori_agent_goal";

export function loadGoal(): string {
  try { return sessionStorage.getItem(GOAL_KEY) ?? ""; } catch { return ""; }
}

export function saveGoal(text: string) {
  try {
    if (text) sessionStorage.setItem(GOAL_KEY, text); else sessionStorage.removeItem(GOAL_KEY);
  } catch { /* a convenience: the page works without it */ }
}
