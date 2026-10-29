// Import / export of parts libraries. The catalogue downloads as CSV; users can upload their own parts
// (CSV with the same columns, or JSON) and Muse Spark will build from them too.
import { z } from "zod";
import { CATALOG, type CatalogPart, type Category, type ModelKind } from "./parts";
import { SUPPLIERS, type SupplierKey } from "./suppliers";

const CATEGORIES: Category[] = ["servo", "motor", "stepper", "controller", "driver", "sensor", "power", "structure", "wheel", "kit", "electronics"];
// Every model a part may use; unknown ones fall back to a generic module.
const MODELS = new Set<string>(CATALOG.map((p) => p.model).concat(["module_pcb"]));

export const COLUMNS = [
  "id",
  "name",
  "category",
  "model",
  "length_mm",
  "height_mm",
  "width_mm",
  "mass_g",
  "price_usd",
  "spec",
  "suppliers",
  "search",
  "actuator_kind",
  "rated_v",
  "stall_kgcm",
  "speed",
  "range_deg",
  "stall_a",
  "idle_a",
] as const;

function cell(v: string | number | undefined): string {
  const s = v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function catalogToCsv(parts: CatalogPart[] = CATALOG): string {
  const lines = [COLUMNS.join(",")];
  for (const p of parts) {
    const a = p.actuator;
    lines.push(
      [p.id, p.name, p.category, p.model, p.dims[0], p.dims[1], p.dims[2], p.massG, p.priceUsd, p.spec, p.suppliers.join(" "), p.search, a?.kind, a?.ratedV, a?.stallKgcm, a?.speed, a?.rangeDeg, a?.stallA, a?.idleA]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\n");
}

/** RFC-4180-ish CSV parsing (quoted cells, embedded commas and quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : undefined;
};

/** Validates one uploaded / web-found part, filling safe defaults. Returns null if it's unusable. */
export function toCatalogPart(r: Record<string, unknown>, idPrefix = "user"): CatalogPart | null {
  const name = String(r.name ?? "").trim().slice(0, 80);
  if (!name) return null;
  const dims = [num(r.length_mm ?? (r.dims as number[] | undefined)?.[0]), num(r.height_mm ?? (r.dims as number[] | undefined)?.[1]), num(r.width_mm ?? (r.dims as number[] | undefined)?.[2])];
  if (dims.some((d) => !d || d <= 0 || d > 3000)) return null;
  const category = (CATEGORIES as string[]).includes(String(r.category)) ? (r.category as Category) : "electronics";
  const model = MODELS.has(String(r.model)) ? (r.model as ModelKind) : "module_pcb";
  const slug = String(r.id || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suppliers = String(r.suppliers ?? "")
    .split(/[\s;|]+/)
    .filter((s): s is SupplierKey => s in SUPPLIERS);
  const kind = String(r.actuator_kind ?? (r.actuator as { kind?: string } | undefined)?.kind ?? "");
  const act = r.actuator as Record<string, unknown> | undefined;
  const actuator =
    ["servo", "continuous_servo", "dc", "stepper"].includes(kind) && num(r.stall_kgcm ?? act?.stallKgcm)
      ? {
          kind: kind as "servo",
          ratedV: num(r.rated_v ?? act?.ratedV) ?? 6,
          stallKgcm: num(r.stall_kgcm ?? act?.stallKgcm)!,
          speed: num(r.speed ?? act?.speed) ?? (kind === "servo" ? 300 : 100),
          rangeDeg: num(r.range_deg ?? act?.rangeDeg),
          stallA: num(r.stall_a ?? act?.stallA) ?? 1,
          idleA: num(r.idle_a ?? act?.idleA) ?? 0.05,
        }
      : undefined;
  return {
    id: slug.startsWith(`${idPrefix}-`) ? slug : `${idPrefix}-${slug}`,
    name,
    category,
    model,
    dims: dims as [number, number, number],
    massG: Math.max(0.1, num(r.mass_g ?? r.massG) ?? 10),
    priceUsd: Math.max(0, num(r.price_usd ?? r.priceUsd) ?? 0),
    spec: String(r.spec ?? "").slice(0, 160),
    suppliers: suppliers.length ? suppliers : ["amazon", "aliexpress"],
    search: String(r.search ?? name).slice(0, 80),
    actuator,
    source: typeof r.source === "string" && /^https?:\/\//.test(r.source) ? r.source : undefined,
  };
}

/** Parses an uploaded parts file (CSV with the catalogue's columns, or a JSON array). */
export function parsePartsUpload(text: string): { parts: CatalogPart[]; skipped: number } {
  const trimmed = text.trim();
  let rows: Record<string, unknown>[] = [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed) as unknown;
    rows = (Array.isArray(j) ? j : [j]) as Record<string, unknown>[];
  } else {
    const [head, ...body] = parseCsv(trimmed);
    const keys = head.map((h) => h.trim().toLowerCase());
    rows = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]?.trim() ?? ""])));
  }
  const parts: CatalogPart[] = [];
  for (const r of rows.slice(0, 300)) {
    const p = toCatalogPart(r);
    if (p) parts.push(p);
  }
  return { parts, skipped: rows.length - parts.length };
}

/** Server-side check of parts sent with a build request. */
export const UploadedPart = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  model: z.string(),
  dims: z.array(z.number()).length(3),
  massG: z.number(),
  priceUsd: z.number(),
  spec: z.string(),
  suppliers: z.array(z.string()),
  search: z.string(),
  actuator: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
});

export function acceptUploaded(input: unknown): CatalogPart[] {
  if (!Array.isArray(input)) return [];
  const out: CatalogPart[] = [];
  for (const r of input.slice(0, 300)) {
    const ok = UploadedPart.safeParse(r);
    if (!ok.success) continue;
    const p = toCatalogPart({ ...ok.data, length_mm: ok.data.dims[0], height_mm: ok.data.dims[1], width_mm: ok.data.dims[2], suppliers: ok.data.suppliers.join(" ") }, ok.data.id.split("-")[0] || "user");
    if (p) out.push({ ...p, id: ok.data.id.slice(0, 48) });
  }
  return out;
}
