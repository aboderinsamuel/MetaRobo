import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/hardware/compile/route";
import { HEARTBEAT } from "@/lib/hardware/recipes";
const request = (code: string, board = "arduino:avr:uno") =>
  new Request("http://localhost/api/hardware/compile", {
    method: "POST",
    body: JSON.stringify({ code, board }),
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Hardware compile API", () => {
  it("serves a real bundled build only for the exact heartbeat source", async () => {
    vi.stubEnv("ARDUINO_COMPILER_URL", "");
    vi.stubEnv("ARDUINO_COMPILER_TOKEN", "");
    const res = await POST(request(HEARTBEAT));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bundled: true, board: "arduino:avr:uno", bytes: 2048 });
    const edited = await POST(request(HEARTBEAT.replace("150", "200")));
    expect(edited.status).toBe(503);
    expect(await edited.json()).not.toHaveProperty("hex");
  });
  it("rejects another target or a malformed request", async () => {
    expect((await POST(request(HEARTBEAT, "esp32"))).status).toBe(400);
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
  });
  it("refuses mismatched source hashes from the compiler", async () => {
    vi.stubEnv("ARDUINO_COMPILER_URL", "http://compiler");
    vi.stubEnv("ARDUINO_COMPILER_TOKEN", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ sourceHash: "wrong", hex: ":00000001FF" })),
    );
    const res = await POST(request("void setup(){} void loop(){}"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("different sketch");
  });
});
