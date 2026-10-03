#!/usr/bin/env node
/**
 * Fail if section links overlap icons/labels or stretch label to the far right.
 *
 *   tools/check-nav.mjs                         # local fixture
 *   tools/check-nav.mjs --url URL --cookie SID  # live LuCI
 *   tools/check-nav.mjs --shot out.png          # also save sidebar PNG
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_ICON_TO_TEXT = 40;  // pad 14 + icon 20 + gap ~6
const MAX_ICON_TO_TEXT = 60;
const MIN_GAP = 8;            // icon right → text left

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/opt/homebrew/bin/chromium',
  ].filter(Boolean);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const body = readFileSync(p, 'utf8');
      if (body.includes('No such file') || body.includes('Caskroom')) continue;
    } catch {
      // binary
    }
    return p;
  }
  throw new Error('chromium/chrome/brave not found; set CHROMIUM_PATH');
}

async function waitPort(port, getErr = () => '', ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  const hint = getErr().trim() ? `\nChromium stderr:\n${getErr().trim()}` : '';
  throw new Error(`DevTools not ready on ${port}${hint}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.ws.close(); }
}

async function connectTarget(port) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const target = await created.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return new CDP(ws);
}

function startFixtureServer() {
  const mime = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'tools/fixtures/nav.html';
    const file = resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404); res.end('missing'); return;
    }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const PROBE = `(() => {
  const links = [...document.querySelectorAll('#topmenu.nav > li > a')];
  if (!links.length) return { ok: false, error: 'no #topmenu.nav > li > a' };
  const rows = links.map((a) => {
    const br = a.getBoundingClientRect();
    const before = getComputedStyle(a, '::before');
    let textRect = null;
    for (const n of a.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) {
        const r = document.createRange();
        r.selectNodeContents(n);
        textRect = r.getBoundingClientRect();
        break;
      }
    }
    const cs = getComputedStyle(a);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const iconW = parseFloat(before.width) || 0;
    const iconH = parseFloat(before.height) || 0;
    // For static ::before in grid/flex, icon occupies the first content box after padding.
    // For absolute ::before, left is relative to padding edge.
    let iconLeft;
    let iconRight;
    if (before.position === 'absolute' || before.position === 'fixed') {
      iconLeft = (parseFloat(before.left) || 0);
      iconRight = iconLeft + iconW;
    } else {
      iconLeft = padL;
      iconRight = padL + iconW;
    }
    const textLeft = textRect ? textRect.left - br.left : null;
    const gap = textLeft == null ? null : textLeft - iconRight;
    const rightSlack = textRect ? br.right - textRect.right : null;
    return {
      text: a.textContent.trim().replace(/\\s+/g, ' '),
      display: cs.display,
      justify: cs.justifyContent,
      columns: cs.gridTemplateColumns,
      beforePos: before.position,
      padL: Math.round(padL * 10) / 10,
      iconW: Math.round(iconW * 10) / 10,
      iconH: Math.round(iconH * 10) / 10,
      iconLeft: Math.round(iconLeft * 10) / 10,
      iconRight: Math.round(iconRight * 10) / 10,
      textLeft: textLeft == null ? null : Math.round(textLeft * 10) / 10,
      gap: gap == null ? null : Math.round(gap * 10) / 10,
      rightSlack: rightSlack == null ? null : Math.round(rightSlack * 10) / 10,
      width: Math.round(br.width),
    };
  });
  const bad = rows.filter((r) => {
    if (r.textLeft == null || r.gap == null) return true;
    // overlap or cramped
    if (r.gap < ${MIN_GAP}) return true;
    if (r.textLeft < ${MIN_ICON_TO_TEXT} || r.textLeft > ${MAX_ICON_TO_TEXT}) return true;
    // absolute icon + small padding = the 1.1.1 failure mode
    if ((r.beforePos === 'absolute' || r.beforePos === 'fixed') && r.padL < 40) return true;
    // space-between: wide row, label glued to the right
    if (r.width > 160 && r.rightSlack != null && r.rightSlack < 40 && r.textLeft > 80) return true;
    // must be grid or flex packing, not block+absolute
    if (r.display === 'block' && (r.beforePos === 'absolute' || r.beforePos === 'fixed')) return true;
    return false;
  });
  return { ok: bad.length === 0, bad, rows };
})()`;

async function main() {
  const liveUrl = arg('--url');
  const cookie = arg('--cookie');
  const shotPath = arg('--shot');
  const port = 9222 + Math.floor(Math.random() * 1000);
  const chromium = findChromium();

  let server = null;
  let pageUrl = liveUrl;
  if (!pageUrl) {
    server = await startFixtureServer();
    const { port: sp } = server.address();
    pageUrl = `http://127.0.0.1:${sp}/tools/fixtures/nav.html`;
  }

  const chrome = spawn(chromium, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=/tmp/graphite-check-nav-${port}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Surface Chromium startup errors when DevTools never comes up (common in CI).
  let chromeErr = '';
  chrome.stderr.on('data', (chunk) => {
    chromeErr += chunk.toString();
    if (chromeErr.length > 4000) chromeErr = chromeErr.slice(-4000);
  });

  try {
    await waitPort(port, () => chromeErr);
    const cdp = await connectTarget(port);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (cookie && liveUrl) {
      const u = new URL(liveUrl);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCookie', {
        name: 'sysauth_http',
        value: cookie,
        domain: u.hostname,
        path: '/',
      });
    }
    await cdp.send('Page.navigate', { url: pageUrl });
    // Live LuCI builds #topmenu async; CSS can lag behind DOM. Wait generously.
    const waitMs = liveUrl ? 45000 : 15000;
    const { result: ready } = await cdp.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        const t0 = Date.now();
        const limit = ${waitMs};
        (function tick() {
          const a = document.querySelector('#topmenu.nav > li > a')
            || document.querySelector('#topmenu > li > a');
          const n = document.querySelectorAll('#topmenu.nav > li > a, #topmenu > li > a').length;
          const cs = a ? getComputedStyle(a) : null;
          const display = cs && cs.display;
          const padL = cs ? parseFloat(cs.paddingLeft) : 0;
          const styled = !!(cs && (
            display === 'grid' || display === 'inline-flex' || display === 'flex' || padL >= 40
          ));
          if (n >= 1 && styled) return resolve({ ok: true, n, display, padL: cs.paddingLeft, ms: Date.now() - t0 });
          if (Date.now() - t0 > limit) return resolve({
            ok: false, n, display, padL: cs && cs.paddingLeft,
            page: document.body && document.body.dataset.page,
            hasPw: !!document.querySelector('#luci_password'),
            ms: Date.now() - t0,
          });
          setTimeout(tick, 200);
        })();
      })`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (!ready?.value?.ok) {
      console.error('[-] timed out waiting for styled #topmenu', ready?.value);
      if (shotPath) {
        try {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
          writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
          console.error(`[-] wrote failure screenshot ${shotPath}`);
        } catch {}
      }
      process.exitCode = 1;
      return;
    }
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: PROBE,
      returnByValue: true,
      awaitPromise: true,
    });
    const data = result.value;

    if (shotPath) {
      const header = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const h=document.querySelector('header'); if(!h) return null; const b=h.getBoundingClientRect(); return {x:b.x,y:b.y,width:Math.min(b.width,280),height:Math.min(b.height,720)}; })()`,
        returnByValue: true,
      });
      const box = header.result.value || { x: 0, y: 0, width: 256, height: 700 };
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
        fromSurface: true,
      });
      writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
      console.log(`[+] wrote screenshot ${shotPath}`);
    }

    cdp.close();

    if (!data?.ok) {
      console.error('[-] nav layout check FAILED');
      console.error(JSON.stringify(data, null, 2));
      process.exitCode = 1;
    } else {
      console.log('[+] nav layout ok');
      for (const r of data.rows) {
        console.log(`    ${r.text}: text@${r.textLeft} gap=${r.gap} ${r.display}/${r.beforePos} cols=${r.columns}`);
      }
    }
  } finally {
    chrome.kill('SIGKILL');
    if (server) server.close();
  }
}

main().catch((e) => {
  console.error('[-]', e.message || e);
  process.exit(1);
});
