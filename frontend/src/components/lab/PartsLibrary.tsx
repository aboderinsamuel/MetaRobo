"use client";

// The parts library Muse Spark designs from: the built-in catalogue plus parts the user uploads.
// Uploads stay in this browser and are sent with each build.
import { Download, Library, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { catalogToCsv, parsePartsUpload } from "@/lib/lab/catalog/io";
import { CATALOG, type CatalogPart } from "@/lib/lab/catalog/parts";

const KEY = "rc-parts";

export function loadUserParts(): CatalogPart[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as CatalogPart[]) : [];
  } catch {
    return [];
  }
}

function save(parts: CatalogPart[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(parts));
  } catch {}
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PartsLibrary({ parts, onChange }: { parts: CatalogPart[]; onChange: (p: CatalogPart[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-4 border border-line p-3 rounded-xl">
      <p className="mono-label flex items-center gap-1.5 text-[10px] text-dim">
        <Library className="size-3.5" /> Parts library
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-mute">
        Muse Spark builds only from real parts: <span className="text-fg">{CATALOG.length} built-in</span>
        {parts.length > 0 && (
          <>
            {" "}
            + <span className="text-fg">{parts.length} of yours</span>
          </>
        )}
        . Missing parts are looked up online.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button onClick={() => download("robocraft_parts_catalogue.csv", catalogToCsv([...CATALOG, ...parts]))} className="mono-label inline-flex h-8 items-center justify-center gap-1.5 border border-line-2 text-[10px] text-mute hover:text-fg rounded-xl">
          <Download className="size-3" /> Catalogue CSV
        </button>
        <button onClick={() => ref.current?.click()} className="mono-label inline-flex h-8 items-center justify-center gap-1.5 border border-line-2 text-[10px] text-mute hover:text-fg rounded-xl">
          <Upload className="size-3" /> Upload parts
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const { parts: added, skipped } = parsePartsUpload(await f.text());
            const byId = new Map(parts.map((p) => [p.id, p]));
            for (const p of added) byId.set(p.id, p);
            const next = [...byId.values()];
            save(next);
            onChange(next);
            setMsg(`Added ${added.length} part${added.length === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} without a name or valid size` : ""}.`);
          } catch (err) {
            setMsg(`Couldn't read that file: ${err instanceof Error ? err.message : String(err)}`);
          }
        }}
      />
      {parts.length > 0 && (
        <button
          onClick={() => {
            save([]);
            onChange([]);
            setMsg("Removed your uploaded parts.");
          }}
          className="mono-label mt-1.5 inline-flex items-center gap-1 text-[10px] text-dim hover:text-bad"
        >
          <Trash2 className="size-3" /> Clear my parts
        </button>
      )}
      {msg && <p className="mt-1.5 text-[11px] text-mute">{msg}</p>}
      <p className="mt-1.5 text-[10px] leading-snug text-dim">Upload CSV with the catalogue&apos;s columns (download it as a template), or a JSON array.</p>
    </div>
  );
}
