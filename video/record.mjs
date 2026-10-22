// video/record.mjs — records the demo video by driving the real app in headless Chrome.
//   node video/record.mjs   →  video/out/needtoknow-demo.mp4   (needs Chrome + ffmpeg)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT = path.join(HERE, 'out');
const FRAMES = path.join(OUT, 'frames');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8766, DEBUG = 9333, W = 1280, H = 720, DPR = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const server = spawn('node', ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${path.join(OUT, 'profile')}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); } catch {}
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const frames = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  } else if (msg.method === 'Page.screencastFrame') {
    const { data: jpg, metadata, sessionId } = msg.params;
    const file = path.join(FRAMES, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(jpg, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId });
  }
};
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1500);

// ---------- recording-only styling + helpers injected into the page ----------
await js(`(() => {
  const css = document.createElement('style');
  css.textContent = \`
    body { font-size: 14.5px; }
    #mode, .msg .row .pill:not(.ok):not(.bad) { display: none !important; }
    main > section:first-child, main > section:last-child { position: sticky; top: 10px; max-height: calc(100vh - 20px); overflow: auto; }
    .rec-overlay { position: fixed; inset: 0; z-index: 99; display: flex; flex-direction: column; justify-content: center; padding: 0 110px;
      background: radial-gradient(900px 500px at 80% 0%, #3a2ea8 0%, transparent 60%), linear-gradient(135deg, #0d0e1f, #141838);
      color: #fff; font-family: -apple-system, BlinkMacSystemFont, Inter, sans-serif; transition: opacity .6s; }
    .rec-overlay .big { font-size: 64px; font-weight: 850; letter-spacing: -0.035em; line-height: 1.05; }
    .rec-overlay .big em { font-style: normal; background: linear-gradient(90deg,#8ea2ff,#3ee0b0); -webkit-background-clip: text; color: transparent; }
    .rec-overlay .small { font-size: 26px; color: #b9bfe6; margin-top: 22px; line-height: 1.4; }
    .rec-overlay > * { animation: rise .8s cubic-bezier(.2,.8,.2,1) both; }
    .rec-overlay > *:nth-child(2) { animation-delay: .25s; } .rec-overlay > *:nth-child(3) { animation-delay: .5s; }
    @keyframes rise { from { opacity: 0; transform: translateY(26px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
    .rec-cap { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 98; max-width: 1000px;
      background: rgba(12,12,24,.92); color: #fff; font: 600 22px/1.35 -apple-system, Inter, sans-serif; padding: 14px 26px;
      border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.35); border: 1px solid rgba(142,162,255,.5); transition: opacity .35s, transform .35s; }
    .rec-cap b { color: #8fe3b8; }
    .rec-hl { animation: hl 1.4s ease-in-out 2; border-radius: 10px; }
    @keyframes hl { 0%,100% { box-shadow: 0 0 0 0 rgba(255,214,0,0); } 50% { box-shadow: 0 0 0 6px rgba(255,214,0,.9), 0 0 40px rgba(255,214,0,.6); } }
  \`;
  document.head.append(css);
  window.rec = {
    overlay(html) {
      document.querySelector('.rec-overlay')?.remove();
      const o = document.createElement('div'); o.className = 'rec-overlay'; o.innerHTML = html; document.body.append(o);
    },
    hideOverlay() { const o = document.querySelector('.rec-overlay'); if (o) { o.style.opacity = 0; setTimeout(() => o.remove(), 700); } },
    caption(html) {
      let c = document.querySelector('.rec-cap');
      if (!c) { c = document.createElement('div'); c.className = 'rec-cap'; document.body.append(c); }
      c.style.opacity = 0; c.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => { c.innerHTML = html; c.style.opacity = 1; c.style.transform = 'translateX(-50%)'; }, 250);
    },
    hideCaption() { const c = document.querySelector('.rec-cap'); if (c) c.style.opacity = 0; },
    hl(sel) { const e = [...document.querySelectorAll(sel)].at(-1); if (!e) return; e.scrollIntoView({ behavior: 'smooth', block: 'center' }); e.classList.remove('rec-hl'); void e.offsetWidth; e.classList.add('rec-hl'); },
    preset(i) { document.querySelectorAll('#presets button')[i].click(); },
    async type(i) {
      document.querySelectorAll('#presets button')[i].click();
      const ta = document.querySelector('#svcReq'), full = ta.value; ta.value = '';
      for (let k = 0; k < full.length; k += 3) { ta.value = full.slice(0, k + 3); await new Promise((r) => setTimeout(r, 12)); }
      ta.dispatchEvent(new Event('input'));
    },
    click(sel) { const e = [...document.querySelectorAll(sel)].at(-1); e?.click(); },
    top() { window.scrollTo({ top: 0, behavior: 'smooth' }); },
  };
})()`);

const overlay = (html) => js(`rec.overlay(${JSON.stringify(html)})`);
const caption = (html) => js(`rec.caption(${JSON.stringify(html)})`);
const hl = (sel) => js(`rec.hl(${JSON.stringify(sel)})`);
const click = (sel) => js(`rec.click(${JSON.stringify(sel)})`);

// ---------- the script ----------
await overlay('<div class="big">Hey!</div>');
await send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });

await overlay('<div class="big">Your AI agent is a<br><em>chronic oversharer.</em></div>');
await sleep(3000);
await overlay('<div class="big">Agents now talk to agents.</div><div class="small">And every sensitive check still means handing over raw data:<br>bank statements, SSNs, ID scans.</div>');
await sleep(4200);
await overlay('<div class="big" style="font-size:96px">Need<em>To</em>Know</div><div class="small">Prove the fact. Never share the value.<br>Zero-knowledge proofs for personal AI agents.</div>');
await sleep(3600);
await js('rec.hideOverlay()');
await sleep(700);

await caption('Banks and issuers sign <b>commitments</b> to your data. The values never leave your device.');
await sleep(1200);
await click('#issueBtn');
await sleep(1200);
await hl('#vault');
await sleep(2600);

await caption("A landlord's AI agent wants <b>6 months of bank statements</b>.");
await js('rec.type(0)');
await sleep(1200);
await click('#sendBtn');
await sleep(2400);
await caption('Your agent cuts it down to <b>one fact</b>: balance ≥ $10,000.');
await hl('.msg.agent table');
await sleep(3200);
await caption('You consent to <b>one proof</b>. Zero raw data.');
await hl('.consent');
await sleep(2600);
await click('#yes');
await sleep(1600);
await caption('LeaseBot verifies the ZK proof in milliseconds. <b>0 raw values received.</b>');
await hl('.stat');
await sleep(3400);

await caption('Replay the proof at another service? <b>Rejected</b>: it is bound to the session.');
await click('#svc button');
await sleep(1200);
await hl('#svc .verdict.bad');
await sleep(2800);

await js('rec.top()');
await caption('Now a request with a <b>hidden prompt injection</b>…');
await js('rec.type(4)');
await sleep(1000);
await click('#sendBtn');
await sleep(2200);
await hl('.msg.alert');
await caption("Flagged. And there's nothing to leak: <b>the LLM never sees your values.</b>");
await sleep(4200);
await click('#yes');
await sleep(1800);

await js('rec.top()');
await caption("Try to fake a <b>760 credit score</b> when you have 742…");
await js('rec.preset(3)');
await sleep(600);
await click('#sendBtn');
await sleep(2400);
await click('#cheat');
await sleep(1600);
await caption('Forged proof → <b>rejected</b>. Math does not negotiate.');
await hl('#svc .verdict.bad');
await sleep(3400);
await js('rec.hideCaption()');

await overlay('<div class="big" style="font-size:88px">Need<em>To</em>Know</div><div class="small">AI agent that shares proofs, not your data.</div><div class="small" style="font-size:20px;color:#8b90b8">Pedersen commitments · Σ-protocol range proofs · Fiat–Shamir · Claude<br>github.com/Leegwangwoon/NeedToKnow</div>');
await sleep(4500);

await send('Page.stopScreencast');
await sleep(300);
ws.close(); chrome.kill(); server.kill();

// ---------- encode: real-time frame durations → 30 fps H.264 ----------
let list = '';
for (let i = 0; i < frames.length; i++) {
  const dur = i + 1 < frames.length ? Math.max(frames[i + 1].t - frames[i].t, 0.001) : 0.5;
  list += `file '${frames[i].file}'\nduration ${dur.toFixed(4)}\n`;
}
list += `file '${frames.at(-1).file}'\n`;
writeFileSync(path.join(OUT, 'frames.txt'), list);
const mp4 = path.join(OUT, 'needtoknow-demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'),
  '-vf', `scale=${W * DPR}:${H * DPR}:force_original_aspect_ratio=decrease,pad=${W * DPR}:${H * DPR}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', mp4]);
console.log(`${frames.length} frames → ${mp4}`);
