// NORI: hosted (LeLab-free) LLM path for the Coding + Agent pages.
//
// On the DESKTOP app the pages POST to LeLab's `/nori/llm/*`, which assembles the prompt +
// tools and forwards to Nori-Backend's gated/metered Anthropic proxy (the key lives on the
// backend). A hosted Vercel build has NO LeLab, so these two pages could never reach that path
// (they hit dead `localhost:8000`). This module reproduces LeLab's assembly IN THE BROWSER
// (see promptAssembly.ts) and calls the backend's generic proxy `/api/v1/agent/llm/messages
// (/stream)` directly with the Supabase JWT — auth + per-customer metering are unchanged (the
// backend gates + charges).
//
// The system prompts + tool schemas come from `prompts.generated.ts`, generated from the Python
// source of truth (lelab/server.py) — see scripts/gen_llm_prompts.py — so they can't drift.
//
// Only used when isDirectBackend() is true; the desktop path is untouched.

import { getAccessToken } from "@/nori/auth/session";
import { getDirectBackendUrl } from "@/nori/api/client";
import { AgentBudgetError, type AgentMessage, type AgentTurn } from "@/nori/remote/AgentSession";
import {
  NORI_CODEGEN_SYSTEM, NORI_PRIMITIVE_SYSTEM, NORI_PYSDK_SYSTEM, AGENT_TOOLS,
} from "./prompts.generated";
import { buildAgentTools } from "@nori/sdk";
import type { RobotDescriptor } from "@nori/sdk";
import {
  buildCodegenContent, buildAgentSystem, inferNewRun, dailyView, type CodegenRequest,
} from "./promptAssembly";

export type { CodegenRequest };

// Mirrors lelab/server.py: model = NORI_LLM_MODEL default, 1500-token completions (the agent loop).
const MODEL = (import.meta.env.VITE_NORI_LLM_MODEL as string | undefined) || "claude-sonnet-5";
const MAX_TOKENS = 1500;
// Codegen gets the backend's ceiling (routes/agent.py _LLM_MAX_TOKENS_CEILING). claude-sonnet-5 thinks
// by default and thinking counts against max_tokens: with the robot's learned advice injected (P2,
// ~46k chars on 0003 by 2026-11-20) every 1500-token generation on 0003 spent the whole budget thinking
// and returned no text, which the page reported as "generated 1 lines".
const CODEGEN_MAX_TOKENS = 8192;
// Lower effort = less thinking before the code (the agent loop runs at medium for the same reason).
const CODEGEN_OUTPUT_CONFIG = { effort: "medium" };

/** A codegen turn that produced no usable text: say why instead of returning "" (which the page
 *  would show as a one-line program). */
function codegenStopError(stopReason: string | undefined): Error | null {
  if (stopReason === "max_tokens") {
    return new Error(`the model ran out of its ${CODEGEN_MAX_TOKENS}-token budget before writing the code (long robot advice/context?) — try again or shorten the request`);
  }
  if (stopReason === "refusal") return new Error("the model declined this request");
  return null;
}
const LLM_BASE = "/api/v1/agent/llm"; // backend proxy prefix (routes/agent.py)

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function backendBase(): string {
  const base = getDirectBackendUrl();
  if (!base) throw new Error("hosted LLM path used without direct-backend mode");
  return base;
}

/** Hosted codegen: POST to the backend streaming proxy and return the raw Response so the caller
 * reads `res.body` exactly as it does for the LeLab stream (both are text/plain). */
// Mirror of lelab/server.py `_system_for`: ts -> JS teleop prompt (default), python -> the
// primitive policy prompt (or the raw-SDK prompt for flavor "sdk").
function systemFor(body: CodegenRequest): string {
  if (body.mode !== "python") return NORI_CODEGEN_SYSTEM;
  return body.flavor === "sdk" ? NORI_PYSDK_SYSTEM : NORI_PRIMITIVE_SYSTEM;
}

export async function hostedGenerateStream(body: CodegenRequest): Promise<Response> {
  return fetch(`${backendBase()}${LLM_BASE}/messages/stream`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: CODEGEN_MAX_TOKENS,
      output_config: CODEGEN_OUTPUT_CONFIG,
      system: systemFor(body) + (body.advice ? `\n\n${body.advice}` : ""),
      messages: [{ role: "user", content: buildCodegenContent(body) }],
      new_run: true, // each generation is its own run (matches LeLab)
    }),
  });
}

// The read_skill tool (matches nori-backend aspire/skills.READ_SKILL_TOOL). Primitive codegen gets the
// skill INDEX in the prompt + this tool, and CHOOSES which skills to read — the agent's `index` model,
// not a pre-injected top-N. The loop serves read_skill from /aspire/skills/{name}.
const READ_SKILL_TOOL = {
  name: "read_skill",
  description:
    "Read one skill from the library (the SKILL LIBRARY list in your instructions) and get its full text: " +
    "triggers, a sketch of which tools to call in which order, evidence and limits. Costs nothing. Read a " +
    "skill when its triggers match the task.",
  input_schema: {
    type: "object",
    properties: { name: { type: "string", description: "the skill's name from the list" } },
    required: ["name"],
  },
};

/** Hosted PRIMITIVE codegen where the model CHOOSES skills (index + read_skill), like the agent worker:
 *  put the skill index in the system prompt, give it read_skill, and run a short tool loop (serving
 *  read_skill from /aspire/skills/{name}) until it emits the policy. Non-streaming — the loop must see
 *  tool_use. `onRead` reports each skill the model actually read. Returns the raw code (caller strips fences). */
export async function hostedGenerateWithSkills(
  body: CodegenRequest, onRead?: (name: string) => void,
): Promise<string> {
  const base = backendBase();
  const headers = await authHeaders();
  let indexText = "";
  try {
    const ir = await fetch(`${base}/api/v1/aspire/skills/index`, { headers });
    if (ir.ok) indexText = ((await ir.json()) as { text?: string })?.text || "";
  } catch { /* skills are optional grounding */ }
  const system = systemFor(body) + (body.advice ? `\n\n${body.advice}` : "") + indexText;
  const messages: Array<Record<string, unknown>> = [{ role: "user", content: buildCodegenContent(body) }];
  for (let round = 0; round < 6; round++) {
    const res = await fetch(`${backendBase()}${LLM_BASE}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL, max_tokens: CODEGEN_MAX_TOKENS, output_config: CODEGEN_OUTPUT_CONFIG,
        system, messages, tools: [READ_SKILL_TOOL], new_run: round === 0,
      }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { detail?: string })?.detail || res.statusText);
    const turn = (await res.json()) as { stop_reason?: string; content?: Array<Record<string, unknown>> };
    const content = turn.content ?? [];
    messages.push({ role: "assistant", content });
    if (turn.stop_reason === "tool_use") {
      const results: Array<Record<string, unknown>> = [];
      for (const b of content) {
        if (b.type === "tool_use" && (b as { name?: string }).name === "read_skill") {
          const name = String(((b as { input?: { name?: unknown } }).input?.name) ?? "");
          onRead?.(name);
          let payload: unknown = { status: "error", reason: "fetch failed" };
          try {
            const r = await fetch(`${base}/api/v1/aspire/skills/${encodeURIComponent(name)}`, { headers });
            if (r.ok) payload = await r.json();
          } catch { /* served as an error tool_result below */ }
          results.push({ type: "tool_result", tool_use_id: (b as { id?: string }).id, content: JSON.stringify(payload) });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    const stopErr = codegenStopError(turn.stop_reason);
    if (stopErr) throw stopErr;
    return content.filter((b) => b.type === "text").map((b) => String((b as { text?: string }).text ?? "")).join("");
  }
  throw new Error("codegen exceeded the read_skill round limit");
}

/** Hosted advice INJECTION (agent-parity P2): fetch the robot's learned advice/context (aspire_robot_notes
 *  via /aspire/robots/{robot}/notes) and render it like the agent's advice.render — CONTEXT facts + topic
 *  entries. This is the channel that actually drives the live agent (measured grasp heights, reach walls,
 *  real-perception deltas, what the primitives' outputs really do). Best-effort: "" on any failure.
 *  See docs/codegen-agent-parity-design.md P2. (Raw topic bodies may include retracted entries until the
 *  code-tied invalidation of P6 lands.) */
export async function hostedRobotAdvice(robot: string): Promise<string> {
  if (!robot) return "";
  const base = backendBase();
  const headers = await authHeaders();
  let files: Array<{ kind?: string; key?: string; body?: string }> = [];
  try {
    const r = await fetch(`${base}/api/v1/aspire/robots/${encodeURIComponent(robot)}/notes`, { headers });
    if (r.ok) files = (((await r.json()) as { files?: typeof files }).files) || [];
  } catch { return ""; }
  const ctx = files.filter((f) => f.kind === "context").map((f) => (f.body || "").trim()).filter(Boolean);
  const topics = files.filter((f) => f.kind === "topic" && (f.body || "").trim());
  if (!ctx.length && !topics.length) return "";
  const parts = [
    "ADVICE — what the agent has learned on THIS robot from real runs (measured deltas, reach limits, grasp "
    + "heights, what the primitives' outputs really do). Prefer these concrete numbers over generic guidance; "
    + "when a live tool result disagrees, the result wins.",
  ];
  if (ctx.length) parts.push(`## CONTEXT\n${ctx.join("\n")}`);
  for (const t of topics) parts.push(`## ${t.key}\n${(t.body || "").trim()}`);
  return parts.join("\n\n");
}

/** Hosted depth fetch: POST one look-frame JPEG to the backend's depth endpoint and return the
 * raw grid result, or null on any failure (depth is best-effort grounding, never a dependency). */
export async function hostedDepthGrid(imageB64: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${backendBase()}/api/v1/agent/depth`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ image_b64: imageB64 }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Hosted agent turn: POST the browser-held messages to the backend proxy with the agent system +
 * tools, return the normalized AgentTurn (429 -> AgentBudgetError, like the LeLab path). */
export async function hostedAgentTurn(
  messages: AgentMessage[],
  robotState: Record<string, number> | undefined,
  cameraLayout: string | undefined,
  descriptor?: RobotDescriptor | null,
  poseSummary?: string,
  motors?: string,
): Promise<AgentTurn> {
  const res = await fetch(`${backendBase()}${LLM_BASE}/messages`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildAgentSystem(robotState, cameraLayout, descriptor, poseSummary, motors),
      // Rebuilt per-connection: with a descriptor the move_to / reach / lift schemas name the
      // joints, task DOFs and rail THIS robot has; without one (legacy/no ack yet) it is
      // byte-identical to the generated AGENT_TOOLS, which remains the L2 rendering LeLab's
      // server-side path also ships.
      tools: descriptor ? buildAgentTools(descriptor) : AGENT_TOOLS,
      messages,
      new_run: inferNewRun(messages),
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg = (detail as { detail?: string })?.detail || res.statusText;
    if (res.status === 429) throw new AgentBudgetError(msg);
    throw new Error(msg);
  }
  const turn = (await res.json()) as {
    stop_reason: string | null;
    content: AgentTurn["content"];
    usage?: { input_tokens: number; output_tokens: number };
    budget?: Record<string, unknown>;
  };
  return {
    stop_reason: turn.stop_reason,
    content: turn.content,
    usage: turn.usage,
    daily: dailyView(turn.budget),
  };
}
