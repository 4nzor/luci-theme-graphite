#!/usr/bin/env node
/**
 * Fail if section links don't keep icon+label packed on the left.
 *
 *   tools/check-nav.mjs                         # local fixture
 *   tools/check-nav.mjs --url URL --cookie SID  # live LuCI
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_ICON_TO_TEXT = 40;   // padding-left ~46px (14 + 20 + 12)
const MAX_ICON_TO_TEXT = 56;
const MAX_RIGHT_SLACK = 80;    // label must not sit on the far right of a wide row

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
    // Homebrew's chromium is often a stub pointing at a missing .app — skip those.
    try {
      const body = readFileSync(p, 'utf8');
      if (body.includes('No such file') || body.includes('Caskroom')) continue;
    } catch {
      // binary — fine
    }
    return p;
  }
  throw new Error('chromium/chrome/brave not found; set CHROMIUM_PATH');
}

async function waitPort(port, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`DevTools not ready on ${port}`);
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

async function connectTarget(port, url) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
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
    const iconToText = textRect ? textRect.left - br.left : null;
    const rightSlack = textRect ? br.right - textRect.right : null;
    const padL = parseFloat(cs.paddingLeft) || 0;
    return {
      text: a.textContent.trim().replace(/\\s+/g, ' '),
      display: cs.display,
      justify: cs.justifyContent,
      padL: Math.round(padL),
      beforePos: before.position,
      iconToText: iconToText == null ? null : Math.round(iconToText * 10) / 10,
      rightSlack: rightSlack == null ? null : Math.round(rightSlack * 10) / 10,
      width: Math.round(br.width),
    };
  });
  const bad = rows.filter((r) => {
    if (r.iconToText == null || r.padL < 40) return true;
    if (r.iconToText < ${MIN_ICON_TO_TEXT} || r.iconToText > ${MAX_ICON_TO_TEXT}) return true;
    // space-between look: wide row, label glued to the right edge
    if (r.width > 160 && r.rightSlack != null && r.rightSlack < 40 && r.iconToText > 80) return true;
    return false;
  });
  return { ok: bad.length === 0, bad, rows };
})()`;

async function main() {
  const liveUrl = arg('--url');
  const cookie = arg('--cookie');
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
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/graphite-check-nav',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    await waitPort(port);
    const cdp = await connectTarget(port, 'about:blank');
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
    await cdp.send('Page.loadEventFired').catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: PROBE,
      returnByValue: true,
      awaitPromise: true,
    });
    const data = result.value;
    cdp.close();

    if (!data?.ok) {
      console.error('[-] nav layout check FAILED');
      console.error(JSON.stringify(data, null, 2));
      process.exitCode = 1;
    } else {
      console.log('[+] nav layout ok');
      for (const r of data.rows) {
        console.log(`    ${r.text}: icon→text=${r.iconToText}px padL=${r.padL} rightSlack=${r.rightSlack} (${r.display}/${r.beforePos})`);
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
