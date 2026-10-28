import { Check } from "lucide-react";
import Link from "next/link";

// Business model: a free lab funded by clearly-labelled sponsored parts, paid tiers for the
// Meta-powered features that cost us per call.
const TIERS = [
  {
    name: "Free",
    price: "$0",
    note: "forever",
    blurb: "Everything you need to build and simulate your first robot.",
    features: ["4 robot rigs with real-part physics", "C++ → WebAssembly simulator", "Offline modeler and advisor", "Firmware export"],
    cta: { label: "Start building", href: "/lab?onboard=1" },
    highlight: false,
  },
  {
    name: "Maker",
    price: "$9",
    note: "per month",
    blurb: "Meta Muse models for any machine you can describe or film.",
    features: ["Muse Spark modeling for any system", "Video → model with SAM 3.1", "Voice input", "Unlimited saved projects"],
    cta: { label: "Coming soon", href: null },
    highlight: true,
  },
  {
    name: "Classroom",
    price: "$49",
    note: "per month · 30 seats",
    blurb: "Robotics and control lessons where every answer is checked by physics.",
    features: ["Everything in Maker", "Teacher dashboard", "Shared kits and parts lists", "Priority support"],
    cta: { label: "Coming soon", href: null },
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="relative border-b border-line">
      <div className="mx-auto max-w-[1440px] px-4 py-24 sm:px-6 sm:py-32">
        <p className="mono-label text-mute">·· Pricing</p>
        <h2 className="mt-4 max-w-2xl text-[clamp(2rem,4vw,3.2rem)] leading-[1.04] font-semibold tracking-[-0.03em]">Free to learn. Pay when it&apos;s real.</h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-mute">
          The free lab is funded by sponsored parts: suppliers can place a part in a generated parts list, always labelled “Sponsored”, and only if it
          fits your robot&apos;s physics.
        </p>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className={`flex flex-col rounded-xl bg-panel p-6 sm:p-8 ${t.highlight ? "meta-ring" : "border border-line"}`}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">{t.name}</p>
                {t.highlight && <span className="mono-label text-spectrum text-[10px]">Meta-powered</span>}
              </div>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
                <span className="text-sm text-mute">{t.note}</span>
              </p>
              <p className="mt-3 text-sm text-mute">{t.blurb}</p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-spec-2" /> {f}
                  </li>
                ))}
              </ul>
              {t.cta.href ? (
                <Link href={t.cta.href} className="mt-8 inline-flex h-10 items-center justify-center rounded-md bg-fg text-sm font-semibold text-void transition-opacity hover:opacity-90">
                  {t.cta.label}
                </Link>
              ) : (
                <span className="mt-8 inline-flex h-10 items-center justify-center rounded-md border border-line-2 text-sm text-mute">{t.cta.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
