import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HEARTBEAT } from "@/lib/hardware/recipes";
import { parseHex } from "@/lib/hardware/hex";

export const runtime = "nodejs";
export const maxDuration = 120;
const input = z.object({ code: z.string().min(1).max(40000), board: z.literal("arduino:avr:uno") });
export async function GET() {
  let compiler = false;
  if (process.env.ARDUINO_COMPILER_URL && process.env.ARDUINO_COMPILER_TOKEN) {
    try {
      const res = await fetch(`${process.env.ARDUINO_COMPILER_URL.replace(/\/$/, "")}/health`, {
        headers: { Authorization: `Bearer ${process.env.ARDUINO_COMPILER_TOKEN}` },
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      compiler = res.ok;
    } catch {}
  }
  return Response.json({ compiler, board: "arduino:avr:uno", bundledDemo: true });
}
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 50000) return Response.json({ error: "Sketch is too large." }, { status: 413 });
    const parsed = input.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json({ error: "Provide an Uno sketch of at most 40,000 characters." }, { status: 400 });
    const { code, board } = parsed.data;
    const sourceHash = createHash("sha256").update(code).digest("hex");
    // Exact source match only. Never pass off a prebuilt image as the user's edited sketch.
    if (code === HEARTBEAT) {
      const demo = JSON.parse(
        await readFile(path.join(process.cwd(), "src/data/uno-heartbeat.json"), "utf8"),
      );
      if (demo.sourceHash !== sourceHash)
        throw new Error("Bundled demo source does not match its firmware. Rebuild the demo.");
      return Response.json({ ...demo, bytes: parseHex(demo.hex).length, bundled: true });
    }
    const endpoint = process.env.ARDUINO_COMPILER_URL;
    const token = process.env.ARDUINO_COMPILER_TOKEN;
    if (!endpoint || !token)
      return Response.json(
        {
          error:
            "Custom compilation is not connected on this deployment. Try Board heartbeat, or ask the host to configure the Arduino compiler service.",
        },
        { status: 503 },
      );
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code, board }),
      signal: AbortSignal.timeout(100000),
    });
    const result = await response.json();
    if (!response.ok)
      return Response.json({ error: result.error || "Compiler failed." }, { status: response.status });
    if (result.sourceHash !== sourceHash)
      throw new Error("Compiler returned firmware for a different sketch.");
    return Response.json({ ...result, bytes: parseHex(result.hex).length, bundled: false });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof SyntaxError
            ? "Invalid request JSON."
            : e instanceof Error
              ? e.message
              : "Compilation failed.",
      },
      { status: e instanceof SyntaxError ? 400 : 502 },
    );
  }
}
