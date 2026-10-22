// video/gallery.mjs — renders the Devpost image gallery (3:2, 1800×1200 JPG) into data/.
//   node video/gallery.mjs   (needs Chrome)
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT = path.join(ROOT, 'data');
const PROFILE = path.join(HERE, 'out', 'gallery-profile');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8767, DEBUG = 9334, W = 1200, H = 800, DPR = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
// Only clear images this script generates; leave anything else in data/ alone.
for (const f of readdirSync(OUT)) if (/^\d\d-[\w-]+\.(jpg|png)$/.test(f)) rmSync(path.join(OUT, f));

const server = spawn('node', ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${PROFILE}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); } catch {}
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  const p = pending.get(msg.id);
  if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
let n = 0;
const shot = async (name) => {
  await sleep(400);
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  const file = path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.jpg`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(file);
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });

// 01: cover (the existing thumbnail)
copyFileSync(path.join(ROOT, 'submission', 'thumbnail2.png'), path.join(OUT, `${String(++n).padStart(2, '0')}-cover.png`));

// 02–04: explainer slides
for (const id of ['problem', 'how', 'math']) {
  await send('Page.navigate', { url: `file://${path.join(HERE, 'slides.html')}#${id}` });
  await sleep(1500);
  await shot(id);
}

// 05–08: the real app
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1500);
await js(`(() => {
  const css = document.createElement('style');
  css.textContent = \`
    #mode, .msg .row .pill:not(.ok):not(.bad) { display: none !important; }
    main > section:first-child, main > section:last-child { position: sticky; top: 10px; max-height: calc(100vh - 20px); overflow: auto; }
    .gal-tag { position: fixed; right: 18px; bottom: 18px; z-index: 99; background: rgba(12,12,24,.94); color: #fff;
      font: 700 19px/1.3 -apple-system, Inter, sans-serif; padding: 12px 20px; border-radius: 14px; border: 1px solid rgba(142,162,255,.6);
      box-shadow: 0 12px 40px rgba(0,0,0,.4); max-width: 560px; }
    .gal-tag b { color: #8fe3b8; }
    .gal-hl { box-shadow: 0 0 0 4px rgba(255,214,0,.95), 0 0 34px rgba(255,214,0,.55) !important; border-radius: 10px; }
  \`;
  document.head.append(css);
  window.gal = {
    tag(html) { let t = document.querySelector('.gal-tag'); if (!t) { t = document.createElement('div'); t.className = 'gal-tag'; document.body.append(t); } t.innerHTML = html; },
    hl(sel) { document.querySelectorAll('.gal-hl').forEach((e) => e.classList.remove('gal-hl')); const e = [...document.querySelectorAll(sel)].at(-1); e?.classList.add('gal-hl'); return e; },
    focus(sel) { const e = [...document.querySelectorAll(sel)].at(-1); e?.scrollIntoView({ block: 'center' }); },
    click(sel) { [...document.querySelectorAll(sel)].at(-1)?.click(); },
    preset(i) { document.querySelectorAll('#presets button')[i].click(); },
  };
})()`);
const g = (expr) => js(`gal.${expr}`);

await g(`click('#issueBtn')`); await sleep(1200);
await g('preset(0)'); await g(`click('#sendBtn')`); await sleep(1500);
await g(`focus('.consent')`); await g(`hl('.msg.agent table')`);
await g(`tag(${JSON.stringify("Agent-to-agent: a leasing bot asks for 3 documents. Your agent sends <b>one ZK proof</b> instead.")})`);
await shot('minimize-and-consent');

await g(`click('#yes')`); await sleep(1500);
await g(`hl('#svc .stats')`);
await g(`tag(${JSON.stringify('Verified in milliseconds. <b>0 raw values</b> ever reach the other side.')})`);
await shot('verified-zero-raw-values');

await g('preset(4)'); await g(`click('#sendBtn')`); await sleep(1500);
await g(`focus('.msg.alert')`); await g(`hl('.msg.alert')`);
await g(`tag(${JSON.stringify("Prompt injection flagged. <b>The LLM never sees your values</b>, so there's nothing to leak.")})`);
await shot('prompt-injection-blocked');
await g(`click('#yes')`); await sleep(1500);

await g('preset(3)'); await g(`click('#sendBtn')`); await sleep(1500);
await g(`click('#cheat')`); await sleep(1500);
await g(`focus('.log')`); await g(`hl('#svc .verdict')`);
await g(`tag(${JSON.stringify('Faking a 760 credit score? The forged proof is <b>rejected</b>. Math does not negotiate.')})`);
await shot('forged-proof-rejected');

ws.close(); chrome.kill(); server.kill();
await sleep(800);
rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
