"use client";

// Bill of materials for an AI-designed machine: every catalogue and fabricated part with quantities,
// cost and where to buy or make it, plus a CSV export for ordering.
import { ChevronDown, Download, ExternalLink } from "lucide-react";
import { useState } from "react";
import { billOfMaterials, totalPriceUsd, type Assembly } from "@/lib/lab/assembly";
import { FAB_SERVICES, supplierLinks } from "@/lib/lab/catalog/suppliers";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bomCsv(a: Assembly): string {
  const rows = billOfMaterials(a);
  const lines = [["Qty", "Part", "Spec", "Type", "Unit USD", "Total USD", "Where", "Search term"].join(",")];
  for (const r of rows) {
    const where = r.kind === "fab" || r.kind === "shell" ? FAB_SERVICES[0] : r.kind === "need" ? "Not in catalogue: look up" : supplierLinks(r.suppliers, r.search).map((l) => l.name).join(" / ");
    lines.push([r.qty, r.name, r.spec, r.kind, r.unitUsd.toFixed(2), (r.qty * r.unitUsd).toFixed(2), where, r.search].map(csvCell).join(","));
  }
  lines.push(["", "Total", "", "", "", totalPriceUsd(a).toFixed(2), "", ""].map(csvCell).join(","));
  return lines.join("\n");
}

export default function BomPanel({ assembly }: { assembly: Assembly }) {
  const [open, setOpen] = useState(true);
  const rows = billOfMaterials(assembly);
  const total = totalPriceUsd(assembly);
  const download = () => {
    const blob = new Blob([bomCsv(assembly)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${assembly.title.replace(/[^\w]+/g, "_").toLowerCase()}_bom.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="mono-label text-[10px] text-dim">
          Bill of materials · {rows.length} items · <span className="text-fg">≈ ${total.toFixed(0)}</span>
        </span>
        <ChevronDown className={`size-3.5 text-dim transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <ul className="divide-y divide-line border border-line rounded-xl">
            {rows.map((r) => (
              <li key={r.key} className="px-2.5 py-1.5">
                <p className="flex justify-between gap-2 text-[12px]">
                  <span className="min-w-0">
                    <span className="text-dim">{r.qty}× </span>
                    <span className={r.kind === "need" ? "text-warn" : ""}>{r.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-mute">${(r.qty * r.unitUsd).toFixed(2)}</span>
                </p>
                <p className="truncate text-[10.5px] text-dim" title={r.spec}>
                  {r.spec}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                  {r.kind === "fab" || r.kind === "shell" ? (
                    <span className="font-mono text-[10px] text-spec-1">Make: {FAB_SERVICES.slice(0, 2).join(" · ")}</span>
                  ) : r.kind === "need" ? (
                    <span className="font-mono text-[10px] text-warn">Not in the catalogue yet</span>
                  ) : (
                    supplierLinks(r.suppliers.slice(0, 4), r.search).map((l) => (
                      <a key={l.name} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[10px] text-spec-1 hover:underline">
                        {l.name} <ExternalLink className="size-2.5" />
                      </a>
                    ))
                  )}
                  {r.source && (
                    <a href={r.source} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-mute hover:underline">
                      source ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button onClick={download} className="mono-label mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 border border-line-2 text-[10px] text-mute hover:text-fg rounded-xl">
            <Download className="size-3" /> Download BOM (CSV)
          </button>
          <p className="mt-1 text-[10px] text-dim">Typical street prices. Supplier links open each store&apos;s search for the part.</p>
        </div>
      )}
    </div>
  );
}
