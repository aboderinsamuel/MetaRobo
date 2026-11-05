// Maintainer-only: compile every recipe and refresh the exact-source bundled demo.
// Visitors never run this or install Arduino tools.
import ts from "typescript";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
const source = await readFile("src/lib/hardware/recipes.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { RECIPES, HEARTBEAT } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const dir = await mkdtemp(path.join(tmpdir(), "rc-recipes-"));
try {
  for (const recipe of RECIPES) {
    const sketch = path.join(dir, recipe.id),
      out = path.join(sketch, "out");
    await mkdir(sketch);
    await mkdir(out);
    await writeFile(path.join(sketch, `${recipe.id}.ino`), recipe.code);
    const result = spawnSync(
      process.env.ARDUINO_CLI || "arduino-cli",
      ["compile", "--fqbn", "arduino:avr:uno", "--output-dir", out, sketch],
      { encoding: "utf8", timeout: 120000, windowsHide: true },
    );
    if (result.status !== 0)
      throw new Error(`${recipe.id}: ${result.error || result.stderr || result.stdout}`);
    console.log(`PASS ${recipe.name}: ${result.stdout.trim()}`);
    if (recipe.code === HEARTBEAT) {
      await writeFile(
        "src/data/uno-heartbeat.json",
        JSON.stringify(
          {
            board: "arduino:avr:uno",
            sourceHash: createHash("sha256").update(HEARTBEAT).digest("hex"),
            hex: await readFile(path.join(out, `${recipe.id}.ino.hex`), "utf8"),
            log: result.stdout.trim(),
            toolchain: "Arduino CLI 1.3.1 · Arduino AVR 1.8.6",
          },
          null,
          2,
        ) + "\n",
      );
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
