"use client";

// The app's shared navigation: one bar across the AI studio and the Control Lab, so the whole
// product feels like one tool.
import Link from "next/link";
import { usePathname } from "next/navigation";
import RoboMark from "@/components/brand/RoboMark";
import { cx } from "@/components/create/ui";

const LINKS = [
  { href: "/create", label: "Create", hint: "Describe any robot; Muse Spark designs it and it's simulated" },
  { href: "/lab", label: "Control lab", hint: "Pick real parts, tune the controller, scope, Bode, firmware; demos included" },
];

export default function AppNav({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <nav className={cx("flex min-w-0 items-center gap-1", className)} aria-label="App">
      <Link href="/" className="mr-2 flex shrink-0 items-center gap-2" aria-label="RoboCraft home">
        <RoboMark className="size-7" />
        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">RoboCraft</span>
      </Link>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          title={l.hint}
          className={cx("inline-flex h-8 shrink-0 items-center rounded-xl px-3 text-[13px] font-medium transition-colors", path.startsWith(l.href) ? "bg-surface-2 text-fg" : "text-mute hover:bg-surface-2 hover:text-fg")}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
