/**
 * Drive the real app and film it, portrait, for the Odia teaching video.
 *
 * The app runs inside a phone frame on a 1080x1920 canvas, with the step's Odia sentence as a large
 * caption underneath and a yellow ripple wherever a finger would touch. Each step stays on screen for at
 * least as long as its narration (work/timing.json), so the voice and the picture never drift apart.
 *
 * Frames are taken straight from Chromium's compositor (CDP screencast) at full resolution rather than
 * through Playwright's built-in recorder, whose low bitrate turns small text to mush. assemble.py turns
 * them into an MP4.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WORK = path.join(HERE, 'work');
const BASE = process.env.DEMO_BASE || 'http://localhost:8765';
const script = JSON.parse(fs.readFileSync(path.join(HERE, 'narration.or.json'), 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.join(WORK, 'timing.json'), 'utf8'));
const sessions = JSON.parse(fs.readFileSync(path.join(WORK, 'sessions.json'), 'utf8'));
const FRAMES = path.join(WORK, 'frames');
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const W = 540;
const H = 960;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let app; // set once the page is up
/** The bill line that mentions this product, so a number goes into that line's box and no other. */
const line = (name) => app.locator('li').filter({ hasText: name });

// ---------------------------------------------------------------------------------------------
// The canvas around the app
// ---------------------------------------------------------------------------------------------
const WRAPPER = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Oriya:wght@500;700;800&family=Inter:wght@600;800&display=block" rel="stylesheet">
<style>
  *{box-sizing:border-box} html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
  body{background:radial-gradient(120% 80% at 50% 0%,#115e59 0%,#0b2b33 55%,#0a1626 100%);font-family:'Noto Sans Oriya','Inter',sans-serif;color:#fff}
  #bar{position:absolute;left:24px;right:24px;top:18px;height:6px;border-radius:9px;background:rgba(255,255,255,.15);overflow:hidden}
  #fill{height:100%;width:0;background:#facc15;border-radius:9px;transition:width .6s ease}
  #brand{position:absolute;left:0;right:0;top:32px;text-align:center;font-weight:800;font-size:19px;letter-spacing:.2px;opacity:.95}
  #brand small{font-family:Inter;font-weight:600;font-size:13px;opacity:.7;margin-left:6px}
  #phone{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:404px;height:700px;border-radius:42px;padding:11px;
    background:#05080d;box-shadow:0 0 0 2px #1f2937,0 30px 60px rgba(0,0,0,.55)}
  #screen{position:relative;width:100%;height:100%;border-radius:32px;overflow:hidden;background:#f8fafc}
  #screen iframe{width:100%;height:100%;border:0;display:block}
  #cap{position:absolute;left:18px;right:18px;top:786px;height:156px;border-radius:24px;padding:14px 20px;
    background:rgba(2,6,23,.72);border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;
    text-align:center;font-weight:700;font-size:23px;line-height:1.5;transition:opacity .25s ease}
  #cap.hide{opacity:0}
  #title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
    background:linear-gradient(160deg,#10b981 0%,#0f766e 48%,#1d4ed8 100%);transition:opacity .6s ease;text-align:center;padding:24px}
  #title.hide{opacity:0;pointer-events:none}
  #title img{width:120px;height:120px;border-radius:30px;box-shadow:0 18px 40px rgba(0,0,0,.25)}
  #title h1{margin:14px 0 0;font-size:52px;font-weight:800;line-height:1.1}
  #title h2{margin:0;font-family:Inter;font-size:24px;font-weight:800;opacity:.9}
  #title p{margin:16px 0 0;font-size:21px;font-weight:700;line-height:1.6;opacity:.95}
  .rip{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:4px solid #facc15;
    background:rgba(250,204,21,.35);pointer-events:none;z-index:99;animation:rip .75s ease-out forwards}
  .dot{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(250,204,21,.9);
    box-shadow:0 0 0 6px rgba(250,204,21,.35);pointer-events:none;z-index:99;animation:dot .75s ease-out forwards}
  @keyframes rip{from{transform:scale(.35);opacity:1}to{transform:scale(1.7);opacity:0}}
  @keyframes dot{0%{transform:scale(.6);opacity:1}70%{opacity:1}100%{transform:scale(1);opacity:0}}
</style></head><body>
  <div id="bar"><div id="fill"></div></div>
  <div id="brand">ମୋ ଦୋକାନ<small>· ଶିଖନ୍ତୁ</small></div>
  <div id="phone"><div id="screen">
    <iframe id="app" name="app" src="/" allow="microphone; camera"></iframe>
    <div id="title"><img src="/icon.svg" alt=""><h1>ମୋ ଦୋକାନ</h1><h2>Mo Dokan</h2>
      <p id="tag">କହନ୍ତୁ · ଫଟୋ ନିଅନ୍ତୁ · ହିସାବ ରଖନ୍ତୁ</p></div>
  </div></div>
  <div id="cap" class="hide"></div>
</body></html>`;

// A wholesaler's bill, handwritten, for the photo step: the same three lines the seeded capture holds.
const BILL = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=block" rel="stylesheet">
<style>html,body{margin:0;background:#6b5b4b}
.p{margin:40px auto;width:620px;padding:34px 40px 44px;background:#fbf7ec;transform:rotate(-2.2deg);font-family:Kalam,cursive;color:#1e3a8a;
 box-shadow:0 18px 40px rgba(0,0,0,.35);background-image:repeating-linear-gradient(#fbf7ec 0 46px,#c7d2fe 46px 47px)}
h1{margin:0 0 4px;font-size:34px;color:#7c2d12} .s{font-size:22px;color:#475569;margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:31px} th{text-align:left;font-size:24px;color:#7c2d12;border-bottom:2px solid #7c2d12}
td{height:47px} .r{text-align:right} .t{font-size:30px;margin-top:10px;text-align:right;color:#7c2d12}
</style></head><body><div class="p"><h1>Jagannath Traders</h1><div class="s">Cuttack Road · 27/09</div>
<table><tr><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th></tr>
<tr><td>Sugar</td><td class="r">25</td><td>kg</td><td class="r">39</td></tr>
<tr><td>Moong Dal</td><td class="r">10</td><td>kg</td><td class="r">105</td></tr>
<tr><td>Biscuit</td><td class="r">48</td><td>pkt</td><td class="r">7</td></tr></table>
<div class="t">Total 2361/-</div></div></body></html>`;

// ---------------------------------------------------------------------------------------------
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'en-IN', serviceWorkers: 'block',
});
await ctx.grantPermissions(['microphone', 'camera'], { origin: BASE });

// the bill photo
{
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 700, height: 520 });
  await p.setContent(BILL);
  await p.evaluate(() => document.fonts.ready);
  await wait(400);
  await p.screenshot({ path: path.join(WORK, 'bill.jpg'), type: 'jpeg', quality: 85 });
  await p.close();
}

// The fake microphone takes seconds to come up the first time it is asked for. Ask once now, off camera,
// so the mic in the film starts listening the moment it is tapped, as a real phone's does.
{
  const p = await ctx.newPage();
  await p.route(`${BASE}/__warm`, (r) => r.fulfill({ contentType: 'text/html', body: '<p>warm</p>' }));
  await p.goto(`${BASE}/__warm`);
  await p.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await new Promise((r) => setTimeout(r, 800));
    s.getTracks().forEach((tr) => tr.stop());
  });
  await p.close();
}

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.route(`${BASE}/__demo`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: WRAPPER }));
await page.goto(`${BASE}/__demo`);
await page.evaluate(() => document.fonts.ready);
const frame = () => page.frame({ name: 'app' });
app = page.frameLocator('#app');
await frame().waitForLoadState('networkidle');
await wait(800);

// ---- film it ----
const cdp = await ctx.newCDPSession(page);
const frames = [];
let n = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = `f${String(n++).padStart(6, '0')}.jpg`;
  fs.writeFileSync(path.join(FRAMES, file), Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });

// ---- the little verbs a teaching video is made of ----
const steps = [];
const total = script.steps.length;

async function caption(text, i) {
  await page.evaluate(([t, pct]) => {
    const c = document.getElementById('cap');
    c.classList.add('hide');
    setTimeout(() => { c.textContent = t; c.classList.remove('hide'); }, 180);
    document.getElementById('fill').style.width = pct + '%';
  }, [text, Math.round(((i + 1) / total) * 100)]);
}
async function title(show, tag) {
  await page.evaluate(([s, t]) => {
    const el = document.getElementById('title');
    if (t) document.getElementById('tag').textContent = t;
    el.classList.toggle('hide', !s);
  }, [show, tag ?? null]);
}
async function mark(locator, kind = 'rip') {
  const b = await locator.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y, k]) => {
    const d = document.createElement('div');
    d.className = k; d.style.left = x + 'px'; d.style.top = y + 'px';
    document.body.appendChild(d); setTimeout(() => d.remove(), 900);
  }, [b.x + b.width / 2, b.y + b.height / 2, kind]);
}
/** Point at something without pressing it. */
async function point(locator, hold = 900) { await reveal(locator, 0); await mark(locator, 'rip'); await wait(hold); }
/** A finger press: the ripple first, so the eye gets there before the screen changes. */
async function tap(locator, after = 700) { await reveal(locator, 0); await mark(locator, 'dot'); await wait(380); await locator.click(); await wait(after); }
async function type(locator, text) { await tap(locator, 150); await locator.pressSequentially(text, { delay: 120 }); await wait(350); }
async function reveal(locator, settle = 650) {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
  if (settle) await wait(settle); else await wait(450);
}
async function open(route) { await frame().goto(BASE + route); await frame().waitForLoadState('networkidle'); await wait(500); }
async function scrollApp(dy) { await frame().evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), dy); await wait(900); }

async function step(id, actions) {
  const i = script.steps.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`no narration step "${id}"`);
  const seconds = timing[id].seconds;
  steps.push({ id, t: Date.now() / 1000, seconds });
  await caption(script.steps[i].or, i);
  const t0 = Date.now();
  if (actions) await actions();
  const left = seconds * 1000 + 450 - (Date.now() - t0);
  if (left > 0) await wait(left);
  process.stdout.write(`  filmed ${id}\n`);
}

// ---------------------------------------------------------------------------------------------
// The tour
// ---------------------------------------------------------------------------------------------
await step('intro_hello');
await step('intro_why', async () => { await wait(Math.max(0, timing.intro_why.seconds * 1000 - 700)); await title(false); });

await step('register', async () => {
  await tap(app.getByRole('button', { name: 'Create an account' }), 900);
  await type(app.locator('#shop'), 'Maa Tarini Stores');
  await type(app.locator('#mobile'), '9876500022');
  await tap(app.getByRole('button', { name: 'Next' }), 800);
});
await step('register_red', async () => {
  await type(app.locator('#username'), 'maa tarini');
  await wait(Math.max(1600, timing.register_red.seconds * 1000 - 3200));
  await app.locator('#username').fill('');
  await type(app.locator('#username'), 'maa.tarini');
});
await step('login', async () => {
  await tap(app.getByRole('button', { name: 'Sign in' }), 900);
  await type(app.locator('#username'), sessions.user);
  await type(app.locator('#password'), sessions.password);
  await tap(app.getByRole('button', { name: 'Sign in', exact: true }), 1400);
  await frame().waitForLoadState('networkidle');
});
await step('home', async () => {
  await wait(500);
  await point(app.getByRole('button', { name: /^Sell/ }), 1200);
  await point(app.getByRole('button', { name: /^Buy/ }), 1000);
});
await step('home_today', async () => { await point(app.getByRole('button', { name: /Sold today/ }), 1200); });
await step('sell_hub', async () => {
  await tap(app.getByRole('button', { name: /^Sell/ }), 1100);
  await point(app.getByRole('button', { name: /^Speak/ }), 900);
  await point(app.getByRole('button', { name: /^Photo/ }), 900);
  await point(app.getByRole('button', { name: /^Type/ }), 900);
});
await step('voice_mic', async () => {
  await tap(app.getByRole('button', { name: /^Speak/ }), 1100);
  await tap(app.getByRole('button', { name: 'Start speaking' }), 0);
  await app.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 15000 });
});
await step('voice_say');

await step('names_only', async () => { await open(`/review/${sessions.sale}`); await wait(600); });
await step('fill_yellow', async () => {
  const qty = line('Basmati Rice').locator('input[placeholder="Fill"]').first();
  await point(qty, 700);
  await type(qty, '2');
});
await step('walk_away', async () => { await wait(900); await tap(app.getByRole('link', { name: /Stock/ }), 1200); await tap(app.getByRole('link', { name: /Home/ }), 900); });
await step('continue', async () => {
  await point(app.getByText('Not saved yet', { exact: false }).first(), 1000);
  await tap(app.getByRole('button', { name: 'Continue' }).first(), 1300);
  await type(line('Marie Gold Biscuit').locator('input[placeholder="Fill"]').first(), '3');
  await type(line('Tiger Biscuit').locator('input[placeholder="Fill"]').first(), '5');
});
await step('save_sale', async () => { await tap(app.getByRole('button', { name: 'Save', exact: true }), 1800); });

await step('buy_hub', async () => {
  await tap(app.getByRole('link', { name: /Home/ }), 900);
  await tap(app.getByRole('button', { name: /^Buy/ }), 900);
});
await step('photo', async () => {
  await tap(app.getByRole('button', { name: /^Photo/ }), 900);
  await mark(app.getByRole('button', { name: /Take a photo/ }), 'dot');
  await wait(400);
  await app.locator('input[type="file"]').first().setInputFiles(path.join(WORK, 'bill.jpg'));
  await wait(1200);
});
await step('photo_read', async () => {
  await tap(app.getByRole('button', { name: 'Read the bill' }), 0).catch(() => {});
  await open(`/review/${sessions.buy}`);
  await wait(500);
  await scrollApp(260);
});
await step('sell_price', async () => {
  // The new item's name is in an input, which hasText cannot see; its written line is plain text.
  const sell = line('Moong Dal | 10').locator('input[placeholder="You sell at"]');
  await reveal(sell);
  await type(sell, '130');
  await wait(600);
});
await step('which_one', async () => {
  const chips = app.locator('div:has(> p:text("Which one?"))');
  await reveal(chips);
  await point(chips.getByRole('button', { name: /^Marie Gold/ }), 700);
  await tap(chips.getByRole('button', { name: /^Tiger Biscuit/ }), 700);
});
await step('save_buy', async () => { await wait(600); await tap(app.getByRole('button', { name: 'Save & add' }), 2000); });

await step('stock', async () => {
  await tap(app.getByRole('link', { name: /Stock/ }), 1200);
  await point(app.locator('thead'), 900);
  await scrollApp(220);
});
await step('stock_sheet', async () => {
  await tap(app.locator('tbody tr', { hasText: 'Basmati' }), 1800);
  await tap(app.getByRole('button', { name: 'Close' }).first(), 700);
  await tap(app.getByRole('button', { name: /^Low ·/ }), 900);
});
await step('report', async () => {
  await tap(app.getByRole('link', { name: /Report/ }), 1200);
  await scrollApp(420);
  await scrollApp(360);
});
await step('report_margin', async () => { await reveal(app.getByText('Best margin')); await wait(800); });

await step('outro_why', async () => {
  await tap(app.getByRole('link', { name: /Home/ }), 1000);
  await wait(Math.max(0, timing.outro_why.seconds * 1000 - 2600));
});
await step('outro_go', async () => { await title(true, 'ଆଜି ହିଁ ଆରମ୍ଭ କରନ୍ତୁ'); });
await wait(1600);

await cdp.send('Page.stopScreencast');
await wait(300);
fs.writeFileSync(path.join(WORK, 'timeline.json'), JSON.stringify({ frames, steps, end: Date.now() / 1000 }, null, 1));
console.log(`  ${frames.length} frames, ${steps.length} steps${errors.length ? ', page errors: ' + JSON.stringify(errors.slice(0, 3)) : ''}`);
await browser.close();
