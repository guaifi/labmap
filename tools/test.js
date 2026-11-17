#!/usr/bin/env node
/* Labmap tests with a headless browser (Playwright + Chromium).
   Usage: node tools/test.js [screenshot folder]      (needs: npm i playwright)
   Parts 1-8: the page served as static files (local mode), with the test fixture loaded
   (tools/fixture.js: a synthetic lab of about 70 devices).
   Part 9: the real server (server.py) in a temporary folder, with two browsers. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawn } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), SHOTS = process.argv[2] || path.join(ROOT, 'tools', 'shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.yaml': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const f = path.join(ROOT, path.normalize(u));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
let fails = 0;
const ok = (cond, msg, extra) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const open = async (url, opts, ready) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/404|423|409|400|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(url);
    await page.waitForFunction(ready || (() => window.LAB && window.LAB.net.mode === 'local' && Object.keys(window.LAB.state.catalog.portTypes).length > 0), null, { timeout: 15000 });
    return page;
  };
  const quiet = page => page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  const fixture = scale => execFileSync('node', [path.join(ROOT, 'tools', 'fixture.js'), String(scale)], { maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const FX = fixture(1), FXCAT = fixture('--catalog');
  /* loads the fixture lab, with the default catalog plus the extra test templates */
  const loadExample = page => page.evaluate(([lab, cat]) => { const st = LAB.parseYaml(lab), c = JSON.parse(JSON.stringify(LAB.state.catalog)); Object.assign(c.templates, LAB.normCatalog(LAB.parseYaml(cat)).templates); st.catalog = c; LAB.load(st); }, [FX, FXCAT]);

  console.log('0. Files on disk (Node, no browser)');
  const L = require(path.join(ROOT, 'app.js'));
  const catTxt = fs.readFileSync(path.join(ROOT, 'defaults', 'catalog.yaml'), 'utf8'), labTxt = fs.readFileSync(path.join(ROOT, 'example', 'lab.yaml'), 'utf8');
  const cat0 = L.normCatalog(L.parseYaml(catTxt)); L.setCatalog0(cat0);
  const NT = Object.keys(cat0.templates).length, NP = Object.keys(cat0.portTypes).length;
  ok(L.toCatalogYaml(cat0) === catTxt, 'defaults/catalog.yaml reads and writes back identically (' + NP + ' types, ' + NT + ' templates)');
  ok(L.toYaml(L.normalize(L.parseYaml(labTxt)), true) === labTxt && Object.keys(L.parseYaml(labTxt).devices).length === 9, 'example/lab.yaml (9 devices) reads and writes back identically');
  ok(L.toYaml(L.normalize(L.parseYaml(FX)), true) === FX, 'the test fixture reads and writes back identically');
  ok(/^# LABMAP DATABASE/.test(catTxt) && /DO NOT EDIT BY HAND/.test(labTxt), 'both files say they are not edited by hand');
  const bad = [];
  for (const k of Object.keys(cat0.templates)) for (const line of cat0.templates[k].ports) { const kind = line.split(/\s+/).slice(1).join(' '); if (!cat0.portTypes[kind]) bad.push(k + ':' + kind); }
  ok(!bad.length && ['pal', 'dvi', 'relay-in', 'relay-out', 'debug', 'rs232', 'iface'].every(k => cat0.portTypes[k]) && ['wall-socket', 'power-strip', 'switch-8', 'pc'].every(k => cat0.templates[k]), 'catalog: every template uses existing port types', bad.join());
  let ferr = ''; try { L.readData('rev: 1\nformat: 99\ndevices:\n'); } catch (e) { ferr = e.message; }
  ok(/^format: 1$/m.test(labTxt) && /^format: 1$/m.test(catTxt) && L.readData('rev: 1\ndevices:\n').format === undefined && /newer Labmap \(format 99/.test(ferr), 'files carry "format: 1"; a missing format is 1; a newer format is refused', ferr);
  /* round trip of awkward text: quotes, #, :, line breaks, yes/no, numbers with zeros, unicode */
  const ODD = ['', ' ', 'true', 'False', 'null', '~', 'yes', 'no', 'on', 'off', 'y', '0', '007', '1e3', '0x1F', '-1', '.5', '1.0', '.inf', 'NaN', '-', '- x', '# x', 'a # b', 'a: b', 'a:b', '{x}', '[x]', '"q"', "'q'", "it's", 'back\\slash', 'tab\there', 'line1\nline2', 'cr\r\n', ' lead', 'trail ', '&a', '*r', '!t', '%x', '@x', '`x`', '|', '>', '?', 'ñandú', 'Ünïcödé €', '中文', '😀', 'a, b', 'x}', 'x]', '192.168.1.1', '02:00:00:00:00:01', 'http://{ip}:8080/a?b=c#d', 'C:\\W', '50%', '=', '+5', '°C', '2026-01-01'];
  let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const CH = 'abXY09 :#{}[],"\'\\\n\t-|>&*!%@`?=+/.ñ€😀', rs = () => (rnd(3) ? ODD[rnd(ODD.length)] : Array.from({ length: 1 + rnd(10) }, () => CH[rnd(CH.length)]).join(''));
  const nm = i => (rs().replace(/:/g, '').trim() || 'x') + i;
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => k !== 'catalog' && v[k] !== '' && v[k] !== undefined && v[k] !== false && !(Array.isArray(v[k]) && !v[k].length)).map(k => [k, canon(v[k])])) : v;
  const same = (a, b) => { const x = canon(a), y = canon(b); x.links = x.links.map(l => JSON.stringify(l)).sort(); y.links = y.links.map(l => JSON.stringify(l)).sort(); return JSON.stringify(x) === JSON.stringify(y); };
  let fz = 0, fzMsg = '';
  for (let it = 0; it < 300; it++) {
    const devices = {}, links = [], vlans = {};
    for (let i = 0; i < 3; i++) devices[nm(i)] = { types: ['board'], model: rs(), serial: rs(), project: rs(), owner: rs(), location: rs(), notes: rs(), admin: rs(), ports: [0, 1, 2].map(j => ({ name: nm(j), kind: ['rj45', 'usb', 'ac-in'][j], ip: rs(), mac: rs(), vlan: rs(), vlans: [rs(), rs()].filter(Boolean), services: rs(), notes: rs() })) };
    const dn = Object.keys(devices);
    for (let i = 0; i < 3; i++) { const a = dn[rnd(3)], b = dn[rnd(3)]; links.push({ id: rs() + i, type: 'net', a: a + ':' + devices[a].ports[0].name, b: b + ':' + devices[b].ports[1].name, notes: rs() }); }
    vlans[nm(0)] = { id: rnd(4000), subnet: rs(), gateway: rs(), dns: rs(), scope: 'local', notes: rs() };
    const st = L.normalize({ rev: it, vlans, devices, links, ipUse: [{ vlan: rs(), from: rs(), to: rs(), iface: rs(), who: rs(), notes: rs() }], log: [{ t: rs(), by: rs(), msg: rs(), rev: 1 }] });
    const c = JSON.parse(JSON.stringify(cat0)); c.templates[nm(0)] = { label: rs(), types: ['board'], model: rs(), pattern: rs(), power: 'dc', admin: rs(), notes: rs(), ports: ['eth0 rj45'], meta: { eth0: { vlan: rs(), services: rs(), notes: rs() } } };
    const y = L.toYaml(st, true), yc = L.toCatalogYaml(L.normCatalog(c));
    try { const st2 = L.normalize(L.readData(y)); if (L.toYaml(st2, true) !== y || !same(st, st2) || L.toCatalogYaml(L.normCatalog(L.readData(yc))) !== yc) { fz++; fzMsg = fzMsg || y; } } catch (e) { fz++; fzMsg = fzMsg || e.message; }
  }
  ok(fz === 0, 'YAML round trip of 300 labs and catalogs full of awkward text: nothing lost', fz ? fz + ' failed: ' + fzMsg.slice(0, 300) : '');
  let yerr = ''; try { L.parseYaml('a:\n  b: 1\n   c: 2'); } catch (e) { yerr = e.message; }
  ok(/line 3/.test(yerr), 'badly indented YAML reports the line number', yerr);

  console.log('1. Start at 390 px (static, local mode)');
  const page = await open(base + '/', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const empty = await page.evaluate(() => ({ n: Object.keys(LAB.state.devices).length, hint: document.getElementById('map-hint').textContent, notice: document.getElementById('notice-t').textContent, compat: document.compatMode, tpl: Object.keys(LAB.state.catalog.templates).length }));
  ok(empty.n === 0 && /^No devices/.test(empty.hint) && /^Local mode/.test(empty.notice) && empty.compat === 'CSS1Compat' && empty.tpl === NT, 'starts empty, with the default catalog and a short local-mode notice', empty.notice);
  await loadExample(page);
  const boot = await page.evaluate(() => ({ devs: document.querySelectorAll('svg.map .dev').length, links: document.querySelectorAll('svg.map .lk').length, n: Object.keys(LAB.state.devices).length, l: LAB.state.links.length,
    err: !document.getElementById('err').hidden, scrollX: document.documentElement.scrollWidth > window.innerWidth + 1, issues: LAB.index.issues.map(i => i.level + ': ' + i.msg),
    col: Object.fromEntries(Object.keys(LAB.state.devices).map(n => [n, LAB.mapCol(n)])),
    x: Object.fromEntries([...document.querySelectorAll('svg.map .dev')].map(g => [g.dataset.dev, g.getBoundingClientRect().x])) }));
  ok(boot.devs === boot.n && boot.n >= 60 && boot.n <= 90, 'example drawn: ' + boot.devs + ' boxes for ' + boot.n + ' devices');
  ok(boot.links === boot.l && boot.l > 150, boot.links + ' lines for ' + boot.l + ' cables');
  ok(!boot.err && !boot.scrollX, 'no error banner and no horizontal overflow at 390 px');
  console.log('  example issues:'); boot.issues.forEach(i => console.log('     ' + i));
  ok(boot.issues.length === 2, 'only the two intentional issues');
  const cols = [0, 1, 2, 3, 4].map(c => Object.keys(boot.col).filter(n => boot.col[n] === c));
  console.log('     columns: ' + cols.map(c => c.length).join(' / '));
  ok(['wall-1', 'ups-1', 'strip-1', 'pdu-1'].every(n => boot.col[n] === 0) && ['sw-lab-1', 'server-lab'].every(n => boot.col[n] === 4) && boot.col['psu-01'] === 1 && boot.col['board-01'] === 2 && boot.col['unit-01'] === 2 && boot.col['usbserial-01'] === 3, 'map columns: power, supplies, devices, adapters, network');
  const maxX = c => Math.max(...cols[c].map(n => boot.x[n])), minX = c => Math.min(...cols[c].map(n => boot.x[n]));
  ok([0, 1, 2, 3].every(c => maxX(c) < minX(c + 1)), 'each column is drawn left of the next one');

  console.log('2. Routes and power');
  const routes = await page.evaluate(() => {
    const L = LAB;
    return { r1: L.routesFrom('board-01:uart0').map(L.routeText), rA: L.routesFrom('unit-01:can-a').map(L.routeText), rB: L.routesFrom('unit-01:can-b').map(L.routeText),
      pdu: L.cascade(new Set(['pdu-1'])), ups: L.cascade(new Set(['ups-1'])), up: L.chainsUp('unit-01').map(c => c.slice().reverse().map(l => l.a).join(' > ')), sw: L.switchesOf('unit-01'), rf: L.routesFrom('board-01:rf-tx').map(L.routeText) };
  });
  console.log('     ' + routes.r1.join('\n     '));
  ok(routes.r1.length === 1 && /usbserial-\d+:uart0 · usbserial-\d+:usb1 → usbhub-2:p\d · usbhub-2:up → server-lab:usb\d$/.test(routes.r1[0]), 'board-01 console reaches the server through adapter and hub');
  ok(routes.rA.length === 3 && routes.rA.every(t => /busA-/.test(t) && !/busB-|can-b/.test(t)), 'bus A reaches 3 nodes and never touches bus B');
  ok(routes.rB.length === 3 && routes.rB.every(t => /busB-/.test(t) && !/busA-|can-a/.test(t)), 'bus B likewise');
  ok(routes.rf.length === 1 && /comb-01:in1 · comb-01:sum → inst-02:rf-in$/.test(routes.rf[0]), 'a 3-port adapter is crossed only through its common port', routes.rf.join(' | '));
  console.log('     chain: ' + routes.up.join(' | '));
  ok(routes.up.length === 1 && /^wall-1:out\d > ups-1:out\d > strip-\d:out\d > pdu-1:out1 > psu-01:ch1 > dist24-01:out1$/.test(routes.up[0]), 'chain wall → UPS → strip → PDU → supply → distribution box → unit');
  ok(routes.sw.join() === 'pdu-1:out1', 'unit-01 is switched by ' + routes.sw.join());
  ok(['psu-01', 'dist24-01', 'unit-01', 'unit-02', 'unit-03', 'usbhub-1'].every(n => routes.pdu.down.includes(n)) && !routes.pdu.down.includes('server-lab'), 'switching the PDU off takes down supply, distribution box and units');
  ok(!routes.ups.down.includes('server-lab') && routes.ups.degraded.includes('server-lab'), 'switching the UPS off does not take down the dual-fed server');

  console.log('3. Catalog port types and pure functions');
  const pure = await page.evaluate(() => {
    const L = LAB, txt = 'p[1-24] rj45\nsfp[1-4] sfp\nmgmt iface\nbusA-[1-4] can\neth1.901 iface\nfa0/[1-48] rj45', ports = L.parsePorts(txt);
    return { layers: ['eth', 'sfp', 'rj45', 'power-in', 'dc-out', 'uart', 'rs232', 'rs422', 'ttl', 'can', 'canfd', 'zigbee', 'thread', 'wifi', 'ble', 'jtag', 'usb', 'hdmi', 'pal', 'dvi', 'rf', 'gpio', 'relay-out', 'something odd'].map(L.layerOf).join(' '),
      alias: L.parsePorts('a Serial\nb rs-232\nc com\nd RS232').map(p => p.kind).join(), unknown: L.parsePorts('x something-odd')[0].unknown === true, virt: ports.filter(p => p.virtual).length,
      net: ['rj45', 'sfp', 'wifi', 'iface', 'ac-in', 'ac-out', 'dc-in', 'dc-out', 'usb', 'uart', 'zigbee'].map(k => +L.isNetKind(k)).join(''),
      nports: ports.length, round: L.portsToText(ports) === txt, names: L.genNames('board-{nn}', 2).join(','), cable: L.nextCableId('net'), pcable: L.nextCableId('power'), free: L.intToIp(L.freeIp('LAB')),
      sug: [L.suggestPorts('rj45', 4, new Set()), L.suggestPorts('can', 2, new Set()), L.suggestPorts('jtag', 1, new Set()), L.suggestPorts('usb', 2, new Set(['usb1'])), L.suggestPorts('relay-out', 8, new Set())].map(a => a.join('|')).join(' ; ') };
  });
  ok(pure.layers === 'net net net power power serial serial serial serial bus bus radio radio radio radio jtag usb video video video rf discrete power other', 'every type (or alias) maps to its layer', pure.layers);
  ok(pure.alias === 'rs232,rs232,rs232,rs232' && pure.unknown, '"Serial", "rs-232" and "com" are stored as rs232');
  ok(pure.net === '11110000000', 'only rj45, sfp, wifi and iface take network data');
  ok(pure.nports === 82 && pure.round && pure.virt === 2, 'ports as text with ranges, there and back');
  ok(pure.sug === 'eth[0-3] rj45 ; can[0-1] can ; jtag jtag ; usb[2-3] usb ; out[1-8] relay-out', 'recommended names per type', pure.sug);
  ok(pure.names === 'board-08,board-09' && /^N-\d{3}$/.test(pure.cable) && /^P-\d{3}$/.test(pure.pcable) && pure.free === '10.20.10.2', 'automatic numbering; the first free IP skips the gateway');

  console.log('4. Interaction: sheet, user, edit mode, wizards, undo');
  await page.screenshot({ path: path.join(SHOTS, 'map-390.png') });
  await page.evaluate(() => { const g = [...document.querySelectorAll('svg.map .dev')].find(x => x.dataset.dev === 'board-01'); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForSelector('#dlg-back:not([hidden])');
  await page.waitForTimeout(350);
  const sheet = await page.evaluate(() => ({ t: document.getElementById('dlg-t').textContent, rows: document.querySelectorAll('#dlg-b tr.pr').length, hl: document.querySelectorAll('svg.map .lk.hl').length, fits: document.getElementById('dlg').getBoundingClientRect().bottom <= window.innerHeight + 1 && document.getElementById('dlg').getBoundingClientRect().top >= 0,
    txt: document.getElementById('dlg-b').textContent, ths: document.querySelectorAll('#dlg-b th').length, edHidden: getComputedStyle(document.querySelector('#dlg-f .ed')).display === 'none', web: [...document.querySelectorAll('#dlg-b a')].map(a => a.textContent + ' ' + a.getAttribute('href')).join(' | ') }));
  ok(sheet.t === 'board-01' && sheet.rows >= 8 && sheet.hl >= 5 && /Powered from/.test(sheet.txt) && sheet.ths === 5, 'board-01 sheet: ports, power chain and highlighted cables');
  ok(/Switched by: pdu-2:out\d/.test(sheet.txt) && /pdu-2 admin http:\/\/10\.20\.10\.\d+/.test(sheet.web), 'the sheet says which outlet switches it, with a link to the PDU', sheet.web);
  ok(sheet.fits && sheet.edHidden, 'the dialog fits the screen; no edit buttons in view mode');
  await page.click('#dlg-b tr.pr[data-p="uart0"]');
  ok(await page.evaluate(() => /Full route/.test(document.getElementById('dlg-b').textContent) && /server-lab:usb/.test(document.getElementById('dlg-b').textContent)), 'tapping a port unfolds the full route');
  await page.screenshot({ path: path.join(SHOTS, 'sheet-390.png') });
  await page.click('[data-act="dlg-close"]');
  await page.click('#tabs [data-tab="devices"]');
  await page.fill('#dq', 'wall-1');
  await page.waitForFunction(() => document.querySelectorAll('#dev-list .item').length === 1 && document.querySelector('#dev-list .item').dataset.dev === 'wall-1');
  await page.click('#dev-list .item');
  ok(await page.evaluate(() => [...document.querySelectorAll('#dlg-b th')].map(t => t.textContent).join() === 'Port,Connection,Cable'), 'a device without network ports shows no IP and VLAN columns');
  await page.click('[data-act="dlg-close"]');
  ok(await page.evaluate(() => LAB.commit('x', () => {}) === false), 'nothing can be changed outside edit mode');
  await page.click('#b-edit');
  ok(await page.evaluate(() => document.getElementById('dlg-t').textContent === 'User' && document.querySelector('#dlg-b input').placeholder === 'jsmith' && !LAB.net.editing), 'the first edit asks for the user name');
  await page.fill('#dlg-b input[data-f="user"]', 'JSmith@example.com');
  await page.click('#dlg-f [data-act="save"]');
  await page.waitForFunction(() => LAB.net.editing);
  ok(await page.evaluate(() => LAB.ui.user === 'jsmith' && localStorage.getItem('labmap.user') === 'jsmith'), 'the user name is normalised (jsmith) and remembered');
  await page.click('#t-devices [data-act="add-dev"]');
  await page.selectOption('#dlg-b select[data-f="tpl"]', 'eval-board');
  ok(await page.evaluate(() => /evb-01/.test(document.getElementById('w-prev').textContent) && document.querySelectorAll('#w-ports .pbox').length === 19 && document.querySelector('#dlg-b input[data-f="f|model"]').value === 'Example EVB'), 'wizard: template applied (19 ports, model, name evb-01)');
  await page.selectOption('#dlg-b select[data-f="addType"]', 'rs232');
  await page.fill('#dlg-b input[data-f="addQty"]', '2');
  await page.click('#dlg-b [data-act="w-add"]');
  ok(await page.evaluate(() => /\nrs232-\[1-2\] rs232$/.test(document.querySelector('#dlg-b textarea').value) && document.querySelectorAll('#w-ports .pbox').length === 21), 'adding ports by type uses the recommended name (rs232-[1-2] rs232)');
  await page.click('#w-ports [data-p="dc-in"]');
  ok(await page.evaluate(() => !document.querySelector('#dlg-b input[data-f="meta|dc-in|ip"]') && document.querySelector('#dlg-b input[data-f="meta|dc-in|notes"]').value === '12 V barrel jack'), 'a dc-in port takes only notes (and inherits the template note)');
  await page.click('#w-ports [data-p="eth0"]');
  await page.selectOption('#dlg-b select[data-f="meta|eth0|vlan"]', 'TEST-A');
  await page.click('#dlg-b [data-act="w-free"][data-p="eth0"]');
  const ipNew = await page.inputValue('#dlg-b input[data-f="meta|eth0|ip"]');
  ok(/^192\.168\.50\.\d+$/.test(ipNew) && !/\.6\d$/.test(ipNew), 'the "free" button proposes ' + ipNew);
  const txt0 = await page.inputValue('#dlg-b textarea');
  await page.fill('#dlg-b textarea', txt0 + '\nodd made-up-type');
  await page.click('#dlg-f [data-act="save"]');
  ok(await page.evaluate(() => !LAB.state.devices['evb-01'] && /not in the catalog/.test(document.getElementById('toast').textContent)), 'a port type that is not in the catalog cannot be saved');
  await quiet(page);
  await page.fill('#dlg-b textarea', txt0);
  await page.click('#dlg-f [data-act="save"]');
  await page.waitForFunction(() => !!LAB.state.devices['evb-01']);
  await page.click('#dlg-f [data-act="link"]');
  const lk = await page.evaluate(() => ({ t: document.getElementById('dlg-t').textContent, a: document.querySelector('#dlg-b select[data-f="a|dev"]').value, ap: document.querySelector('#dlg-b select[data-f="a|port"]').value, b: document.querySelector('#dlg-b select[data-f="b|dev"]').value }));
  ok(lk.t === 'New cable' && lk.a === 'evb-01' && lk.ap === '' && lk.b === '', '"+ Cable" on the sheet opens the wizard with From = that device');
  await page.click('#dlg-b [data-act="w-sc"][data-k="sw"]');
  const prop = await page.evaluate(() => ({ ap: document.querySelector('#dlg-b select[data-f="a|port"]').value, bdev: document.querySelector('#dlg-b select[data-f="b|dev"]').value, bport: document.querySelector('#dlg-b select[data-f="b|port"]').value, id: document.querySelector('#dlg-b input[data-f="id"]').value }));
  ok(prop.ap === 'eth0' && /^sw-lab-\d$/.test(prop.bdev) && /^p\d+$/.test(prop.bport) && /^N-\d{3}$/.test(prop.id), 'the "Device → switch" shortcut proposes port, switch and free port', JSON.stringify(prop));
  await page.click('#dlg-f [data-act="save"]');
  await page.waitForFunction(() => LAB.state.links.some(l => l.a === 'evb-01:eth0'));
  const mism = await page.evaluate(() => { const n = LAB.index.issues.length; LAB.commit('test: USB to JTAG', s => s.links.push({ id: 'X-900', type: 'usb', a: 'pc-01:usb3', b: 'evb-01:jtag', notes: '' })); return { before: n, after: LAB.index.issues.length, has: LAB.index.issues.some(i => i.code === 'types' && i.level === 'warn') }; });
  ok(mism.has && mism.after > mism.before, 'joining USB to JTAG is allowed and only raises a warning');
  const val = await page.evaluate(() => { LAB.commit('test', s => { const d = s.devices['evb-01'], e = d.ports.find(p => p.name === 'eth0'); e.ip = '192.168.50.65'; e.mac = s.devices['board-01'].ports[0].mac; d.ports.find(p => p.name === 'dc-in').ip = '1.2.3.4'; }); const c = LAB.index.issues.map(i => i.level + ':' + i.code); return { range: c.includes('warn:ip-range'), mac: c.includes('err:mac-dup'), nonet: c.includes('warn:net-on-non-net'), st: LAB.ipInfo('TEST-A', LAB.ipToInt('192.168.50.65')).state }; });
  ok(val.range && val.mac && val.nonet && val.st === 'conf', 'validation: IP in a reserved range, duplicate MAC, network data on a non-network port');
  await quiet(page);
  await page.click('#dlg-f [data-act="edit"]');
  await page.fill('#dlg-b textarea[data-f="portsText"]', 'usb-uart usb\njtag jtag\ndc-in dc-in');
  await page.click('#dlg-f [data-act="save"]');
  const conf = await page.evaluate(() => ({ t: document.getElementById('dlg-t').textContent, msg: document.getElementById('dlg-b').textContent, still: LAB.state.devices['evb-01'].ports.length }));
  ok(conf.t === 'Confirm' && /orphan/.test(conf.msg) && conf.still === 21, 'removing a cabled port asks first', conf.msg);
  await page.click('#dlg-f [data-act="ok"]');
  await page.waitForFunction(() => LAB.state.devices['evb-01'].ports.length === 3 && !LAB.state.links.some(l => l.a === 'evb-01:eth0'));
  await page.click('#toast [data-act="undo"]');
  ok(await page.evaluate(() => LAB.state.devices['evb-01'].ports.length === 21 && LAB.state.links.some(l => l.a === 'evb-01:eth0')), 'undo brings ports and cable back');
  const log = await page.evaluate(() => ({ n: LAB.state.log.length, rev: LAB.state.rev, last: LAB.state.log[LAB.state.log.length - 1] }));
  ok(log.n >= 6 && log.last.rev === log.rev && log.last.by === 'jsmith' && !!log.last.t, 'every change is logged with the user', JSON.stringify(log.last));
  await page.click('[data-act="dlg-close"]');
  const rel = await page.evaluate(() => {
    const T = LAB.state.catalog.templates, mk = (k, extra) => Object.assign({ types: T[k].types.slice(), ports: LAB.parsePorts(T[k].ports.join('\n')).map(p => ({ name: p.name, kind: p.kind })), expectedPower: T[k].power, admin: T[k].admin }, extra || {});
    LAB.commit('test: relays and debug adapter', s => {
      s.devices['relay-09'] = mk('relay-board'); s.devices['dut-01'] = mk('dut', { project: 'ALPHA' }); s.devices['dbg-01'] = mk('debug-adapter', { project: 'ALPHA' });
      s.devices['relay-09'].ports[0].ip = '10.20.10.77'; s.devices['relay-09'].ports[0].vlan = 'LAB';
      s.links.push({ id: 'P-901', type: 'power', a: 'strip-1:out6', b: 'relay-09:ac-in', notes: '' }, { id: 'P-902', type: 'power', a: 'psu-01:ch2', b: 'relay-09:in1', notes: '' }, { id: 'P-903', type: 'power', a: 'relay-09:out1', b: 'dut-01:dc-in', notes: '' },
        { id: 'N-901', type: 'net', a: 'relay-09:eth0', b: 'sw-lab-2:p22', notes: '' }, { id: 'X-901', type: 'other', a: 'dut-01:debug', b: 'dbg-01:dut', notes: '' }, { id: 'N-902', type: 'net', a: 'dbg-01:eth0', b: 'sw-lab-2:p21', notes: '' }, { id: 'S-901', type: 'serial', a: 'dbg-01:rs232-1', b: 'pc-01:usb4', notes: '' });
    });
    const lk = id => LAB.state.links.find(l => l.id === id);
    return { up: LAB.chainsUp('dut-01').map(c => c.slice().reverse().map(l => l.a).join(' > ')), sw: LAB.switchesOf('dut-01').join(), cutIn: LAB.cascade(new Set(), new Set([lk('P-902')])).down.join(), cutCard: LAB.cascade(new Set(['relay-09'])).down.join(), cutSupply: LAB.cascade(new Set(), new Set([lk('P-901')])).down.join(), fromSw: LAB.routesFrom('sw-lab-2:p21').map(LAB.routeText) };
  });
  console.log('     ' + rel.up.join(' | '));
  ok(rel.up.length === 1 && /pdu-1:out1 > psu-01:ch2 > relay-09:out1$/.test(rel.up[0]) && rel.sw === 'relay-09:out1', 'relay board: the DUT chain follows contact 1 up to the supply; it is switched by relay-09:out1');
  ok(rel.cutIn === 'dut-01' && rel.cutCard === 'dut-01' && rel.cutSupply === 'dut-01,relay-09', 'cutting the relay inlet or switching the board off takes the DUT down', [rel.cutIn, rel.cutCard, rel.cutSupply].join(' / '));
  ok(rel.fromSw.length === 1 && /dbg-01:eth0 · dbg-01:dut → dut-01:debug$/.test(rel.fromSw[0]), 'debug adapter: switch → adapter → DUT, not mixed with its RS-232', rel.fromSw.join(' | '));
  await quiet(page);

  console.log('5. IPs: netmask, gateway, DNS and large subnets');
  await page.click('#tabs [data-tab="ips"]');
  const ips = await page.evaluate(() => ({ vlan: LAB.ui.vlan, cells: document.querySelectorAll('.ipg .ipc').length, fixed: document.querySelectorAll('.ipc.s-fixed').length, noted: document.querySelectorAll('.ipc.s-noted').length, mask: document.getElementById('msk').textContent, txt: document.getElementById('ips').textContent, scrollX: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  ok(ips.vlan === 'LAB' && ips.cells === 256 && ips.fixed > 15 && ips.noted >= 52 && !ips.scrollX, '/24 grid for LAB: ' + ips.fixed + ' on ports, ' + ips.noted + ' noted');
  ok(ips.mask === '255.255.255.0' && /10\.20\.10\.1 – 10\.20\.10\.254/.test(ips.txt) && /Gateway\s*10\.20\.10\.1/.test(ips.txt) && /DNS\s*10\.20\.0\.53, 10\.20\.0\.54/.test(ips.txt), 'dotted netmask, usable range, gateway and DNS are shown');
  await page.screenshot({ path: path.join(SHOTS, 'ips-390.png') });
  await page.click('#ips [data-act="ip-give"]');
  const give = await page.inputValue('#dlg-b input[data-f="from"]');
  await page.click('#dlg-b [data-act="next"]');
  const give2 = await page.inputValue('#dlg-b input[data-f="from"]');
  ok(give === '10.20.10.2' && give2 !== give && (await page.inputValue('#dlg-b input[data-f="who"]')) === 'jsmith', '"Give me an IP" proposes ' + give + ' then ' + give2 + ', for the current user');
  await page.click('#dlg-f [data-act="note"]');
  ok(await page.evaluate(ip => LAB.state.ipUse.some(e => e.from === ip && e.who === 'jsmith'), give2), 'the IP is noted in ipUse');
  const nUse = await page.evaluate(() => LAB.state.ipUse.length);
  await quiet(page);
  await page.click('#ips [data-act="ipuse-del"][data-i="' + (nUse - 1) + '"]');
  ok(await page.evaluate(n => LAB.state.ipUse.length === n - 1, nUse), 'deleting an IP note is one tap');
  await page.click('.ipc[data-ip="' + (10 * 16777216 + 20 * 65536 + 10 * 256 + 1) + '"]');
  ok(await page.evaluate(() => /arping -D -c 3 -I eth0 10\.20\.10\.1/.test(document.getElementById('cmd').textContent) && /VLAN gateway/.test(document.getElementById('dlg-b').textContent)), 'address detail: gateway and the arping command');
  await page.click('[data-act="dlg-close"]');
  await page.click('#ips [data-act="vlan"][data-v="TEST-C"]');
  ok(await page.evaluate(() => document.getElementById('msk').textContent === '255.255.255.192' && /62 usable/.test(document.getElementById('ips').textContent) && document.querySelectorAll('.ipg .ipc').length === 64), 'a /26 shows 255.255.255.192, 62 usable and its grid');
  await page.click('#ips [data-act="vlan"][data-v="INSTR"]');
  const instr = await page.evaluate(() => ({ blocks: document.querySelectorAll('#ips [data-act="ip-block"]').length, cells: document.querySelectorAll('.ipg .ipc').length, mask: document.getElementById('msk').textContent }));
  ok(instr.blocks === 4 && instr.cells === 256 && instr.mask === '255.255.252.0', 'INSTR (/22): grid in 4 blocks of 256');
  await page.click('#ips [data-act="ip-block"]:nth-of-type(2)');
  ok(await page.evaluate(() => document.querySelectorAll('.ipc.s-noted').length === 10), 'block 10.40.1.x shows the noted range');
  await quiet(page);
  await page.click('#ips [data-act="vlan"][data-v="TEST-A"]');
  await page.click('#ips .row [data-act="vlan-edit"]');
  await page.fill('#dlg-b input[data-f="dns"]', '192.168.50.1');
  await page.click('#dlg-f [data-act="save"]');
  ok(await page.evaluate(() => LAB.state.vlans['TEST-A'].dns === '192.168.50.1' && /DNS\s*192\.168\.50\.1/.test(document.getElementById('ips').textContent)), 'the DNS of a VLAN can be noted');

  console.log('6. Catalog and layers: templates, import and export');
  await quiet(page);
  await page.click('#tabs [data-tab="catalog"]');
  const cat = await page.evaluate(() => ({ tpl: document.querySelectorAll('#cat .list .item').length, types: document.querySelectorAll('#cat table tbody tr').length }));
  ok(cat.tpl === NT + 5 && cat.types === NP, 'Catalog tab: ' + cat.tpl + ' templates and ' + cat.types + ' port types');
  await page.screenshot({ path: path.join(SHOTS, 'catalog-390.png') });
  await page.click('#cat [data-act="import"]');
  const ex = await page.inputValue('#imp');
  ok(/\n  example:\n    label: "Example name"/.test(ex) && ['types:', 'model:', 'pattern:', 'power:', 'admin:', 'notes:', 'ports:', 'meta:', 'portTypes:', 'alias:'].every(k => ex.includes(k)), 'importing templates starts from an editable example with every field');
  await page.fill('#imp', ex.replace('example:', 'scope4:').replace('Example name', 'Test oscilloscope').replace('"usb[1-2] usb"', '"ch[1-4] bnc"'));
  await page.click('#dlg-f [data-act="go"]');
  const merged = await page.evaluate(() => ({ t: LAB.state.catalog.templates.scope4, p: !!LAB.state.catalog.portTypes['example-type'], n: Object.keys(LAB.state.catalog.templates).length, k: LAB.kindKey('other-name'), kinds: LAB.parsePorts(LAB.state.catalog.templates.scope4.ports.join('\n')).map(p => p.kind).join() }));
  ok(merged.t && merged.t.label === 'Test oscilloscope' && merged.t.meta.eth0.services === 'http, ssh' && merged.p && merged.n === NT + 6 && merged.k === 'example-type' && merged.kinds === 'rj45,rf,rf,rf,rf,ac-in', 'the edited example is imported: new template (alias bnc → rf) and new type');
  await quiet(page);
  await page.click('#tabs [data-tab="devices"]');
  await page.fill('#dq', 'dio-01');
  await page.waitForFunction(() => document.querySelectorAll('#dev-list .item').length === 1 && document.querySelector('#dev-list .item').dataset.dev === 'dio-01');
  await page.click('#dev-list .item');
  await page.click('#dlg-f [data-act="tpl"]');
  await page.click('#dlg-f [data-act="save"]');
  ok(await page.evaluate(() => { const t = LAB.state.catalog.templates.dio; return !!t && t.ports.join('|') === 'eth0 rj45|k[1-8] discrete|ac-in ac-in' && t.pattern === 'dio-{nn}' && t.meta.eth0.services === 'http, modbus'; }), '"To template" creates a template from a real device, with its services');
  await page.click('[data-act="dlg-close"]');
  await quiet(page);
  await page.click('#tabs [data-tab="data"]');
  await page.screenshot({ path: path.join(SHOTS, 'data-390.png') });
  await page.click('#dat [data-act="export"][data-k="lab"]');
  const yLab = await page.inputValue('#exp');
  await page.click('[data-act="dlg-close"]');
  await page.click('#dat [data-act="export"][data-k="cat"]');
  const yCat = await page.inputValue('#exp');
  await page.click('[data-act="dlg-close"]');
  ok(/^# LABMAP DATABASE · lab/.test(yLab) && /\n  board-01:\n    types: \[board\]/.test(yLab) && !/portTypes:/.test(yLab) && /^# LABMAP DATABASE · catalog/.test(yCat) && /\nportTypes:/.test(yCat) && !/devices:/.test(yCat), 'two separate layers are exported: lab.yaml and catalog.yaml');
  const nDev = await page.evaluate(() => Object.keys(LAB.state.devices).length);
  await page.click('#dat [data-act="import"][data-k="lab"]');
  await page.fill('#imp', 'devices:\n  nas-01:\n    types: [server]\n    ports:\n      - { name: eth0, kind: ethernet, ip: "10.20.10.90", vlan: LAB }\n      - { name: ac-in, kind: power-in }\nlinks:\n  - { id: N-777, type: net, a: "nas-01:eth0", b: "sw-lab-2:p20" }\n');
  await page.click('#dlg-f [data-act="go"]');
  const impAdd = await page.evaluate(() => ({ d: LAB.state.devices['nas-01'], n: Object.keys(LAB.state.devices).length, l: LAB.state.links.some(x => x.id === 'N-777'), keptCat: !!LAB.state.catalog.templates.scope4 }));
  ok(impAdd.d && impAdd.d.ports[0].kind === 'rj45' && impAdd.d.ports[1].kind === 'ac-in' && impAdd.n === nDev + 1 && impAdd.l && impAdd.keptCat, 'importing devices and cables (add): nas-01 comes in with its cable and aliases converted');
  await quiet(page);
  await page.click('#dat [data-act="import"][data-k="lab"]');
  await page.selectOption('#dlg-b select[data-f="mode"]', 'replace');
  await page.fill('#imp', yLab);
  await page.click('#dlg-f [data-act="go"]');
  ok(await page.evaluate(n => !LAB.state.devices['nas-01'] && Object.keys(LAB.state.devices).length === n && !!LAB.state.catalog.templates.scope4, nDev), 'importing the exported lab (replace) restores it and leaves the catalog alone');
  await quiet(page);
  await page.click('#dat [data-act="import"][data-k="lab"]');
  await page.fill('#imp', yCat);
  await page.click('#dlg-f [data-act="go"]');
  ok(await page.evaluate(() => /This is a catalog/.test(document.getElementById('toast').textContent)), 'importing the wrong layer is refused with a clear message');
  await page.click('[data-act="dlg-close"]');
  await quiet(page);

  console.log('7. Map: layers, project, search; short texts');
  await page.click('#tabs [data-tab="map"]');
  await page.selectOption('#f-proj', 'ALPHA');
  const fproj = await page.evaluate(() => [...document.querySelectorAll('svg.map .dev')].map(g => g.dataset.dev));
  ok(fproj.includes('unit-01') && fproj.includes('server-lab') && fproj.includes('pdu-1') && !fproj.includes('board-01') && !fproj.includes('usbserial-08'), 'project filter: ALPHA and what it connects to (' + fproj.length + ' devices)');
  await page.selectOption('#f-proj', '');
  await page.click('#layers [data-l="power"]');
  ok(await page.evaluate(() => document.querySelectorAll('svg.map .lk.ln-power').length === 0 && document.querySelectorAll('svg.map .lk').length > 100), 'switching the power layer off removes its lines');
  await page.click('#layers [data-act="layers-all"]');
  await page.fill('#q', '02:00:00:00:00:01');
  await page.waitForFunction(() => document.querySelectorAll('svg.map .dev.hitq').length >= 1);
  await page.fill('#q', '');
  const longest = await page.evaluate(() => { let max = ''; for (const t of ['map', 'devices', 'cables', 'power', 'ips', 'issues', 'catalog', 'data']) { LAB.setTab(t); for (const p of document.querySelectorAll('#t-' + t + ' p.mut, #notice-t, #map-hint')) if (p.textContent.length > max.length) max = p.textContent; } LAB.setTab('map'); return max; });
  ok(longest.length <= 80, 'no on-screen help text is longer than 80 characters', longest.length + ': ' + longest);
  const idle = await page.evaluate(() => new Promise(r => { LAB.net.lastAct = Date.now() - 601000; setTimeout(() => r({ editing: LAB.net.editing, toast: document.getElementById('toast').textContent }), 5600); }));
  ok(!idle.editing && /10 minutes/.test(idle.toast), 'edit mode closes itself after 10 idle minutes');
  ok(errors.length === 0, 'no console errors', errors.join(' | '));

  console.log('7b. Trunks, VLAN members, cables in bulk, labels and map exports');
  await quiet(page);
  await page.click('#b-edit');
  await page.waitForFunction(() => LAB.net.editing);
  const trunk = await page.evaluate(() => {
    LAB.commit('test: trunk', s => {
      const T = s.devices['sw-lab-1'].ports, p = T[T.length - 1]; p.vlan = 'LAB'; p.vlans = ['TEST-A', 'TEST-B'];
      s.devices['pp-a'] = { types: ['other'], ports: LAB.parsePorts('p[1-6] rj45').map(x => ({ name: x.name, kind: x.kind })) };
      s.devices['pp-b'] = { types: ['other'], ports: LAB.parsePorts('p[1-6] rj45').map(x => ({ name: x.name, kind: x.kind })) };
      s.devices['pp-a'].ports[0].vlan = 'LAB'; s.devices['pp-b'].ports[0].vlan = 'TEST-A'; s.devices['pp-b'].ports[1].vlan = 'LAB';
      s.links.push({ id: 'N-950', type: 'net', a: 'pp-a:p1', b: 'pp-b:p1', notes: '' });
    });
    const T = LAB.state.devices['sw-lab-1'].ports, ref = 'sw-lab-1:' + T[T.length - 1].name, y = LAB.toYaml(LAB.state);
    const back = LAB.normalize(LAB.parseYaml(y)).devices['sw-lab-1'].ports.slice(-1)[0].vlans;
    const mis = LAB.index.issues.filter(i => i.code === 'vlan-mismatch').map(i => i.msg);
    LAB.setTab('ips'); LAB.ui.vlan = 'TEST-A'; LAB.setTab('ips');
    const txt = document.getElementById('ips').textContent;
    return { ref, yaml: /vlans: \[TEST-A, TEST-B\]/.test(y), back: (back || []).join(), mis, members: /Members of TEST-A \(\d+\)/.test(txt), tagged: [...document.querySelectorAll('#ips .item')].some(i => i.textContent.includes(ref) && /tagged/.test(i.textContent)) };
  });
  ok(trunk.yaml && trunk.back === 'TEST-A,TEST-B', 'a trunk port keeps its tagged VLANs in lab.yaml');
  ok(trunk.members && trunk.tagged, 'the IPs tab lists the members of a VLAN, the trunk as "tagged"');
  ok(trunk.mis.length === 1 && /N-950/.test(trunk.mis[0]), 'a cable between two different access VLANs is warned', trunk.mis.join(' | '));
  await page.evaluate(() => LAB.setTab('cables'));
  const nl = await page.evaluate(() => LAB.state.links.length);
  await page.click('#t-cables [data-act="add-link"]');
  await page.selectOption('#dlg-b select[data-f="a|dev"]', 'pp-a');
  await page.selectOption('#dlg-b select[data-f="a|port"]', 'p2');
  await page.selectOption('#dlg-b select[data-f="b|dev"]', 'pp-b');
  await page.selectOption('#dlg-b select[data-f="b|port"]', 'p2');
  await page.fill('#dlg-b input[data-f="count"]', '4');
  await page.dispatchEvent('#dlg-b input[data-f="count"]', 'change');
  await page.waitForFunction(() => /cables/.test(document.getElementById('w-warn').textContent), null, { timeout: 3000 }).catch(() => {});
  const wtxt = await page.evaluate(() => document.getElementById('w-warn').textContent);
  ok(/4 cables/.test(wtxt) && /pp-a:p5 ↔ pp-b:p5/.test(wtxt), 'bulk cabling previews 4 cables on consecutive ports', wtxt);
  await page.click('#dlg-f [data-act="save"]');
  const bulk = await page.evaluate(n => ({ n: LAB.state.links.length - n, pairs: LAB.state.links.slice(-4).map(l => l.a + '-' + l.b).join(), ids: new Set(LAB.state.links.map(l => l.id)).size === LAB.state.links.length, last: LAB.state.log[LAB.state.log.length - 1].msg }), nl);
  ok(bulk.n === 4 && bulk.pairs === 'pp-a:p2-pp-b:p2,pp-a:p3-pp-b:p3,pp-a:p4-pp-b:p4,pp-a:p5-pp-b:p5' && bulk.ids && /^4 cables/.test(bulk.last), '"How many: 4" adds 4 cables with their own ids, in one logged change', bulk.last);
  await quiet(page);
  await page.click('#t-cables [data-act="add-link"]');
  await page.selectOption('#dlg-b select[data-f="a|dev"]', 'pp-a');
  await page.selectOption('#dlg-b select[data-f="b|dev"]', 'pp-b');
  await page.click('#dlg-f [data-act="next"]');
  const nxt = await page.evaluate(n => ({ n: LAB.state.links.length - n, open: document.getElementById('dlg-t').textContent, a: document.querySelector('#dlg-b select[data-f="a|port"]').value }), nl);
  ok(nxt.n === 5 && nxt.open === 'New cable' && nxt.a === '', '"Connect + next" saves and keeps the wizard open for the next pair', JSON.stringify(nxt));
  await page.click('[data-act="dlg-close"]');
  await quiet(page);
  await page.fill('#cq', 'pp-a');
  await page.click('#t-cables [data-act="export"][data-k="labels"]');
  const csv = await page.inputValue('#exp');
  await page.click('[data-act="dlg-close"]');
  await page.fill('#cq', '');
  const rows = csv.trim().split(/\r?\n/);
  ok(rows[0] === 'id,layer,from_device,from_port,to_device,to_port,notes' && rows.length === 7 && rows.slice(1).every(r => /,net,pp-a,p\d,pp-b,p\d,$/.test(r)), 'Labels CSV: one row per shown cable (filter applied)', rows.length + ' rows');
  ok(await page.evaluate(() => LAB.labelsCsv([{ id: 'X-1', type: 'other', a: 'a:b', b: 'c:d', notes: 'say "hi", ok' }]).split('\r\n')[1] === 'X-1,other,a,b,c,d,"say ""hi"", ok"'), 'CSV quotes commas and quotes');
  const ex2 = await page.evaluate(() => {
    LAB.ui.layers.net = false; LAB.ui.project = 'ALPHA';
    const svg = LAB.exportMapSvg(), doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const rep = LAB.reportHtml(), rd = new DOMParser().parseFromString(rep, 'text/html');
    return { ok: !doc.querySelector('parsererror'), devs: doc.querySelectorAll('.dev').length, lks: doc.querySelectorAll('.lk').length, n: Object.keys(LAB.state.devices).length, l: LAB.state.links.length, vars: /var\(--/.test(svg), style: /<style>/.test(svg),
      rsvg: rd.querySelectorAll('svg').length, rrows: [...rd.querySelectorAll('table')].map(t => t.tBodies[0].rows.length).join(), undo: (LAB.ui.layers.net = true, LAB.ui.project = '') };
  });
  ok(ex2.ok && ex2.devs === ex2.n && ex2.lks === ex2.l && !ex2.vars && ex2.style, 'Map SVG: valid, self-contained, the whole lab whatever the filters (' + ex2.devs + ' devices, ' + ex2.lks + ' cables)');
  ok(ex2.rsvg === 1 && ex2.rrows.split(',')[0] === String(ex2.n) && ex2.rrows.split(',')[1] === String(ex2.l), 'Report HTML: the map and the tables of devices, cables, VLANs and IP notes', ex2.rrows);
  await page.evaluate(() => { LAB.setTab('data'); });
  ok(await page.evaluate(() => !!document.querySelector('#dat [data-k="svg"]') && !!document.querySelector('#dat [data-k="report"]') && !document.querySelector('#dat [data-act="backups"]')), 'Data tab: Map SVG and Report HTML; no Backups in local mode');
  ok(errors.length === 0, 'no console errors', errors.join(' | '));

  console.log('8. Desktop, dark theme; home network, example button and load at scale 4');
  const desk = await open(base + '/index.html#ips', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await loadExample(desk);
  ok(await desk.evaluate(() => LAB.ui.tab === 'ips' && document.querySelectorAll('.ipg .ipc').length === 256), 'the page honours #ips');
  await desk.evaluate(() => { LAB.ui.fit = true; LAB.setTab('map'); });
  await desk.screenshot({ path: path.join(SHOTS, 'map-full.png'), fullPage: true });
  await desk.evaluate(() => { LAB.ui.fit = false; LAB.setTab('power'); });
  await desk.screenshot({ path: path.join(SHOTS, 'power-1280-dark.png') });
  const home = await desk.evaluate(() => {
    const y = ['vlans:', '  HOME: { id: 1, subnet: "192.168.1.0/24", gateway: "192.168.1.1", dns: "192.168.1.1", scope: local }', 'devices:',
      '  router:', '    types: [router, switch, ap]', '    expectedPower: ups', '    admin: "http://{ip}"', '    ports:', '      - { name: wan, kind: rj45 }', '      - { name: lan1, kind: rj45, ip: "192.168.1.1", vlan: HOME }', '      - { name: lan2, kind: rj45 }', '      - { name: wifi, kind: wifi }', '      - { name: dc-in, kind: dc-in }',
      '  ups-dc:', '    types: [ups]', '    ports:', '      - { name: ac-in, kind: ac-in }', '      - { name: out1, kind: dc-out }', '      - { name: out2, kind: dc-out }',
      '  living-room-socket:', '    types: [wall]', '    ports:', '      - { name: out1, kind: ac-out }',
      '  nas:', '    types: [server]', '    ports:', '      - { name: eth0, kind: rj45 }',
      '  homeassistant:', '    types: [server]', '    expectedPower: ups', '    ports:', '      - { name: eth0, kind: rj45 }', '      - { name: usb1, kind: usb }', '      - { name: dc-in, kind: dc-in }',
      '  zigbee-hub:', '    types: [radiohub]', '    ports:', '      - { name: usb1, kind: usb }', '      - { name: zigbee, kind: zigbee }', '      - { name: thread, kind: thread }',
      '  living-room-bulb:', '    types: [sensor]', '    ports:', '      - { name: zigbee, kind: zigbee }',
      '  door-sensor:', '    types: [sensor]', '    ports:', '      - { name: zigbee, kind: zigbee }',
      '  thermostat:', '    types: [sensor]', '    ports:', '      - { name: thread, kind: thread }',
      '  garden-camera:', '    types: [sensor]', '    ports:', '      - { name: wifi, kind: wifi }',
      'links:', '  - { id: P-001, type: power, a: "living-room-socket:out1", b: "ups-dc:ac-in" }', '  - { id: P-002, type: power, a: "ups-dc:out1", b: "router:dc-in" }', '  - { id: P-003, type: power, a: "ups-dc:out2", b: "homeassistant:dc-in" }',
      '  - { id: N-001, type: net, a: "nas:eth0", b: "router:lan1" }', '  - { id: N-002, type: net, a: "homeassistant:eth0", b: "router:lan2" }', '  - { id: U-001, type: usb, a: "zigbee-hub:usb1", b: "homeassistant:usb1" }',
      '  - { id: W-001, type: radio, a: "living-room-bulb:zigbee", b: "zigbee-hub:zigbee" }', '  - { id: W-002, type: radio, a: "door-sensor:zigbee", b: "zigbee-hub:zigbee" }', '  - { id: W-003, type: radio, a: "thermostat:thread", b: "zigbee-hub:thread" }', '  - { id: W-004, type: radio, a: "garden-camera:wifi", b: "router:wifi" }'].join('\n');
    LAB.load(LAB.parseYaml(y)); LAB.setTab('map');
    return { boxes: document.querySelectorAll('svg.map .dev').length, lines: document.querySelectorAll('svg.map .lk').length, issues: LAB.index.issues.map(i => i.msg), down: LAB.cascade(new Set(['ups-dc'])).down.join(), gw: LAB.ipInfo('HOME', LAB.ipToInt('192.168.1.1')).state };
  });
  ok(home.boxes === 10 && home.lines === 10 && home.down === 'homeassistant,router' && home.gw === 'fixed' && home.issues.length === 0, 'a home network written in YAML: 10 devices, 10 links, no issues; UPS off takes down router and Home Assistant', home.issues.join(' | '));
  await desk.screenshot({ path: path.join(SHOTS, 'home-1280.png') });
  await desk.evaluate(() => { LAB.ui.user = 'test'; });
  await desk.click('#b-edit');
  await desk.evaluate(() => LAB.setTab('data'));
  await desk.click('#dat [data-act="example"]');
  await desk.click('#dlg-f [data-act="ok"]');
  await desk.waitForFunction(() => Object.keys(LAB.state.devices).length === 9 && !!LAB.state.devices['usbserial-01']);
  ok(await desk.evaluate(() => LAB.index.issues.length === 0 && LAB.routesFrom('board-01:uart0').map(LAB.routeText).join() === 'board-01:uart0 → usbserial-01:uart0 · usbserial-01:usb1 → pc-01:usb1' && LAB.cascade(new Set(['strip-1'])).down.join() === 'board-01,pc-01,router-1,sw-1'), '"Load example" loads the small demo lab: 9 devices, no issues, console route and power cascade');
  await desk.screenshot({ path: path.join(SHOTS, 'example-1280.png') });
  const big = fixture(4);
  const load = await desk.evaluate(y => { LAB.setTab('map'); const t0 = performance.now(); const st = LAB.parseYaml(y); st.catalog = JSON.parse(JSON.stringify(LAB.state.catalog)); const n = LAB.normalize(st); const t1 = performance.now(); LAB.replaceState(n, 'load x4'); const t2 = performance.now();
    return { n: Object.keys(n.devices).length, l: n.links.length, parse: Math.round(t1 - t0), commit: Math.round(t2 - t1), boxes: document.querySelectorAll('svg.map .dev').length, yamlKb: Math.round(y.length / 1024) }; }, big);
  console.log('     scale 4: ' + JSON.stringify(load));
  ok(load.boxes === load.n && load.commit < 3000 && load.parse < 3000, 'scale 4 (' + load.n + ' devices, ' + load.l + ' cables): YAML read in ' + load.parse + ' ms, full change in ' + load.commit + ' ms');
  ok(errors.length === 0, 'no console errors', errors.join(' | '));

  console.log('9. Real server (server.py) with two browsers');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'labmap-'));
  for (const f of ['index.html', 'app.js', 'server.py']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  for (const d of ['defaults', 'example']) { fs.mkdirSync(path.join(tmp, d)); for (const f of fs.readdirSync(path.join(ROOT, d))) fs.copyFileSync(path.join(ROOT, d, f), path.join(tmp, d, f)); }
  const DATA = path.join(tmp, 'data-do-not-edit');
  const port = 18000 + Math.floor(Math.random() * 2000), srvUrl = 'http://127.0.0.1:' + port;
  const start = () => spawn('python3', [path.join(tmp, 'server.py'), '--port', String(port), '--host', '127.0.0.1'], { stdio: 'ignore' });
  const waitUp = async () => { for (let i = 0; i < 60; i++) { try { await fetch(srvUrl + '/api/rev'); return; } catch (e) { await sleep(100); } } };
  let py = start(); await waitUp();
  ok(fs.existsSync(path.join(DATA, 'lab.yaml')) && fs.readFileSync(path.join(DATA, 'catalog.yaml'), 'utf8') === catTxt, 'first run creates data-do-not-edit/ with an empty lab and the default catalog');
  const ready = () => window.LAB && window.LAB.net.mode === 'server';
  const A = await open(srvUrl + '/', { viewport: { width: 1280, height: 900 } }, ready);
  const B = await open(srvUrl + '/', { viewport: { width: 390, height: 844 } }, ready);
  const a0 = await A.evaluate(() => ({ chip: document.getElementById('st-store').textContent, n: Object.keys(LAB.state.devices).length, tpl: Object.keys(LAB.state.catalog.templates).length, notice: document.getElementById('notice').hidden }));
  ok(/^server · rev 0/.test(a0.chip) && a0.n === 0 && a0.tpl === NT && a0.notice, 'the page starts empty against the server, with the catalog loaded', JSON.stringify(a0));
  await A.evaluate(() => { LAB.ui.user = 'ann'; }); await B.evaluate(() => { LAB.ui.user = 'bob'; });
  await A.click('#b-edit');
  await A.waitForFunction(() => LAB.net.editing);
  await A.click('#t-map [data-act="add-dev"]');
  await A.selectOption('#dlg-b select[data-f="tpl"]', 'switch-8');
  await A.click('#dlg-f [data-act="save"]');
  await A.waitForFunction(() => !!LAB.state.devices['sw-1'] && !LAB.net.saving && LAB.net.rev === 1);
  const disk = fs.readFileSync(path.join(DATA, 'lab.yaml'), 'utf8');
  ok(/^rev: 1$/m.test(disk) && /\n  sw-1:\n/.test(disk) && /by: ann/.test(disk) && fs.readdirSync(path.join(DATA, 'backups')).some(f => /^lab-rev000000-/.test(f)), 'the new device is saved at once in data-do-not-edit/lab.yaml (rev 1, user ann), with a backup of the previous version');
  await B.click('#b-edit');
  await B.waitForFunction(() => !document.getElementById('toast').hidden);
  ok(await B.evaluate(() => !LAB.net.editing && /Editing: ann/.test(document.getElementById('toast').textContent)), 'a second user cannot edit: "Editing: ann"');
  await B.waitForFunction(() => !!LAB.state.devices['sw-1'], null, { timeout: 15000 });
  ok(await B.evaluate(() => /rev 1/.test(document.getElementById('st-store').textContent) && document.querySelectorAll('svg.map .dev').length === 1), 'the second browser gets the change on its own (polling every 8 s)');
  await A.evaluate(() => document.querySelector('#toast').hidden = true);
  await A.click('[data-act="dlg-close"]');
  await A.click('#b-edit');
  await A.waitForFunction(() => !LAB.net.editing);
  await sleep(1300);
  await B.evaluate(() => document.querySelector('#toast').hidden = true);
  await B.click('#b-edit');
  await B.waitForFunction(() => LAB.net.editing, null, { timeout: 8000 });
  await B.evaluate(() => LAB.commit('Test VLAN', s => { s.vlans.LAB = { id: 10, subnet: '10.0.0.0/24', gateway: '', dns: '', scope: 'local', notes: '' }; s.catalog.templates.x = { label: 'X', types: ['other'], model: '', pattern: 'x-{nn}', power: 'none', admin: '', notes: '', ports: ['eth0 rj45'], meta: {} }; }));
  await B.waitForFunction(() => LAB.net.rev === 2 && !LAB.net.saving);
  const disk2 = { lab: fs.readFileSync(path.join(DATA, 'lab.yaml'), 'utf8'), cat: fs.readFileSync(path.join(DATA, 'catalog.yaml'), 'utf8') };
  ok(/^rev: 2$/m.test(disk2.lab) && /by: bob/.test(disk2.lab) && /\n  x:\n    label: X\n/.test(disk2.cat) && fs.readdirSync(path.join(DATA, 'backups')).some(f => /^catalog-rev000001-/.test(f)), 'once the lock is released the other user edits; a catalog change goes to catalog.yaml, with its backup');
  const put = base2 => A.evaluate(async b => { const r = await fetch('api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: 2, base: b, holder: 'zzz', by: 'zzz', lab: 'rev: 2\ndevices:\n', cat: '' }) }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, rev: j.rev }; }, base2);
  ok((await put(1)).s === 423, 'saving without holding the lock is refused (423)');
  await B.click('#b-edit');
  await B.waitForFunction(() => !LAB.net.editing);
  await sleep(1300);
  const stale = await put(1);
  ok(stale.s === 409 && stale.rev === 2, 'saving from an old revision is refused (409) and returns the current one');
  const blocked = await A.evaluate(async () => (await Promise.all(['server.py', 'data-do-not-edit/lab.yaml', 'data-do-not-edit/backups/', '.git/config', 'tools/test.js', 'README.md'].map(u => fetch(u).then(r => r.status)))).join());
  ok(blocked === '404,404,404,404,404,404', 'the server serves only the page, the default catalog and the example', blocked);
  const api = q => A.evaluate(async u => { const r = await fetch(u); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }, q);
  const bl = await api('api/backups'), bad1 = await api('api/backup?file=../lab.yaml'), bad2 = await api('api/backup?file=lab-rev000099-20000101T000000.yaml');
  const names = (bl.j.backups || []).map(b => b.layer + b.rev).join();
  ok(bl.s === 200 && names === 'lab1,catalog1,lab0' || names === 'catalog1,lab1,lab0', 'the server lists its backups, newest first', names);
  ok(bad1.s === 400 && bad2.s === 404, 'a backup is read only by its exact name, from the backups folder');
  await A.evaluate(() => { document.querySelector('#toast').hidden = true; LAB.setTab('data'); });
  await A.click('#b-edit');
  await A.waitForFunction(() => LAB.net.editing);
  await A.click('#dat [data-act="backups"]');
  await A.waitForFunction(() => document.querySelectorAll('#dlg-b .item [data-act="restore"]').length === 3);
  await A.evaluate(() => [...document.querySelectorAll('#dlg-b .item')].find(i => /^labrev 1/.test(i.textContent)).querySelector('[data-act="restore"]').click());
  await A.waitForFunction(() => document.getElementById('dlg-t').textContent === 'Confirm');
  await A.click('#dlg-f [data-act="ok"]');
  await A.waitForFunction(() => LAB.net.rev === 3 && !LAB.net.saving);
  const rst = await A.evaluate(() => ({ vl: Object.keys(LAB.state.vlans).join(), sw: !!LAB.state.devices['sw-1'], tplx: !!LAB.state.catalog.templates.x, msg: LAB.state.log[LAB.state.log.length - 1].msg, dlg: document.getElementById('dlg-back').hidden }));
  ok(rst.vl === '' && rst.sw && rst.tplx && /Lab restored from the backup of rev 1/.test(rst.msg) && /^rev: 3$/m.test(fs.readFileSync(path.join(DATA, 'lab.yaml'), 'utf8')), 'restoring a lab backup from the web is a normal change (rev 3, logged); the catalog stays', JSON.stringify(rst));
  py.kill(); await sleep(400);
  await A.evaluate(() => LAB.commit('Change while the server is down', s => { s.devices['sw-1'].notes = 'offline'; }));
  await A.waitForFunction(() => LAB.net.saveMsg === 'not saved', null, { timeout: 8000 });
  const off = await A.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return { notice: document.getElementById('notice-t').textContent, ask: e.defaultPrevented, editing: LAB.net.editing }; });
  ok(/^Not saved yet/.test(off.notice) && off.ask && off.editing, 'server down: the change is kept, the page says so and asks before closing', off.notice);
  py = start(); await waitUp();
  await A.waitForFunction(() => LAB.net.rev === 4 && !LAB.net.saving && !LAB.net.saveMsg, null, { timeout: 20000 });
  ok(/notes: offline/.test(fs.readFileSync(path.join(DATA, 'lab.yaml'), 'utf8')) && await A.evaluate(() => /^Editing as ann/.test(document.getElementById('notice-t').textContent)), 'when the server is back the change is saved by itself (rev 4)');
  await A.click('#b-edit');
  await A.waitForFunction(() => !LAB.net.editing);
  const other = path.join(tmp, 'elsewhere', 'labdata'), port2 = port + 1;
  fs.mkdirSync(path.dirname(other));
  const py2 = spawn('python3', [path.join(tmp, 'server.py'), '--port', String(port2), '--host', '127.0.0.1', '--data', other], { stdio: 'ignore' });
  let r2 = null; for (let i = 0; i < 60 && !r2; i++) { try { r2 = await (await fetch('http://127.0.0.1:' + port2 + '/api/state')).json(); } catch (e) { await sleep(100); } }
  py2.kill();
  ok(r2 && r2.rev === 0 && fs.existsSync(path.join(other, 'lab.yaml')) && fs.existsSync(path.join(other, 'catalog.yaml')) && fs.existsSync(path.join(other, 'backups')), '--data keeps the data in another folder (e.g. another disk)');
  const labNow = fs.readFileSync(path.join(DATA, 'lab.yaml'), 'utf8');
  fs.writeFileSync(path.join(DATA, 'lab.yaml'), labNow.replace(/^rev: 4$/m, 'rev: 9').replace(/^format: 1$/m, 'format: 2'));
  const D = await open(srvUrl + '/', { viewport: { width: 1280, height: 900 } }, () => window.LAB && LAB.net.mode === 'server');
  await D.evaluate(() => { LAB.ui.user = 'dan'; document.getElementById('err').hidden = true; });
  await D.click('#b-edit');
  await sleep(300);
  const ro = await D.evaluate(() => ({ editing: LAB.net.editing, notice: document.getElementById('notice-t').textContent, err: document.getElementById('err').hidden ? '' : document.getElementById('err').textContent }));
  ok(!ro.editing && /newer Labmap \(format 2/.test(ro.notice) && /Read-only/.test(ro.notice), 'data from a newer format: read-only, with the reason; edit mode refused', ro.notice);
  await sleep(1300);
  const old = await D.evaluate(async () => { await fetch('api/lock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ holder: 'old', by: 'old', ttlMs: 5000 }) }); const r = await fetch('api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: 10, base: 9, holder: 'old', by: 'old', lab: 'rev: 10\nformat: 1\ndevices:\n', cat: '' }) }); const j = await r.json(); await fetch('api/lock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ holder: 'old', by: 'old', ttlMs: 1 }) }); return r.status + ' ' + j.error; });
  ok(/^400 older data format/.test(old) && /^format: 2$/m.test(fs.readFileSync(path.join(DATA, 'lab.yaml'), 'utf8')), 'the server refuses to overwrite newer-format data from older code', old);
  fs.writeFileSync(path.join(DATA, 'lab.yaml'), labNow);
  await A.waitForFunction(() => LAB.net.rev === 4 && !LAB.net.blocked, null, { timeout: 15000 }).catch(() => {});
  ok(await A.evaluate(() => LAB.net.rev === 4 && !LAB.net.blocked), 'once the data is readable again the page recovers by itself');
  await A.evaluate(() => { const e = document.getElementById('err'); if (e) e.hidden = true; });
  py.kill(); await sleep(400);
  fs.writeFileSync(path.join(tmp, 'app.js'), fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').replace(/const VERSION = '[^']+';/, "const VERSION = '9.9.9';"));
  fs.writeFileSync(path.join(tmp, 'defaults', 'catalog.yaml'), 'portTypes: {}\ntemplates: {}\n');
  py = start(); await waitUp();
  const C = await open(srvUrl + '/', { viewport: { width: 1280, height: 900 } }, ready);
  const c0 = await C.evaluate(() => ({ ver: LAB.VERSION, rev: LAB.state.rev, ports: LAB.state.devices['sw-1'] ? LAB.state.devices['sw-1'].ports.length : 0, tplx: !!LAB.state.catalog.templates.x, tpls: Object.keys(LAB.state.catalog.templates).length, log: LAB.state.log.map(e => e.by).join() }));
  ok(c0.ver === '9.9.9' && c0.rev === 4 && c0.ports === 10 && c0.tplx && c0.tpls === NT + 1 && c0.log === 'ann,bob,ann,ann', 'after replacing the code and restarting, the data is intact: rev 4, the switch, the catalog and the log', JSON.stringify(c0));
  await C.screenshot({ path: path.join(SHOTS, 'server-1280.png') });
  py.kill();
  ok(errors.length === 0, 'no console errors', errors.join(' | '));

  await browser.close(); server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? '\n' + fails + ' TESTS FAILED' : '\nAll tests passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
