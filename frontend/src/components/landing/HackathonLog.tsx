// What was built during the Meta Global AI Developer Hackathon (Oct 27 – Nov 4, 2026), from an
// empty repository. The judges need to see exactly what is new, so each entry maps to commits in
// the public repo.
const LOG: { date: string; title: string; text: string }[] = [
  { date: "Oct 27", title: "The Control Lab and its engine", text: "A C++17 physics and control engine compiled to WebAssembly, robots built from real parts, and firmware generated for the board." },
  { date: "Oct 28", title: "Muse Spark goes live", text: "The lab's AI moves to Meta Muse Spark, behind a credit-safe client: response cache, cost log, daily cap. Onboarding and Simple mode for beginners." },
  { date: "Oct 28", title: "Video to model", text: "SAM 3.1 tracks a real robot frame by frame in a video, and the engine fits its physics from the motion." },
  { date: "Oct 29", title: "Only real, buyable parts", text: "Every machine is built from datasheet-rated parts, every actuator simulated and wired, with hardware fit checks. In English, 日本語 and 中文." },
  { date: "Oct 29", title: "Create: a robot from a sentence", text: "Muse Spark designs the body, joints, room and task; Rapier physics and cloth run it; one click opens it in the Control Lab with real hardware inside." },
  { date: "Oct 30", title: "A welcome for newcomers", text: "Robo's welcome, four ready-made robots that open instantly, and a guided studio tour." },
  { date: "Oct 31", title: "The engineering agent", text: "Muse Wonder (or Spark) runs a closed loop of tool calls: simulate, diagnose, revise, until the physics passes. Users choose Spark or Wonder for every design." },
  { date: "Nov 1", title: "Physics you can trust", text: "Hands hold only what they touch, arms keep out of the body and the furniture, every step is judged by its real outcome, and a video of a real robot becomes a 3D design." },
];

export default function HackathonLog() {
  return (
    <section id="log" className="relative border-b border-line">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="mono-label text-mute">·· Build log</p>
          <h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] leading-[1.04] font-semibold tracking-[-0.03em]">
            Built in <span className="text-spectrum">nine days</span>, from an empty repo.
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
            Everything on this page was built for the Meta Global AI Developer Hackathon, October 27 to November 4, 2026. Nothing predates it, and every step is a public commit.
          </p>
          <a
            href="https://github.com/aboderinsamuel/MetaRobo/commits/main"
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex h-10 items-center rounded-xl border border-line-2 px-4 text-[14px] font-medium text-fg transition-colors hover:bg-panel"
          >
            Read the commit history ↗
          </a>
        </div>
        <ol className="relative border-l border-line pl-8">
          {LOG.map((e) => (
            <li key={e.title} className="relative pb-8 last:pb-0">
              <span className="absolute top-1.5 -left-[37px] size-2.5 rounded-full ring-4 ring-void" style={{ background: "var(--spectrum-conic)" }} />
              <p className="mono-label text-[10px] text-dim">{e.date}</p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{e.title}</p>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-mute">{e.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
