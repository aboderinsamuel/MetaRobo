// Local maintainer convenience: same no-IDE browser flow, compiler bound to loopback.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
const token = randomBytes(32).toString("hex");
const portable = path.resolve("../.tools/arduino-cli/arduino-cli.exe");
const cli = process.env.ARDUINO_CLI || (existsSync(portable) ? portable : "arduino-cli");
const compilerPort = process.env.COMPILER_PORT || "8080";
const children = [];
const worker = spawn(process.execPath, ["../compiler/server.mjs"], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, HOST: "127.0.0.1", PORT: compilerPort, COMPILER_TOKEN: token, ARDUINO_CLI: cli },
});
children.push(worker);
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    ARDUINO_COMPILER_URL: `http://127.0.0.1:${compilerPort}`,
    ARDUINO_COMPILER_TOKEN: token,
  },
});
children.push(app);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
};
for (const child of children) {
  child.on("error", (e) => {
    console.error(e.message);
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    stop();
    process.exitCode = code || 0;
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
