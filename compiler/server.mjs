// Private compile worker. Run in the restricted container described in README.md.
import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { validateSketch } from './policy.mjs';

const token = process.env.COMPILER_TOKEN;
if (!token || token.length < 24) throw new Error('Set COMPILER_TOKEN to a random secret of at least 24 characters.');
let busy = false;
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const authorized = (req) => {
  const supplied = Buffer.from(req.headers.authorization || '');
  const wanted = Buffer.from(`Bearer ${token}`);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
};
function compile(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.ARDUINO_CLI || 'arduino-cli', args, {
      shell: false, windowsHide: true, detached: process.platform !== 'win32',
      // Never pass the service credential to compiler subprocesses.
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'COMPILER_TOKEN')),
    });
    let output = '', settled = false;
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const finish = (err) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(output); };
    const timer = setTimeout(() => { kill(); finish(new Error('Compilation timed out after 90 seconds.')); }, 90000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 100000) { kill(); finish(new Error('Compiler output limit exceeded.')); }
    });
    child.on('error', finish);
    child.on('close', (code) => finish(code === 0 ? null : new Error(output.slice(-12000) || 'Compilation failed.')));
  });
}
http.createServer(async (req, res) => {
  if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });
  if (req.url === '/health' && req.method === 'GET') return send(res, 200, { board: 'arduino:avr:uno', busy });
  if (req.url !== '/compile' || req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  if (busy) return send(res, 429, { error: 'Compiler is busy. Try again in a moment.' });
  busy = true;
  let dir, response;
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 50000) { send(res, 413, { error: 'Sketch too large.' }); return; } }
    const { code, board } = JSON.parse(raw);
    if (board !== 'arduino:avr:uno' || typeof code !== 'string' || !code.length || code.length > 40000) return send(res, 400, { error: 'Only Uno R3 sketches up to 40,000 characters are supported.' });
    validateSketch(code);
    dir = await mkdtemp(path.join(tmpdir(), 'robocraft-'));
    const sketch = path.join(dir, 'sketch'), out = path.join(dir, 'out');
    await mkdir(sketch); await mkdir(out);
    await writeFile(path.join(sketch, 'sketch.ino'), code);
    const log = await compile(['compile', '--fqbn', board, '--warnings', 'default', '--build-path', path.join(dir, 'build'), '--output-dir', out, sketch]);
    const hex = await readFile(path.join(out, 'sketch.ino.hex'), 'utf8');
    response = { status: 200, body: { hex, board, sourceHash: createHash('sha256').update(code).digest('hex'), log: log.slice(-12000), toolchain: 'Arduino AVR 1.8.6' } };
  } catch (e) { response = { status: e instanceof SyntaxError ? 400 : 422, body: { error: e.message } }; }
  finally {
    try { if (dir) await rm(dir, { recursive: true, force: true }); }
    catch { response = { status: 500, body: { error: 'Could not clean up the compilation job.' } }; }
    finally { busy = false; }
  }
  if (response) send(res, response.status, response.body);
}).listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () => console.log('Arduino compiler listening'));
