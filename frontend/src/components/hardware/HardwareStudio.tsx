"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Cpu,
  Download,
  HelpCircle,
  Loader2,
  Pause,
  Play,
  PlugZap,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Unplug,
  Upload,
  X,
} from "lucide-react";
import AppNav from "@/components/AppNav";
import { ThemeToggle } from "@/components/create/ui";
import { HEARTBEAT, HDL_START, VHDL_START, RECIPES, type Recipe } from "@/lib/hardware/recipes";
import { flashUno, serialAPI, type HardwarePort } from "@/lib/hardware/serial";
import { MODEL_CHOICES, type ModelChoice } from "@/lib/meta/models";
import "./hardware.css";

const UnoScene = dynamic(() => import("./UnoScene"), {
  ssr: false,
  loading: () => (
    <div className="hw-scene-loading">
      <Cpu size={32} /> Preparing your workbench…
    </div>
  ),
});
type Language = "arduino" | "verilog" | "vhdl";
type Build = { hex: string; sourceHash: string; bytes: number; log: string; bundled: boolean; code: string };
type Proposal = {
  code: string;
  explanation: string;
  wiring: { from: string; to: string }[];
  cautions: string[];
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");
const initialCodes = { arduino: HEARTBEAT, verilog: HDL_START, vhdl: VHDL_START };
const importedRecipe: Recipe = {
  id: "imported",
  name: "Your custom sketch",
  group: "Custom",
  description:
    "Firmware brought into Hardware Studio. Review its target board, components, and pin mapping before upload.",
  parts: "Check the source design's bill of materials",
  wiring: [],
  note: "No recipe wiring applies to this imported sketch. Use the source design's wiring and component datasheets.",
  code: "",
};
class BoardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="hw-scene-loading">
        3D is unavailable on this device. Use “View real board”; editing and USB tools still work.
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function HardwareStudio() {
  const [recipe, setRecipe] = useState<Recipe>(RECIPES[0]);
  const [language, setLanguage] = useState<Language>("arduino");
  const [code, setCode] = useState(HEARTBEAT);
  const drafts = useRef({ ...initialCodes });
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"code" | "wiring" | "serial">("code");
  const [model, setModel] = useState<ModelChoice>("muse-spark-1.3");
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [aiWiring, setAiWiring] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<"compile" | "flash" | "ai" | "connect" | null>(null);
  const [compiled, setCompiled] = useState<Build | null>(null);
  const [verified, setVerified] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("Ready when you are");
  const [progress, setProgress] = useState(0);
  const [supported] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : Boolean(serialAPI()) && window.isSecureContext,
  );
  const [compiler, setCompiler] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const [baud, setBaud] = useState(9600);
  const [serial, setSerial] = useState("");
  const [spinning, setSpinning] = useState(() =>
    typeof window === "undefined" ? true : !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [guide, setGuide] = useState(true);
  const [view3d, setView3d] = useState(true);
  const port = useRef<HardwarePort | null>(null);
  const serialReader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const monitorTask = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const stopMonitor = async () => {
    await serialReader.current?.cancel().catch(() => {});
    await monitorTask.current;
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem("rc-hardware-drafts") || "null");
      if (saved && typeof saved.arduino === "string") {
        drafts.current = {
          arduino: saved.arduino,
          verilog: typeof saved.verilog === "string" ? saved.verilog : HDL_START,
          vhdl: typeof saved.vhdl === "string" ? saved.vhdl : VHDL_START,
        };
        setCode(saved.arduino);
        setRecipe(
          RECIPES.find((r) => r.id === saved.recipeId) ||
            (saved.arduino === HEARTBEAT ? RECIPES[0] : importedRecipe),
        );
      }
      const handoff = sessionStorage.getItem("rc-hardware-handoff");
      if (handoff) {
        setCode(handoff);
        drafts.current.arduino = handoff;
        setRecipe(importedRecipe);
        sessionStorage.removeItem("rc-hardware-handoff");
        setNotice(
          "Firmware imported from Control Lab. Confirm it targets Uno R3 and review its original wiring before uploading.",
        );
      }
      setGuide(localStorage.getItem("rc-hardware-guide") !== "done");
    } catch {}
    setHydrated(true);
    fetch("/api/hardware/compile")
      .then((r) => r.json())
      .then((v) => setCompiler(v.compiler === true))
      .catch(() => setCompiler(false));
    const api = serialAPI();
    const disconnected = (event: Event) => {
      if (event.target === port.current) {
        setConnected(false);
        port.current = null;
        setVerified(false);
        setNotice("USB disconnected. Your sketch is saved; reconnect to upload or read serial.");
      }
    };
    api?.addEventListener("disconnect", disconnected);
    return () => {
      mounted.current = false;
      api?.removeEventListener("disconnect", disconnected);
      void serialReader.current?.cancel().catch(() => {});
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!hydrated) return;
    drafts.current[language] = code;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          "rc-hardware-drafts",
          JSON.stringify({ ...drafts.current, recipeId: aiWiring ? "imported" : recipe.id }),
        );
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [code, language, hydrated, recipe.id, aiWiring]);
  useEffect(() => {
    if (busy !== "flash") return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [busy]);

  function edit(value: string) {
    setCode(value);
    setCompiled(null);
    setVerified(false);
    setReviewed(false);
    setProposal(null);
    setStatus("Draft updated · not uploaded");
    setProgress(0);
  }
  function selectRecipe(next: Recipe) {
    drafts.current[language] = code;
    setRecipe(next);
    setLanguage("arduino");
    edit(next.code);
    setAiWiring(null);
    setError("");
    setNotice(`${next.name} loaded. Your other language drafts are kept.`);
    setTab("code");
  }
  function changeLanguage(next: Language) {
    drafts.current[language] = code;
    setLanguage(next);
    edit(drafts.current[next]);
    setAiWiring(null);
    setTab("code");
  }
  async function connect() {
    setError("");
    setBusy("connect");
    try {
      const chosen = await serialAPI()!.requestPort();
      port.current = chosen;
      setConnected(true);
      setStatus("USB port selected · chip checked during upload");
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError")
        setNotice("No port selected. Connect your Uno with a USB data cable and try again.");
      else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  async function compile() {
    setError("");
    setCompiled(null);
    setVerified(false);
    if (!canBuild) {
      setError(
        "Custom sketches need the hosted Arduino compiler. Choose Board heartbeat to try the built-in verified demo, or configure ARDUINO_COMPILER_URL and ARDUINO_COMPILER_TOKEN on the frontend server.",
      );
      setStatus("Build unavailable · choose Board heartbeat or connect the compiler");
      return;
    }
    setBusy("compile");
    setStatus("Compiling for Arduino Uno R3…");
    try {
      const res = await fetch("/api/hardware/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, board: "arduino:avr:uno" }),
        signal: AbortSignal.timeout(115000),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Compiler unavailable.");
      setCompiled({ ...result, code });
      setStatus(
        `Build ready · ${result.bytes.toLocaleString()} bytes · ${result.bundled ? "bundled demo build" : "compiled your source"}`,
      );
    } catch (e) {
      setError(errorText(e));
      setStatus("Build failed · no hardware changed");
    } finally {
      setBusy(null);
    }
  }
  async function upload() {
    if (!port.current || !compiled || compiled.code !== code || !reviewed || language !== "arduino") return;
    setBusy("flash");
    setError("");
    setVerified(false);
    setProgress(0);
    try {
      await stopMonitor();
      await flashUno(port.current, compiled.hex, (message, pct) => {
        if (mounted.current) {
          setStatus(message);
          setProgress(pct);
        }
      });
      setVerified(true);
      setNotice(
        "Upload verified by reading flash back. Observe your real hardware to confirm its behavior; the 3D board is only a preview.",
      );
    } catch (e) {
      setError(errorText(e));
      setStatus("Upload not verified · reconnect and retry");
    } finally {
      setBusy(null);
    }
  }
  async function toggleMonitor() {
    if (monitor) {
      await stopMonitor();
      return;
    }
    const selectedPort = port.current;
    if (!selectedPort) return;
    setError("");
    setTab("serial");
    setBusy("connect");
    try {
      await selectedPort.open({ baudRate: baud });
      const reader = selectedPort.readable!.getReader();
      serialReader.current = reader;
      setMonitor(true);
      monitorTask.current = (async () => {
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            if (mounted.current) setSerial((prev) => (prev + text).slice(-20000));
          }
        } catch (e) {
          if (mounted.current) setError(errorText(e));
        } finally {
          reader.releaseLock();
          serialReader.current = null;
          await selectedPort.close().catch(() => {});
          if (mounted.current) setMonitor(false);
        }
      })();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  async function askAI() {
    setBusy("ai");
    setError("");
    setProposal(null);
    try {
      const res = await fetch("/api/hardware/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          prompt,
          language,
          model,
          context: JSON.stringify({
            recipe: recipe.name,
            wiring: aiWiring?.wiring || recipe.wiring,
            parts: recipe.parts,
          }),
        }),
        signal: AbortSignal.timeout(120000),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "AI unavailable.");
      setProposal(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `robocraft.${language === "arduino" ? "ino" : language === "vhdl" ? "vhd" : "v"}`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  const filtered = RECIPES.filter((r) =>
    `${r.name} ${r.parts} ${r.group}`.toLowerCase().includes(search.toLowerCase()),
  );
  const heartbeatReady = language === "arduino" && code === HEARTBEAT;
  const canBuild = language === "arduino" && (heartbeatReady || compiler === true);
  const dismissGuide = () => {
    setGuide(false);
    try {
      localStorage.setItem("rc-hardware-guide", "done");
    } catch {}
  };
  const steps = ["Choose a sketch", "Connect USB", "Build & upload", "See it work"];

  return (
    <div className="hw-app">
      <header className="hw-nav">
        <AppNav />
        <div className="hw-nav-end">
          <span className="hw-beta">HARDWARE STUDIO · BETA</span>
          <button
            className="hw-icon"
            onClick={() => setGuide((v) => !v)}
            aria-label="Toggle getting started guide"
          >
            <HelpCircle size={18} />
          </button>
          <ThemeToggle />
        </div>
      </header>
      <main className="hw-shell">
        <div className="hw-title">
          <div>
            <p className="hw-eyebrow">
              <span /> FROM IDEA TO ELECTRONS
            </p>
            <h1>
              Make something <em>real.</em>
            </h1>
            <p>Your browser is your workbench. Write it, wire it, bring it to life.</p>
          </div>
          <div className="hw-connection">
            <span className={connected ? "hw-dot on" : "hw-dot"} />
            {connected ? "USB port selected" : "No board connected"}
            <button
              className={connected ? "hw-button" : "hw-button primary"}
              disabled={!!busy || !supported}
              onClick={
                connected
                  ? async () => {
                      await stopMonitor();
                      port.current = null;
                      setConnected(false);
                      setVerified(false);
                    }
                  : connect
              }
            >
              {connected ? <Unplug size={15} /> : <PlugZap size={15} />}
              {connected ? "Disconnect" : "Connect Uno"}
            </button>
          </div>
        </div>
        {supported === false && (
          <div className="hw-message warning">
            USB upload needs desktop Chrome or Edge over HTTPS (or localhost). You can still edit and download
            code here. Some USB clones need an operating-system driver.
          </div>
        )}
        {guide && (
          <section className="hw-guide" aria-label="Getting started">
            <div className="hw-guide-heading">
              <strong>Start with a real board, in four small steps.</strong>
              <button className="hw-icon" onClick={dismissGuide} aria-label="Dismiss getting started guide">
                <X size={16} />
              </button>
            </div>
            <div className="hw-steps">
              {steps.map((label, i) => (
                <div key={label}>
                  <span className={i === 0 || (i === 1 && connected) || (i === 2 && verified) ? "done" : ""}>
                    {(i === 1 && connected) || (i === 2 && verified) ? <Check size={15} /> : `0${i + 1}`}
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <p>
                      {
                        [
                          "Choose Board heartbeat. It builds here without a compiler service.",
                          "Use a USB data cable in desktop Chrome or Edge.",
                          "Build, review the code, then upload.",
                          "Watch the amber L LED blink twice and read serial at 9600 baud.",
                        ][i]
                      }
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="hw-workspace">
          <aside className="hw-library">
            <div className="hw-panel-heading">
              <div>
                <span className="hw-eyebrow">YOUR NEXT INVENTION</span>
                <h2>Kit recipes</h2>
              </div>
              <span className="hw-count">{RECIPES.length}</span>
            </div>
            <label className="hw-search">
              <Search size={16} />
              <input
                aria-label="Search kit recipes"
                placeholder="Find a component…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="hw-recipes">
              {filtered.map((r, i) => (
                <button
                  disabled={!!busy}
                  className={`hw-recipe ${r.id === recipe.id && language === "arduino" ? "selected" : ""}`}
                  key={r.id}
                  onClick={() => selectRecipe(r)}
                >
                  <span className="hw-recipe-icon">
                    {r.id === "heartbeat" ? (
                      <Cpu size={19} />
                    ) : r.group === "Motion" ? (
                      <Radio size={19} />
                    ) : (
                      <Code2 size={19} />
                    )}
                  </span>
                  <span>
                    <small>{r.group}</small>
                    <strong>{r.name}</strong>
                  </span>
                  <span className="hw-recipe-number">{String(i + 1).padStart(2, "0")}</span>
                </button>
              ))}
              {!filtered.length && <p className="hw-muted">No matching recipe. Try a component name.</p>}
            </div>
            <div className="hw-library-note">
              <ShieldCheck size={18} />
              <p>
                Built for Uno R3.
                <br />
                <span>
                  Recipes cover common kit parts. Other modules need their own wiring, libraries, and checks.
                </span>
              </p>
            </div>
            <Link href="/lab" className="hw-text-link">
              Back to Control Lab <ArrowRight size={14} />
            </Link>
          </aside>
          <section className="hw-board-panel">
            <div className="hw-panel-heading">
              <div>
                <span className="hw-eyebrow">MEET YOUR HARDWARE</span>
                <h2>
                  Arduino Uno <span>Rev3</span>
                </h2>
              </div>
              <span className="hw-chip">5V · ATmega328P</span>
            </div>
            <div className="hw-board-stage">
              {view3d ? (
                <BoardBoundary>
                  <UnoScene spinning={spinning} />
                </BoardBoundary>
              ) : (
                <img
                  src="/hardware/uno-desk.jpeg"
                  alt="The user's physical Uno R3 connected by a blue USB cable"
                />
              )}
              <span className="hw-preview-label">
                {view3d ? "3D PREVIEW · NOT LIVE TELEMETRY" : "REAL BOARD · REFERENCE PHOTO"}
              </span>
              <div className="hw-scene-controls">
                <button className="hw-button glass" onClick={() => setView3d((v) => !v)}>
                  {view3d ? "View real board" : "Back to 3D"}
                </button>
                {view3d && (
                  <button
                    className="hw-button glass"
                    aria-label={spinning ? "Pause rotation" : "Rotate board"}
                    onClick={() => setSpinning((v) => !v)}
                  >
                    {spinning ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                )}
              </div>
            </div>
            <div className="hw-board-specs">
              <div>
                <strong>14</strong>
                <span>digital pins</span>
              </div>
              <div>
                <strong>6</strong>
                <span>analog inputs</span>
              </div>
              <div>
                <strong>
                  16<span> MHz</span>
                </strong>
                <span>clock speed</span>
              </div>
            </div>
            <div className="hw-project-card">
              <span className="hw-eyebrow">
                {language === "arduino" ? "ON YOUR WORKBENCH" : "FPGA WORKSPACE"}
              </span>
              <h3>{language === "arduino" ? recipe.name : `${language.toUpperCase()} draft`}</h3>
              <p>
                {language === "arduino"
                  ? recipe.description
                  : "Design digital logic with Meta AI. Export to your FPGA toolchain for constraints, simulation, synthesis, and programming."}
              </p>
              <div className="hw-parts">
                <Cpu size={15} />
                {language === "arduino" ? recipe.parts : "Requires a target FPGA · Uno upload unavailable"}
              </div>
              <button className="hw-text-link" onClick={() => setTab("wiring")}>
                Open wiring guide <ArrowRight size={14} />
              </button>
            </div>
            <div className="hw-grounding">
              <span className="hw-dot on" />
              <p>
                No Arduino IDE for visitors.
                <br />
                <span>Browser USB upload · hosted compilation</span>
              </p>
            </div>
          </section>
          <section className="hw-editor-panel">
            <div className="hw-editor-top">
              <div className="hw-editor-tabs" role="tablist" aria-label="Hardware workspace">
                {(["code", "wiring", "serial"] as const).map((t) => (
                  <button role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}>
                    {t === "code" ? (
                      <Code2 size={15} />
                    ) : t === "wiring" ? (
                      <PlugZap size={15} />
                    ) : (
                      <Terminal size={15} />
                    )}
                    {t === "serial" ? "Serial monitor" : t === "wiring" ? "Wiring" : "Sketch"}
                  </button>
                ))}
              </div>
              <button className="hw-icon" onClick={download} aria-label="Download current code">
                <Download size={16} />
              </button>
            </div>
            {tab === "code" && (
              <>
                <div className="hw-filebar">
                  <span>
                    <span className="hw-file-dot" />
                    robocraft.{language === "arduino" ? "ino" : language === "vhdl" ? "vhd" : "v"}
                  </span>
                  <label>
                    <select
                      aria-label="Code language"
                      disabled={!!busy}
                      value={language}
                      onChange={(e) => changeLanguage(e.target.value as Language)}
                    >
                      <option value="arduino">Arduino C++</option>
                      <option value="verilog">Verilog · FPGA draft</option>
                      <option value="vhdl">VHDL · FPGA draft</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                </div>
                <div className="hw-code">
                  <pre aria-hidden="true">
                    {code
                      .split("\n")
                      .map((_, i) => i + 1)
                      .join("\n")}
                  </pre>
                  <textarea
                    aria-label="Firmware source code"
                    spellCheck={false}
                    value={code}
                    disabled={!!busy}
                    onChange={(e) => edit(e.target.value)}
                    onScroll={(e) => {
                      const lineNumbers = e.currentTarget.previousElementSibling;
                      if (lineNumbers) lineNumbers.scrollTop = e.currentTarget.scrollTop;
                    }}
                  />
                </div>
              </>
            )}
            {tab === "wiring" && (
              <div className="hw-wiring">
                <span className="hw-eyebrow">CONNECT WITH CONFIDENCE</span>
                <h3>{language === "arduino" ? "Follow the pins." : "Choose your FPGA first."}</h3>
                <p>
                  {language === "arduino"
                    ? "Unplug power while wiring. Breadboards are passive connections; they do not receive code or identify attached parts."
                    : "Pin assignments and clock timing depend on your FPGA board. This app edits HDL drafts; it does not synthesize or upload FPGA bitstreams."}
                </p>
                {language === "arduino" && (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th>From</th>
                          <th>To</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(aiWiring ? aiWiring.wiring.map((w) => [w.from, w.to]) : recipe.wiring).map(
                          ([from, to], i) => (
                            <tr key={i}>
                              <td>{from}</td>
                              <td>{to}</td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                    <div className="hw-message warning">
                      {aiWiring
                        ? aiWiring.cautions.join(" ") ||
                          "Review the AI's wiring against your component datasheets."
                        : recipe.note}
                    </div>
                    <p className="hw-muted">
                      This guide belongs to {aiWiring ? "the applied AI proposal" : "the selected recipe"}.
                      Manual code edits and imported firmware may change the pin mapping; check the source
                      before powering up.
                    </p>
                  </>
                )}
              </div>
            )}
            {tab === "serial" && (
              <div className="hw-serial">
                <div className="hw-serial-toolbar">
                  <label>
                    Baud{" "}
                    <select
                      aria-label="Serial baud rate"
                      value={baud}
                      disabled={monitor || !!busy}
                      onChange={(e) => setBaud(Number(e.target.value))}
                    >
                      {[9600, 19200, 38400, 57600, 115200].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <button className="hw-button" disabled={!connected || !!busy} onClick={toggleMonitor}>
                    {monitor ? "Stop monitor" : "Start monitor"}
                  </button>
                  <button className="hw-icon" onClick={() => setSerial("")} aria-label="Clear serial output">
                    <X size={14} />
                  </button>
                </div>
                <pre aria-label="Actual serial output">
                  {serial ||
                    "Waiting for real USB serial data…\n\nConnect your Uno and start the monitor.\nThe heartbeat recipe uses 9600 baud.\nOpening the monitor may reset the Uno."}
                </pre>
              </div>
            )}
            <div className="hw-ai">
              <div className="hw-ai-title">
                <span>
                  <Sparkles size={16} /> Your coding copilot
                </span>
                <select
                  aria-label="AI model"
                  value={model}
                  disabled={!!busy}
                  onChange={(e) => setModel(e.target.value as ModelChoice)}
                >
                  {MODEL_CHOICES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void askAI();
                }}
              >
                <textarea
                  aria-label="Describe your code change"
                  placeholder="“Make it blink three times, then rest for a second…”"
                  rows={2}
                  value={prompt}
                  disabled={!!busy}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <button className="hw-button primary" disabled={!!busy || prompt.trim().length < 3}>
                  {busy === "ai" ? <Loader2 className="animate-spin" size={15} /> : <ArrowRight size={16} />}
                  <span>{busy === "ai" ? "Thinking" : "Propose"}</span>
                </button>
              </form>
              <p>AI proposes. You review. Compiler checks. Hardware proves.</p>
            </div>
            {proposal && (
              <div className="hw-proposal">
                <h3>Review the proposed sketch</h3>
                <p>{proposal.explanation}</p>
                <pre>{proposal.code}</pre>
                {proposal.cautions.map((c, i) => (
                  <p className="hw-caution" key={i}>
                    {c}
                  </p>
                ))}
                <div className="hw-actions">
                  <button
                    className="hw-button primary"
                    onClick={() => {
                      const next = proposal;
                      edit(next.code);
                      setAiWiring(next);
                      setNotice("AI draft applied. Review its wiring and compile before uploading.");
                    }}
                  >
                    Apply draft
                  </button>
                  <button className="hw-button" onClick={() => setProposal(null)}>
                    Keep my code
                  </button>
                </div>
              </div>
            )}
            <div className="hw-build">
              <div className="hw-build-status">
                <span className={verified ? "hw-dot on" : "hw-dot"} />
                <span role="status">{status}</span>
                {verified && <CheckCircle2 size={16} />}
              </div>
              {busy === "flash" && (
                <progress value={progress} max={100} aria-label="Upload and verification progress" />
              )}
              <div className="hw-build-actions">
                <button
                  className="hw-button"
                  disabled={!!busy || !canBuild}
                  onClick={compile}
                  title={
                    language !== "arduino"
                      ? "An Uno runs Arduino C++, not HDL."
                      : canBuild
                        ? "Build this sketch for Arduino Uno R3."
                        : "Choose Board heartbeat or configure the hosted Arduino compiler."
                  }
                >
                  {busy === "compile" ? <Loader2 className="animate-spin" size={16} /> : <Code2 size={16} />}
                  1. Build sketch
                </button>
                <button
                  className="hw-button primary"
                  disabled={
                    !!busy ||
                    !compiled ||
                    compiled.code !== code ||
                    !connected ||
                    !reviewed ||
                    language !== "arduino"
                  }
                  onClick={upload}
                >
                  {busy === "flash" ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}2.
                  Upload to Uno
                </button>
              </div>
              <label className="hw-review">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={!!busy || language !== "arduino"}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>I checked the code and wiring for my Uno R3. Upload replaces its current sketch.</span>
              </label>
              <p className="hw-compiler-status">
                {language !== "arduino"
                  ? "HDL is export-only. An Uno runs C++, not FPGA logic."
                  : compiler === null
                    ? "Checking compiler connection…"
                    : compiler
                      ? "Hosted compiler connected · custom sketches enabled"
                      : heartbeatReady
                        ? "Demo mode · this Board heartbeat is ready to build without a compiler service."
                        : "Custom build unavailable · choose Board heartbeat or configure the hosted compiler."}
              </p>
              {language === "arduino" && compiler === false && !heartbeatReady && (
                <button className="hw-button hw-build-fallback" onClick={() => selectRecipe(RECIPES[0])}>
                  Load Board heartbeat
                </button>
              )}
              {compiled && (
                <details>
                  <summary>Build evidence · SHA-256 {compiled.sourceHash.slice(0, 12)}…</summary>
                  <pre>{`Source SHA-256: ${compiled.sourceHash}\nTarget: arduino:avr:uno\nFlash image: ${compiled.bytes} bytes\n${compiled.log || ""}`}</pre>
                </details>
              )}
            </div>
          </section>
        </div>
        {error && (
          <div className="hw-message error" role="alert">
            <div>
              <strong>Let’s fix this.</strong>
              <pre>{error}</pre>
            </div>
            <button className="hw-icon" onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="hw-message" role="status">
            <span>{notice}</span>
            <button className="hw-icon" onClick={() => setNotice("")} aria-label="Dismiss notice">
              <X size={16} />
            </button>
          </div>
        )}
        <footer className="hw-footer">
          <span>
            RoboCraft <span className="hw-footer-separator">/</span> Small experiments. Real possibilities.
          </span>
          <span>Uno R3 USB upload · 10 kit recipes · Meta AI editing</span>
        </footer>
      </main>
    </div>
  );
}
