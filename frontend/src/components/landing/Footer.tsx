import { ArrowUpRight, Bot, Car } from "lucide-react";
import Link from "next/link";
import RoboMark from "@/components/brand/RoboMark";
import { LaunchButton } from "./Chrome";

const CREDITS: [string, string[]][] = [
  ["Simulation", ["PlantSim · C++17", "WebAssembly + TS port"]],
  ["Modeling AI", ["Claude Opus 5.5", "Offline physics library"]],
  ["Interface", ["Next.js · React Three Fiber", "Motion"]],
  ["Validation", ["21 native checks", "20 cross-engine tests"]],
];

export default function Footer() {
  return (
    <>
      <section id="builder" className="border-b border-line">
        <div className="mx-auto grid max-w-[1440px] gap-px bg-line sm:grid-cols-[1.2fr_1fr_1fr]">
          <div className="bg-void p-6 py-14 sm:p-10">
            <p className="mono-label text-mute">·· Also in RoboCraft</p>
            <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Robot builder</h2>
            <p className="mt-3 max-w-sm text-[15px] text-mute">
              Shape an arm or a rover in 3D. RoboCraft sizes the motors, wires a safe circuit and writes the firmware.
            </p>
          </div>
          {[
            { href: "/studio/arm", icon: Bot, name: "3-axis arm", text: "Inverse kinematics, torque sizing, servo rail" },
            { href: "/studio/rover", icon: Car, name: "Rover", text: "Drive-force budget, H-bridge matching, runtime" },
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
            Your machine is waiting for a <span className="text-spectrum">controller</span>.
          </h2>
          <div className="mt-8 flex justify-center">
            <LaunchButton label="Open the control lab" />
          </div>
        </div>
        <div className="mx-auto grid max-w-[1440px] grid-cols-2 border-t border-line md:grid-cols-4">
          {CREDITS.map(([k, vs]) => (
            <div key={k} className="border-r border-b border-line p-5 last:border-r-0 sm:p-6">
              <p className="mono-label text-dim">{k}</p>
              <div className="mt-4 space-y-1 font-mono text-[12px] tracking-wide uppercase">
                {vs.map((v) => (
                  <p key={v}>{v}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-5 sm:px-6">
          <span className="mono-label flex items-center gap-3 text-mute">
            ▸ <RoboMark className="size-6" /> Fin.
          </span>
          <span className="mono-label text-dim">RoboCraft · {new Date().getFullYear()}</span>
        </div>
      </footer>
    </>
  );
}
