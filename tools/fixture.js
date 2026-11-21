#!/usr/bin/env node
/* Test fixture: a synthetic lab of about 70 devices and 160 cables, generic on purpose.
   Usage:  node tools/fixture.js [scale]        prints the lab as YAML
           node tools/fixture.js --catalog      prints the extra templates the tests use
   With scale 2, 4, 8... the five projects are repeated with new numbering and the
   infrastructure grows on its own (switches, PDUs, strips, hubs), for load tests.
   It is not shipped as data: the page starts empty and example/lab.yaml is the demo.
   Intentional issues: a duplicate IP, a board with no power cable, and TEST-B on the
   isolated GOLF switch (missing uplink). networks() holds the VLAN cases. */
'use strict';
const fs = require('fs'), path = require('path');
const LAB = require(path.join(__dirname, '..', 'app.js'));
/* Templates the tests need on top of defaults/catalog.yaml. */
const EXTRA = { templates: {
  'eval-board': { label: 'Evaluation board', types: ['board'], model: 'Example EVB', pattern: 'evb-{nn}', power: 'dc', ports: ['dc-in dc-in', 'eth0 rj45', 'sfp[0-3] sfp', 'usb-uart usb', 'usb-jtag usb', 'jtag jtag', 'usb1 usb', 'dp1 displayport', 'hdmi-out hdmi', 'hdmi-in hdmi', 'can0 can', 'pmod[0-1] discrete', 'fmc[0-1] other', 'aux other'], meta: { 'dc-in': { notes: '12 V barrel jack' } } },
  'relay-board': { label: 'Ethernet relay board, 8 relays', types: ['relay'], pattern: 'relay-{nn}', power: 'wall', admin: 'http://{ip}', ports: ['eth0 rj45', 'ac-in ac-in', 'in[1-8] relay-in', 'out[1-8] relay-out'] },
  'dut': { label: 'Device under test', types: ['board'], pattern: 'dut-{nn}', power: 'dc', ports: ['dc-in dc-in', 'eth[0-3] rj45', 'debug debug'] },
  'debug-adapter': { label: 'Debug breakout adapter', types: ['adapter'], pattern: 'dbg-{nn}', power: 'none', ports: ['dut debug', 'eth0 rj45', 'rs232-1 rs232', 'jtag jtag'] },
  'switch-48': { label: 'Managed switch, 48 ports', types: ['switch'], pattern: 'sw-{nn}', power: 'ups', admin: 'https://{ip}', ports: ['p[1-48] rj45', 'up[1-2] rj45', 'sfp[1-2] sfp', 'console rs232', 'mgmt iface', 'ac-in ac-in'] }
} };
const DEFAULTS = LAB.normCatalog(LAB.parseYaml(fs.readFileSync(path.join(__dirname, '..', 'defaults', 'catalog.yaml'), 'utf8')));
Object.assign(DEFAULTS.templates, LAB.normCatalog(EXTRA).templates);
LAB.setCatalog0(DEFAULTS);
if (process.argv[2] === '--catalog') { process.stdout.write(LAB.toCatalogYaml(LAB.normCatalog(EXTRA))); process.exit(0); }
const SCALE = Math.max(1, +process.argv[2] || 1);
const S = { rev: 1, vlans: {}, devices: {}, links: [], ipUse: [], log: [] };

/* ---------- helpers ---------- */
const PRE = { net: 'N', power: 'P', serial: 'S', jtag: 'J', usb: 'U', video: 'V', bus: 'B', rf: 'R', radio: 'W', discrete: 'D', other: 'X' };
const pad = (n, w) => String(n).padStart(w, '0');
const cnt = {}, cab = {};
const nn = (base, w = 2) => { cnt[base] = (cnt[base] || 0) + 1; return base + '-' + pad(cnt[base], w); };
let macN = 0;
const mac = () => { macN++; return '02:00:00:' + [macN >> 16, (macN >> 8) & 255, macN & 255].map(x => pad(x.toString(16), 2)).join(':'); };
function link(type, a, b, notes) {
  if (!a || !b) return;
  cab[type] = (cab[type] || 0) + 1;
  S.links.push({ id: PRE[type] + '-' + pad(cab[type], 3), type, a, b, notes: notes || '' });
}
function expand(spec) {
  const out = [];
  for (const line of spec) {
    const tk = line.split(/\s+/), kind = tk.slice(1).join(' ') || 'other';
    const m = /^(.*)\[(\d+)-(\d+)\](.*)$/.exec(tk[0]);
    const names = [];
    if (m) for (let i = +m[2]; i <= +m[3]; i++) names.push(m[1] + i + m[4]); else names.push(tk[0]);
    for (const name of names) out.push({ name, kind });
  }
  return out;
}
function dev(name, o) {
  S.devices[name] = {
    types: o.types, model: o.model || '', serial: o.serial || '', project: o.project || '', owner: o.owner || '',
    location: o.location || '', notes: o.notes || '', admin: o.admin || '', expectedPower: o.power || 'none', ports: expand(o.ports)
  };
  return name;
}
function port(ref) { const i = ref.indexOf(':'); return S.devices[ref.slice(0, i)].ports.find(p => p.name === ref.slice(i + 1)); }
const serial = () => 'SN' + pad(Math.floor(100000 + (macN * 7919 + Object.keys(S.devices).length * 104729) % 899999), 6);

/* ---------- VLANs and addresses ---------- */
S.vlans = {
  'LAB': { id: 110, subnet: '10.20.10.0/24', gateway: '10.20.10.1', dns: '10.20.0.53, 10.20.0.54', dhcp: '10.20.10.200-10.20.10.249', scope: 'it', notes: 'Lab VLAN, managed by IT.' },
  'TEST-A': { id: 901, subnet: '192.168.50.0/24', scope: 'local', notes: 'Radio tests. Exists only on the lab switches; no uplink, no DNS.' },
  'TEST-B': { id: 902, subnet: '192.168.60.0/24', gateway: '192.168.60.1', scope: 'local', notes: 'Control and sensor tests. Routed by the lab server (eth1.902).' },
  'TEST-C': { id: 903, subnet: '172.16.30.0/26', scope: 'local', notes: 'Video bench. Small subnet on purpose.' },
  'PROJ-D': { id: 340, subnet: '10.34.0.0/25', gateway: '10.34.0.1', scope: 'it', notes: 'Dedicated IT VLAN for one project.' },
  'INSTR': { id: 120, subnet: '10.40.0.0/22', gateway: '10.40.0.1', dns: '10.20.0.53', scope: 'it', notes: 'Shared building instrumentation.' },
  'GOLF-NET': { id: 950, subnet: '10.95.0.0/24', scope: 'local', notes: 'Project GOLF bench network, isolated. Same id as HOTEL-NET on purpose: separate networks.' },
  'HOTEL-NET': { id: 950, subnet: '10.95.0.0/24', scope: 'local', notes: 'Project HOTEL bench network, isolated. Same id and subnet as GOLF-NET, never joined.' }
};
const PFX = { 'LAB': '10.20.10.', 'TEST-A': '192.168.50.', 'TEST-B': '192.168.60.', 'TEST-C': '172.16.30.', 'PROJ-D': '10.34.0.', 'GOLF-NET': '10.95.0.', 'HOTEL-NET': '10.95.0.' };
const MAXH = { 'LAB': 199, 'TEST-A': 250, 'TEST-B': 99, 'TEST-C': 49, 'PROJ-D': 120, 'GOLF-NET': 250, 'HOTEL-NET': 250 };
const SKIP = { 'TEST-A': [60, 69], 'LAB': [150, 150] };
const hostN = { 'LAB': 9, 'TEST-A': 10, 'TEST-B': 20, 'TEST-C': 10, 'PROJ-D': 10, 'GOLF-NET': 10, 'HOTEL-NET': 10 };
function ipNext(vlan) {
  for (;;) {
    const h = ++hostN[vlan];
    if (h > MAXH[vlan]) return '';
    if (SKIP[vlan] && h >= SKIP[vlan][0] && h <= SKIP[vlan][1]) continue;
    return PFX[vlan] + h;
  }
}
S.ipUse = [
  { vlan: 'LAB', from: '10.20.10.150', who: 'mjones', notes: 'Test laptop, temporary' },
  { vlan: 'TEST-A', from: '192.168.50.60', to: '192.168.50.69', iface: 'board-01:eth0', who: 'Project BRAVO', notes: 'The board changes IP during the boot test' },
  { vlan: 'TEST-B', from: '192.168.60.100', to: '192.168.60.109', who: 'Project ALPHA', notes: 'Simulators on a laptop' },
  { vlan: 'TEST-C', from: '172.16.30.50', who: 'lgreen', notes: 'Laptop with the viewer' },
  { vlan: 'INSTR', from: '10.40.1.20', to: '10.40.1.29', who: 'Metrology', notes: 'Analysers on loan' },
  { vlan: 'INSTR', from: '10.40.2.5', who: 'jsmith', notes: 'Climate chamber' }
];

/* ---------- pools that grow on their own (outlets, switch ports, hub slots) ---------- */
const pools = {};
function pool(kind, make) { pools[kind] = { free: [], n: 0, make }; }
function alloc(kind) { const p = pools[kind]; if (!p.free.length) { p.n++; p.make(p, p.n); } return p.free.shift() || null; }
const outs = (name, pre, n) => Array.from({ length: n }, (_, i) => name + ':' + pre + (i + 1));
function power(src, dst, notes) { link('power', src, dst, notes); }
/* plugs a network port into a switch and sets VLAN, IP and MAC */
function net(ref, vlan, o) {
  o = o || {};
  const sw = alloc('sw'), p = port(ref);
  p.vlan = vlan; p.mac = mac();
  if (o.ip !== false) { const ip = o.ip || ipNext(vlan); if (ip) p.ip = ip; }
  if (o.services) p.services = o.services;
  if (sw) { port(sw).vlan = vlan; link('net', ref, sw, o.notes); }
  return ref;
}
let stripN = 0, pduN = 0, hubN = 0;

pool('wall', (p, n) => {
  const name = dev('wall-' + n, { types: ['wall'], location: 'Wall trunking', notes: 'Circuit C' + (2 + n), ports: ['out[1-4] ac-out'] });
  p.free = outs(name, 'out', 4);
});
pool('ups', (p, n) => {
  const name = dev('ups-' + n, { types: ['ups'], location: 'Central rack', power: 'wall', admin: 'http://{ip}', notes: 'About 12 min at half load', serial: serial(), ports: ['ac-in ac-in', 'out[1-4] ac-out', 'eth0 rj45', 'usb1 usb'] });
  p.free = outs(name, 'out', 4);
  power(alloc('wall'), name + ':ac-in');
  net(name + ':eth0', 'LAB', { services: 'http, snmp' });
});
pool('strip-ups', p => {
  const name = dev('strip-' + (++stripN), { types: ['strip'], location: 'Central rack', power: 'ups', notes: 'UPS protected', ports: ['ac-in ac-in', 'out[1-6] ac-out'] });
  p.free = outs(name, 'out', 6);
  power(alloc('ups'), name + ':ac-in');
});
pool('strip-wall', p => {
  const name = dev('strip-' + (++stripN), { types: ['strip'], location: 'Desk trunking', power: 'wall', notes: 'No UPS: desks', ports: ['ac-in ac-in', 'out[1-6] ac-out'] });
  p.free = outs(name, 'out', 6);
  power(alloc('wall'), name + ':ac-in');
});
for (const g of ['a', 'b']) pool('pdu-' + g, p => {              // two groups of benches, each with its PDUs
  const name = dev('pdu-' + (++pduN), { types: ['pdu'], location: 'Central rack', power: 'ups', admin: 'http://{ip}', serial: serial(), notes: 'Network-switched outlets', ports: ['ac-in ac-in', 'out[1-8] ac-out', 'eth0 rj45'] });
  p.free = outs(name, 'out', 8);
  power(alloc('strip-ups'), name + ':ac-in');
  net(name + ':eth0', 'LAB', { services: 'http, snmp' });
});
pool('sw', (p, n) => {
  const name = dev('sw-lab-' + n, { types: ['switch'], location: 'Central rack', power: 'ups', admin: 'https://{ip}', serial: serial(),
    notes: 'Managed switch. Test VLANs exist only here.', ports: ['p[1-24] rj45', 'sfp[1-4] sfp', 'mgmt iface', 'ac-in ac-in'] });
  p.free = outs(name, 'p', 22);
  const m = port(name + ':mgmt'); m.vlan = 'LAB'; m.ip = ipNext('LAB'); m.mac = mac(); m.services = 'https, ssh, snmp';
  power(alloc('ups'), name + ':ac-in');
  if (n === 1) {
    dev('it-socket-1', { types: ['other'], location: 'North wall', notes: 'Link to the corporate network (IT). Do not touch without notice.', ports: ['rj45 rj45'] });
    link('net', name + ':p24', 'it-socket-1:rj45', 'LAB VLAN uplink to IT');
    port(name + ':p24').vlan = 'LAB';
  } else if (n <= 5) {
    link('net', name + ':sfp1', 'sw-lab-1:sfp' + (n - 1), 'Trunk between switches (all VLANs)');
    for (const t of [name + ':sfp1', 'sw-lab-1:sfp' + (n - 1)]) { port(t).vlan = 'LAB'; port(t).vlans = ['TEST-A', 'TEST-B', 'TEST-C', 'PROJ-D']; }      // LAB untagged, the rest tagged
  }
});
pool('srvusb', p => { p.free = p.n === 1 ? outs('server-lab', 'usb', 8) : []; });
for (const g of ['a', 'b']) pool('hub-' + g, p => {
  const name = dev('usbhub-' + (++hubN), { types: ['hub'], location: 'Central rack', power: 'pdu', notes: 'Powered 7-port USB hub', ports: ['up usb', 'p[1-7] usb', 'dc-in dc-in'] });
  p.free = outs(name, 'p', 7);
  link('usb', name + ':up', alloc('srvusb'), 'Uplink to the lab server');
  power(alloc('pdu-' + g), name + ':dc-in', '5 V adapter');
});

/* ---------- fixed infrastructure ---------- */
pools.sw.free.unshift(alloc('sw'));                                // creates sw-lab-1 (and with it wall-1 and ups-1)
dev('server-lab', { types: ['server'], location: 'Central rack', power: 'ups', owner: 'lab', serial: serial(),
  notes: 'Shared serial consoles (ser2net) and remote JTAG (XVC). Two supplies: one on the UPS, one on the wall.',
  ports: ['eth[0-1] rj45', 'bmc rj45', 'usb[1-8] usb', 'ac-in[1-2] ac-in', 'vga vga', 'eth1.901 iface', 'eth1.902 iface', 'eth1.903 iface'] });
net('server-lab:eth0', 'LAB', { services: 'ssh, ser2net 2001-2032, xvc 2542-2549, tftp, nfs' });
net('server-lab:bmc', 'LAB', { services: 'https, ipmi' });
{ // trunk with the test VLANs
  const sw = alloc('sw'); link('net', 'server-lab:eth1', sw, '802.1Q trunk with TEST-A, TEST-B and TEST-C');
  port('server-lab:eth1').mac = mac(); port('server-lab:eth1').notes = 'Trunk; the IPs are on the eth1.90x interfaces';
  port(sw).notes = 'Trunk 901-903'; port(sw).vlans = ['TEST-A', 'TEST-B', 'TEST-C'];
  for (const [i, v] of [['901', 'TEST-A'], ['902', 'TEST-B'], ['903', 'TEST-C']]) { const p = port('server-lab:eth1.' + i); p.vlan = v; p.ip = PFX[v] + '1'; p.notes = 'Sub-interface of VLAN ' + i; }
}
power(alloc('ups'), 'server-lab:ac-in1');
power(alloc('strip-wall'), 'server-lab:ac-in2');
dev('radiohub-1', { types: ['radiohub'], location: 'Ceiling, centre', power: 'wall', admin: 'http://{ip}:8123', notes: 'Zigbee coordinator and Thread border router', ports: ['eth0 rj45', 'zigbee zigbee', 'thread thread', 'ble ble', 'dc-in dc-in'] });
net('radiohub-1:eth0', 'LAB', { services: 'http 8123, mqtt' });
power(alloc('strip-ups'), 'radiohub-1:dc-in', '5 V adapter');
dev('ap-lab-1', { types: ['ap'], location: 'Ceiling, centre', power: 'none', admin: 'https://{ip}', notes: 'PoE powered from the switch. Two SSIDs: lab (LAB) and radio tests (TEST-A)', ports: ['eth0 rj45', 'wifi wifi', 'wifi2 wifi', 'mgmt iface'] });
{ // the AP is managed: a trunk with LAB untagged and TEST-A tagged, one SSID per VLAN
  net('ap-lab-1:eth0', 'LAB', { notes: 'PoE, trunk', ip: false });
  const up = S.links[S.links.length - 1].b;
  for (const r of ['ap-lab-1:eth0', up]) port(r).vlans = ['TEST-A'];
  port('ap-lab-1:wifi').vlan = 'LAB'; port('ap-lab-1:wifi').notes = 'SSID lab';
  port('ap-lab-1:wifi2').vlan = 'TEST-A'; port('ap-lab-1:wifi2').notes = 'SSID radio-tests';
  const m = port('ap-lab-1:mgmt'); m.vlan = 'LAB'; m.ip = ipNext('LAB'); m.mac = mac(); m.services = 'https';
}

/* ---------- common pieces ---------- */
function pc(pr, loc, o) {
  const n = nn('pc');
  dev(n, { types: ['pc'], project: pr, location: loc, owner: o || '', power: 'wall', serial: serial(), ports: ['eth0 rj45', 'usb[1-6] usb', 'dp[1-2] displayport', 'ac-in ac-in'] });
  net(n + ':eth0', 'LAB', { services: 'ssh' });
  power(alloc('strip-wall'), n + ':ac-in');
  return n;
}
function psu(pr, loc, g) {
  const n = nn('psu');
  dev(n, { types: ['psu'], project: pr, location: loc, power: 'pdu', admin: 'http://{ip}', serial: serial(), notes: '3-channel bench supply, LAN control', ports: ['ac-in ac-in', 'ch[1-3] dc-out', 'eth0 rj45', 'usb1 usb'] });
  power(alloc('pdu-' + g), n + ':ac-in');
  net(n + ':eth0', 'LAB', { services: 'scpi 5025' });
  return n;
}
/* serial console of a device: USB-serial adapter → hub → server */
function consoleOf(pr, loc, g, ref, kind) {
  const n = nn('usbserial'), sp = kind === 'rs422' ? 'rs422-1' : 'uart0';
  dev(n, { types: ['adapter'], project: pr, location: loc, notes: 'USB-serial adapter', ports: ['usb1 usb', sp + ' ' + (kind === 'rs422' ? 'rs422' : 'uart')] });
  link('serial', ref, n + ':' + sp, kind === 'rs422' ? 'RS-422, 115200 8N1' : '3V3, 115200 8N1');
  link('usb', n + ':usb1', alloc('hub-' + g));
  return n;
}
function jtag(pr, loc, g, ref) {
  const n = nn('usbjtag');
  dev(n, { types: ['adapter'], project: pr, location: loc, notes: 'USB-JTAG probe, used remotely over XVC', ports: ['usb1 usb', 'jtag jtag'] });
  link('jtag', ref, n + ':jtag', '14-pin ribbon cable');
  link('usb', n + ':usb1', alloc('hub-' + g));
  return n;
}
const boardPorts = extra => ['eth0 rj45', 'uart0 uart', 'jtag jtag', 'usb1 usb', 'dc-in dc-in'].concat(extra || []);
const pname = (base, s) => s === 1 ? base : base + '-' + s;

/* ---------- ALPHA: control units on a dual CAN bus, RS-485 and discretes ---------- */
function alpha(s) {
  const pr = pname('ALPHA', s), loc = 'Bench 1', g = 'a', vl = 'TEST-B';
  const fu = psu(pr, loc, g);
  const dist = dev(nn('dist24'), { types: ['other'], project: pr, location: loc, power: 'dc', notes: '24 V distribution box with 5 A fuses', ports: ['dc-in dc-in', 'out[1-6] dc-out'] });
  power(fu + ':ch1', dist + ':dc-in', '24 V, 10 A limit');
  const cpl = dev(nn('canhub'), { types: ['bus'], project: pr, location: loc, notes: 'Dual CAN hub (bus A and bus B), terminated', ports: ['busA-[1-4] can', 'busB-[1-4] can'] });
  const ana = dev(nn('inst'), { types: ['instrument'], project: pr, location: loc, power: 'pdu', admin: 'http://{ip}', serial: serial(), notes: 'Bus analyser',
    ports: ['eth0 rj45', 'usb1 usb', 'ac-in ac-in', 'can-a can', 'can-b can', 'rs485-[1-2] rs485'] });
  power(alloc('pdu-' + g), ana + ':ac-in'); net(ana + ':eth0', 'LAB', { services: 'http' });
  link('bus', ana + ':can-a', cpl + ':busA-4', 'Bus A monitor'); link('bus', ana + ':can-b', cpl + ':busB-4', 'Bus B monitor');
  const eq = [1, 2, 3].map(i => {
    const e = dev(nn('unit'), { types: ['board'], project: pr, location: loc, power: 'dc', admin: 'http://{ip}', serial: serial(), owner: 'team-alpha', notes: 'Control unit, 24 V' + (i === 1 ? ' (bus master)' : ' (node ' + i + ')'),
      ports: ['dc-in dc-in', 'eth0 rj45', 'rs422-1 rs422', 'can-a can', 'can-b can', 'rs485-out rs485', 'rs485-in rs485', 'disc[1-4] discrete'] });
    power(dist + ':out' + i, e + ':dc-in'); net(e + ':eth0', vl, { services: 'ssh, http' });
    link('bus', e + ':can-a', cpl + ':busA-' + i, 'Bus A stub'); link('bus', e + ':can-b', cpl + ':busB-' + i, 'Bus B stub');
    consoleOf(pr, loc, g, e + ':rs422-1', 'rs422');
    return e;
  });
  link('serial', eq[0] + ':rs485-out', eq[1] + ':rs485-in', 'RS-485'); link('serial', eq[1] + ':rs485-out', eq[2] + ':rs485-in', 'RS-485');
  link('serial', eq[2] + ':rs485-out', ana + ':rs485-1', 'Listen only');
  const rel = dev(nn('dio'), { types: ['instrument'], project: pr, location: loc, power: 'pdu', admin: 'http://{ip}', notes: '8-channel LAN I/O module for discretes', ports: ['eth0 rj45', 'k[1-8] discrete', 'ac-in ac-in'] });
  power(alloc('pdu-' + g), rel + ':ac-in'); net(rel + ':eth0', 'LAB', { services: 'http, modbus' });
  eq.forEach((e, i) => { link('discrete', rel + ':k' + (2 * i + 1), e + ':disc1', 'Enable'); link('discrete', rel + ':k' + (2 * i + 2), e + ':disc2', 'Start'); });
  link('discrete', eq[0] + ':disc3', eq[1] + ':disc3', 'Interlock'); link('discrete', eq[1] + ':disc4', eq[2] + ':disc4', 'Interlock');
  const p = pc(pr, loc, 'team-alpha'); link('usb', ana + ':usb1', p + ':usb1', 'Local control of the analyser');
}

/* ---------- BRAVO: radio boards and RF instruments ---------- */
function bravo(s) {
  const pr = pname('BRAVO', s), loc = 'Bench 2', g = 'b', vl = 'TEST-A';
  const fu = psu(pr, loc, g);
  const pl = [1, 2].map(i => {
    const n = dev(nn('board'), { types: ['board'], project: pr, location: loc, power: 'dc', admin: 'http://{ip}', owner: 'team-bravo', serial: serial(), notes: 'FPGA/SoC board with radio front end', ports: boardPorts(['sfp0 sfp', 'rf-tx rf', 'rf-rx rf']) });
    power(fu + ':ch' + i, n + ':dc-in', '12 V'); net(n + ':eth0', vl, { services: 'ssh, iperf' });
    consoleOf(pr, loc, g, n + ':uart0'); jtag(pr, loc, g, n + ':jtag');
    return n;
  });
  const sa = dev(nn('inst'), { types: ['instrument'], project: pr, location: loc, power: 'pdu', admin: 'http://{ip}', serial: serial(), notes: 'Spectrum analyser', ports: ['eth0 rj45', 'usb1 usb', 'ac-in ac-in', 'rf-in rf', 'trig-in discrete'] });
  const sg = dev(nn('inst'), { types: ['instrument'], project: pr, location: loc, power: 'pdu', admin: 'http://{ip}', serial: serial(), notes: 'Signal generator', ports: ['eth0 rj45', 'usb1 usb', 'ac-in ac-in', 'rf-out rf', 'trig-out discrete'] });
  const osc = dev(nn('inst'), { types: ['instrument'], project: pr, location: loc, power: 'pdu', admin: 'http://{ip}', serial: serial(), notes: '4-channel oscilloscope', ports: ['eth0 rj45', 'usb1 usb', 'ac-in ac-in', 'ch[1-4] rf'] });
  for (const i of [sa, sg, osc]) { power(alloc('pdu-' + g), i + ':ac-in'); net(i + ':eth0', 'LAB', { services: 'http, scpi 5025' }); }
  const at1 = dev(nn('att'), { types: ['adapter'], project: pr, location: loc, notes: '30 dB fixed attenuator, 2 W', ports: ['in rf', 'out rf'] });
  const at2 = dev(nn('att'), { types: ['adapter'], project: pr, location: loc, notes: '10 dB fixed attenuator', ports: ['in rf', 'out rf'] });
  const cb = dev(nn('comb'), { types: ['adapter'], project: pr, location: loc, notes: '2-way combiner', ports: ['sum rf', 'in1 rf', 'in2 rf'] });
  link('rf', pl[0] + ':rf-tx', at1 + ':in', 'SMA, semi-rigid'); link('rf', at1 + ':out', cb + ':in1', 'SMA');
  link('rf', sg + ':rf-out', at2 + ':in', 'N to SMA, interferer'); link('rf', at2 + ':out', cb + ':in2', 'SMA');
  link('rf', cb + ':sum', sa + ':rf-in', 'SMA to N'); link('rf', pl[1] + ':rf-tx', pl[0] + ':rf-rx', 'SMA with 40 dB in-line attenuator');
  link('rf', pl[1] + ':rf-rx', osc + ':ch1', 'BNC, envelope only');
  link('discrete', sg + ':trig-out', sa + ':trig-in', 'BNC, sweep trigger');
  link('net', pl[0] + ':sfp0', 'sw-lab-' + Math.min(s, pools.sw.n) + ':sfp4', 'Multimode fibre LC-LC, 10 G data link');
  const p = pc(pr, loc, 'team-bravo'); link('usb', osc + ':usb1', p + ':usb1', 'USB-TMC'); link('usb', sg + ':usb1', p + ':usb2', 'USB-TMC'); link('usb', sa + ':usb1', p + ':usb3', 'USB-TMC');
}

/* ---------- CHARLIE: video (SDI, HDMI, CAN) ---------- */
function charlie(s) {
  const pr = pname('CHARLIE', s), loc = 'Bench 3', g = 'b', vl = 'TEST-C';
  const fu = psu(pr, loc, g);
  const mon = dev(nn('monitor'), { types: ['other'], project: pr, location: loc, power: 'pdu', notes: 'Reference monitor', ports: ['hdmi[1-2] hdmi', 'ac-in ac-in'] });
  power(alloc('pdu-' + g), mon + ':ac-in');
  const can = dev(nn('canbus'), { types: ['bus'], project: pr, location: loc, notes: 'CAN bus strip, 120 Ω termination at both ends', ports: ['can-[1-6] can'] });
  const pl = [1, 2].map(i => {
    const n = dev(nn('board'), { types: ['board'], project: pr, location: loc, power: 'dc', admin: 'http://{ip}', owner: 'team-charlie', serial: serial(), notes: 'Video processing board', ports: boardPorts(['sdi-in sdi', 'hdmi-out hdmi', 'can0 can']) });
    power(fu + ':ch' + i, n + ':dc-in', '12 V'); net(n + ':eth0', vl, { services: 'ssh, rtsp' });
    consoleOf(pr, loc, g, n + ':uart0');
    const c = dev(nn('cam'), { types: ['sensor'], project: pr, location: loc, power: 'none', admin: 'http://{ip}', serial: serial(), notes: 'Camera with SDI output, PoE powered', ports: ['eth0 rj45', 'sdi-out sdi'] });
    net(c + ':eth0', vl, { services: 'http, rtsp', notes: 'PoE' });
    link('video', c + ':sdi-out', n + ':sdi-in', '75 Ω coax, 3G-SDI'); link('video', n + ':hdmi-out', mon + ':hdmi' + i);
    link('bus', n + ':can0', can + ':can-' + i, 'CAN at 500 kbit/s');
    return n;
  });
  jtag(pr, loc, g, pl[0] + ':jtag');
  const plat = dev(nn('platform'), { types: ['board'], project: pr, location: loc, power: 'dc', admin: 'http://{ip}', serial: serial(), notes: 'Pan-tilt unit', ports: ['dc-in dc-in', 'eth0 rj45', 'can0 can', 'rs422-1 rs422'] });
  power(fu + ':ch3', plat + ':dc-in', '24 V'); net(plat + ':eth0', vl); link('bus', plat + ':can0', can + ':can-3', 'CAN at 500 kbit/s');
  pc(pr, loc, 'team-charlie');
}

/* ---------- DELTA: a project with its own VLAN ---------- */
function delta(s) {
  const pr = pname('DELTA', s), loc = 'Bench 4', g = 'a', vl = 'PROJ-D';
  const fu = psu(pr, loc, g);
  const p5 = dev(nn('board'), { types: ['board'], project: pr, location: loc, power: 'dc', admin: 'https://{ip}', owner: 'team-delta', serial: serial(), notes: 'FPGA/SoC board', ports: boardPorts() });
  power(fu + ':ch1', p5 + ':dc-in', '12 V'); net(p5 + ':eth0', vl, { services: 'ssh' });
  consoleOf(pr, loc, g, p5 + ':uart0'); jtag(pr, loc, g, p5 + ':jtag');
  const p6 = dev(nn('board'), { types: ['board'], project: pr, location: loc, power: 'dc', admin: 'https://{ip}', owner: 'team-delta', serial: serial(), notes: 'FPGA/SoC board, just arrived', ports: boardPorts() });
  net(p6 + ':eth0', vl, { services: 'ssh' });          // intentional issue: expects DC and has no power cable
  const e = dev(nn('unit'), { types: ['board'], project: pr, location: loc, power: 'dc', admin: 'https://{ip}', owner: 'team-delta', serial: serial(), notes: 'Control unit, 24 V',
    ports: ['dc-in dc-in', 'eth0 rj45', 'rs422-1 rs422', 'disc[1-4] discrete'] });
  power(fu + ':ch2', e + ':dc-in', '24 V'); net(e + ':eth0', vl, s === 1 ? { ip: port(p5 + ':eth0').ip } : {});   // intentional issue: duplicate IP
  const p = pc(pr, loc, 'team-delta');
  const ue = dev(nn('usbeth'), { types: ['adapter'], project: pr, location: loc, notes: 'Second network card of the PC, for the dedicated VLAN', ports: ['usb1 usb', 'eth0 rj45'] });
  link('usb', ue + ':usb1', p + ':usb2'); link('usb', fu + ':usb1', p + ':usb1', 'Local control of the supply'); net(ue + ':eth0', vl, { notes: 'Desk access to the dedicated VLAN' });
}

/* ---------- ECHO: wireless sensors ---------- */
function echo(s) {
  const pr = pname('ECHO', s), loc = 'Bench 5', g = 'a';
  const gw = dev(nn('board'), { types: ['board'], project: pr, location: loc, power: 'wall', admin: 'http://{ip}', owner: 'team-echo', serial: serial(), notes: 'Gateway under development with an 802.15.4 radio', ports: boardPorts(['radio0 zigbee']) });
  power(alloc('strip-ups'), gw + ':dc-in', '12 V adapter'); net(gw + ':eth0', 'TEST-B', { services: 'ssh, mqtt' });
  consoleOf(pr, loc, g, gw + ':uart0');
  link('radio', gw + ':radio0', 'radiohub-1:zigbee', 'Joined the Zigbee network as a router');
  for (let i = 0; i < 6; i++) { const n = dev(nn('sensor'), { types: ['sensor'], project: pr, location: loc, notes: ['Temperature and humidity', 'Door contact', 'Presence', 'Power meter', 'Vibration', 'Light level'][i] + ', battery', ports: ['zigbee zigbee'] }); link('radio', n + ':zigbee', 'radiohub-1:zigbee'); }
  for (let i = 0; i < 2; i++) { const n = dev(nn('bulb'), { types: ['sensor'], project: pr, location: loc, notes: 'Thread bulb for actuation tests', ports: ['thread thread'] }); link('radio', n + ':thread', 'radiohub-1:thread'); }
  const c = dev(nn('wificam'), { types: ['sensor'], project: pr, location: loc, power: 'wall', admin: 'http://{ip}', notes: 'Wi-Fi camera watching the bench', ports: ['wifi wifi', 'dc-in dc-in'] });
  port(c + ':wifi').ip = ipNext('LAB'); port(c + ':wifi').vlan = 'LAB'; port(c + ':wifi').mac = mac();
  link('radio', c + ':wifi', 'ap-lab-1:wifi', 'Lab SSID'); power(alloc('strip-ups'), c + ':dc-in', 'USB charger');
  const p = pc(pr, loc, 'team-echo'); link('usb', gw + ':usb1', p + ':usb1', 'Firmware download');
}

for (let s = 1; s <= SCALE; s++) { alpha(s); bravo(s); charlie(s); delta(s); echo(s); }

/* ---------- network cases (once): for the VLAN model and the VLAN map ---------- */
function networks() {
  /* a tablet on the second SSID: no VLAN set, it gets TEST-A from the AP */
  dev('tablet-01', { types: ['pc'], project: 'BRAVO', location: 'Bench 2', notes: 'Tablet with the radio test app', ports: ['wifi wifi'] });
  port('tablet-01:wifi').ip = ipNext('TEST-A'); port('tablet-01:wifi').mac = mac();
  link('radio', 'tablet-01:wifi', 'ap-lab-1:wifi2', 'SSID radio-tests');
  /* an unmanaged desk switch on a LAB port: what is behind it has no VLAN set and gets LAB */
  dev('desk-sw-1', { types: ['switch'], location: 'Desk 3', power: 'wall', notes: 'Unmanaged 5-port desk switch', ports: ['p[1-5] rj45', 'dc-in dc-in'] });
  power(alloc('strip-wall'), 'desk-sw-1:dc-in', '12 V adapter');
  { const sw = alloc('sw'); port(sw).vlan = 'LAB'; link('net', 'desk-sw-1:p1', sw, 'Desk switch uplink'); }
  for (const [n, pn] of [['laptop-dock-1', 'p2'], ['printer-1', 'p3']]) {
    dev(n, { types: [n === 'printer-1' ? 'other' : 'pc'], location: 'Desk 3', power: 'wall', notes: n === 'printer-1' ? 'Label printer' : 'Docking station of a laptop', ports: ['eth0 rj45', 'ac-in ac-in'] });
    port(n + ':eth0').ip = ipNext('LAB'); port(n + ':eth0').mac = mac();
    link('net', n + ':eth0', 'desk-sw-1:' + pn); power(alloc('strip-wall'), n + ':ac-in');
  }
  /* a hypervisor: LAB untagged, TEST-B and TEST-C tagged to its virtual machines */
  dev('hv-01', { types: ['server'], location: 'Central rack', power: 'ups', admin: 'https://{ip}', serial: serial(), notes: 'Hypervisor; its VMs use TEST-B and TEST-C tagged', ports: ['eth0 rj45', 'ac-in ac-in'] });
  net('hv-01:eth0', 'LAB', { services: 'https, ssh' });
  { const up = S.links[S.links.length - 1].b; for (const r of ['hv-01:eth0', up]) port(r).vlans = ['TEST-B', 'TEST-C']; }
  power(alloc('ups'), 'hv-01:ac-in');
  /* project GOLF: its own switch in another room, never cabled to the lab. TEST-B on it is
     meant to be the lab TEST-B (same name), but the uplink is missing: intentional issue.
     GOLF-NET reuses id 950 with HOTEL-NET: separate networks on purpose, no warning. */
  const golf = (sw, vl, room, devs) => {
    dev(sw, { types: ['switch'], location: room, power: 'wall', admin: 'https://{ip}', serial: serial(), notes: 'Managed 8-port switch of the project, not connected to the lab', ports: ['p[1-8] rj45', 'mgmt iface', 'ac-in ac-in'] });
    power(alloc('strip-wall'), sw + ':ac-in');
    devs.forEach(([n, v], i) => {
      dev(n, { types: ['board'], project: sw === 'sw-golf-1' ? 'GOLF' : 'HOTEL', location: room, power: 'wall', serial: serial(), notes: 'Board of the project', ports: ['eth0 rj45', 'dc-in dc-in'] });
      port(sw + ':p' + (i + 1)).vlan = v; port(n + ':eth0').ip = ipNext(v); port(n + ':eth0').mac = mac();
      link('net', n + ':eth0', sw + ':p' + (i + 1)); power(alloc('strip-wall'), n + ':dc-in', '12 V adapter');
    });
    const m = port(sw + ':mgmt'); m.vlan = vl; m.ip = ipNext(vl);
  };
  golf('sw-golf-1', 'GOLF-NET', 'Room G', [['golf-01', 'GOLF-NET'], ['golf-02', 'GOLF-NET'], ['golf-03', 'TEST-B']]);
  golf('sw-hotel-1', 'HOTEL-NET', 'Room H', [['hotel-01', 'HOTEL-NET'], ['hotel-02', 'HOTEL-NET']]);
}
networks();

S.log.push({ t: '2026-01-12T09:00:00.000Z', by: 'fixture', msg: 'Test fixture (scale ' + SCALE + ')', rev: 1 });
const st = LAB.normalize(S);
process.stdout.write(LAB.toYaml(st, true));
process.stderr.write(Object.keys(st.devices).length + ' devices, ' + st.links.length + ' cables, ' + Object.values(st.devices).reduce((a, d) => a + d.ports.length, 0) + ' ports\n');
