// One-off: draws the landing-page mascot "Robo" in several art styles with Muse Image and saves
// them to public/robo/, so the site serves static files and never calls Meta at runtime.
// Each image costs $0.01. Existing files are skipped, spend is logged to .meta-cache/usage.jsonl
// and checked against META_DAILY_BUDGET_USD.
//   node scripts/robo-styles.mjs            (needs META_LIVE=1 and MODEL_API_KEY in .env.local)
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")));
const env = Object.fromEntries(
  (await readFile(path.join(root, ".env.local"), "utf8"))
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);
if (env.META_LIVE !== "1" || !env.MODEL_API_KEY) throw new Error("Set META_LIVE=1 and MODEL_API_KEY in .env.local");

const ROBO =
  "a friendly small robot mascot named Robo: a rounded-square glossy dark charcoal head with a black face screen framed by a thin glowing rim that shifts cyan to blue to violet to pink, two big round glowing cyan eyes on the screen, a compact rounded body, short arms, one hand waving, centered, full body, plain dark background #06080b, no text, no logos";
const STYLES = {
  studio: "photoreal product render, soft studio lighting, subtle reflections",
  anime: "Japanese anime cel-shaded illustration, crisp line art, vivid highlights",
  ukiyoe: "traditional Japanese ukiyo-e woodblock print, flat colours, visible wood grain texture",
  inkwash: "Chinese ink-wash shuimo painting, expressive brush strokes, rice paper texture, touches of colour on the rim and eyes",
  clay: "claymation stop-motion figure, handmade plasticine texture, fingerprints, warm light",
  pixel: "detailed 32-bit pixel art sprite, limited palette, crisp pixels",
  blueprint: "engineering blueprint line drawing, white lines on deep blue paper, dimension annotations without readable text",
  papercraft: "layered papercraft origami sculpture, folded paper facets, soft shadows",
};

const cache = path.join(root, ".meta-cache");
const out = path.join(root, "public", "robo");
await mkdir(cache, { recursive: true });
await mkdir(out, { recursive: true });

const day = new Date().toISOString().slice(0, 10);
async function spentToday() {
  try {
    return (await readFile(path.join(cache, "usage.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.day === day)
      .reduce((s, r) => s + (r.costUsd || 0), 0);
  } catch {
    return 0;
  }
}
const budget = Number(env.META_DAILY_BUDGET_USD) || 1;

for (const [id, style] of Object.entries(STYLES)) {
  const file = path.join(out, `${id}.webp`);
  if (existsSync(file)) {
    console.log(`skip ${id} (exists)`);
    continue;
  }
  const spent = await spentToday();
  if (spent + 0.01 > budget) throw new Error(`Daily budget reached ($${spent.toFixed(2)} of $${budget})`);
  const res = await fetch("https://api.meta.ai/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MODEL_API_KEY}` },
    body: JSON.stringify({ model: "muse-image-1.0", prompt: `${ROBO}. Style: ${style}.`, n: 1, size: "1024x1024", output_format: "webp" }),
  });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${id}: no image returned`);
  await writeFile(file, Buffer.from(b64, "base64"));
  const u = body.usage ?? {};
  await appendFile(
    path.join(cache, "usage.jsonl"),
    JSON.stringify({ day, at: new Date().toISOString(), model: "muse-image-1.0", call: `robo-style:${id}`, inputTokens: u.input_tokens ?? 0, cachedTokens: 0, outputTokens: u.output_tokens ?? 0, reasoningTokens: 0, costUsd: 0.01 }) + "\n",
  );
  console.log(`saved ${id}.webp ($0.01, today $${(spent + 0.01).toFixed(2)})`);
}
