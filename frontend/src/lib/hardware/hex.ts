/** Strict Intel HEX decoder for the Uno's application flash (bootloader excluded). */
export function parseHex(hex: string): Uint8Array {
  const flash = new Uint8Array(32256).fill(255);
  const used = new Set<number>();
  let base = 0,
    end = 0,
    eof = false;
  for (const line of hex.trim().split(/\r?\n/)) {
    if (!/^:([\da-f]{2})+$/i.test(line) || eof) throw new Error("Invalid Intel HEX record.");
    const bytes = Uint8Array.from(
      line
        .slice(1)
        .match(/../g)!
        .map((b) => parseInt(b, 16)),
    );
    const size = bytes[0],
      addr = bytes[1] * 256 + bytes[2],
      type = bytes[3];
    if (bytes.length !== size + 5 || bytes.reduce((a, b) => a + b, 0) % 256)
      throw new Error("Firmware checksum failed.");
    const data = bytes.slice(4, -1);
    if (type === 0) {
      if (base + addr + size > flash.length) throw new Error("Firmware exceeds Uno application flash.");
      for (let i = 0; i < size; i++) {
        const at = base + addr + i;
        if (used.has(at)) throw new Error("Overlapping firmware records.");
        used.add(at);
        flash[at] = data[i];
      }
      end = Math.max(end, base + addr + size);
    } else if (type === 1 && size === 0 && addr === 0) eof = true;
    else if ((type === 2 || type === 4) && size === 2 && addr === 0)
      base = (data[0] * 256 + data[1]) * (type === 2 ? 16 : 65536);
    else throw new Error("Unsupported HEX record.");
  }
  if (!eof || !end || !used.has(0))
    throw new Error("Incomplete firmware: missing reset vector or end record.");
  return flash.slice(0, Math.ceil(end / 128) * 128);
}
