import { parseHex } from "./hex";

// Small structural types keep Web Serial optional in unsupported browsers.
export interface HardwarePort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: { dataTerminalReady: boolean; requestToSend?: boolean }): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
export interface SerialAPI extends EventTarget {
  requestPort(): Promise<HardwarePort>;
  getPorts(): Promise<HardwarePort[]>;
}
export function serialAPI(): SerialAPI | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { serial?: SerialAPI }).serial;
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uno R3 / ATmega328P, Optiboot STK500v1 at 115200 baud. Never auto-selects a port. */
export async function flashUno(
  port: HardwarePort,
  hex: string,
  progress: (message: string, percent: number) => void,
) {
  const bytes = parseHex(hex); // Reject corrupt images before opening USB.
  await port.open({ baudRate: 115200, bufferSize: 65536 });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let pumping: Promise<void> | undefined;
  let stopped = false,
    failure: unknown;
  const queue: number[] = [];
  try {
    reader = port.readable!.getReader();
    writer = port.writable!.getWriter();
    pumping = (async () => {
      try {
        while (!stopped) {
          const { value, done } = await reader!.read();
          if (done) {
            if (!stopped) failure = new Error("USB disconnected.");
            break;
          }
          if (value) {
            queue.push(...value);
            if (queue.length > 65536) queue.splice(0, queue.length - 65536);
          }
        }
      } catch (e) {
        failure = e;
      }
    })();
    const command = async (data: number[], count = 0, timeout = 1500) => {
      if (failure) throw failure;
      await writer!.write(Uint8Array.from([...data, 0x20]));
      const deadline = Date.now() + timeout;
      while (queue.length < count + 2) {
        if (failure) throw failure;
        if (Date.now() > deadline)
          throw new Error(
            "The Uno bootloader did not respond. Close Arduino IDE or any serial monitor, reconnect the USB data cable, choose the Uno port again, and retry. If it still fails, press the Uno RESET button immediately after starting the upload.",
          );
        await delay(5);
      }
      const reply = queue.splice(0, count + 2);
      if (reply[0] !== 0x14 || reply.at(-1) !== 0x10)
        throw new Error("Unexpected bootloader response. Select an Uno R3 with its standard bootloader.");
      return reply.slice(1, -1);
    };
    progress("Resetting Uno bootloader", 3);
    let synced = false;
    for (let attempt = 0; attempt < 3 && !synced; attempt++) {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await delay(250);
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
      await delay(250);
      queue.length = 0;
      try {
        await command([0x30], 0, 800);
        synced = true;
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    const signature = await command([0x75], 3);
    if (signature.join() !== "30,149,15") throw new Error("Chip is not an ATmega328P. Nothing was written.");
    await command([0x50]);
    for (let offset = 0; offset < bytes.length; offset += 128) {
      const word = offset / 2;
      await command([0x55, word & 255, word >> 8]);
      await command([0x64, 0, 128, 0x46, ...bytes.slice(offset, offset + 128)]);
      progress(
        `Writing flash · ${offset + 128} / ${bytes.length} bytes`,
        5 + Math.round(((offset + 128) / bytes.length) * 55),
      );
    }
    for (let offset = 0; offset < bytes.length; offset += 128) {
      const word = offset / 2;
      await command([0x55, word & 255, word >> 8]);
      const actual = await command([0x74, 0, 128, 0x46], 128);
      if (actual.some((v, i) => v !== bytes[offset + i]))
        throw new Error(`Flash verification failed at byte ${offset}. Retry upload before using the board.`);
      progress(
        `Reading back flash · ${offset + 128} / ${bytes.length} bytes`,
        60 + Math.round(((offset + 128) / bytes.length) * 38),
      );
    }
    await command([0x51]);
    progress("Flash verified · sketch running on Uno", 100);
  } finally {
    stopped = true;
    if (reader) {
      await reader.cancel().catch(() => {});
      await pumping;
      reader.releaseLock();
    }
    writer?.releaseLock();
    await port.close().catch(() => {});
  }
  return bytes.length;
}
