// Server-side Meta Model API client, built to protect a small credit budget.
//
// - Live calls are off unless META_LIVE=1 and MODEL_API_KEY are both set; callers fall back to
//   the offline library otherwise.
// - Every response is cached on disk (keyed by a hash of the full request), so a repeated request
//   never costs twice. Demo flows replay from the cache.
// - Every call has a tight output limit, and its tokens and estimated cost go to a usage log.
// - A daily spend cap (META_DAILY_BUDGET_USD) refuses new live calls once reached.
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

export const BASE_URL = "https://api.meta.ai/v1";

export const TEXT_MODEL = process.env.META_TEXT_MODEL || "muse-spark-1.3";

// USD per 1M tokens, from dev.meta.ai/docs/pricing-rate-limits.
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.1": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, cached: 0.002, output: 0.2 },
  "muse-spark-1.2-contributor": { input: 0.1, cached: 0.002, output: 0.2 },
  "muse-wonder-1.0": { input: 4, cached: 0.2, output: 20 },
};

export function metaEnabled(): boolean {
  return process.env.META_LIVE === "1" && Boolean(process.env.MODEL_API_KEY);
}

export class MetaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export interface JsonResult<T> {
  data: T;
  usage: Usage;
  cached: boolean;
  model: string;
}

export interface JsonRequest<S extends z.ZodType> {
  schema: S;
  schemaName: string;
  system: string;
  user: string;
  /** Images for Muse Spark vision: data: URLs (jpeg/png/webp), at most 50. */
  images?: string[];
  maxTokens: number;
  effort?: "minimal" | "low" | "medium" | "high";
  model?: string;
}

// Vercel's filesystem is read-only outside /tmp, so fall back there when the project dir fails.
function cacheDir(): string {
  return process.env.META_CACHE_DIR || path.join(process.cwd(), ".meta-cache");
}

async function ensureDir(): Promise<string> {
  const dir = cacheDir();
  try {
    await mkdir(dir, { recursive: true });
    return dir;
  } catch {
    const fallback = path.join(tmpdir(), "meta-cache");
    await mkdir(fallback, { recursive: true });
    return fallback;
  }
}

export function estimateCost(model: string, u: Omit<Usage, "costUsd">): number {
  const p = PRICES[model] ?? PRICES["muse-spark-1.3"];
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens);
  return (fresh * p.input + u.cachedTokens * p.cached + u.outputTokens * p.output) / 1e6;
}

// Running spend for today; loaded from the usage log once per process.
let spend: { day: string; usd: number } | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function todaysSpend(): Promise<number> {
  const day = today();
  if (spend?.day === day) return spend.usd;
  let usd = 0;
  try {
    const log = await readFile(path.join(await ensureDir(), "usage.jsonl"), "utf8");
    for (const line of log.split("\n")) {
      if (!line.startsWith(`{"day":"${day}"`)) continue;
      usd += (JSON.parse(line) as { costUsd: number }).costUsd;
    }
  } catch {
    // No log yet.
  }
  spend = { day, usd };
  return usd;
}

/** Today's estimated spend and the daily cap, for the lab's cost meter. */
export async function spendToday(): Promise<{ usd: number; budgetUsd: number }> {
  return { usd: await todaysSpend(), budgetUsd: dailyBudget() };
}

function dailyBudget(): number {
  const v = Number(process.env.META_DAILY_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Throws unless a live call is allowed right now: live mode on and today's budget not spent. */
export async function assertCanSpend(): Promise<void> {
  if (!metaEnabled()) throw new MetaError("Live Meta calls are off (set META_LIVE=1 and MODEL_API_KEY).");
  if ((await todaysSpend()) >= dailyBudget()) throw new MetaError(`Daily Meta budget of $${dailyBudget().toFixed(2)} reached.`, 429);
}

/** Path of the on-disk cache entry for a request hash. */
export async function cachePath(key: string): Promise<string> {
  return path.join(await ensureDir(), `${key}.json`);
}

export async function recordUsage(model: string, schemaName: string, usage: Usage): Promise<void> {
  const day = today();
  await todaysSpend();
  spend = { day, usd: (spend?.usd ?? 0) + usage.costUsd };
  const line = JSON.stringify({ day, at: new Date().toISOString(), model, call: schemaName, ...usage });
  try {
    await appendFile(path.join(await ensureDir(), "usage.jsonl"), line + "\n");
  } catch {
    // Logging must never break a request.
  }
  console.info(`[meta] ${schemaName} ${model} in=${usage.inputTokens} out=${usage.outputTokens} $${usage.costUsd.toFixed(4)} (today $${spend.usd.toFixed(4)})`);
}

export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

// Ask a Meta model for JSON matching `schema`. Results are validated with zod, cached, and costed.
export async function metaJson<S extends z.ZodType>(req: JsonRequest<S>): Promise<JsonResult<z.infer<S>>> {
  const model = req.model ?? TEXT_MODEL;
  const body = {
    model,
    messages: [
      { role: "developer", content: req.system },
      {
        role: "user",
        content: req.images?.length
          ? [{ type: "text", text: req.user }, ...req.images.slice(0, 50).map((url) => ({ type: "image_url", image_url: { url } }))]
          : req.user,
      },
    ],
    max_completion_tokens: req.maxTokens,
    reasoning_effort: req.effort ?? "low",
    response_format: {
      type: "json_schema",
      json_schema: { name: req.schemaName, strict: true, schema: jsonSchemaFor(req.schema) },
    },
  };
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const file = await cachePath(key);

  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as { content: string };
    return { data: req.schema.parse(JSON.parse(hit.content)), usage: zeroUsage(), cached: true, model };
  } catch {
    // Cache miss (or a stale entry that no longer validates): go live.
  }

  await assertCanSpend();

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(110_000),
  });
  const json = (await res.json().catch(() => null)) as ChatResponse | null;
  if (!res.ok || !json) throw new MetaError(json?.error?.message ?? `Meta API error ${res.status}`, res.status);

  const u = json.usage ?? {};
  const raw = {
    inputTokens: u.prompt_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
  const usage = { ...raw, costUsd: estimateCost(model, raw) };
  await recordUsage(model, req.schemaName, usage);

  const choice = json.choices?.[0];
  if (choice?.finish_reason === "length") throw new MetaError("The model ran out of output tokens before finishing.");
  const content = choice?.message?.content;
  if (!content) throw new MetaError(choice?.message?.refusal ? "The model declined this request." : "The model returned no content.");
  const data = req.schema.parse(JSON.parse(content));
  await writeFile(file, JSON.stringify({ model, schemaName: req.schemaName, content })).catch(() => {});
  return { data, usage, cached: false, model };
}

/** The long-horizon engineering agent's model (tool calling, multi-step). */
export const AGENT_MODEL = process.env.META_AGENT_MODEL || "muse-wonder-1.0";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatTurn {
  message: { content: string | null; tool_calls?: ChatToolCall[] };
  usage: Usage;
  cached: boolean;
  model: string;
}

// One tool-calling turn of a Chat Completions conversation. Cached by the exact request (same
// conversation + same tool results → same answer, free), costed, capped, retried once on 5xx.
export async function metaChat(req: { messages: unknown[]; tools: unknown[]; model?: string; maxTokens?: number; effort?: "minimal" | "low" | "medium" | "high"; label?: string }): Promise<ChatTurn> {
  const model = req.model ?? AGENT_MODEL;
  const body = { model, messages: req.messages, tools: req.tools, max_completion_tokens: req.maxTokens ?? 4000, reasoning_effort: req.effort ?? "medium" };
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const file = await cachePath(key);
  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as { message: ChatTurn["message"] };
    if (hit.message) return { message: hit.message, usage: zeroUsage(), cached: true, model };
  } catch {
    // Not cached: go live.
  }
  await assertCanSpend();
  type AgentResponse = { choices?: { finish_reason?: string; message?: ChatTurn["message"] }[]; usage?: ChatResponse["usage"]; error?: { message?: string } };
  let json: AgentResponse | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });
    json = (await res.json().catch(() => null)) as AgentResponse | null;
    if (res.ok && json) break;
    if (res.status < 500 || attempt === 1) throw new MetaError(json?.error?.message ?? `Meta API error ${res.status}`, res.status);
  }
  const u = json!.usage ?? {};
  const raw = { inputTokens: u.prompt_tokens ?? 0, cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0 };
  const usage = { ...raw, costUsd: estimateCost(model, raw) };
  await recordUsage(model, req.label ?? "agent_turn", usage);
  const choice = json!.choices?.[0];
  const msg = choice?.message;
  if (!msg) throw new MetaError("The model returned no message.");
  if (choice?.finish_reason === "length" && !msg.tool_calls?.length) throw new MetaError("The model ran out of output tokens before finishing.");
  const message = { content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.function.name, arguments: c.function.arguments ?? "{}" } })) } : {}) };
  await writeFile(file, JSON.stringify({ model, schemaName: req.label ?? "agent_turn", message })).catch(() => {});
  return { message, usage, cached: false, model };
}

export function zeroUsage(): Usage {
  return { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
}

interface ChatResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

// ---------------------------------------------------------------------------
// Web search grounding (Responses API + web_search tool)
// ---------------------------------------------------------------------------

/** $2.50 per 1,000 searches, on top of tokens (dev.meta.ai/docs/pricing-rate-limits). */
const USD_PER_SEARCH = 0.0025;

interface ResponsesResult {
  output?: { type?: string; content?: { type?: string; text?: string; annotations?: { type?: string; url?: string }[] }[] }[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string };
}

/**
 * Asks Muse Spark to look something up on the web and answer as JSON matching `schema`.
 * The answer is parsed from the text (search grounding doesn't promise strict JSON), validated,
 * cached and costed like every other call. Returns the cited source URLs too.
 */
export async function metaSearchJson<S extends z.ZodType>(req: Omit<JsonRequest<S>, "effort">): Promise<JsonResult<z.infer<S>> & { sources: string[] }> {
  const model = req.model ?? TEXT_MODEL;
  const body = {
    model,
    instructions: `${req.system}\n\nReply with ONLY a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(jsonSchemaFor(req.schema))}`,
    input: req.user,
    tools: [{ type: "web_search", search_context_size: "low" }],
    max_output_tokens: req.maxTokens,
    reasoning: { effort: "low" },
  };
  const key = createHash("sha256").update("search").update(JSON.stringify(body)).digest("hex");
  const file = await cachePath(key);
  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as { content: string; sources: string[] };
    return { data: req.schema.parse(JSON.parse(hit.content)), usage: zeroUsage(), cached: true, model, sources: hit.sources ?? [] };
  } catch {
    // Not cached: go live.
  }
  await assertCanSpend();
  const res = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(110_000),
  });
  const json = (await res.json().catch(() => null)) as ResponsesResult | null;
  if (!res.ok || !json) throw new MetaError(json?.error?.message ?? `Meta API error ${res.status}`, res.status);

  const searches = (json.output ?? []).filter((o) => o.type === "web_search_call").length;
  const u = json.usage ?? {};
  const raw = {
    inputTokens: u.input_tokens ?? 0,
    cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
  };
  const usage = { ...raw, costUsd: estimateCost(model, raw) + searches * USD_PER_SEARCH };
  await recordUsage(model, `${req.schemaName}+search×${searches}`, usage);

  const parts = (json.output ?? []).flatMap((o) => (o.type === "message" ? (o.content ?? []) : []));
  const text = json.output_text ?? parts.map((c) => c.text ?? "").join("");
  const sources = [...new Set(parts.flatMap((c) => (c.annotations ?? []).filter((a) => a.type === "url_citation" && a.url).map((a) => a.url!)))];
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new MetaError("The web search didn't return a usable answer.");
  const data = req.schema.parse(JSON.parse(match[0]));
  await writeFile(file, JSON.stringify({ model, schemaName: req.schemaName, content: match[0], sources })).catch(() => {});
  return { data, usage, cached: false, model, sources };
}
