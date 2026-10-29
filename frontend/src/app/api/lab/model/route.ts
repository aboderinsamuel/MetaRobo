// POST { description, dataSummary?, presetId?, assembly? } -> { model, usage? } | { error }
//
// A description is always built by Muse Spark: first the physics, then the machine's 3D design.
// It never falls back to a demo robot. Each step retries once with more room; if it still fails,
// the lab gets an error and keeps the user's workspace as it was. Demo robots load only through
// `presetId`, i.e. when the user picks one.
// With `assembly` (an engineer's edited design), the physics is re-derived from its parts list and
// the design is kept exactly as edited.
import { MAX_ATTEMPTS, aiEnabled, describeError, designAssembly, findPartOnline, modelFromDescription, offlineModel, reviewIdea } from "@/lib/lab/ai";
import { reviewBrief } from "@/lib/lab/review";
import { describeAssembly, resolveNeeds, sanitizeAssembly, type Assembly } from "@/lib/lab/assembly";
import { acceptUploaded } from "@/lib/lab/catalog/io";
import type { CatalogPart } from "@/lib/lab/catalog/parts";
import type { CallUsage } from "@/lib/lab/types";

export const maxDuration = 300;

const MAX_SEARCHES = 3;

/** Runs `fn` until it succeeds or the attempts run out; adds up what every attempt cost. */
async function withRetry<T extends { usage?: CallUsage }>(fn: (attempt: number) => Promise<T>): Promise<{ result?: T; spent: CallUsage[]; error?: unknown }> {
  const spent: CallUsage[] = [];
  let error: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn(attempt);
      if (result.usage) spent.push(result.usage);
      return { result, spent };
    } catch (err) {
      error = err;
      // A failed live call still costs; the client's meter reads the logged total on its next status check.
    }
  }
  return { spent, error };
}

function total(parts: (CallUsage | undefined)[]): CallUsage | undefined {
  const u = parts.filter((p): p is CallUsage => !!p);
  if (!u.length) return undefined;
  return { model: u[0].model, cached: u.every((x) => x.cached), tokens: u.reduce((s, x) => s + x.tokens, 0), costUsd: u.reduce((s, x) => s + x.costUsd, 0) };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { description?: string; dataSummary?: string; presetId?: string; assembly?: Assembly; customParts?: unknown };
  const description = (body.description ?? "").slice(0, 4000).trim();
  // The user's uploaded parts library: Muse Spark builds from these as well as the catalogue.
  const extra = acceptUploaded(body.customParts);
  // Demo robots: only when the user picked one.
  if (body.presetId) return Response.json(offlineModel(description, body.presetId));
  if (!description) return Response.json({ error: "Describe the machine first." }, { status: 400 });
  if (!aiEnabled()) return Response.json({ error: "Muse Spark is off (live mode isn't enabled), so it can't build what you describe. Demo robots still work from the Demos tab." }, { status: 503 });

  if (body.assembly) {
    let edited: Assembly;
    try {
      edited = sanitizeAssembly(body.assembly, extra);
    } catch (err) {
      return Response.json({ error: `That design can't be used: ${describeError(err)}` }, { status: 400 });
    }
    const brief = `${description}\n\nEngineered design (parts list):\n${describeAssembly(edited).slice(0, 6000)}`;
    const r = await withRetry((a) => modelFromDescription(brief, body.dataSummary?.slice(0, 4000), a));
    if (!r.result) return Response.json({ error: `Muse Spark couldn't update the physics: ${describeError(r.error)}. Try again.` }, { status: 502 });
    return Response.json({ ...r.result, model: { ...r.result.model, assembly: edited }, usage: total(r.spent) });
  }

  // 1. Engineering review: buildable from buyable parts? Rethink it into a practical design if so.
  //    A failed review never blocks the build: the 3D render always happens.
  const reviewed = await withRetry((a) => reviewIdea(description, a, extra));
  const review = reviewed.result?.review;
  const brief = review ? `${description}\n\nEngineering review:\n${reviewBrief(review)}` : description;

  // 2. Physics, of the practical design (or of the concept, if it can't be built).
  const physics = await withRetry((a) => modelFromDescription(brief, body.dataSummary?.slice(0, 4000), a));
  if (!physics.result) {
    return Response.json({ error: `Muse Spark couldn't model that machine: ${describeError(physics.error)}. Try again, or add a little detail.`, usage: total(reviewed.spent) }, { status: 502 });
  }

  // 3. The 3D build: the practical variant from real parts, or the concept exactly as imagined.
  const design = await withRetry((a) => designAssembly(description, physics.result!.model, a, review, extra));
  if (!design.result) {
    return Response.json(
      {
        error: `Muse Spark modelled the physics but couldn't design the 3D build: ${describeError(design.error)}. Press Build again; the review and physics are saved, so only the 3D design is redone.`,
        usage: total([...reviewed.spent, ...physics.spent]),
      },
      { status: 502 },
    );
  }

  // 4. Real parts the design needs that the catalogue doesn't have: look them up on the web (at most
  //    3 per build, to keep cost down). Anything still not found stays flagged in the design.
  let assembly = design.result.assembly;
  const searched: CallUsage[] = [];
  const found = new Map<string, CatalogPart>();
  for (const name of (assembly.unresolved ?? []).slice(0, MAX_SEARCHES)) {
    try {
      const r = await findPartOnline(name, `${physics.result.model.title}: ${description}`);
      searched.push(r.usage);
      if (r.part) found.set(name, r.part);
    } catch {
      // A failed lookup leaves the part flagged; the build still succeeds.
    }
  }
  assembly = resolveNeeds(assembly, found);

  return Response.json({
    ...physics.result,
    model: { ...physics.result.model, assembly, review },
    foundOnline: [...found.values()],
    usage: total([...reviewed.spent, ...physics.spent, ...design.spent, ...searched]),
  });
}
