"use client";

// Muse Spark's engineering review of the user's idea: can it be built from buyable parts, the
// practical design, its bill of materials, what can't be done, and what to buy instead.
import { AlertTriangle, CheckCircle2, ChevronDown, ShoppingCart, XCircle } from "lucide-react";
import { useState } from "react";
import { bomTotal, type Review, type Verdict } from "@/lib/lab/review";

export const VERDICT_UI: Record<Verdict, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  buildable: { label: "Buildable with hobby parts", cls: "border-ok/40 text-ok", icon: CheckCircle2 },
  partly_buildable: { label: "Partly buildable", cls: "border-warn/50 text-warn", icon: AlertTriangle },
  not_buildable: { label: "Not buildable at home", cls: "border-bad/50 text-bad", icon: XCircle },
};

export default function ReviewCard({ review }: { review: Review }) {
  const [open, setOpen] = useState(true);
  const v = VERDICT_UI[review.verdict];
  const Icon = v.icon;
  const total = bomTotal(review);
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="mono-label text-[10px] text-dim">Engineering review · Muse Spark</span>
        <ChevronDown className={`size-3.5 text-dim transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          <span className={`mono-label inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] ${v.cls}`}>
            <Icon className="size-3" /> {v.label}
          </span>
          <p className="text-[13px] leading-snug font-medium">{review.headline}</p>
          <p className="text-[12px] leading-relaxed text-mute">{review.explanation}</p>
          <div>
            <p className="mono-label text-[9px] text-dim">{review.verdict === "not_buildable" ? "Concept, rendered as imagined" : "What to build"}</p>
            <p className="mt-1 text-[12px] leading-relaxed">{review.concept}</p>
          </div>

          {review.bom.length > 0 && (
            <div>
              <p className="mono-label flex items-center justify-between text-[9px] text-dim">
                <span className="flex items-center gap-1">
                  <ShoppingCart className="size-3" /> Bill of materials
                </span>
                <span className="text-fg">≈ ${total.toFixed(0)}</span>
              </p>
              <ul className="mt-1.5 divide-y divide-line border border-line">
                {review.bom.map((b, i) => (
                  <li key={i} className="px-2.5 py-1.5">
                    <p className="flex justify-between gap-2 text-[12px]">
                      <span className="min-w-0">
                        <span className="text-dim">{b.qty}× </span>
                        {b.item}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-mute">${(b.qty * b.priceUsd).toFixed(0)}</span>
                    </p>
                    <p className="truncate font-mono text-[10px] text-spec-1" title={b.example}>
                      {b.example}
                    </p>
                    <p className="text-[11px] leading-snug text-dim">{b.role}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-dim">Rough street prices; check your supplier.</p>
            </div>
          )}

          {review.limitations.length > 0 && (
            <div>
              <p className="mono-label text-[9px] text-dim">Limitations</p>
              <ul className="mt-1 space-y-1">
                {review.limitations.map((l, i) => (
                  <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-warn">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> <span className="text-mute">{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.alternative && (
            <div className="border border-spec-2/30 bg-spec-2/5 px-2.5 py-2">
              <p className="mono-label text-[9px] text-spec-1">Buy or build instead</p>
              <p className="mt-1 text-[12px] leading-relaxed">{review.alternative}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
