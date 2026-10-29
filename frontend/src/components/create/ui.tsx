"use client";

// Small building blocks of the workspace's design system: soft rounded surfaces, pill segmented
// controls, quiet buttons, evidence badges. They read their colours from the theme tokens.
import { Monitor, Moon, Sun } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Segmented<T extends string>({ value, options, onChange, size = "md", className }: { value: T; options: { id: T; label: ReactNode; icon?: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex items-center gap-0.5 rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap transition-all",
            size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
            o.id === value ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--color-line)]" : "text-mute hover:text-fg",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-3 text-[12.5px]" : size === "lg" ? "h-11 px-5 text-[14px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "bg-accent text-accent-fg shadow-[0_6px_20px_-8px_var(--color-accent)] hover:brightness-110 active:brightness-95",
        variant === "secondary" && "bg-surface text-fg shadow-[0_0_0_1px_var(--color-line-2)] hover:bg-surface-2",
        variant === "ghost" && "text-mute hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button {...rest} aria-label={label} title={label} className={cx("inline-flex size-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40", active ? "bg-accent-soft text-accent" : "text-mute hover:bg-surface-2 hover:text-fg", className)}>
      {children}
    </button>
  );
}

const BASIS: Record<string, { label: string; cls: string; title: string }> = {
  physics: { label: "Simulated", cls: "bg-ok/12 text-ok", title: "Measured in the physics simulation" },
  kinematics: { label: "Planned", cls: "bg-accent-soft text-accent", title: "From inverse kinematics within the joints' limits and speeds" },
  engineering: { label: "Checked", cls: "bg-[#0ea5e9]/12 text-[#0284c7] dark:text-[#38bdf8]", title: "Calculated from masses and actuator ratings" },
  ai: { label: "AI estimate", cls: "bg-warn/12 text-warn", title: "Muse Spark's judgement, not verified" },
};

export function BasisBadge({ basis }: { basis: string }) {
  const b = BASIS[basis] ?? BASIS.ai;
  return (
    <span title={b.title} className={cx("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-semibold", b.cls)}>
      {b.label}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h3 className="text-[12px] font-semibold tracking-wide text-mute uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function ThemeToggle() {
  const mode = useThemeMode();
  const opts: { id: ThemeMode; icon: ReactNode; title: string }[] = [
    { id: "light", icon: <Sun className="size-3.5" />, title: "Light" },
    { id: "dark", icon: <Moon className="size-3.5" />, title: "Dark" },
    { id: "system", icon: <Monitor className="size-3.5" />, title: "Match system" },
  ];
  return <Segmented size="sm" value={mode} onChange={setThemeMode} options={opts.map((o) => ({ id: o.id, label: null, icon: o.icon, title: o.title }))} />;
}
