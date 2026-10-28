// What was built during the Meta Global AI Developer Hackathon (Oct 27 – Nov 4, 2026). The judges
// need to see exactly what is new, so each entry maps to commits in the public repo.
const LOG: { date: string; title: string; text: string; done: boolean }[] = [
  { date: "Oct 27", title: "RoboCraft core", text: "C++17 physics engine compiled to WebAssembly, four robot rigs built from real parts, firmware generator.", done: true },
  { date: "Oct 28", title: "Simple mode + onboarding", text: "Beginner path, 3D playback and motion programs, one-click Simulate.", done: true },
  { date: "Oct 28", title: "Muse Spark goes live", text: "Modeler and explainer moved to Meta Muse Spark 1.3 with a credit-safe client: cache, cost log, daily cap.", done: true },
  { date: "Oct 28", title: "Meta-inspired redesign", text: "The ∞ control-loop motif, Meta model stack, live agent trace.", done: true },
  { date: "Oct 30", title: "Video → model", text: "SAM 3.1 tracks a phone video of the real robot; we fit its physics from the motion.", done: false },
  { date: "Nov 1", title: "Agent loop + voice", text: "Visible propose → simulate → check → revise loop; Muse Voice Transcribe input.", done: false },
  { date: "Nov 2", title: "Real hardware", text: "Flash the verified controller to a real robot; film before and after.", done: false },
];

export default function HackathonLog() {
  return (
    <section id="log" className="relative border-b border-line">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="mono-label text-mute">·· Built during the hackathon</p>
          <h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] leading-[1.04] font-semibold tracking-[-0.03em]">
            Nine days, <span className="text-spectrum">in the open</span>.
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
            Everything here was built for the Meta Global AI Developer Hackathon, Oct 27 to Nov 4, 2026. Every step is a public commit.
          </p>
          <a
            href="https://github.com/aboderinsamuel/MetaRobo/commits/main"
            target="_blank"
            rel="noreferrer"
            className="mono-label mt-6 inline-flex h-9 items-center rounded-md border border-line-2 px-4 text-mute transition-colors hover:text-fg"
          >
            View the commits ↗
          </a>
        </div>
        <ol className="relative border-l border-line pl-8">
          {LOG.map((e) => (
            <li key={e.title} className="relative pb-8 last:pb-0">
              <span
                className={`absolute top-1.5 -left-[37px] size-2.5 rounded-full ring-4 ring-void ${e.done ? "" : "border border-line-2 bg-void"}`}
                style={e.done ? { background: "var(--spectrum-conic)" } : undefined}
              />
              <p className="mono-label text-[10px] text-dim">
                {e.date} · {e.done ? <span className="text-ok">shipped</span> : <span className="text-warn">next</span>}
              </p>
              <p className={`mt-1 text-lg font-semibold tracking-tight ${e.done ? "" : "text-mute"}`}>{e.title}</p>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-mute">{e.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
