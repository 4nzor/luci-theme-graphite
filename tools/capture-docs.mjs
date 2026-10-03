#!/usr/bin/env node
/**
 * Capture EN/RU docs screenshots from a live LuCI instance.
 *
 *   SID=<session> DOCS_LANG=en node tools/capture-docs.mjs
 *   SID=<session> DOCS_LANG=ru node tools/capture-docs.mjs
 *
 * Optional: LUCI_HOST=192.168.10.1 CHROMIUM_PATH=...
 */
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const chromePath = process.env.CHROMIUM_PATH
  || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
if (!existsSync(chromePath)) throw new Error('browser not found; set CHROMIUM_PATH');

const sid = process.env.SID;
if (!sid) throw new Error('SID env required');
const lang = process.env.DOCS_LANG || 'en'; // en | ru
const host = process.env.LUCI_HOST || '192.168.10.1';
const outDir = lang === 'ru' ? 'docs/ru' : 'docs';
mkdirSync(outDir, { recursive: true });

const port = 9360 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1',
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=/tmp/graphite-docs-${port}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.stderr.on('data', (c) => {
  chromeErr += c.toString();
  if (chromeErr.length > 4000) chromeErr = chromeErr.slice(-4000);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPort() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`DevTools not ready${chromeErr.trim() ? `\n${chromeErr.trim()}` : ''}`);
}

await waitPort();
const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
const target = await created.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Page.enable');
await send('Network.enable');
for (const name of ['sysauth_http', 'sysauth']) {
  await send('Network.setCookie', {
    name, value: sid, url: `http://${host}/`, path: '/',
  });
}

async function waitReady(timeoutMs = 45000) {
  const { result } = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        const menu = document.querySelectorAll('#topmenu.nav > li > a').length;
        const auth = !document.querySelector('#luci_password');
        const body = (document.body && document.body.innerText) || '';
        const loading = /Loading view|Загрузка страницы/i.test(body);
        const content = document.querySelectorAll(
          '#view .cbi-section, #view .cbi-map, #view .ifacebox, #view .cbi-progressbar, #view table, #view .cbi-value'
        ).length;
        const page = document.body && document.body.dataset.page;
        if (menu >= 1 && auth && content >= 1 && !loading) {
          return resolve({ ok: true, menu, content, page, ms: Date.now() - t0 });
        }
        if (Date.now() - t0 > ${timeoutMs}) {
          return resolve({ ok: false, menu, content, loading, auth, page, ms: Date.now() - t0, snippet: body.slice(0, 160) });
        }
        setTimeout(tick, 250);
      })();
    })`,
  });
  return result?.value;
}

async function goto(url, desktop = true) {
  if (desktop) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1200, deviceScaleFactor: 1, mobile: false,
    });
  } else {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
  }
  await send('Page.navigate', { url });
  const ready = await waitReady(45000);
  if (!ready?.ok) {
    throw new Error(`page not ready: ${url} ${JSON.stringify(ready)}`);
  }
  await sleep(600);
  return ready;
}

async function shotDesktop(out) {
  const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync('/tmp/_graphite_docs.png', Buffer.from(res.data, 'base64'));
  execSync(`sips -z 1200 1920 /tmp/_graphite_docs.png --out ${out}`);
  console.log('[+]', out);
}

async function shotMobile(out) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: true,
    clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 },
  });
  writeFileSync('/tmp/_graphite_mobile.png', Buffer.from(shot.data, 'base64'));
  execSync(`python3 - <<'PY'
from PIL import Image
im = Image.open('/tmp/_graphite_mobile.png')
im = im.resize((1260, int(im.height * 1260 / im.width)), Image.LANCZOS)
h = min(1326, im.height)
im.crop((0, 0, 1260, h)).save('${out}')
print('[+] ${out}', (1260, h))
PY`);
}

const pages = [
  [`http://${host}/cgi-bin/luci/admin/status/overview`, `${outDir}/overview.png`],
  [`http://${host}/cgi-bin/luci/admin/network/network`, `${outDir}/interfaces.png`],
  [`http://${host}/cgi-bin/luci/admin/network/wireless`, `${outDir}/wireless.png`],
  [`http://${host}/cgi-bin/luci/admin/network/firewall`, `${outDir}/firewall.png`],
];

try {
  for (const [url, out] of pages) {
    const ready = await goto(url, true);
    console.log('    ready', ready);
    await shotDesktop(out);
  }

  const mobileReady = await goto(`http://${host}/cgi-bin/luci/admin/status/overview`, false);
  console.log('    mobile ready', mobileReady);
  await shotMobile(`${outDir}/mobile.png`);
} finally {
  try { ws.close(); } catch {}
  chrome.kill('SIGKILL');
}
