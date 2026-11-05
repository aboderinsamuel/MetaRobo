import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseHex } from "@/lib/hardware/hex";
import { HEARTBEAT } from "@/lib/hardware/recipes";
import { flashUno, type HardwarePort } from "@/lib/hardware/serial";

const record = (type: number, addr: number, data: number[]) => {
  const b = [data.length, addr >> 8, addr & 255, type, ...data];
  b.push(-b.reduce((a, n) => a + n, 0) & 255);
  return (
    ":" +
    b
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
};
const hex = `${record(0, 0, [12, 148, 0, 0])}\n${record(1, 0, [])}`;

function mockPort({ wrongChip = false, corrupt = false, disconnect = false } = {}) {
  let channel: ReadableStreamDefaultController<Uint8Array>;
  const memory = new Uint8Array(32256).fill(255);
  let address = 0,
    opened = false,
    closed = false,
    writes = 0;
  const port: HardwarePort = {
    readable: new ReadableStream({
      start(c) {
        channel = c;
      },
    }),
    writable: new WritableStream({
      write(packet) {
        const cmd = [...packet];
        expect(cmd.at(-1)).toBe(0x20);
        let data: number[] = [];
        if (cmd[0] === 0x75) data = wrongChip ? [0, 0, 0] : [0x1e, 0x95, 0x0f];
        if (cmd[0] === 0x55) address = (cmd[1] + cmd[2] * 256) * 2;
        if (cmd[0] === 0x64) {
          writes++;
          memory.set(cmd.slice(4, -1), address);
          if (disconnect) {
            channel.error(new Error("USB unplugged"));
            return;
          }
        }
        if (cmd[0] === 0x74) {
          data = [...memory.slice(address, address + 128)];
          if (corrupt) data[0] ^= 1;
        }
        // Deliver split packets to exercise streaming rather than one-read-per-command assumptions.
        const reply = Uint8Array.from([0x14, ...data, 0x10]);
        channel.enqueue(reply.slice(0, 1));
        channel.enqueue(reply.slice(1));
      },
    }),
    async open() {
      opened = true;
    },
    async close() {
      closed = true;
    },
    async setSignals() {},
    getInfo: () => ({}),
  };
  return { port, memory, state: () => ({ opened, closed, writes }) };
}

describe("Uno firmware validation", () => {
  it("pads short firmware to a flash page with erased bytes", () => {
    const bytes = parseHex(hex);
    expect(bytes.length).toBe(128);
    expect([...bytes.slice(0, 5)]).toEqual([12, 148, 0, 0, 255]);
  });
  it("rejects checksum errors, overlap and missing EOF", () => {
    expect(() => parseHex(hex.replace("0C94", "0C95"))).toThrow("checksum");
    expect(() => parseHex(`${record(0, 0, [1])}\n${record(0, 0, [2])}\n${record(1, 0, [])}`)).toThrow(
      "Overlapping",
    );
    expect(() => parseHex(record(0, 0, [1]))).toThrow("Incomplete");
  });
  it("refuses bootloader writes and out-of-range extended addresses", () => {
    expect(() => parseHex(`${record(0, 32256, [0])}\n${record(1, 0, [])}`)).toThrow("exceeds");
    expect(() => parseHex(`${record(4, 0, [0, 1])}\n${hex}`)).toThrow("exceeds");
  });
  it("bundled binary is tied to the exact demo source", () => {
    const demo = JSON.parse(readFileSync("src/data/uno-heartbeat.json", "utf8"));
    expect(demo.sourceHash).toBe(createHash("sha256").update(HEARTBEAT).digest("hex"));
    expect(parseHex(demo.hex).length).toBeGreaterThan(128);
  });
});
describe("STK500 browser upload", () => {
  it("programs and reads flash back before reporting success, then closes USB", async () => {
    const mock = mockPort();
    const progress: number[] = [];
    await flashUno(mock.port, hex, (_, n) => progress.push(n));
    expect(mock.memory.slice(0, 128)).toEqual(parseHex(hex));
    expect(progress.at(-1)).toBe(100);
    expect(mock.state()).toEqual({ opened: true, closed: true, writes: 1 });
  });
  it("does not write a chip with a different signature", async () => {
    const mock = mockPort({ wrongChip: true });
    await expect(flashUno(mock.port, hex, () => {})).rejects.toThrow("not an ATmega328P");
    expect(mock.state()).toEqual({ opened: true, closed: true, writes: 0 });
  });
  it("rejects readback mismatch and releases the port", async () => {
    const mock = mockPort({ corrupt: true });
    await expect(flashUno(mock.port, hex, () => {})).rejects.toThrow("verification failed");
    expect(mock.state().closed).toBe(true);
  });
  it("handles a disconnect during programming", async () => {
    const mock = mockPort({ disconnect: true });
    await expect(flashUno(mock.port, hex, () => {})).rejects.toThrow("USB unplugged");
    expect(mock.state().closed).toBe(true);
  });
  it("rejects a corrupt file before touching the port", async () => {
    const mock = mockPort();
    await expect(flashUno(mock.port, "bad", () => {})).rejects.toThrow();
    expect(mock.state().opened).toBe(false);
  });
});
