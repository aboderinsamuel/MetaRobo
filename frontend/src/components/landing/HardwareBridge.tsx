import Link from "next/link";
import { ArrowRight, CheckCircle2, PlugZap } from "lucide-react";

export default function HardwareBridge() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-20" id="hardware">
      <div className="grid overflow-hidden rounded-[28px] border border-line bg-surface md:grid-cols-2">
        <div className="flex flex-col justify-center p-8 lg:p-12">
          <p className="mono-label mb-5 text-[10px] text-ok">INTRODUCING HARDWARE STUDIO</p>
          <h2 className="text-4xl font-medium tracking-[-0.05em] lg:text-5xl">
            The next step
            <br />
            happens on your desk.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-mute">
            Take an idea all the way to an Arduino Uno. Edit with Muse Spark or Wonder, build the firmware,
            and upload straight from your browser.
          </p>
          <div className="mt-6 space-y-3 text-xs text-mute">
            <p className="flex gap-2">
              <CheckCircle2 className="size-4 text-ok" /> No Arduino IDE for visitors
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="size-4 text-ok" /> Guided kit recipes and pin-by-pin wiring
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="size-4 text-ok" /> USB upload with flash readback verification
            </p>
          </div>
          <Link
            href="/hardware"
            className="mt-8 inline-flex w-fit items-center gap-3 rounded-xl bg-fg px-5 py-3 text-sm font-medium text-void"
          >
            <PlugZap className="size-4" /> Open Hardware Studio <ArrowRight className="size-4" />
          </Link>
          <p className="mt-4 text-[10px] leading-5 text-mute">
            Uno R3 · desktop Chrome / Edge · USB permission required.
            <br />
            Custom builds require the hosted compiler. Heartbeat demo is bundled.
          </p>
        </div>
        <figure className="relative min-h-[360px] overflow-hidden bg-[#c6c7ca]">
          <img
            src="/hardware/uno-desk.jpeg"
            alt="A physical Uno R3 connected to the developer's laptop by USB"
            className="absolute inset-0 h-full w-full object-cover object-[50%_75%]"
            loading="lazy"
          />
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-7 pt-16 text-xs text-white">
            Our Uno, on the bench.
            <br />
            <span className="mt-1 block text-[10px] text-white/70">
              Reference hardware photo · upload verification happens in the studio
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
