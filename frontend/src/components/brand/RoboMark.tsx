import { useId } from "react";

// RoboCraft's mark: a robot face with a spectrum rim and a feedback-loop notch.
export default function RoboMark({ className, animate = false }: { className?: string; animate?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden fill="none">
      <defs>
        <linearGradient id={`g${id}`} x1="4" y1="6" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3ff0ff" />
          <stop offset="0.3" stopColor="#5a86ff" />
          <stop offset="0.55" stopColor="#b06bff" />
          <stop offset="0.75" stopColor="#ff5fa2" />
          <stop offset="0.9" stopColor="#ff9a3d" />
          <stop offset="1" stopColor="#ffe45c" />
        </linearGradient>
      </defs>
      {/* Rim: a rounded square with a gap at the top right, like a loop that hasn't closed yet. */}
      <path
        d="M30 5 H14 A9 9 0 0 0 5 14 V34 A9 9 0 0 0 14 43 H34 A9 9 0 0 0 43 34 V18"
        stroke={`url(#g${id})`}
        strokeWidth="4"
        strokeLinecap="round"
        pathLength={100}
        style={animate ? { strokeDasharray: 100, strokeDashoffset: 100, animation: "rc-draw 1.2s cubic-bezier(.6,0,.2,1) forwards" } : undefined}
      />
      <path d="M38 5 L43 10" stroke={`url(#g${id})`} strokeWidth="4" strokeLinecap="round" />
      <rect x="12" y="13" width="24" height="22" rx="5" fill="#0b0c10" stroke="rgb(255 255 255 / 0.12)" />
      <circle cx="19.5" cy="24" r="2.6" fill="#fff" style={animate ? undefined : { animation: "rc-blink 5s infinite" }} />
      <circle cx="28.5" cy="24" r="2.6" fill="#fff" style={animate ? undefined : { animation: "rc-blink 5s infinite" }} />
      <style>{`@keyframes rc-draw { to { stroke-dashoffset: 0; } }`}</style>
    </svg>
  );
}
