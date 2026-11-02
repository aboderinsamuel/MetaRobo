import { ArrowUpRight, Bot, Car } from "lucide-react";
import Link from "next/link";
import RoboMark from "@/components/brand/RoboMark";
import { LaunchButton } from "./Chrome";

type Item = { label: string; note?: string; href?: string };

const COLUMNS: [string, Item[]][] = [
  [
    "Product",
    [
      { label: "Create", note: "Design a robot from a sentence", href: "/create" },
      { label: "Control Lab", note: "Real parts, tuning, firmware", href: "/lab" },
      { label: "Ready-made robots", note: "Open one instantly", href: "/create?example=laundry-humanoid" },
      { label: "Guided tour", note: "New to robots? Start here", href: "/lab?onboard=1" },
    ],
  ],
  [
    "Meta models",
    [
      { label: "Muse Spark", note: "Designs and revises robots" },
      { label: "Muse Wonder", note: "Deeper designs, the engineering agent" },
      { label: "SAM 3.1", note: "Tracks real robots on video" },
      { label: "Muse Image", note: "The launch film" },
    ],
  ],
  [
    "Under the hood",
    [
      { label: "Rapier physics", note: "Rigid bodies and cloth" },
      { label: "C++ control engine", note: "Compiled to WebAssembly" },
      { label: "Next.js · React Three Fiber", note: "Real-time 3D in the browser" },
      { label: "139 automated tests", note: "Physics, parts and firmware" },
    ],
  ],
  [
    "Project",
    [
      { label: "Source on GitHub", href: "https://github.com/aboderinsamuel/MetaRobo" },
      { label: "Build log", note: "Every commit of the hackathon", href: "#log" },
      { label: "How it works", href: "#loop" },
      { label: "Pricing", href: "#pricing" },
    ],
  ],
];

function FooterItem({ it }: { it: Item }) {
  const body = (
    <>
      <span className="flex items-center gap-1 text-[14px] font-medium text-fg">
        {it.label}
        {it.href?.startsWith("http") && <ArrowUpRight className="size-3.5 text-mute" />}
      </span>
      {it.note && <span className="mt-0.5 block text-[13px] text-mute">{it.note}</span>}
    </>
  );
  if (!it.href) return body;
  if (it.href.startsWith("http"))
    return (
      <a href={it.href} target="_blank" rel="noreferrer" className="block transition-opacity hover:opacity-75">
        {body}
      </a>
    );
  return (
    <Link href={it.href} className="block transition-opacity hover:opacity-75">
      {body}
    </Link>
  );
}

export default function Footer() {
  return (
    <>
      <section id="builder" className="border-b border-line">
        <div className="mx-auto grid max-w-[1440px] gap-px bg-line sm:grid-cols-[1.2fr_1fr_1fr]">
          <div className="bg-void p-6 py-14 sm:p-10">
            <p className="mono-label text-mute">Prefer a head start?</p>
            <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Start from a working machine</h2>
            <p className="mt-3 max-w-sm text-[15px] text-mute">
              Open a ready-built arm or rover in the Control Lab. Swap any part and watch the motors, the circuit and the firmware follow.
            </p>
          </div>
          {[
            { href: "/lab?preset=arm", icon: Bot, name: "3-axis arm", text: "Inverse kinematics, torque sizing, servo rail" },
            { href: "/lab?preset=rover", icon: Car, name: "Rover", text: "Drive-force budget, H-bridge matching, runtime" },
          ].map(({ href, icon: Icon, name, text }) => (
            <Link key={href} href={href} className="group flex flex-col justify-between gap-8 bg-void p-6 transition-colors hover:bg-panel sm:p-10">
              <Icon className="size-6 text-mute transition-colors group-hover:text-fg" />
              <div>
                <p className="flex items-center justify-between text-lg font-medium">
                  {name} <ArrowUpRight className="size-4 text-mute transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </p>
                <p className="mt-1 text-sm text-mute">{text}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="relative">
        <div className="mx-auto max-w-[1440px] px-4 py-24 text-center sm:px-6">
          <RoboMark className="mx-auto size-16" />
          <h2 className="mx-auto mt-8 max-w-3xl text-[clamp(2rem,5vw,4.2rem)] leading-[1] font-medium tracking-[-0.03em]">
            Your next robot starts with a <span className="text-spectrum">sentence</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-mute">Describe it, watch it work, fix what physics finds, then build it with parts you can actually order.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <LaunchButton className="h-11 px-5 text-[14.5px]" />
            <Link href="/lab" className="inline-flex h-11 items-center rounded-xl border border-line-2 px-5 text-[14.5px] font-medium text-fg transition-colors hover:bg-panel">
              Open the Control Lab
            </Link>
          </div>
        </div>

        <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-x-6 gap-y-10 border-t border-line px-4 py-12 sm:px-6 md:grid-cols-4">
          {COLUMNS.map(([title, items]) => (
            <div key={title}>
              <p className="mono-label text-dim">{title}</p>
              <ul className="mt-4 space-y-3">
                {items.map((it) => (
                  <li key={it.label}>
                    <FooterItem it={it} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 border-t border-line px-4 py-6 text-[13px] text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <RoboMark className="size-5" />
            <span className="font-medium text-fg">RoboCraft</span>
            <span>Built during Meta&apos;s <i>Push the Frontier</i> hackathon, {new Date().getFullYear()}</span>
          </span>
          <a href="https://robocraftlabs.vercel.app" className="transition-colors hover:text-fg">
            robocraftlabs.vercel.app
          </a>
        </div>
      </footer>
    </>
  );
}
