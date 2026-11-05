// Run against a real installed Arduino CLI: ARDUINO_CLI=/path/to/arduino-cli node --test ...
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
test('real compile worker: authentication, target validation, compiler errors, source binding', { timeout: 120000 }, async () => {
  const token = randomBytes(32).toString('hex');
  const port = '18081';
  const worker = spawn(process.execPath, ['compiler/server.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: port, COMPILER_TOKEN: token }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(worker.stdout, 'data');
    const url = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${url}/health`)).status, 401);
    const post = (body) => fetch(`${url}/compile`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ code: 'void setup(){} void loop(){}', board: 'esp32:esp32:esp32' })).status, 400);
    assert.equal((await post({ code: '#include "/proc/1/environ"', board: 'arduino:avr:uno' })).status, 422);
    assert.equal((await post({ code: 'void setup() { broken } void loop(){}', board: 'arduino:avr:uno' })).status, 422);
    const code = 'void setup() { pinMode(13, OUTPUT); } void loop() { digitalWrite(13, HIGH); delay(123); digitalWrite(13, LOW); delay(456); }';
    const res = await post({ code, board: 'arduino:avr:uno' });
    const result = await res.json();
    assert.equal(res.status, 200, result.error);
    assert.equal(result.sourceHash, createHash('sha256').update(code).digest('hex'));
    assert.match(result.hex, /:00000001FF/);
    console.log('Real compiler returned valid HEX tied to edited source. No board was flashed.');
  } finally { worker.kill(); await once(worker, 'exit'); }
});
