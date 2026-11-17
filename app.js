/* ============================================================================
   LABMAP · living documentation for a lab, office or home network
   ============================================================================
   MAINTAINER GUIDE. Read it before changing anything.

   1. WHAT IT IS, AND ITS THREE LAYERS
   One page that documents which devices exist, which ports they have, which
   cables join them, how they are powered and which IP each one uses.
     a) WEB (no data, device-agnostic)   index.html, app.js, server.py
     b) CATALOG (shared vocabulary)      data-do-not-edit/catalog.yaml
                                         port types and device templates
     c) LAB (what is really there)       data-do-not-edit/lab.yaml
                                         devices, cables, VLANs, IP notes, change log
   The web layer knows nothing about concrete devices or port types; all of that
   comes from layers b and c. Each layer is exported and imported on its own from
   the page (Data and Catalog tabs). The data folder is created by server.py on
   first run (catalog seeded from defaults/catalog.yaml) and is git-ignored, so
   updating the code never touches the data. Nobody edits those YAML files by
   hand: they are the database and are changed from the page.
   Also: example/lab.yaml (small demo lab, Data > Load example), tools/fixture.js
   (synthetic lab for the tests, with a scale factor for load tests), tools/test.js
   (headless browser tests, including the real server).

   2. PRINCIPLES (do not break)
   a) Connecting never blocks: any port can be joined to any other, a port can
      carry several cables, the cable type can be forced. Odd things only raise
      issues: red = almost certainly wrong, amber = worth a look.
   b) A port type is a CATALOG KEY, not free text. Typing an alias ("serial",
      "rs-232") stores the key ("rs232"). A new type is added to the catalog; the
      device wizard refuses port types that do not exist. The catalog gives each
      type its layer, recommended port name and whether it takes network data
      (VLAN, IP, MAC, services): power, USB, serial... do not.
   c) Single source of truth: the object S. reindex() derives everything else
      (IX) and every view is redrawn from scratch on each change (refreshAll).
      No state hides in the DOM; the only thing outside S is UI (filters, tab,
      selection).
   d) No dependencies: hand-written HTML, CSS and JS; the map is SVG built as
      text; YAML is read and written by toYaml / parseYaml.
   e) View mode and edit mode with a lock (see Persistence). Every change goes
      through commit(): bumps rev, appends to the log, saves at once.
   f) Mobile first (390 px): 44 px buttons, the map scrolls inside its own box,
      dialogs are bottom sheets that never exceed the screen, 16 px inputs.
   g) On-screen text is short, like a plain tool. No long help sentences.

   3. DATA MODEL (S)
     rev      number; grows by one on every change
     catalog  { portTypes: { KEY: { label, layer, name, first?, dir?, net?, virtual?, pass?, alias:[..] } },
                templates: { KEY: { label, types:[..], model, pattern, power, admin, notes, ports:["name type", ..],
                                    meta?: { PORT: { vlan?, services?, notes? } } } } }
     vlans    { NAME: { id, subnet:"10.20.10.0/24", gateway, dns, scope:"it"|"local", notes } }
     devices  { NAME: { types:[..], model, serial, project, owner, location, notes,
                admin:"http://{ip}", expectedPower:"pdu"|"dc"|"ups"|"wall"|"none",
                ports:[ { name, kind, virtual?, ip?, mac?, vlan?, vlans?:[..], services?, notes? } ] } }
              vlan = access (untagged) VLAN; vlans = tagged VLANs on a trunk port.
              NAME = physical label = hostname; no ":" allowed. kind = key of portTypes.
     links    [ { id, type, a:"device:port", b:"device:port", notes } ]
              type is a key of LAYERS. For power, a = outlet and b = inlet.
              The id (N-001, P-001...) goes on the physical label at both ends.
     ipUse    [ { vlan, from, to?, iface?:"device:port", who, notes } ]
     log      [ { t, by, msg, rev } ]
   Device types are the keys of TYPES (fixed in code because they drive the map).
   In YAML the catalog lives in its own file and everything else in the lab file.

   4. USERS
   No accounts, no passwords. For the log each person types a short user name
   once (corporate id without the mail domain); the browser remembers it. It is
   a label trusted among colleagues. If real identity is ever needed, server.py
   is the place (for example behind the corporate single sign-on).

   5. PERSISTENCE
   boot() draws an empty lab, then asks the server:
   · SERVER (server.py, Python 3, standard library only). State travels as the
     two YAML texts; the server does not parse YAML, it only writes atomically and
     keeps the previous version in <data>/backups/ (data folder: --data, default
     data-do-not-edit/ next to server.py).
       GET  /api/state  -> { labmap, rev, lab, cat }
       GET  /api/rev    -> { rev }                 (polled every POLL_EVERY)
       PUT  /api/state  <- { rev, base, holder, by, msg, lab, cat }
                        -> 200 { rev } | 409 current state if base is not the stored
                           revision | 423 { by } if somebody else holds the lock
       POST /api/lock   <- { holder, by, ttlMs }   (small ttlMs = release)
                        -> { acquired, by, expiresAt }
       GET  /api/backups           -> { backups:[{ file, layer, rev, time }] } newest first
       GET  /api/backup?file=NAME  -> { file, text }
     A save that fails for network or server reasons (not 4xx) stays pending and
     is retried with backoff (3 s doubling, at most 30 s); the page shows "Not
     saved yet", closing it asks first, polling never overwrites pending changes
     and leaving edit mode keeps the lock until the save goes through.
     Restoring a backup (Data > Backups) is an ordinary commit: logged, undoable.
     Data the page cannot read (bad YAML, newer FORMAT) puts it in read-only mode
     (NET.blocked): it never enters edit mode, so it never saves over that data.
     The server also refuses a save whose format is older than the stored one.
   · FILE FORMAT: both files carry "format: N" (see FORMAT, UPGRADE, readData). Read
     the rules next to FORMAT before changing what is written. Both files are
     standard YAML (a test checks a round trip of awkward text), so any YAML
     library can read them to convert or audit the data.
     The lock lasts LOCK_TTL (2 min) and is renewed every RENEW_EVERY while edit
     mode stays open; edit mode closes itself after IDLE_MAX (10 min) idle.
   · NO SERVER (page opened from static hosting): local in-memory mode with a
     visible notice and the default catalog. Export/import is the only way to keep
     anything.

   6. WHERE TO CHANGE WHAT
     Port types and templates ............ in the page (Catalog tab) or defaults/catalog.yaml
     Layers, cable prefixes, strokes ..... LAYERS; colours in index.html (--L-*)
     Device types, pass-through .......... TYPES
     Map column of a device .............. mapCol(), POWER_INFRA, NET_INFRA
     Connection wizard shortcuts ......... SHORTCUTS
     Validation rules .................... validate()
     Routes through pass-through devices . exitsOf() and routesFrom()
     Power chain and cascade ............. chainsUp(), cascade(), switchesOf()
     Map layout .......................... MAP (sizes), buildMap(), mapSvg()
     Exports (SVG, report, labels CSV) ... exportMapSvg(), reportHtml(), labelsCsv()
     IP grid and proposals ............... ipInfo(), freeIp(), renderIps()
     YAML format and its version ......... toYaml(), toCatalogYaml(), parseYaml(), FORMAT, UPGRADE
     Persistence and lock ................ section 12 (NET) and server.py

   7. DESIGN DECISIONS
   · Map in five columns (MAP_COLS), left to right: Power (wall sockets, UPS,
     strips, PDUs, relay boards), Supplies (bench supplies, distribution boxes),
     Devices (DUTs, boards, PCs, instruments; grouped by project in bands),
     Adapters (pass-through devices: serial and USB adapters, hubs, couplers),
     Network (routers, switches, APs, servers, radio hubs). Devices are stacked
     first; the other columns are placed at the barycentre of their peers.
     Cables that jump three or more columns are drawn faint until selected.
     Physical position in the room is not used.
   · Exports: Map SVG is the whole lab whatever the filters, with its CSS inlined
     (light theme); Report HTML is one static file (map + tables) to print as PDF;
     Labels CSV is one row per shown cable (the Cables tab filter applies).
   · Ports: vlan is the access (untagged) VLAN, vlans the tagged ones of a trunk.
     A net cable between two different access VLANs is warned unless one end
     carries the other's VLAN tagged. The IPs tab lists the members of each VLAN.
   · New cable with "How many" > 1 joins consecutive ports of the same type at both
     ends (only free ones when "Only free" is on), one id each, in one commit.
     "Connect + next" keeps the wizard open on the same devices.
   · A box only lists ports with a visible cable; free ports are in the device
     sheet. Ports in a box are ordered by where the other end is.
   · Project filter shows what the routes of its devices reach (a shared hub does
     not drag in other projects' adapters).
   · Pass-through devices: adapters, hubs and bus couplers. Hub: from a downstream
     port you leave by up*, from up* by every downstream port. Bus coupler: only
     ports with the same prefix (busA-* never reaches busB-*). Adapter with 3 or
     more ports: the first listed port is the common one. Power-only ports are
     never crossed.
   · Relays (port types with pass:true): outlet N depends only on inlet N of the
     same device; the card's own supply is not propagated to its outlets, but if
     the card is off every outlet is off. switchesOf() gives the nearest PDU or
     relay outlet upstream.
   · An interface without a cable (switch management, VLAN sub-interface) is the
     port type "iface"; the virtual flag is set automatically.
   · "Give me an IP" proposes the first free address: not on a port, not noted,
     not the VLAN gateway.
   · Subnets larger than /24 are shown in blocks of 256; larger than /16, list only.
   · Creating several devices at once: the typed IP is for the first one, the rest
     get the next free one. MAC and serial are not copied.
   · Renaming a port in the text is remove + add (asks before orphaning cables).
     Renaming a device carries its cables along.
   · Same MAC on a physical port and on cable-less interfaces of the same device
     is not an error (VLAN sub-interfaces).
   · expectedPower only raises issues: no inlet cable, or fed from something else.
   · Deleting an IP note, a cable or a template is one tap; every change shows
     Undo for a few seconds.
   · Import: "Add" merges and the imported item wins on equal name or id;
     "Replace" swaps the whole layer. Importing a lab never touches the catalog.

   8. MINIMUM TESTS (node tools/test.js runs them all)
   · node --check app.js
   · Page over HTTP in a headless browser: no console errors, example drawn.
   · Routes: a board console reaches the server through adapter and hub; bus A of a
     dual coupler never mixes with bus B; switching a PDU off takes down what hangs
     from it (a dual-fed server only loses redundancy).
   · Both YAML files are read and written back identically.
   · server.py with two browsers: lock, save, polling, 409/423, backups list and
     restore, save retried while the server is down, --data, code update.
   window.LAB exposes the state and the pure functions for the browser console.

   9. KNOWN LIMITS
   · Every save sends both YAML files whole (about 165 kB for 270 devices).
   · Other browsers see a change after POLL_EVERY (8 s).
   · server.py has no passwords and no HTTPS: lab network only. Data is not
     encrypted by the app: use disk encryption on the server PC. The data folder
     must never go to a public repository.
   · The YAML reader understands what this tool writes (see parseYaml): no block
     scalars (| and >), no anchors, no multi-line { } or [ ].
   · The log keeps the last LOG_MAX entries; backups keep the last 300 versions
     and, older than that, the last one of each day.
   · IPv4 only.
   · The map does not minimise crossings: with hundreds of cables use layers, the
     project filter or select a device. A full change (reindex, validate, redraw)
     takes about 40 ms for 270 devices on a PC.
   · The lock is cooperative. Two tabs of the same user count as two editors.
   · Undo covers the last change of this tab only.
   ============================================================================ */
'use strict';
const VERSION = '0.6.0';

/* ---------------------------------------------------------------------------
   1. Utilities
   --------------------------------------------------------------------------- */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const natCmp = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
const pad = (n, w) => String(n).padStart(w, '0');
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const push = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
const trunc = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const splitRef = r => { r = String(r || ''); const i = r.indexOf(':'); return i < 0 ? [r, ''] : [r.slice(0, i), r.slice(i + 1)]; };
const refDev = r => splitRef(r)[0];
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

function ipToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) { const o = +m[i]; if (o > 255) return null; n = n * 256 + o; }
  return n;
}
const intToIp = n => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
function parseCidr(c) {
  const m = /^(.+)\/(\d{1,2})$/.exec(String(c || '').trim());
  if (!m) return null;
  const ip = ipToInt(m[1]), bits = +m[2];
  if (ip == null || bits > 32) return null;
  const size = Math.pow(2, 32 - bits), base = Math.floor(ip / size) * size;
  return { base, bits, size, last: base + size - 1 };
}
const hostRange = c => c.bits >= 31 ? [c.base, c.last] : [c.base + 1, c.last - 1];
const maskOf = c => intToIp(4294967296 - c.size);
function normMac(m) {
  const h = String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return h.length === 12 ? h.match(/../g).join(':') : String(m || '').trim().toLowerCase();
}

/* ---------------------------------------------------------------------------
   2. Layers and catalog port types
   --------------------------------------------------------------------------- */
const LAYERS = {
  net:      { label: 'Network',  prefix: 'N' },
  power:    { label: 'Power',    prefix: 'P' },   // dashed stroke (CSS .ln-power)
  serial:   { label: 'Serial',   prefix: 'S' },
  jtag:     { label: 'JTAG',     prefix: 'J' },
  usb:      { label: 'USB',      prefix: 'U' },
  video:    { label: 'Video',    prefix: 'V' },
  bus:      { label: 'Buses',    prefix: 'B' },
  rf:       { label: 'RF',       prefix: 'R' },
  radio:    { label: 'Radio',    prefix: 'W' },   // dotted stroke (CSS .ln-radio)
  discrete: { label: 'Discrete', prefix: 'D' },
  other:    { label: 'Other',    prefix: 'X' }
};
const LAYER_KEYS = Object.keys(LAYERS);
/* A port kind is a CATALOG KEY (CAT.portTypes), never free text. The catalog holds
   its layer, recommended name, whether it takes network data, and its aliases. */
let CAT = { portTypes: {}, templates: {} };        // catalog in use (= S.catalog); set by reindex()
let ALIAS = new Map();                             // lower-case alias -> key
let CATALOG0 = { portTypes: {}, templates: {} };   // default catalog, used when a state brings none
function aliasMap(cat) {
  const m = new Map(), keys = Object.keys(cat.portTypes);
  for (const k of keys) m.set(k.toLowerCase(), k);
  for (const k of keys) for (const a of cat.portTypes[k].alias || []) { const x = String(a).toLowerCase(); if (!m.has(x)) m.set(x, k); }
  return m;
}
const kindKey = kind => { const k = String(kind == null ? '' : kind).trim(); return CAT.portTypes[k] ? k : ALIAS.get(k.toLowerCase()) || null; };
const portType = kind => { const k = kindKey(kind); return k ? CAT.portTypes[k] : null; };
function layerOf(kind) { const t = portType(kind); return t && LAYERS[t.layer] ? t.layer : 'other'; }
/* Direction of a power port: 'out', 'in' or '' when the type does not say. */
function powerDir(kind) { const t = portType(kind); return t && (t.dir === 'in' || t.dir === 'out') ? t.dir : ''; }
/* Only types with net:true take VLAN, IP, MAC and services. */
const isNetKind = kind => { const t = portType(kind); return !!(t && t.net); };
const linkLayer = l => LAYERS[l.type] ? l.type : 'other';
const kindChip = kind => `<span class="k k-${layerOf(kind)}"${kindKey(kind) ? '' : ' style="color:var(--err)"'}>${esc(kind)}</span>`;
const catKeys = () => Object.keys(CAT.portTypes).sort((a, b) => LAYER_KEYS.indexOf(CAT.portTypes[a].layer) - LAYER_KEYS.indexOf(CAT.portTypes[b].layer) || natCmp(a, b));
function normCatalog(c) {
  c = isObj(c) ? c : {};
  const out = { portTypes: {}, templates: {} }, pt = isObj(c.portTypes) ? c.portTypes : {}, tp = isObj(c.templates) ? c.templates : {};
  for (const k of Object.keys(pt)) {
    const t = isObj(pt[k]) ? pt[k] : {}, key = String(k).trim();
    if (!key || /\s/.test(key)) continue;
    const o = { label: String(t.label || key), layer: LAYERS[t.layer] ? t.layer : 'other' };
    if (t.name) o.name = String(t.name);
    if (t.first != null && t.first !== '' && !isNaN(+t.first)) o.first = +t.first;
    if (t.dir === 'in' || t.dir === 'out') o.dir = t.dir;
    if (t.net === true) o.net = true;
    if (t.virtual === true) o.virtual = true;
    if (t.pass === true) o.pass = true;
    o.alias = (Array.isArray(t.alias) ? t.alias : t.alias ? [t.alias] : []).map(a => String(a).trim()).filter(Boolean);
    out.portTypes[key] = o;
  }
  for (const k of Object.keys(tp)) {
    const t = isObj(tp[k]) ? tp[k] : {}, meta = {};
    if (isObj(t.meta)) for (const pn of Object.keys(t.meta)) { const o = {}; if (isObj(t.meta[pn])) for (const f of ['vlan', 'services', 'notes']) if (t.meta[pn][f]) o[f] = String(t.meta[pn][f]); if (Object.keys(o).length) meta[pn] = o; }
    out.templates[String(k).trim()] = { label: String(t.label || k), types: Array.isArray(t.types) && t.types.length ? t.types.map(String) : ['other'], model: String(t.model || ''),
      pattern: String(t.pattern || k + '-{nn}'), power: EXP[t.power] ? t.power : 'none', admin: String(t.admin || ''), notes: String(t.notes || ''), ports: (Array.isArray(t.ports) ? t.ports : []).map(String), meta };
  }
  return out;
}

/* ---------------------------------------------------------------------------
   3. Device types and connection shortcuts
   --------------------------------------------------------------------------- */
/* src: power source. pass: pass-through device ('adapter' | 'hub' | 'bus'); routes go
   through it. The map column of each device is decided by mapCol(). */
const TYPES = {
  wall:       { label: 'Wall socket',     tag: 'WALL', src: 1 },
  ups:        { label: 'UPS',             tag: 'UPS', src: 1 },
  strip:      { label: 'Power strip',     tag: 'STRIP', src: 1 },
  pdu:        { label: 'PDU',             tag: 'PDU', src: 1 },
  relay:      { label: 'Relay board',     tag: 'RELAY', src: 1 },
  psu:        { label: 'Bench supply',    tag: 'PSU', src: 1 },
  router:     { label: 'Router',          tag: 'ROUTER' },
  switch:     { label: 'Switch',          tag: 'SWITCH' },
  ap:         { label: 'Access point',    tag: 'AP' },
  server:     { label: 'Server',          tag: 'SERVER' },
  radiohub:   { label: 'Radio hub',       tag: 'RADIO' },
  instrument: { label: 'Instrument',      tag: 'INSTR' },
  pc:         { label: 'PC',              tag: 'PC' },
  board:      { label: 'Board or DUT',    tag: 'DUT' },
  sensor:     { label: 'Sensor',          tag: 'SENSOR' },
  adapter:    { label: 'Adapter',         tag: 'ADAPT',  pass: 'adapter' },
  hub:        { label: 'Hub',             tag: 'HUB',    pass: 'hub' },
  bus:        { label: 'Bus or coupler',  tag: 'BUS',    pass: 'bus' },
  other:      { label: 'Other',           tag: 'OTHER' }
};
const typeLabel = t => (TYPES[t] ? TYPES[t].label : t);
const EXP = { pdu: 'PDU', dc: 'DC supply', ups: 'UPS', wall: 'wall or strip', none: 'none' };

/* Shortcuts of the connection wizard. a and b filter candidate devices and ports:
   layer (port layer), dir (power direction), types / notTypes (device type), noUp
   (on hubs, never propose the upstream port). */
const SHORTCUTS = [
  { k: 'free',   label: 'Free',                a: {}, b: {} },
  { k: 'sw',     label: 'Device → switch',     a: { layer: 'net', notTypes: ['switch'] }, b: { layer: 'net', types: ['switch', 'router'] } },
  { k: 'pdu',    label: 'Outlet → device',     a: { layer: 'power', dir: 'out', types: ['pdu', 'relay', 'strip', 'ups', 'wall'] }, b: { layer: 'power', dir: 'in' } },
  { k: 'dc',     label: 'Supply → DC device',  a: { layer: 'power', dir: 'out', types: ['psu'] }, b: { layer: 'power', dir: 'in' } },
  { k: 'serial', label: 'Serial console',      a: { layer: 'serial', notTypes: ['adapter'] }, b: { layer: 'serial', types: ['adapter', 'server', 'pc'] } },
  { k: 'usb',    label: 'USB → hub/host',      a: { layer: 'usb', notTypes: ['server'] }, b: { layer: 'usb', types: ['hub', 'server', 'pc'], noUp: 1 } },
  { k: 'jtag',   label: 'JTAG',                a: { layer: 'jtag', notTypes: ['adapter'] }, b: { layer: 'jtag', types: ['adapter', 'server', 'pc', 'instrument'] } },
  { k: 'bus',    label: 'Bus',                 a: { layer: 'bus', notTypes: ['bus'] }, b: { layer: 'bus', types: ['bus'] } },
  { k: 'radio',  label: 'Radio (device → hub)', a: { layer: 'radio', notTypes: ['radiohub', 'ap', 'router'] }, b: { layer: 'radio', types: ['radiohub', 'ap', 'router'] } }
];

/* ---------------------------------------------------------------------------
   4. State (S) and derived index (IX)
   --------------------------------------------------------------------------- */
let S = null;        // the single source of truth
let IX = null;       // everything derived; rebuilt by reindex()
let UNDO = null;     // { prev, msg } of the last change

function normalize(st) {
  st = isObj(st) ? st : {};
  st.rev = +st.rev || 0;
  st.catalog = normCatalog(isObj(st.catalog) && isObj(st.catalog.portTypes) && Object.keys(st.catalog.portTypes).length ? st.catalog : CATALOG0);
  const pt = st.catalog.portTypes, am = aliasMap(st.catalog);
  const canon = k => { k = String(k == null || k === '' ? 'other' : k).trim(); return pt[k] ? k : am.get(k.toLowerCase()) || k; };      // alias -> catalog key
  st.vlans = isObj(st.vlans) ? st.vlans : {};
  st.devices = isObj(st.devices) ? st.devices : {};
  st.links = (Array.isArray(st.links) ? st.links : []).filter(l => isObj(l) && l.a && l.b);
  st.ipUse = (Array.isArray(st.ipUse) ? st.ipUse : []).filter(isObj);
  st.log = (Array.isArray(st.log) ? st.log : []).filter(isObj);
  for (const n of Object.keys(st.devices)) {
    const d = isObj(st.devices[n]) ? st.devices[n] : (st.devices[n] = {});
    d.types = (Array.isArray(d.types) && d.types.length ? d.types : [d.types || 'other']).map(String);
    d.ports = (Array.isArray(d.ports) ? d.ports : []).filter(p => isObj(p) && p.name != null && p.name !== '');
    for (const p of d.ports) {
      p.name = String(p.name); p.kind = canon(p.kind);
      if (pt[p.kind] && pt[p.kind].virtual) p.virtual = true;
      const tg = (Array.isArray(p.vlans) ? p.vlans : p.vlans ? String(p.vlans).split(/[\s,]+/) : []).map(String).filter(Boolean);      // tagged VLANs (trunk)
      if (tg.length) p.vlans = tg; else delete p.vlans;
    }
    for (const k of ['model', 'serial', 'project', 'owner', 'location', 'notes', 'admin']) d[k] = d[k] == null ? '' : String(d[k]);
    d.expectedPower = EXP[d.expectedPower] ? d.expectedPower : 'none';
  }
  for (const l of st.links) { l.id = String(l.id || ''); l.a = String(l.a); l.b = String(l.b); l.type = LAYERS[l.type] ? l.type : 'other'; l.notes = l.notes == null ? '' : String(l.notes); }
  for (const v of Object.keys(st.vlans)) if (!isObj(st.vlans[v])) st.vlans[v] = {};
  return st;
}

function reindex() {
  CAT = S.catalog; ALIAS = aliasMap(CAT);
  const ix = { names: Object.keys(S.devices).sort(natCmp), ports: new Map(), byPort: new Map(), byDev: new Map(), pin: new Map(), pout: new Map(), plinks: [] };
  for (const n of ix.names) for (const p of S.devices[n].ports) ix.ports.set(n + ':' + p.name, { dev: n, d: S.devices[n], p });
  for (const l of S.links) {
    push(ix.byPort, l.a, l); if (l.b !== l.a) push(ix.byPort, l.b, l);
    const da = refDev(l.a), db = refDev(l.b);
    push(ix.byDev, da, l); if (db !== da) push(ix.byDev, db, l);
    if (l.type === 'power' && da !== db) { push(ix.pout, da, l); push(ix.pin, db, l); ix.plinks.push(l); }
  }
  IX = ix;
  ix.ip = buildIpIndex();
  ix.issues = validate();
  ix.issueDev = new Map();
  for (const i of ix.issues) if (i.dev && (ix.issueDev.get(i.dev) !== 'err')) ix.issueDev.set(i.dev, i.level);
  ix.stats = computeStats();
}
const linksOf = ref => IX.byPort.get(ref) || [];
const powerIn = dev => IX.pin.get(dev) || [];
const powerOut = dev => IX.pout.get(dev) || [];
const firstIp = d => { const p = d.ports.find(p => p.ip); return p ? p.ip : ''; };

function computeStats() {
  const st = { devs: IX.names.length, links: S.links.length, ports: 0, sw: [0, 0], pdu: [0, 0], hub: [0, 0] };
  for (const n of IX.names) {
    const d = S.devices[n], t = d.types;
    for (const p of d.ports) {
      if (p.virtual) continue;
      st.ports++;
      const free = !linksOf(n + ':' + p.name).length, lay = layerOf(p.kind);
      if (t.includes('switch') && lay === 'net') { st.sw[1]++; if (free) st.sw[0]++; }
      if (t.includes('pdu') && lay === 'power' && powerDir(p.kind) !== 'in') { st.pdu[1]++; if (free) st.pdu[0]++; }
      if (t.includes('hub') && lay === 'usb' && !/^up/i.test(p.name)) { st.hub[1]++; if (free) st.hub[0]++; }
    }
  }
  return st;
}

/* ---------------------------------------------------------------------------
   5. IPs: what is set on ports and what is noted in ipUse, per VLAN
   --------------------------------------------------------------------------- */
function buildIpIndex() {
  const per = {};
  const mk = (name, v) => ({ name, v: v || null, cidr: v ? parseCidr(v.subnet) : null, gw: v ? ipToInt(v.gateway) : null, fixed: new Map(), uses: [] });
  for (const vn of Object.keys(S.vlans)) per[vn] = mk(vn, S.vlans[vn]);
  per[''] = mk('', null);                       // ports with an IP and no known VLAN
  for (const [ref, P] of IX.ports) {
    if (!P.p.ip) continue;
    const n = ipToInt(P.p.ip);
    if (n == null) continue;
    let vn = P.p.vlan && per[P.p.vlan] ? P.p.vlan : '';
    if (!P.p.vlan) for (const k of Object.keys(per)) { const c = per[k].cidr; if (c && n >= c.base && n <= c.last) { vn = k; break; } }
    push(per[vn].fixed, n, ref);
  }
  S.ipUse.forEach((e, i) => {
    const from = ipToInt(e.from);
    if (from == null) return;
    let to = e.to ? ipToInt(e.to) : null;
    if (to == null || to < from) to = from;
    (per[e.vlan] || per['']).uses.push({ e, i, from, to });
  });
  return per;
}
/* State of an address: free | fixed (on a port) | noted (ipUse or gateway) | conf (conflict). */
function ipInfo(vn, n) {
  const V = IX.ip[vn];
  const fixed = (V && V.fixed.get(n)) || [];
  const uses = V ? V.uses.filter(u => n >= u.from && n <= u.to) : [];
  const gw = !!(V && V.gw != null && V.gw === n);
  let state = 'free';
  if (fixed.length > 1 || uses.length > 1 || (fixed.length && uses.some(u => u.e.iface && !fixed.includes(u.e.iface)))) state = 'conf';
  else if (fixed.length) state = 'fixed';
  else if (uses.length || gw) state = 'noted';
  return { fixed, uses, state, gw };
}
/* First free IP after "after"; wraps around at the end of the subnet. */
function freeIp(vn, after, skip) {
  const V = IX.ip[vn];
  if (!V || !V.cidr) return null;
  const [lo, hi] = hostRange(V.cidr), size = hi - lo + 1;
  if (size <= 0) return null;
  let n = after != null && after >= lo && after < hi ? after + 1 : lo;
  for (let i = 0; i < Math.min(size, 70000); i++, n = n >= hi ? lo : n + 1) {
    if (skip && skip.has(n)) continue;
    if (ipInfo(vn, n).state === 'free') return n;
  }
  return null;
}
/* Interface of a server in a VLAN, for the arping command. */
function serverIface(vn) {
  for (const n of IX.names) { const d = S.devices[n]; if (!d.types.includes('server')) continue; const p = d.ports.find(p => p.vlan === vn && p.ip); if (p) return p.name; }
  return '<interface>';
}

/* ---------------------------------------------------------------------------
   6. Validation: it only reports. err = red, warn = amber
   --------------------------------------------------------------------------- */
function validate() {
  const out = [];
  const add = (level, code, msg, x) => out.push(Object.assign({ level, code, msg }, x || {}));
  for (const n of IX.names) if (n.includes(':')) add('err', 'name', `Name "${n}" contains ":" and breaks device:port references`, { dev: n });
  for (const n of IX.names) {
    const bad = [...new Set(S.devices[n].ports.filter(p => !kindKey(p.kind)).map(p => p.kind))];
    if (bad.length) add('warn', 'port-type', `${n}: port type not in the catalog: ${bad.join(', ')}`, { dev: n });
  }

  const ids = new Set();
  for (const l of S.links) {
    if (l.id && ids.has(l.id)) add('err', 'cable-dup', `Duplicate cable id: ${l.id}`, { link: l.id });
    ids.add(l.id);
    const A = IX.ports.get(l.a), B = IX.ports.get(l.b);
    for (const ref of [l.a, l.b]) if (!IX.ports.has(ref)) add('err', 'orphan', `Cable ${l.id}: port ${ref} does not exist`, { link: l.id, dev: S.devices[refDev(ref)] ? refDev(ref) : undefined });
    if (l.a === l.b) add('warn', 'loop', `Cable ${l.id}: both ends are ${l.a}`, { link: l.id, dev: refDev(l.a) });
    if (!A || !B) continue;
    const la = layerOf(A.p.kind), lb = layerOf(B.p.kind);
    if (la !== lb && la !== 'other' && lb !== 'other') add('warn', 'types', `Cable ${l.id}: ${l.a} (${A.p.kind}) and ${l.b} (${B.p.kind}) do not match`, { link: l.id, dev: A.dev });
    if (l.type === 'net' && A.p.vlan && B.p.vlan && A.p.vlan !== B.p.vlan && !(A.p.vlans || []).includes(B.p.vlan) && !(B.p.vlans || []).includes(A.p.vlan))
      add('warn', 'vlan-mismatch', `Cable ${l.id}: ${l.a} is in VLAN ${A.p.vlan} and ${l.b} in ${B.p.vlan}`, { link: l.id, dev: A.dev });
    if (l.type === 'power') {
      const da = powerDir(A.p.kind), db = powerDir(B.p.kind);
      if (da === 'in' && db === 'out') add('warn', 'direction', `Cable ${l.id}: reversed; the first end must be the outlet`, { link: l.id, dev: A.dev });
      else if (da && da === db) add('warn', 'direction', `Cable ${l.id}: joins two power ${da === 'in' ? 'inlets' : 'outlets'}`, { link: l.id, dev: A.dev });
    }
  }
  for (const [ref, ls] of IX.byPort) {
    if (ls.length < 2) continue;
    const P = IX.ports.get(ref);
    if (!P) continue;
    const lay = layerOf(P.p.kind);
    if (lay === 'radio' || lay === 'bus' || ls.every(l => l.type === 'radio' || l.type === 'bus')) continue;
    add('warn', 'multi', `${ref} has ${ls.length} cables: ${ls.map(l => l.id).join(', ')}`, { dev: P.dev });
  }

  const macs = new Map();
  for (const [ref, P] of IX.ports) {
    const p = P.p;
    if (p.mac) push(macs, normMac(p.mac), ref);
    if (kindKey(p.kind) && !isNetKind(p.kind) && (p.ip || p.mac || p.vlan || p.services)) add('warn', 'net-on-non-net', `${ref} is ${p.kind} and carries network data (VLAN, IP, MAC or services)`, { dev: P.dev });
    for (const v of [p.vlan].concat(p.vlans || [])) if (v && !S.vlans[v]) add('warn', 'vlan', `${ref}: VLAN "${v}" is not defined`, { dev: P.dev });
    if (!p.ip) continue;
    const n = ipToInt(p.ip);
    if (n == null) { add('warn', 'ip-bad', `${ref}: "${p.ip}" is not a valid IPv4`, { dev: P.dev }); continue; }
    const v = S.vlans[p.vlan], c = v && parseCidr(v.subnet);
    if (c && (n < c.base || n > c.last)) add('warn', 'ip-outside', `${ref}: ${p.ip} is outside ${v.subnet} (VLAN ${p.vlan})`, { dev: P.dev, vlan: p.vlan, ip: n });
    if (!p.virtual && !linksOf(ref).length) add('warn', 'ip-no-cable', `${ref} has IP ${p.ip} and no cable`, { dev: P.dev });
  }
  for (const [m, refs] of macs) {
    if (refs.length < 2) continue;
    const devs = new Set(refs.map(refDev));
    if (devs.size === 1 && refs.some(r => IX.ports.get(r).p.virtual)) continue;      // sub-interfaces
    add('err', 'mac-dup', `MAC ${m} repeated on ${refs.join(' and ')}`, { dev: refDev(refs[0]) });
  }
  for (const vn of Object.keys(IX.ip)) {
    const V = IX.ip[vn];
    for (const [n, refs] of V.fixed) {
      if (refs.length > 1) add('err', 'ip-dup', `IP ${intToIp(n)} repeated${vn ? ' in VLAN ' + vn : ''}: ${refs.join(' and ')}`, { dev: refDev(refs[0]), vlan: vn, ip: n });
      for (const u of V.uses) if (n >= u.from && n <= u.to && u.e.iface && !refs.includes(u.e.iface))
        add('warn', 'ip-range', `${refs[0]}: ${intToIp(n)} falls in the range noted for ${u.e.iface}`, { dev: refDev(refs[0]), vlan: vn, ip: n });
    }
    for (let i = 0; i < V.uses.length; i++) {
      const u = V.uses[i], span = x => x.e.from + (x.e.to ? '–' + x.e.to : '');
      if (V.cidr && (u.from < V.cidr.base || u.to > V.cidr.last)) add('warn', 'note-outside', `IP note ${span(u)}: outside the subnet of ${vn}`, { vlan: vn, ip: u.from });
      for (let j = i + 1; j < V.uses.length; j++) { const w = V.uses[j]; if (u.from <= w.to && w.from <= u.to) add('warn', 'note-overlap', `Two IP notes overlap in ${vn}: ${span(u)} (${u.e.who || '?'}) and ${span(w)} (${w.e.who || '?'})`, { vlan: vn, ip: Math.max(u.from, w.from) }); }
    }
  }
  for (const e of S.ipUse) {
    if (ipToInt(e.from) == null) add('warn', 'note-bad', `IP note with an invalid address: "${e.from || ''}"`, {});
    if (e.vlan && !S.vlans[e.vlan]) add('warn', 'note-vlan', `IP note ${e.from}: VLAN "${e.vlan}" is not defined`, {});
    if (e.iface && !IX.ports.has(e.iface)) add('warn', 'note-iface', `IP note ${e.from}: interface ${e.iface} does not exist`, { vlan: e.vlan });
  }

  for (const n of IX.names) {
    const d = S.devices[n], exp = d.expectedPower;
    if (!exp || exp === 'none') continue;
    const ins = upLinks(n);
    if (!ins.length) { add('warn', 'no-power', `${n}: no power cable (expected: ${EXP[exp]})`, { dev: n }); continue; }
    const src = ins.map(l => refDev(l.a)).filter(s => S.devices[s]);
    const has = (s, t) => S.devices[s].types.includes(t);
    let ok = true;
    if (exp === 'pdu') ok = src.some(s => has(s, 'pdu') || has(s, 'relay'));
    else if (exp === 'ups') ok = src.some(s => has(s, 'ups')) || chainsUp(n).some(ch => ch.some(l => S.devices[refDev(l.a)] && has(refDev(l.a), 'ups')));
    else if (exp === 'dc') ok = ins.some(l => { const s = refDev(l.a), P = IX.ports.get(l.a); return S.devices[s] && (has(s, 'psu') || (P && /^dc/.test(P.p.kind)) || !['pdu', 'strip', 'ups', 'wall'].some(t => has(s, t))); });
    if (!ok) add('warn', 'power-source', `${n}: expected power from ${EXP[exp]}, fed from ${src.join(', ') || '?'}`, { dev: n });
  }
  out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'err' ? -1 : 1));
  return out;
}

/* ---------------------------------------------------------------------------
   7. Routes through pass-through devices (adapters, hubs, bus couplers)
   --------------------------------------------------------------------------- */
function passMode(devName) {
  const d = S.devices[devName];
  if (!d) return null;
  for (const m of ['bus', 'hub', 'adapter']) if (d.types.includes(m)) return TYPES[m].pass;
  return null;
}
const busPrefix = n => { const i = n.indexOf('-'); return i < 0 ? '' : n.slice(0, i).toLowerCase(); };
/* Ports you can leave a pass-through device by, when entering by portName. */
function exitsOf(devName, portName) {
  const mode = passMode(devName);
  if (!mode) return [];
  const d = S.devices[devName], me = d.ports.find(p => p.name === portName);
  const isPow = p => layerOf(p.kind) === 'power';
  if (me && isPow(me)) return [];                                   // never cross a power-only port
  const others = d.ports.filter(p => !p.virtual && p.name !== portName && !isPow(p));
  if (mode === 'hub') { const up = /^up/i.test(portName); return others.filter(p => /^up/i.test(p.name) !== up).map(p => p.name); }   // downstream → up*, up → downstream
  if (mode === 'bus') { const pre = busPrefix(portName); return others.filter(p => busPrefix(p.name) === pre).map(p => p.name); }    // same bus only
  if (others.length > 1) { const common = d.ports.find(p => !p.virtual && !isPow(p)).name; return portName === common ? others.map(p => p.name) : [common]; }   // 3+ ports: the first is the common one
  return others.map(p => p.name);
}
/* Every route from a port. Each route: { hops:[{link, from, to}], end }. */
function routesFrom(ref, onlyLink) {
  const res = [];
  const walk = (from, link, hops, seen) => {
    if (res.length >= 60) return;
    const to = link.a === from ? link.b : link.a;
    const h = hops.concat([{ link, from, to }]);
    const s2 = new Set(seen); s2.add(link);
    const [td, tp] = splitRef(to);
    let cont = false;
    for (const ex of exitsOf(td, tp)) for (const l2 of linksOf(td + ':' + ex)) { if (s2.has(l2)) continue; cont = true; walk(td + ':' + ex, l2, h, s2); }
    if (!cont) res.push({ hops: h, end: to });
  };
  for (const l of linksOf(ref)) if (!onlyLink || l === onlyLink) walk(ref, l, [], new Set());
  return res;
}
const routeText = r => r.hops.map(h => h.from + ' → ' + h.to).join(' · ');

/* ---------------------------------------------------------------------------
   8. Power: chain upwards and cascade downwards
   --------------------------------------------------------------------------- */
/* Pass contacts (relays): port types with pass:true. Outlet out3 depends only on
   inlet in3 of the same device, not on the board's own supply. */
const passPort = (ref, dir) => { const P = IX.ports.get(ref), t = P && portType(P.p.kind); return !!(t && t.pass && t.dir === dir); };
const portNum = name => (/(\d+)\D*$/.exec(name) || [])[1];
function pairedIn(ref) {
  if (!passPort(ref, 'out')) return null;
  const P = IX.ports.get(ref), num = portNum(P.p.name);
  const q = P.d.ports.find(p => passPort(P.dev + ':' + p.name, 'in') && portNum(p.name) === num);
  return q ? P.dev + ':' + q.name : null;
}
const linksInto = ref => linksOf(ref).filter(l => l.type === 'power' && l.b === ref);
/* Cables that power the device itself (contact inlets do not count). */
const upLinks = dev => powerIn(dev).filter(l => !passPort(l.b, 'in'));
/* Cable chains from the device up to the origin (nearest first).
   via = the outlet we arrived through, to follow only its contact. */
function chainsUp(dev, seen, via) {
  const src = via && passPort(via, 'out') ? (pairedIn(via) ? linksInto(pairedIn(via)) : []) : upLinks(dev);
  const ins = src.filter(l => !(seen && seen.has(l)));
  if (!ins.length) return [[]];
  const out = [];
  for (const l of ins) {
    const s2 = new Set(seen || []); s2.add(l);
    for (const c of chainsUp(refDev(l.a), s2, l.a)) { out.push([l].concat(c)); if (out.length >= 12) return out; }
  }
  return out;
}
/* What switches it on and off: the nearest PDU or relay outlet upstream. */
function switchesOf(dev) {
  const out = [];
  for (const ch of chainsUp(dev)) {
    const l = ch.find(l => { const d = S.devices[refDev(l.a)]; return d && d.types.some(t => t === 'pdu' || t === 'relay'); });
    if (l && !out.includes(l.a)) out.push(l.a);
  }
  return out;
}
/* What goes down if these devices or these outlets are switched off. A device goes
   down when ALL its inlets are dead; if it only loses some, it is "degraded". */
function cascade(offDevs, offLinks) {
  const down = new Set(offDevs || []), dead = new Set(offLinks || []);
  const powered = IX.names.filter(n => upLinks(n).length);
  for (let changed = true; changed;) {
    changed = false;
    for (const l of IX.plinks) {
      if (dead.has(l)) continue;
      const pin = pairedIn(l.a), ins = pin ? linksInto(pin) : [];
      if (down.has(refDev(l.a)) || (ins.length && ins.every(x => dead.has(x)))) { dead.add(l); changed = true; }
    }
    for (const n of powered) if (!down.has(n) && upLinks(n).every(l => dead.has(l))) { down.add(n); changed = true; }
  }
  const degraded = powered.filter(n => !down.has(n) && upLinks(n).some(l => dead.has(l)));
  for (const d of offDevs || []) down.delete(d);
  return { down: [...down].sort(natCmp), degraded };
}

/* ---------------------------------------------------------------------------
   9. Cables: numbering
   --------------------------------------------------------------------------- */
function nextCableId(type, taken) {
  const pre = (LAYERS[type] || LAYERS.other).prefix + '-';
  let max = 0;
  for (const l of S.links) if (l.id.startsWith(pre)) { const n = parseInt(l.id.slice(pre.length), 10); if (n > max) max = n; }
  let id;
  do { max++; id = pre + pad(max, 3); } while (taken && taken.has(id));
  return id;
}

/* ---------------------------------------------------------------------------
   10. Ports as text: "name type", with ranges eth[0-3]; the type is a catalog key
   --------------------------------------------------------------------------- */
function expandRange(t) {
  const m = /^(.*)\[(\d+)-(\d+)\](.*)$/.exec(t);
  if (!m) return [t];
  const a = +m[2], b = +m[3], w = m[2].length > 1 && m[2][0] === '0' ? m[2].length : 0, out = [];
  for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) { out.push(m[1] + (w ? pad(i, w) : i) + m[4]); if (out.length >= 512) break; }
  return out;
}
function parsePorts(text) {
  const out = [], seen = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const tk = line.split(/\s+/);
    let virtual = false;
    const rest = tk.slice(1).filter(t => (/^virtual$/i.test(t) ? ((virtual = true), false) : true));
    for (const name of expandRange(tk[0])) {
      if (seen.has(name)) continue;
      seen.add(name);
      const raw2 = rest.join(' ') || 'other', key = kindKey(raw2), p = { name, kind: key || raw2 };
      if (!key) p.unknown = true;                               // not in the catalog: the wizard refuses to save it
      if (virtual || (key && CAT.portTypes[key].virtual)) p.virtual = true;
      out.push(p);
    }
  }
  return out;
}
/* Inverse of parsePorts: groups consecutive series (p1..p24 → p[1-24]). */
function portsToText(ports) {
  const lines = [], vt = (kind, v) => (v && !(portType(kind) || {}).virtual ? ' virtual' : '');
  let run = null;
  const flush = () => { if (run) lines.push((run.n > 1 ? `${run.pre}[${run.first}-${run.last}]${run.suf}` : run.pre + run.first + run.suf) + ' ' + run.kind + vt(run.kind, run.virtual)); run = null; };
  for (const p of ports) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(p.name), v = !!p.virtual;
    if (m && run && run.pre === m[1] && run.suf === m[3] && run.kind === p.kind && run.virtual === v && (run.w ? pad(run.num + 1, run.w) : String(run.num + 1)) === m[2]) { run.num++; run.last = m[2]; run.n++; continue; }
    flush();
    if (m) run = { pre: m[1], suf: m[3], first: m[2], last: m[2], num: +m[2], n: 1, w: m[2].length > 1 && m[2][0] === '0' ? m[2].length : 0, kind: p.kind, virtual: v };
    else lines.push(p.name + ' ' + p.kind + vt(p.kind, v));
  }
  flush();
  return lines.join('\n');
}
/* Port lines with the catalog's recommended name for "qty" ports of one type. */
function suggestPorts(key, qty, used) {
  const t = CAT.portTypes[key] || {};
  let pat = t.name || key;
  if (!/\{[na]\}/.test(pat)) { if (qty === 1 && !used.has(pat)) return [pat + ' ' + key]; pat += /\d$/.test(pat) ? '-{n}' : '{n}'; }
  const letters = pat.includes('{a}'), first = letters ? 0 : t.first != null ? t.first : 1;
  const nameAt = i => (letters ? pat.replace('{a}', String.fromCharCode(97 + i)) : pat.replace('{n}', i));
  let s = first;
  for (; s < first + 500; s++) { let free = true; for (let i = 0; i < qty; i++) if (used.has(nameAt(s + i))) { free = false; break; } if (free) break; }
  if (letters || qty === 1) return Array.from({ length: qty }, (_, i) => nameAt(s + i) + ' ' + key);
  return [pat.replace('{n}', `[${s}-${s + qty - 1}]`) + ' ' + key];
}
/* Device names from a pattern: {n}, {nn}, {nnn} = first free number. */
function genNames(pattern, qty) {
  const pat = String(pattern || '').trim();
  const m = /\{(n+)\}/.exec(pat), used = new Set(Object.keys(S.devices)), names = [];
  let k = 1;
  for (let i = 0; i < qty; i++) {
    if (!m) { names.push(i === 0 ? pat : pat + '-' + (i + 1)); continue; }
    let nm;
    do { nm = pat.replace(m[0], pad(k, m[1].length)); k++; } while (used.has(nm));
    used.add(nm); names.push(nm);
  }
  return names;
}
const patternFrom = name => { const m = /^(.*?)(\d+)(\D*)$/.exec(name); return m ? m[1] + '{' + 'n'.repeat(m[2].length) + '}' + m[3] : name + '-{n}'; };

/* ---------------------------------------------------------------------------
   11. YAML: write (stable order, made for Git diffs) and read
   --------------------------------------------------------------------------- */
function yamlStr(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (/^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_ .\/()+=°-]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(s)) return s;
  return JSON.stringify(s);
}
function yamlVal(v) { return Array.isArray(v) ? '[' + v.map(yamlStr).join(', ') + ']' : yamlStr(v); }
function yamlFlow(o, keys) {
  const parts = [];
  for (const k of keys || Object.keys(o)) { const v = o[k]; if (v === undefined || v === null || v === '' || v === false) continue; parts.push(k + ': ' + yamlVal(v)); }
  return '{ ' + parts.join(', ') + ' }';
}
const YAML_HEAD = what => ['# LABMAP DATABASE · ' + what, '# DO NOT EDIT BY HAND: change it from the web page. This file is the stored copy.'];
/* Lab: devices, cables, VLANs, IP notes and change log. The catalog is a separate file. */
function toYaml(st, noDate) {
  const L = YAML_HEAD('lab: devices, cables, VLANs, IPs and change log');
  L.push('# Labmap ' + VERSION + (noDate ? '' : ' · exported ' + new Date().toISOString()) + ' · rev ' + st.rev);
  L.push('rev: ' + st.rev, 'format: ' + FORMAT);
  L.push('vlans:');
  for (const v of Object.keys(st.vlans).sort(natCmp)) L.push('  ' + yamlStr(v) + ': ' + yamlFlow(st.vlans[v], ['id', 'subnet', 'gateway', 'dns', 'scope', 'notes']));
  L.push('devices:');
  for (const n of Object.keys(st.devices).sort(natCmp)) {
    const d = st.devices[n];
    L.push('  ' + yamlStr(n) + ':');
    L.push('    types: ' + yamlVal(d.types));
    for (const k of ['model', 'serial', 'project', 'owner', 'location', 'notes', 'admin']) if (d[k]) L.push('    ' + k + ': ' + yamlStr(d[k]));
    if (d.expectedPower && d.expectedPower !== 'none') L.push('    expectedPower: ' + yamlStr(d.expectedPower));
    if (d.ports.length) { L.push('    ports:'); for (const p of d.ports) L.push('      - ' + yamlFlow(p, ['name', 'kind', 'virtual', 'ip', 'mac', 'vlan', 'vlans', 'services', 'notes'])); }
    else L.push('    ports: []');
  }
  L.push(st.links.length ? 'links:' : 'links: []');
  for (const l of st.links.slice().sort((a, b) => natCmp(a.id, b.id))) L.push('  - ' + yamlFlow(l, ['id', 'type', 'a', 'b', 'notes']));
  L.push(st.ipUse.length ? 'ipUse:' : 'ipUse: []');
  for (const e of st.ipUse) L.push('  - ' + yamlFlow(e, ['vlan', 'from', 'to', 'iface', 'who', 'notes']));
  L.push(st.log.length ? 'log:' : 'log: []');
  for (const e of st.log) L.push('  - ' + yamlFlow(e, ['t', 'by', 'msg', 'rev']));
  return L.join('\n') + '\n';
}
/* Catalog: port types and device templates. */
function toCatalogYaml(cat) {
  const L = YAML_HEAD('catalog: port types and device templates');
  L.push('#', '# portTypes: the only port types that can be chosen.', '#   layer   ' + LAYER_KEYS.join(', '), '#   name    recommended port name; {n} = number, {a} = letter', '#   first   first number for {n} (default 1)',
    '#   dir     for power: in (inlet) or out (outlet)', '#   net     true = takes VLAN, IP, MAC and services', '#   virtual true = logical interface, no cable', '#   pass    true = relay contact: outlet N depends only on inlet N',
    '#   alias   other spellings; they are converted to the key', '# templates: device templates for the wizard. ports: one line per port, "name type".', '#   meta    optional, data each port inherits: { vlan, services, notes }');
  L.push('format: ' + FORMAT);
  const pk = Object.keys(cat.portTypes).sort((a, b) => LAYER_KEYS.indexOf(cat.portTypes[a].layer) - LAYER_KEYS.indexOf(cat.portTypes[b].layer) || natCmp(a, b));
  L.push(pk.length ? 'portTypes:' : 'portTypes: {}');
  for (const k of pk) L.push('  ' + yamlStr(k) + ': ' + yamlFlow(cat.portTypes[k], ['label', 'layer', 'name', 'first', 'dir', 'net', 'virtual', 'pass', 'alias']));
  const tk = Object.keys(cat.templates).sort(natCmp);
  L.push(tk.length ? 'templates:' : 'templates: {}');
  for (const k of tk) {
    const t = cat.templates[k];
    L.push('  ' + yamlStr(k) + ':', '    label: ' + yamlStr(t.label), '    types: ' + yamlVal(t.types));
    for (const f of ['model', 'pattern', 'power', 'admin', 'notes']) if (t[f]) L.push('    ' + f + ': ' + yamlStr(t[f]));
    if (t.ports.length) { L.push('    ports:'); for (const p of t.ports) L.push('      - ' + yamlStr(p)); } else L.push('    ports: []');
    const mk = Object.keys(t.meta || {}).sort(natCmp);
    if (mk.length) { L.push('    meta:'); for (const pn of mk) L.push('      ' + yamlStr(pn) + ': ' + yamlFlow(t.meta[pn], ['vlan', 'services', 'notes'])); }
  }
  return L.join('\n') + '\n';
}

/* Reader for the YAML subset this tool writes: indented maps and lists, inline maps
   and lists ({ } and [ ]), quoted strings and comments. No block scalars (| and >),
   no anchors, no multi-line { } or [ ]. */
function parseYaml(text) {
  const lines = [];
  String(text == null ? '' : text).replace(/\r/g, '').split('\n').forEach((raw, i) => {
    let q = '', cut = raw.length;
    for (let j = 0; j < raw.length; j++) {                    // strip the comment, respecting quotes
      const ch = raw[j];
      if (q) { if (ch === '\\' && q === '"') j++; else if (ch === q) q = ''; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '#' && (j === 0 || /\s/.test(raw[j - 1]))) { cut = j; break; }
    }
    const s = raw.slice(0, cut);
    if (!s.trim()) return;
    if (/^ *\t/.test(s)) throw new Error('YAML line ' + (i + 1) + ': tab indentation');
    lines.push({ ind: s.length - s.trimStart().length, t: s.trim(), n: i + 1 });
  });
  let pos = 0;
  const err = (ln, m) => { throw new Error('YAML line ' + (ln ? ln.n : '?') + ': ' + m); };
  const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s{\["'#-][^:]*?|-[^\s:][^:]*?):(?=\s|$)/;
  const isItem = ln => ln.t === '-' || ln.t.startsWith('- ');
  function scalar(t, ln) {
    if (t[0] === '"') { try { return JSON.parse(t); } catch (e) { err(ln, 'bad quotes in ' + t); } }
    if (t[0] === "'") return t.slice(1, -1).replace(/''/g, "'");
    if (t === '' || t === '~' || t === 'null') return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) return +t;
    return t;
  }
  function flow(s, ln) {
    let i = 0;
    const ws = () => { while (s[i] === ' ') i++; };
    const token = key => {
      ws();
      const st = i;
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i];
        for (i++; i < s.length; i++) { if (s[i] === '\\' && q === '"') i++; else if (s[i] === q) { if (q === "'" && s[i + 1] === "'") i++; else break; } }
        if (i >= s.length) err(ln, 'unclosed quotes');
        i++;
        return scalar(s.slice(st, i), ln);
      }
      while (i < s.length && !',}]'.includes(s[i]) && !(key && s[i] === ':' && (s[i + 1] === ' ' || i + 1 === s.length))) i++;
      return scalar(s.slice(st, i).trim(), ln);
    };
    const val = () => {
      ws();
      if (s[i] === '{') {
        const o = {};
        i++; ws();
        if (s[i] === '}') { i++; return o; }
        for (;;) {
          const k = token(true); ws();
          if (s[i] !== ':') err(ln, 'missing ":" inside { }');
          i++; o[String(k)] = val(); ws();
          if (s[i] === ',') { i++; continue; }
          if (s[i] === '}') { i++; return o; }
          err(ln, 'missing "}"');
        }
      }
      if (s[i] === '[') {
        const a = [];
        i++; ws();
        if (s[i] === ']') { i++; return a; }
        for (;;) {
          a.push(val()); ws();
          if (s[i] === ',') { i++; continue; }
          if (s[i] === ']') { i++; return a; }
          err(ln, 'missing "]"');
        }
      }
      return token(false);
    };
    const v = val();
    ws();
    if (i < s.length) err(ln, 'unexpected text: ' + s.slice(i));
    return v;
  }
  const value = (s, ln) => (s[0] === '{' || s[0] === '[' ? flow(s, ln) : scalar(s, ln));
  const block = ind => (isItem(lines[pos]) ? seq(ind) : map(ind));
  function seq(ind) {
    const out = [];
    while (pos < lines.length && lines[pos].ind === ind && isItem(lines[pos])) {
      const ln = lines[pos], rest = ln.t.slice(1).trim();
      if (!rest) { pos++; const nx = lines[pos]; out.push(nx && nx.ind > ind ? block(nx.ind) : null); }
      else if (KEY.test(rest)) { ln.t = rest; ln.ind = ind + 2; out.push(map(ind + 2)); }       // "- key: value"
      else { pos++; out.push(value(rest, ln)); }
    }
    return out;
  }
  function map(ind) {
    const out = {};
    while (pos < lines.length && lines[pos].ind === ind && !isItem(lines[pos])) {
      const ln = lines[pos], m = KEY.exec(ln.t);
      if (!m) err(ln, 'expected "key: value"');
      const key = String(scalar(m[1], ln)), rest = ln.t.slice(m[0].length).trim();
      pos++;
      if (rest) out[key] = value(rest, ln);
      else { const nx = lines[pos]; out[key] = nx && (nx.ind > ind || (nx.ind === ind && isItem(nx))) ? block(nx.ind) : null; }
    }
    if (pos < lines.length && lines[pos].ind > ind) err(lines[pos], 'unexpected indentation');
    return out;
  }
  if (!lines.length) return {};
  const v = block(lines[0].ind);
  if (pos < lines.length) err(lines[pos], 'structure not understood');
  return v;
}
/* Pasted text or file: JSON when it starts with a brace, YAML otherwise. */
const parseAny = text => (/^\s*\{/.test(text) ? JSON.parse(text) : parseYaml(text));
/* FILE FORMAT of lab.yaml and catalog.yaml ("format:" key; missing = 1).
   Rules, so data entered today is never typed again:
   · Adding an optional field, a port type, a device type or a layer is NOT a new
     format: old files simply lack it.
   · Bump FORMAT only when old data would be misread (a field renamed, moved or
     with a new meaning), and add to UPGRADE the step that converts it in place.
   · Data from a newer format is refused (read-only), never rewritten by old code. */
const FORMAT = 1;
const UPGRADE = {
  /* 1: o => { ...turn a format 1 object into format 2... }, */
};
function upgrade(o) {
  if (!isObj(o)) return o;
  const f = o.format == null ? 1 : +o.format;
  if (!Number.isInteger(f) || f < 1) throw new Error('unknown data format "' + o.format + '"');
  if (f > FORMAT) throw new Error(`data written by a newer Labmap (format ${f}, this one reads up to ${FORMAT}): update Labmap`);
  for (let k = f; k < FORMAT; k++) UPGRADE[k](o);
  delete o.format;
  return o;
}
/* Every lab or catalog text from outside (server, backup, import, files) enters here. */
const readData = text => upgrade(parseAny(text));

/* ---------------------------------------------------------------------------
   12. Persistence and edit lock (NET)
   --------------------------------------------------------------------------- */
const TAB = 't' + Math.random().toString(36).slice(2, 10);     // identifies this browser tab
const LOG_MAX = 300, LOCK_TTL = 120000, IDLE_MAX = 600000, RENEW_EVERY = 40000, POLL_EVERY = 8000, CONNECT_MAX = 4000;
/* mode: boot | server | offline (the server stopped answering) | local (no server) */
const NET = { mode: 'boot', rev: 0, editing: false, lastAct: Date.now(), lastRenew: 0, saving: false, dirty: false, saveMsg: '', retry: 0, retryTimer: 0, localDirty: false, blocked: '' };
const withTimeout = (p, ms, fallback) => Promise.race([Promise.resolve(p), new Promise(r => setTimeout(() => r(fallback), ms))]);
const who = () => UI.user || 'anon';
const holder = () => who() + ':' + TAB;
function setMode(mode) { NET.mode = mode; renderHeader(); }
async function httpJson(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}
/* Ask server.py for the state. Returns false when there is no server (local mode). */
async function connectServer() {
  try {
    const r = await withTimeout(httpJson('GET', 'api/state'), CONNECT_MAX, null);
    if (r && r.status === 200 && r.j && r.j.labmap) { serverLoad(r.j); setMode('server'); setInterval(poll, POLL_EVERY); return true; }
  } catch (e) { /* no server */ }
  return false;
}
/* The state travels as the two YAML texts. */
function serverLoad(j) {
  let st;
  try { st = readData(j.lab || ''); if (!isObj(st)) st = {}; if (j.cat) st.catalog = readData(j.cat); st = normalize(st); }
  catch (e) {                                                       // never edit (and save) over data this page cannot read
    NET.blocked = 'Data not readable: ' + e.message + '. Read-only.'; NET.rev = +j.rev || 0;
    if (NET.editing) leaveEdit();
    showError(NET.blocked); renderHeader();
    return false;
  }
  NET.blocked = '';
  S = st;
  S.rev = +j.rev || 0;
  NET.rev = S.rev; NET.dirty = false; UNDO = null;
  refreshAll();
}
async function poll() {
  try {
    const r = await httpJson('GET', 'api/rev');
    if (r.status !== 200 || !r.j) throw new Error('HTTP ' + r.status);
    if (NET.mode === 'offline') setMode('server');
    if (NET.saving || NET.dirty || r.j.rev === NET.rev) return;      // unsaved local changes are never overwritten
    const s = await httpJson('GET', 'api/state');
    if (s.status !== 200 || !s.j || NET.saving || NET.dirty || s.j.rev === NET.rev) return;
    const was = S.rev, ed = NET.editing;
    serverLoad(s.j);
    if (ed) toast(`Changed by another user (rev ${was} → ${s.j.rev}). Reloaded.`, { sticky: true });
  } catch (e) { if (NET.mode === 'server') setMode('offline'); }
}
/* Save: one write at a time; changes made while writing are sent in the next round.
   If the server does not answer, the change stays pending and is retried (3 s, 6 s...
   up to 30 s) until it is saved; closing the page meanwhile asks first. */
function save() {
  if (NET.mode === 'local' || NET.mode === 'boot') { NET.localDirty = true; return; }
  NET.dirty = true; pump();
}
async function pump() {
  if (NET.saving || NET.blocked) return;
  clearTimeout(NET.retryTimer);
  NET.saving = true; NET.saveMsg = 'saving…'; renderHeader();
  try {
    while (NET.dirty) {
      NET.dirty = false;
      const rev = S.rev;
      const r = await httpJson('PUT', 'api/state', { rev, base: NET.rev, holder: holder(), by: who(), msg: (S.log[S.log.length - 1] || {}).msg || '', lab: toYaml(S, true), cat: toCatalogYaml(S.catalog) });
      if (r.status === 409 && r.j) { serverLoad(r.j); toast(`Someone saved first (rev ${r.j.rev}). Reloaded: repeat the change.`, { sticky: true }); break; }
      if (r.status === 423) { NET.rev = -1; leaveEdit('Lock lost. Editing: ' + ((r.j && r.j.by) || 'another user') + '.'); poll(); break; }
      if (r.status >= 400 && r.status < 500) { const e = new Error('HTTP ' + r.status + (r.j && r.j.error ? ': ' + r.j.error : '')); e.fatal = true; throw e; }
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      NET.rev = rev;
    }
    NET.saveMsg = ''; NET.retry = 0;
    if (NET.mode === 'offline') NET.mode = 'server';
  } catch (e) {
    NET.saveMsg = 'not saved';
    if (e && e.fatal) showError('Not saved (' + e.message + '). Export so the change is not lost.');
    else { NET.dirty = true; NET.retryTimer = setTimeout(pump, Math.min(30000, 3000 * Math.pow(2, NET.retry++))); }     // network or server error: keep it and try again
  } finally { NET.saving = false; renderHeader(); }
}
const unsaved = () => NET.dirty || NET.saving || (NET.mode === 'local' && NET.localDirty);
/* Edit lock: { acquired, by, expiresAt }. A small ttlMs releases it. */
async function lockCall(ttlMs) {
  const r = await httpJson('POST', 'api/lock', { holder: holder(), by: who(), ttlMs });
  if (r.status !== 200 || !r.j) throw new Error('HTTP ' + r.status);
  return r.j;
}
async function enterEdit() {
  if (NET.editing) return;
  if (!UI.user) return userDlg(() => enterEdit());                  // asked once
  if (NET.mode === 'local') return startEdit();
  if (NET.mode !== 'server') return toast('No connection to the server.');
  if (NET.blocked) return toast(NET.blocked, { sticky: true });
  const b = $('#b-edit'); b.disabled = true;
  try {
    const r = await lockCall(LOCK_TTL);
    if (!r.acquired) return toast(`Editing: ${r.by || 'another user'}. Locked until ${r.expiresAt ? new Date(r.expiresAt).toLocaleTimeString() : 'about 2 min'}.`, { sticky: true });
    const s = await httpJson('GET', 'api/state');                   // always start from the latest
    if (s.status === 200 && s.j && s.j.rev !== NET.rev) serverLoad(s.j);
    NET.lastRenew = Date.now();
    startEdit();
  } catch (e) { toast('Lock not available (' + ((e && e.message) || e) + ').', { sticky: true }); }
  finally { b.disabled = false; }
}
function startEdit() { NET.editing = true; NET.lastAct = Date.now(); document.body.classList.add('editing'); renderHeader(); renderTab(); renderDlg(); }
function leaveEdit(msg) {
  if (!NET.editing) return;
  NET.editing = false; UNDO = null;
  document.body.classList.remove('editing');
  if (NET.mode !== 'local' && NET.saveMsg !== 'not saved') lockCall(1000).catch(() => {});         // release: 1 s lock (kept while a save is pending)
  closeDlg(true); renderHeader(); renderTab();
  if (msg) toast(msg, { sticky: true });
}
async function renewLock() {
  NET.lastRenew = Date.now();
  if (NET.mode === 'local') return;
  try {
    const r = await lockCall(LOCK_TTL);
    if (!r.acquired && NET.editing) leaveEdit('Lock lost. Editing: ' + (r.by || 'another user') + '.');
  } catch (e) { /* retried on the next tick */ }
}
/* Edit clock: renews the lock and closes edit mode after 10 idle minutes. */
function tick() {
  if (!NET.editing) return;
  const idle = Date.now() - NET.lastAct;
  if (idle > IDLE_MAX) return leaveEdit('Edit mode closed: 10 minutes idle.');
  if (Date.now() - NET.lastRenew > RENEW_EVERY) renewLock();
  renderHeader();
}

/* Every data change goes through here: revision, log, save and redraw. */
function commit(msg, fn) {
  if (!NET.editing) { toast('Edit mode required.'); return false; }
  const prev = clone(S);
  try { fn(S); } catch (e) { S = normalize(prev); refreshAll(); throw e; }
  S.rev = (+S.rev || 0) + 1;
  S.log.push({ t: new Date().toISOString(), by: who(), msg, rev: S.rev });
  if (S.log.length > LOG_MAX) S.log = S.log.slice(-LOG_MAX);
  UNDO = { prev, msg };
  NET.lastAct = Date.now();
  refreshAll();
  save();
  toast(msg, { undo: true });
  return true;
}
function replaceState(st, msg) { return commit(msg, cur => { for (const k of ['catalog', 'vlans', 'devices', 'links', 'ipUse']) cur[k] = st[k]; }); }
function undo() { if (!UNDO) return; const u = UNDO; if (replaceState(normalize(u.prev), 'Undone: ' + u.msg)) { UNDO = null; hideToast(); toast('Undone: ' + u.msg); } }

/* ---------------------------------------------------------------------------
   13. UI state (the only thing that does not live in S) and shared pieces
   --------------------------------------------------------------------------- */
const MAP = { W: 140, HEAD: 30, ROW: 13, GAPY: 9, BAND: 22, COLGAP: 88, PADX: 70, TOP: 20 };
const UI = { tab: 'map', layers: {}, project: '', q: '', fit: false, zoom: 1, sel: null, selLink: null, vlan: '', ipBlock: null, dq: '', dtype: '', cq: '', clayer: '', logN: 40, lastWho: '', center: null, user: '' };
for (const k of LAYER_KEYS) UI.layers[k] = true;
let LAYOUT = null;      // last map layout (to centre on a device)

function showError(t) { if (typeof window !== 'undefined' && typeof window.showErr === 'function') window.showErr(t); else console.error(t); }
let toastTimer = 0;
function toast(msg, o) {
  o = o || {};
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (o.undo && UNDO ? '<button data-act="undo">Undo</button>' : '') + (o.sticky ? '<button data-act="toast-x">OK</button>' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  if (!o.sticky) toastTimer = setTimeout(hideToast, o.undo ? 7000 : 3500);
}
function hideToast() { $('#toast').hidden = true; clearTimeout(toastTimer); }
const tagBtn = l => `<button class="tag" data-act="cable" data-id="${esc(l.id)}">${esc(l.id || '?')}</button>`;
const devBtn = (n, label) => `<button class="linkb" data-act="dev" data-dev="${esc(n)}">${esc(label || n)}</button>`;
const refBtn = ref => devBtn(refDev(ref), ref);
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
const fld = (label, inner) => `<label class="fld"><span>${label}</span>${inner}</label>`;
const inp = (f, v, extra) => `<input type="text" data-f="${esc(f)}" value="${esc(v == null ? '' : v)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${extra || ''}>`;
function fillSelect(el, options, value) { el.innerHTML = options.map(o => opt(o[0], o[1], value)).join(''); el.value = value; }
const projects = () => [...new Set(IX.names.map(n => S.devices[n].project || '').filter(Boolean))].sort(natCmp);
const issueHtml = i => `<div class="iss ${i.level}"><b>${i.level === 'err' ? 'Error' : 'Warning'}</b><span>${esc(i.msg)}</span></div>`;
function routeHtml(r) { return '<div class="chain">' + r.hops.map(h => esc(h.from) + '<span class="ar">→</span>' + tagBtn(h.link) + '<span class="ar">→</span>' + esc(h.to)).join(' <span class="ar">·</span> ') + '</div>'; }
function fillLists() {
  $('#dl-proj').innerHTML = projects().map(p => `<option value="${esc(p)}">`).join('');
  const ppl = new Set([UI.user]);
  for (const n of IX.names) ppl.add(S.devices[n].owner);
  for (const e of S.ipUse) ppl.add(e.who);
  for (const e of S.log) ppl.add(e.by);
  $('#dl-people').innerHTML = [...ppl].filter(Boolean).sort(natCmp).map(p => `<option value="${esc(p)}">`).join('');
}

function refreshAll() { reindex(); fillLists(); renderHeader(); renderTab(); renderDlg(); }

function renderHeader() {
  if (!IX) return;
  $('#ver').textContent = 'v' + VERSION;
  const st = $('#st-store');
  const M = { boot: ['starting…', ''], offline: ['offline', 'warn'], local: ['local · rev ' + S.rev, 'warn'], server: ['server · rev ' + S.rev + (NET.saveMsg ? ' · ' + NET.saveMsg : ''), NET.saveMsg === 'not saved' ? 'err' : 'ok'] }[NET.mode];
  st.textContent = M[0];
  st.className = 'chip ' + M[1];
  const e = IX.issues.filter(i => i.level === 'err').length, w = IX.issues.length - e;
  const bi = $('#b-issues');
  bi.textContent = (e ? plural(e, 'error') : '') + (e && w ? ' · ' : '') + (w ? plural(w, 'warning') : '') || 'no issues';
  bi.className = 'chip ' + (e ? 'err' : w ? 'warn' : 'ok');
  const be = $('#b-edit');
  if (NET.editing) { const left = Math.max(0, IDLE_MAX - (Date.now() - NET.lastAct)); be.textContent = left < 180000 ? 'Done (' + Math.ceil(left / 60000) + ' min)' : 'Done'; be.className = 'btn sm pri'; }
  else { be.textContent = 'Edit'; be.className = 'btn sm'; }
  let note = '';
  if (NET.mode === 'local') note = 'Local mode: changes are not saved. Use Data → Export.';
  else if (NET.mode === 'offline') note = 'No connection to the server.';
  if (NET.editing) note = 'Editing as ' + who() + (NET.mode === 'local' ? ' (local, not saved).' : '. Every change is saved.');
  if (NET.saveMsg === 'not saved') note = 'Not saved yet: the server does not answer. Retrying. Keep this page open.';
  if (NET.blocked) note = NET.blocked;
  $('#notice').hidden = !note; $('#notice-t').textContent = note;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === UI.tab);
}
function setTab(t) {
  if (!document.getElementById('t-' + t)) t = 'map';
  UI.tab = t;
  for (const s of document.querySelectorAll('main .tab')) s.hidden = s.id !== 't-' + t;
  renderHeader(); renderTab();
  try { if (location.hash.slice(1) !== t) location.hash = t; } catch (e) {}
}
function renderTab() {
  if (!IX) return;
  ({ map: renderMapTab, devices: renderDevices, cables: renderCables, power: renderPower, ips: renderIps, issues: renderIssues, catalog: renderCatalog, data: renderData })[UI.tab]();
}

/* ---------------------------------------------------------------------------
   14. Map (hand-built SVG)
   --------------------------------------------------------------------------- */
function renderMapTab() {
  const s = IX.stats;
  const cell = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  $('#summary').innerHTML = cell(s.devs, 'devices') + cell(s.links, 'cables') + cell(s.ports, 'ports') +
    cell(s.sw[0] + '/' + s.sw[1], 'free on switches') + cell(s.pdu[0] + '/' + s.pdu[1], 'free on PDUs') + cell(s.hub[0] + '/' + s.hub[1], 'free on USB hubs');
  const pj = projects();
  if (UI.project && !pj.includes(UI.project)) UI.project = '';
  fillSelect($('#f-proj'), [['', 'All projects']].concat(pj.map(p => [p, 'Project ' + p])), UI.project);
  const count = {};
  for (const l of S.links) count[l.type] = (count[l.type] || 0) + 1;
  $('#layers').innerHTML = LAYER_KEYS.filter(k => count[k] || !UI.layers[k]).map(k => `<button class="lay${UI.layers[k] ? ' on' : ''}" data-act="layer" data-l="${k}" aria-pressed="${UI.layers[k]}"><i style="background:var(--L-${k})"></i>${LAYERS[k].label} <small>${count[k] || 0}</small></button>`).join('') +
    '<button class="lay on" data-act="layers-all">All</button><button class="lay on" data-act="layers-none">None</button>';
  $('#b-fit').textContent = UI.fit ? 'Actual size' : 'Fit width';
  renderMap();
}

/* Map column of a device, by role:
   0 power infrastructure (wall, UPS, strips, PDUs, relay boards)
   1 supplies and power distribution (bench supplies, boxes that only pass power on)
   2 devices, grouped by project
   3 adapters, hubs and bus couplers
   4 network infrastructure (switches, routers, access points, servers, radio hubs)
   Power flows left to right into the devices; data flows right from them. */
const POWER_INFRA = ['wall', 'ups', 'strip', 'pdu', 'relay'], NET_INFRA = ['router', 'switch', 'ap', 'server', 'radiohub'];
const MAP_COLS = ['Power', 'Supplies', 'Devices', 'Adapters', 'Network'];
function mapCol(n) {
  const d = S.devices[n], t = d.types;
  if (t.some(x => POWER_INFRA.includes(x))) return 0;
  if (t.some(x => NET_INFRA.includes(x))) return 4;
  const real = d.ports.filter(p => !p.virtual);
  if (t.includes('psu') || (real.length && real.every(p => layerOf(p.kind) === 'power') && real.some(p => powerDir(p.kind) === 'out'))) return 1;
  return passMode(n) ? 3 : 2;
}
function searchMatch(q) {
  const hits = new Set(), qm = q.replace(/[^0-9a-f]/g, '');
  for (const n of IX.names) {
    const d = S.devices[n];
    if (n.toLowerCase().includes(q) || (d.serial || '').toLowerCase().includes(q)) { hits.add(n); continue; }
    for (const p of d.ports) if ((p.ip && p.ip.includes(q)) || (p.mac && (p.mac.toLowerCase().includes(q) || (qm.length >= 4 && normMac(p.mac).replace(/:/g, '').includes(qm))))) { hits.add(n); break; }
  }
  return hits;
}

function buildMap() {
  const M = MAP, all = IX.names;
  /* 1. which devices and cables are visible */
  let vis = new Set(all), coreLinks = null;
  if (UI.project) {
    vis = new Set(all.filter(n => (S.devices[n].project || '') === UI.project));
    coreLinks = new Set();
    for (const n of [...vis]) for (const p of S.devices[n].ports) for (const r of routesFrom(n + ':' + p.name)) for (const h of r.hops) { coreLinks.add(h.link); for (const ref of [h.from, h.to]) if (S.devices[refDev(ref)]) vis.add(refDev(ref)); }
  }
  const links = [];
  for (const l of S.links) {
    if (!UI.layers[linkLayer(l)] || !vis.has(refDev(l.a)) || !vis.has(refDev(l.b))) continue;
    if (coreLinks && !coreLinks.has(l)) continue;
    links.push({ l, a: l.a, b: l.b, type: linkLayer(l), id: l.id });
  }
  /* 2. boxes: one row per port with a visible cable */
  const box = new Map();
  for (const n of vis) box.set(n, { n, d: S.devices[n], rows: new Map(), col: 0, x: 0, y: 0, h: 0 });
  for (const k of links) for (const e of ['a', 'b']) { const [dn, pn] = splitRef(k[e]); const b = box.get(dn); if (!b.rows.has(pn)) b.rows.set(pn, { pn, links: [], y: 0, side: 1 }); b.rows.get(pn).links.push(k); }
  for (const b of box.values()) b.h = M.HEAD + b.rows.size * M.ROW + (b.rows.size ? 6 : 0);
  /* 3. columns by role; devices stacked by project, everything else level with what it connects */
  for (const b of box.values()) b.col = mapCol(b.n);
  const colX = c => M.PADX + c * (M.W + M.COLGAP);
  const peers = b => { const o = []; for (const r of b.rows.values()) for (const k of r.links) for (const e of ['a', 'b']) { const dn = refDev(k[e]); if (dn !== b.n) o.push(box.get(dn)); } return o; };
  const bands = [], placed = new Set();
  { const groups = new Map();
    for (const b of box.values()) if (b.col === 2) push(groups, b.d.project || '', b);
    let y = M.TOP;
    for (const g of [...groups.keys()].sort((a, b) => (a === '') - (b === '') || natCmp(a, b))) {
      const bs = groups.get(g).sort((p, q) => natCmp(p.n, q.n)), y0 = y;
      y += M.BAND;
      for (const b of bs) { b.x = colX(2); b.y = y; y += b.h + M.GAPY; placed.add(b); }
      bands.push({ g, x: colX(2) - 6, y: y0, w: M.W + 12, h: y - y0 - M.GAPY + 7 });
      y += 14;
    } }
  for (const c of [1, 3, 0, 4]) {                              // nearest columns first: each box at the barycentre of its peers
    const bs = [...box.values()].filter(b => b.col === c), want = new Map();
    for (const b of bs) { const ys = peers(b).filter(o => placed.has(o)).map(o => o.y + o.h / 2); if (ys.length) want.set(b, avg(ys)); }
    for (let pass = 0; pass < 3; pass++) for (const b of bs) if (!want.has(b)) { const ys = peers(b).filter(o => want.has(o)).map(o => want.get(o)); if (ys.length) want.set(b, avg(ys)); }
    bs.sort((p, q) => (want.has(p) ? want.get(p) : 1e9) - (want.has(q) ? want.get(q) : 1e9) || natCmp(p.n, q.n));
    let y = M.TOP + M.BAND;
    for (const b of bs) { b.x = colX(c); b.y = want.has(b) ? Math.max(y, Math.round(want.get(b) - b.h / 2)) : y; y = b.y + b.h + M.GAPY; placed.add(b); }
  }
  /* 4. rows ordered by where the other end is, and the exit side of each cable */
  /* same column: outer columns bulge outwards, inner ones towards the devices, devices by layer */
  const sideFor = (b, o, k) => (o.col > b.col ? 1 : o.col < b.col ? -1 : b.col === 0 || b.col === 3 ? -1 : b.col === 4 || b.col === 1 ? 1 : k.type === 'power' ? -1 : 1);
  for (const b of box.values()) {
    const rows = [...b.rows.values()], me = pn => b.n + ':' + pn;
    for (const r of rows) { const k = r.links[0], o = box.get(refDev(k.a === me(r.pn) ? k.b : k.a)); r.peerY = o.y + o.h / 2; r.side = sideFor(b, o, k); }
    rows.sort((p, q) => p.peerY - q.peerY || natCmp(p.pn, q.pn));
    rows.forEach((r, i) => { r.y = b.y + M.HEAD + i * M.ROW + M.ROW / 2 + 2; });
    b.rowList = rows;
  }
  let H = 60;
  for (const b of box.values()) H = Math.max(H, b.y + b.h + 16);
  const W = M.PADX * 2 + 5 * M.W + 4 * M.COLGAP;
  /* 5. cable geometry */
  for (const k of links) {
    const [an, ap] = splitRef(k.a), [bn, bp] = splitRef(k.b), A = box.get(an), B = box.get(bn);
    const sa = sideFor(A, B, k), sb = sideFor(B, A, k);
    const x1 = sa > 0 ? A.x + M.W : A.x, y1 = A.rows.get(ap).y, x2 = sb > 0 ? B.x + M.W : B.x, y2 = B.rows.get(bp).y;
    const dx = A.col === B.col ? 16 + Math.min(48, Math.abs(y2 - y1) * 0.1) : Math.max(28, Math.abs(x2 - x1) * 0.45);
    const c1 = Math.round(x1 + sa * dx), c2 = Math.round(x2 + sb * dx);
    k.d = `M${x1} ${y1}C${c1} ${y1} ${c2} ${y2} ${x2} ${y2}`;
    k.mid = [Math.round((x1 + 3 * c1 + 3 * c2 + x2) / 8), Math.round((y1 + y2) / 2)];
    k.devs = [an, bn];
    k.far = Math.abs(A.col - B.col) >= 3;
  }
  return { W, H, box, links, bands, colX };
}

/* The map as SVG text. o.scale: 0 = fit width; o.hits: search matches; o.style: CSS to
   embed (standalone export). */
function mapSvg(o) {
  const M = MAP, L = buildMap(), hits = o.hits || null;
  const selOn = (UI.sel && L.box.has(UI.sel)) || UI.selLink;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="map${selOn ? ' has-sel' : ''}" viewBox="0 0 ${L.W} ${L.H}" ${o.scale ? `width="${Math.round(L.W * o.scale)}" height="${Math.round(L.H * o.scale)}"` : 'width="100%"'} data-act="map-bg" role="img" aria-label="Map of devices and cables">`);
  if (o.style) out.push('<style>' + o.style.replace(/</g, '&lt;') + '</style>');
  out.push(`<rect class="bg" width="${L.W}" height="${L.H}"/>`);
  MAP_COLS.forEach((t, i) => out.push(`<text class="cap" x="${L.colX(i)}" y="12">${t}</text>`));
  for (const b of L.bands) out.push(`<rect class="band" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/><text class="bandt" x="${b.x + 8}" y="${b.y + 15}">${esc(trunc(b.g || 'No project', 20))}</text>`);
  const tags = [];
  for (const k of L.links) {
    const hl = (UI.sel && k.devs.includes(UI.sel)) || (UI.selLink && k.id === UI.selLink);
    const dim = hits && !hits.has(k.devs[0]) && !hits.has(k.devs[1]);
    out.push(`<g class="lk ln-${k.type}${k.far ? ' far' : ''}${hl ? ' hl' : ''}${dim ? ' dim' : ''}" data-act="cable" data-id="${esc(k.id)}"><path class="v" d="${k.d}"/><path class="hit" d="${k.d}"/></g>`);
    if (hl && k.id) tags.push(k);
  }
  for (const b of L.box.values()) {
    const d = b.d, t0 = d.types[0], ip = firstIp(d), iss = IX.issueDev.get(b.n);
    const cls = ['dev', b.col === 0 || b.col === 4 ? 'infra' : '', b.col === 3 ? 'pass' : '', UI.sel === b.n ? 'sel' : '', hits ? (hits.has(b.n) ? 'hitq' : 'dim') : ''].filter(Boolean).join(' ');
    out.push(`<g class="${cls}" data-act="dev" data-dev="${esc(b.n)}" data-col="${b.col}" data-map="1" transform="translate(${b.x} ${b.y})"><rect class="bx" width="${M.W}" height="${b.h}" rx="5"/>`);
    out.push(`<text class="nm" x="7" y="13">${esc(trunc(b.n, 19))}</text><text class="sb" x="7" y="24">${esc(trunc(((TYPES[t0] && TYPES[t0].tag) || t0) + (ip ? ' · ' + ip : ''), 26))}</text>`);
    if (iss) out.push(`<circle class="i-${iss}" cx="${M.W - 9}" cy="9" r="4"/>`);
    if (b.rowList.length) out.push(`<line class="sep" x1="0" x2="${M.W}" y1="${M.HEAD - 1}" y2="${M.HEAD - 1}"/>`);
    for (const r of b.rowList) {
      const right = r.side > 0, ry = r.y - b.y;
      out.push(`<text class="pt${IX.ports.has(b.n + ':' + r.pn) ? '' : ' bad'}" x="${right ? M.W - 7 : 7}" y="${ry + 3}" text-anchor="${right ? 'end' : 'start'}">${esc(trunc(r.pn, 18))}</text><circle class="pf-${r.links[0].type}" cx="${right ? M.W : 0}" cy="${ry}" r="2.6"/>`);
    }
    out.push('</g>');
  }
  for (const k of tags) { const w = k.id.length * 5.4 + 8; out.push(`<g class="ltag" data-act="cable" data-id="${esc(k.id)}"><rect x="${k.mid[0] - w / 2}" y="${k.mid[1] - 7}" width="${w}" height="13" rx="2"/><text x="${k.mid[0]}" y="${k.mid[1] + 3}" text-anchor="middle">${esc(k.id)}</text></g>`); }
  out.push('</svg>');
  return { svg: out.join(''), L };
}
function renderMap() {
  const q = UI.q.trim().toLowerCase(), hits = q ? searchMatch(q) : null;
  const r = mapSvg({ scale: UI.fit ? 0 : UI.zoom, hits }), L = r.L;
  LAYOUT = L;
  $('#map').innerHTML = r.svg;
  $('#map-hint').textContent = IX.names.length ? `${plural(L.box.size, 'device')} · ${plural(L.links.length, 'cable')}` + (hits ? ` · ${hits.size} ${hits.size === 1 ? 'match' : 'matches'}` : '') : 'No devices. Edit > + Device, or Data > Load example.';
  if (UI.center) { const n = UI.center; UI.center = null; centerOn(n); }
}
/* The whole map (every layer, no filter, no selection) as a standalone SVG file, with
   the page's map styles embedded and resolved to the light theme. */
function mapCss() {
  const root = document.documentElement, had = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  const cs = getComputedStyle(root), out = [];
  for (const sh of document.styleSheets) { let rules = []; try { rules = sh.cssRules; } catch (e) {} for (const r of rules) if (r.selectorText && /svg\.map|\.ln-|\.pf-/.test(r.selectorText)) out.push(r.cssText); }
  const css = out.join('\n').replace(/var\((--[\w-]+)\)/g, (m, v) => cs.getPropertyValue(v).trim() || m);
  if (had == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', had);
  return css;
}
function exportMapSvg() {
  const keep = { layers: UI.layers, project: UI.project, sel: UI.sel, selLink: UI.selLink };
  UI.layers = {}; for (const k of LAYER_KEYS) UI.layers[k] = true;
  UI.project = ''; UI.sel = UI.selLink = null;
  try { return mapSvg({ scale: 1, style: mapCss() }).svg; } finally { Object.assign(UI, keep); }
}
function centerOn(name) {
  const b = LAYOUT && LAYOUT.box.get(name), w = $('#mapwrap'), svg = $('#map svg');
  if (!b || !svg) return;
  const k = svg.getBoundingClientRect().width / LAYOUT.W;
  w.scrollLeft = Math.max(0, (b.x + MAP.W / 2) * k - w.clientWidth / 2);
  w.scrollTop = Math.max(0, (b.y + b.h / 2) * k - w.clientHeight / 2);
}

/* ---------------------------------------------------------------------------
   15. Tabs: devices, cables, power, IPs, issues, catalog, data
   --------------------------------------------------------------------------- */
function renderDevices() {
  const types = [...new Set(IX.names.flatMap(n => S.devices[n].types))].sort((a, b) => natCmp(typeLabel(a), typeLabel(b)));
  fillSelect($('#d-type'), [['', 'All types']].concat(types.map(t => [t, typeLabel(t)])), UI.dtype);
  const q = UI.dq.trim().toLowerCase(), hits = q ? searchMatch(q) : null, groups = new Map();
  for (const n of IX.names) {
    const d = S.devices[n];
    if (UI.dtype && !d.types.includes(UI.dtype)) continue;
    if (hits && !hits.has(n) && !(d.project || '').toLowerCase().includes(q) && !(d.notes || '').toLowerCase().includes(q) && !(d.location || '').toLowerCase().includes(q) && !(d.model || '').toLowerCase().includes(q)) continue;
    push(groups, d.project || '', n);
  }
  let h = '';
  for (const g of [...groups.keys()].sort(natCmp)) {
    h += `<div class="list" style="margin-bottom:10px"><div class="gh">${esc(g || 'No project')} · ${groups.get(g).length}</div>`;
    for (const n of groups.get(g)) {
      const d = S.devices[n], iss = IX.issueDev.get(n), ips = d.ports.filter(p => p.ip).map(p => p.ip), used = d.ports.filter(p => linksOf(n + ':' + p.name).length).length;
      h += `<button class="item" data-act="dev" data-dev="${esc(n)}"><span class="nm">${esc(n)}</span>${d.types.map(t => `<span class="chip">${esc(typeLabel(t))}</span>`).join('')}${iss ? `<i class="dot ${iss}"></i>` : ''}<span class="sp mono">${esc(ips[0] || '')}${ips.length > 1 ? ' +' + (ips.length - 1) : ''}</span><span class="sub">${used}/${d.ports.length} ports cabled${d.model ? ' · ' + esc(d.model) : ''}${d.location ? ' · ' + esc(d.location) : ''}${d.notes ? ' · ' + esc(trunc(d.notes, 70)) : ''}</span></button>`;
    }
    h += '</div>';
  }
  $('#dev-list').innerHTML = h || '<p class="mut">No results.</p>';
}

/* Cables that pass the filter of the Cables tab, by id. */
function shownCables() {
  const q = UI.cq.trim().toLowerCase();
  return S.links.filter(l => (!UI.clayer || linkLayer(l) === UI.clayer) && (!q || (l.id + ' ' + l.a + ' ' + l.b + ' ' + (l.notes || '')).toLowerCase().includes(q))).sort((a, b) => natCmp(a.id, b.id));
}
function renderCables() {
  fillSelect($('#c-layer'), [['', 'All layers']].concat(LAYER_KEYS.map(k => [k, LAYERS[k].label])), UI.clayer);
  const ls = shownCables();
  let h = `<p class="mut">${ls.length} of ${plural(S.links.length, 'cable')}</p><div class="list">`;
  for (const l of ls.slice(0, 600)) h += `<button class="item" data-act="cable" data-id="${esc(l.id)}"><span class="tag">${esc(l.id || '?')}</span><span class="k k-${linkLayer(l)}">${LAYERS[linkLayer(l)].label}</span><span class="mono">${esc(l.a)} ${l.type === 'power' ? '→' : '↔'} ${esc(l.b)}</span>${l.notes ? `<span class="sub">${esc(l.notes)}</span>` : ''}</button>`;
  h += '</div>' + (ls.length > 600 ? '<p class="mut">First 600 shown. Filter to see more.</p>' : '');
  $('#cab-list').innerHTML = ls.length ? h : '<p class="mut">No results.</p>';
}

function renderPower() {
  const depth = n => Math.max.apply(null, chainsUp(n).map(c => c.length));
  const srcs = IX.names.filter(n => S.devices[n].types.some(t => TYPES[t] && TYPES[t].src) || powerOut(n).length).map(n => [n, depth(n)]).sort((a, b) => a[1] - b[1] || natCmp(a[0], b[0]));
  let h = srcs.length ? '<div class="cards">' : '<p class="mut">No power sources.</p><div class="cards">';
  for (const [n] of srcs) {
    const d = S.devices[n];
    const outsP = d.ports.filter(p => (layerOf(p.kind) === 'power' && powerDir(p.kind) !== 'in') || linksOf(n + ':' + p.name).some(l => l.type === 'power' && l.a === n + ':' + p.name));
    const all = cascade(new Set([n])), free = outsP.filter(p => !linksOf(n + ':' + p.name).length).length, ups = chainsUp(n).filter(c => c.length);
    h += `<div class="card"><h4>${devBtn(n)} ${d.types.map(t => `<span class="chip">${esc(typeLabel(t))}</span>`).join('')}</h4>`;
    h += `<div class="mut" style="font-size:12.5px">${ups.length ? 'From ' + ups.map(c => c.slice().reverse().map(l => esc(l.a)).join(' → ')).join(' <b>and</b> ') : 'No inlet'}</div>`;
    h += `<div style="font-size:12.5px;margin-top:4px">${plural(outsP.length, 'outlet')} · ${free} free · off takes down <b>${all.down.length}</b>${all.degraded.length ? ' · lose one inlet: ' + all.degraded.map(esc).join(', ') : ''}</div><div class="outl">`;
    for (const p of outsP) {
      const ls = linksOf(n + ':' + p.name).filter(l => l.type === 'power' && l.a === n + ':' + p.name);
      h += `<span class="o">${esc(p.name)}</span>`;
      if (!ls.length) { h += '<span class="free">free</span>'; continue; }
      const c = cascade(new Set(), new Set(ls)), direct = new Set(ls.map(l => refDev(l.b))), more = c.down.filter(x => !direct.has(x));
      h += '<span>' + ls.map(l => tagBtn(l) + ' ' + refBtn(l.b)).join(', ') + (more.length ? `<br><span class="mut">cascade (${more.length}): ${more.map(x => devBtn(x)).join(', ')}</span>` : '') + (c.degraded.length ? `<br><span class="mut">loses one inlet: ${c.degraded.map(esc).join(', ')}</span>` : '') + '</span>';
    }
    h += '</div></div>';
  }
  $('#pow').innerHTML = h + '</div>';
}

function ipGrid(vn, from, to, lo, hi) {
  let h = '<div class="ipg">';
  for (let n = from; n <= to; n++) h += `<button class="ipc s-${n < lo || n > hi ? 'res' : ipInfo(vn, n).state}" data-act="ip" data-v="${esc(vn)}" data-ip="${n}" title="${intToIp(n)}">${n % 256}</button>`;
  return h + '</div><div class="legend" style="margin-top:8px"><span><i style="background:var(--ip-free)"></i>free</span><span><i style="background:var(--ip-fixed)"></i>on a port</span><span><i style="background:var(--ip-noted)"></i>noted</span><span><i style="background:var(--err)"></i>conflict</span><span><i style="border:1px dashed var(--line)"></i>network / broadcast</span></div>';
}
function renderIps() {
  const vl = Object.keys(S.vlans).sort(natCmp), none = '<span class="mut">not set</span>';
  if (!UI.vlan || !S.vlans[UI.vlan]) UI.vlan = vl.slice().sort((a, b) => IX.ip[b].fixed.size - IX.ip[a].fixed.size)[0] || '';      // default: the busiest
  let h = '<div class="lays">' + vl.map(v => `<button class="lay${v === UI.vlan ? ' on' : ''}" data-act="vlan" data-v="${esc(v)}">${esc(v)} <small>${esc(S.vlans[v].id == null ? '' : S.vlans[v].id)}</small></button>`).join('') + '<button class="lay on ed" data-act="vlan-edit" data-v="">+ VLAN</button></div>';
  if (UI.vlan) {
    const vn = UI.vlan, v = S.vlans[vn], V = IX.ip[vn], c = V.cidr;
    h += `<dl class="kv" style="margin-top:12px"><dt>VLAN</dt><dd><b>${esc(vn)}</b> · id ${esc(v.id == null ? '?' : v.id)} · <span class="chip">${v.scope === 'it' ? 'IT' : 'local'}</span></dd><dt>Subnet</dt><dd class="mono">${esc(v.subnet || 'none')}</dd>`;
    if (c) {
      const [lo, hi] = hostRange(c);
      h += `<dt>Netmask</dt><dd class="mono" id="msk">${maskOf(c)}</dd><dt>Hosts</dt><dd class="mono">${intToIp(lo)} – ${intToIp(hi)} <span class="mut">(${hi - lo + 1} usable)</span></dd>` + (c.bits < 31 ? `<dt>Broadcast</dt><dd class="mono">${intToIp(c.last)}</dd>` : '');
    }
    h += `<dt>Gateway</dt><dd class="mono">${v.gateway ? esc(v.gateway) : none}</dd><dt>DNS</dt><dd class="mono">${v.dns ? esc(v.dns) : none}</dd>` + (v.notes ? `<dt>Notes</dt><dd>${esc(v.notes)}</dd>` : '') + '</dl>';
    h += `<div class="row" style="margin:8px 0"><button class="btn pri ed" data-act="ip-give" data-v="${esc(vn)}">Give me an IP</button><button class="btn sm ed" data-act="vlan-edit" data-v="${esc(vn)}">Edit VLAN</button></div>`;
    if (!c) h += '<p class="mut">Invalid subnet. Format: 192.168.50.0/24.</p>';
    else if (c.size <= 256) h += ipGrid(vn, c.base, c.last, ...hostRange(c));
    else if (c.size <= 65536) {                                // large subnet: grid in blocks of 256
      const blocks = [];
      for (let b = c.base; b <= c.last; b += 256) blocks.push(b);
      const usedIn = b => { let k = 0; for (const n of V.fixed.keys()) if (n >= b && n < b + 256) k++; for (const u of V.uses) if (u.from < b + 256 && u.to >= b) k++; if (V.gw != null && V.gw >= b && V.gw < b + 256) k++; return k; };
      if (UI.ipBlock == null || !blocks.includes(UI.ipBlock)) { const f = blocks.find(b => usedIn(b)); UI.ipBlock = f === undefined ? c.base : f; }
      h += `<p class="mut">${c.size} addresses, in blocks of 256</p><div class="lays" style="margin-bottom:8px">` +
        blocks.map(b => `<button class="lay${b === UI.ipBlock ? ' on' : ''}" data-act="ip-block" data-b="${b}">${intToIp(b).replace(/\.\d+$/, '.x')} <small>${usedIn(b) || ''}</small></button>`).join('') + '</div>' + ipGrid(vn, UI.ipBlock, UI.ipBlock + 255, ...hostRange(c));
    } else h += `<p class="mut">${c.size} addresses: list only.</p>`;
    const rows = [];
    if (V.gw != null) rows.push({ n: V.gw, to: V.gw, h: 'Gateway', note: '' });
    for (const [n, refs] of V.fixed) rows.push({ n, to: n, h: refs.map(refBtn).join(', '), note: 'on a port', st: ipInfo(vn, n).state });
    for (const u of V.uses) rows.push({ n: u.from, to: u.to, h: esc(u.e.who || '?') + (u.e.iface ? ' · ' + refBtn(u.e.iface) : ''), note: esc(u.e.notes || '') });
    rows.sort((a, b) => a.n - b.n);
    h += `<h3>In use in ${esc(vn)} (${rows.length})</h3><div class="list">`;
    for (const r of rows) h += `<div class="item"><button class="linkb" data-act="ip" data-v="${esc(vn)}" data-ip="${r.n}">${intToIp(r.n)}${r.to !== r.n ? '–' + intToIp(r.to) : ''}</button>${r.st === 'conf' ? '<i class="dot err"></i>' : ''}<span>${r.h}</span><span class="sub">${r.note}</span></div>`;
    h += (rows.length ? '' : '<div class="item mut">Nothing in use.</div>') + '</div>';
    /* members: every port in this VLAN, switch ports first */
    const mem = [];
    for (const [ref, P] of IX.ports) {
      const tagged = (P.p.vlans || []).includes(vn);
      if (P.p.vlan !== vn && !tagged) continue;
      mem.push({ ref, tagged, sw: P.d.types.some(t => t === 'switch' || t === 'router'), ip: P.p.ip || '', peers: linksOf(ref).map(l => (l.a === ref ? l.b : l.a)) });
    }
    mem.sort((a, b) => b.sw - a.sw || natCmp(a.ref, b.ref));
    h += `<h3>Members of ${esc(vn)} (${mem.length})</h3><div class="list">`;
    for (const m of mem) h += `<div class="item">${refBtn(m.ref)}<span class="chip">${m.tagged ? 'tagged' : m.sw ? 'access' : 'interface'}</span><span class="mono">${esc(m.ip)}</span><span class="sub">${m.peers.length ? '↔ ' + m.peers.map(esc).join(', ') : 'no cable'}</span></div>`;
    h += (mem.length ? '' : '<div class="item mut">No ports in this VLAN.</div>') + '</div>';
  } else h += '<p class="mut">No VLANs.</p>';
  const lost = IX.ip[''];
  if (lost && lost.fixed.size) h += '<h3>IPs without a VLAN</h3><div class="list">' + [...lost.fixed].map(([n, refs]) => `<div class="item"><span class="mono">${intToIp(n)}</span><span>${refs.map(refBtn).join(', ')}</span></div>`).join('') + '</div>';
  h += `<h3>IP notes, all VLANs (${S.ipUse.length})</h3><div class="list">`;
  S.ipUse.forEach((e, i) => {
    h += `<div class="item"><span class="chip">${esc(e.vlan || 'no VLAN')}</span><span class="mono">${esc(e.from || '')}${e.to ? '–' + esc(e.to) : ''}</span><span>${esc(e.who || '')}</span><span class="sp ed"><button class="btn sm" data-act="ipuse-edit" data-i="${i}">Edit</button> <button class="btn sm dan" data-act="ipuse-del" data-i="${i}">Delete</button></span><span class="sub">${e.iface ? 'only for ' + esc(e.iface) + ' · ' : ''}${esc(e.notes || '')}</span></div>`;
  });
  h += (S.ipUse.length ? '' : '<div class="item mut">None.</div>') + '</div><p><button class="btn ed" data-act="ip-give" data-v="">+ IP note</button></p>';
  $('#ips').innerHTML = h;
}

function renderIssues() {
  const e = IX.issues.filter(i => i.level === 'err'), w = IX.issues.filter(i => i.level === 'warn');
  const row = i => `<button class="item" data-act="issue" data-dev="${esc(i.dev || '')}" data-link="${esc(i.link || '')}" data-v="${esc(i.vlan || '')}"><i class="dot ${i.level}"></i><span style="flex:1;min-width:0">${esc(i.msg)}</span></button>`;
  let h = `<h3 style="margin-top:0">Errors (${e.length})</h3>` + (e.length ? '<div class="list">' + e.map(row).join('') + '</div>' : '<p class="mut">None.</p>');
  h += `<h3>Warnings (${w.length})</h3>` + (w.length ? '<div class="list">' + w.map(row).join('') + '</div>' : '<p class="mut">None.</p>');
  $('#issues').innerHTML = h;
}

function renderCatalog() {
  const pt = CAT.portTypes, tp = CAT.templates, tk = Object.keys(tp).sort((a, b) => natCmp(tp[a].label, tp[b].label)), pk = catKeys();
  const used = {};
  for (const P of IX.ports.values()) used[P.p.kind] = (used[P.p.kind] || 0) + 1;
  let h = '<div class="row"><button class="btn pri ed" data-act="import" data-k="cat">+ Template or type</button><button class="btn ed" data-act="cat-edit">Edit YAML</button><button class="btn" data-act="export" data-k="cat">Export</button></div>';
  h += `<h3>Templates (${tk.length})</h3><div class="list">`;
  for (const k of tk) {
    const t = tp[k];
    h += `<div class="item"><span class="nm">${esc(k)}</span><span>${esc(t.label)}</span><span class="sp ed"><button class="btn sm dan" data-act="tpl-del" data-k="${esc(k)}">Delete</button></span><span class="sub">${t.types.map(typeLabel).map(esc).join(', ')}${t.model ? ' · ' + esc(t.model) : ''} · <span class="mono">${esc(t.pattern)}</span> · ${plural(parsePorts(t.ports.join('\n')).length, 'port')}: <span class="mono">${esc(t.ports.join(', '))}</span></span></div>`;
  }
  h += (tk.length ? '' : '<div class="item mut">No templates.</div>') + '</div>';
  h += `<h3>Port types (${pk.length})</h3><div class="tw"><table class="pt"><thead><tr><th>Key</th><th>Description</th><th>Layer</th><th>Name</th><th>Aliases</th><th>Used</th></tr></thead><tbody>`;
  for (const k of pk) { const t = pt[k]; h += `<tr><td>${kindChip(k)}</td><td>${esc(t.label)}${t.net ? ' <span class="chip">net</span>' : ''}${t.virtual ? ' <span class="chip">no cable</span>' : ''}${t.dir ? ' <span class="chip">' + (t.dir === 'in' ? 'inlet' : 'outlet') + '</span>' : ''}</td><td>${LAYERS[t.layer].label}</td><td class="mono">${esc(t.name || k)}</td><td class="mono">${esc(t.alias.join(', '))}</td><td class="mono">${used[k] || ''}</td></tr>`; }
  $('#cat').innerHTML = h + '</tbody></table></div>';
}

function renderData() {
  const mode = { server: 'Server (data-do-not-edit/)', local: 'Local, not saved', offline: 'Offline', boot: 'Starting…' }[NET.mode];
  let h = '<div class="cards">';
  h += `<div class="card"><h4>Lab</h4><p class="mut">${plural(IX.names.length, 'device')} · ${plural(S.links.length, 'cable')} · ${plural(Object.keys(S.vlans).length, 'VLAN')}</p><div class="row"><button class="btn" data-act="export" data-k="lab">Export</button><button class="btn ed" data-act="import" data-k="lab">Import</button><button class="btn ed" data-act="example">Load example</button></div><div class="row" style="margin-top:8px"><button class="btn sm" data-act="export" data-k="svg">Map SVG</button><button class="btn sm" data-act="export" data-k="report">Report HTML</button>${NET.mode === 'server' ? '<button class="btn sm" data-act="backups">Backups</button>' : ''}</div></div>`;
  h += `<div class="card"><h4>Catalog</h4><p class="mut">${plural(Object.keys(CAT.templates).length, 'template')} · ${plural(Object.keys(CAT.portTypes).length, 'port type')}</p><div class="row"><button class="btn" data-act="export" data-k="cat">Export</button><button class="btn ed" data-act="import" data-k="cat">Import</button></div></div></div>`;
  h += `<dl class="kv" style="margin-top:14px"><dt>Storage</dt><dd>${mode}</dd><dt>Revision</dt><dd>${S.rev}</dd><dt>User</dt><dd><b class="mono">${esc(UI.user || '—')}</b> <button class="btn sm" data-act="user">Change</button></dd><dt>Version</dt><dd>${VERSION}</dd></dl>`;
  const log = S.log.slice().reverse();
  h += `<h3>Change log (${log.length})</h3><div class="list">`;
  for (const e of log.slice(0, UI.logN)) h += `<div class="item"><span class="mono">rev ${esc(e.rev)}</span><span>${esc(e.by || '?')}</span><span class="sp mut" style="font-size:12px">${esc(fmtTime(e.t))}</span><span class="sub" style="color:var(--ink)">${esc(e.msg)}</span></div>`;
  h += (log.length ? '' : '<div class="item mut">No changes.</div>') + '</div>';
  if (log.length > UI.logN) h += '<p><button class="btn sm" data-act="log-more">More</button></p>';
  $('#dat').innerHTML = h;
}
function fmtTime(t) { const d = new Date(t); return isNaN(d) ? String(t || '') : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); }

/* ---------------------------------------------------------------------------
   16. Dialogs: a stack of sheets. Each one: { title, body(), foot(), on:{action},
       set(field, value), fix(field), partial() }. Wizards keep their draft in their
       own variable (w) and redraw from it, so nothing typed is lost.
   --------------------------------------------------------------------------- */
const DLG = [];
const topDlg = () => DLG[DLG.length - 1] || null;
function openDlg(d) { const t = topDlg(); if (t) t.scroll = $('#dlg-b').scrollTop; DLG.push(d); renderDlg(true); }
function closeDlg(all) { if (all) DLG.length = 0; else DLG.pop(); renderDlg(true); }
function renderDlg(restore) {
  const d = topDlg(), body = $('#dlg-b');
  $('#dlg-back').hidden = !d;
  if (!d) { body.innerHTML = ''; return; }
  const st = restore ? d.scroll || 0 : body.scrollTop;
  $('#dlg-t').textContent = typeof d.title === 'function' ? d.title() : d.title;
  $('#dlg-bk').hidden = DLG.length < 2;
  body.innerHTML = d.body();
  $('#dlg-f').innerHTML = d.foot ? d.foot() : '';
  body.scrollTop = st;
}
function confirmDlg(msg, onOk, okLabel, danger) {
  openDlg({ title: 'Confirm', body: () => `<p>${esc(msg)}</p>`, foot: () => `<button class="btn" data-act="dlg-back">Cancel</button><button class="btn ${danger ? 'dan' : 'pri'}" data-act="ok">${esc(okLabel || 'OK')}</button>`, on: { ok: () => { closeDlg(); onOk(); } } });
}
function copyText(text, el) {
  const fallback = () => { try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); if (el.select) el.select(); toast('Selected. Copy with the system menu.'); } catch (e) { toast('Could not copy.'); } };
  try { navigator.clipboard.writeText(text).then(() => toast('Copied.'), fallback); } catch (e) { fallback(); }
}
function saveFile(name, text) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Download started.');
  } catch (e) { toast('No download: use Copy.'); }
}

/* ---------- User: a short label, the same form for everyone ---------- */
const cleanUser = s => String(s || '').trim().toLowerCase().replace(/@.*$/, '').replace(/\s+/g, '');
function userDlg(next) {
  const w = { user: UI.user };
  openDlg({
    title: 'User',
    body: () => fld('Corporate id, without the mail domain', inp('user', w.user, 'placeholder="jsmith" autocorrect="off"')),
    foot: () => '<button class="btn" data-act="dlg-back">Cancel</button><button class="btn pri" data-act="save">Save</button>',
    set(f, v) { w[f] = v; },
    on: { save: () => {
      const a = cleanUser(w.user);
      if (!a) return toast('User name missing.');
      UI.user = a;
      try { localStorage.setItem('labmap.user', a); } catch (e) {}
      closeDlg(); renderTab();
      if (next) next();
    } }
  });
}

/* ---------- Device sheet ---------- */
function adminUrl(n) {
  const d = S.devices[n];
  if (!d || !d.admin) return '';
  const ip = firstIp(d), u = d.admin.replace(/\{ip\}/g, ip);
  return /^https?:\/\//i.test(u) && (ip || !/\{ip\}/.test(d.admin)) ? u : '';
}
const webBtn = (n, label) => { const u = adminUrl(n); return u ? `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : ''; };
function devSheet(name) {
  const open = new Set();
  openDlg({
    title: () => name,
    body() {
      const d = S.devices[name];
      if (!d) return '<p class="mut">Device deleted.</p>';
      const net = d.ports.some(p => isNetKind(p.kind)), cols = net ? 5 : 3;
      let h = '<div class="chips">' + d.types.map(t => `<span class="chip">${esc(typeLabel(t))}</span>`).join('') + (d.project ? `<span class="chip pj">${esc(d.project)}</span>` : '') + '</div>';
      const kv = [['Model', d.model], ['Serial', d.serial], ['Owner', d.owner], ['Location', d.location], ['Notes', d.notes]].filter(x => x[1]);
      if (kv.length) h += '<dl class="kv">' + kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
      if (adminUrl(name)) h += `<p>${webBtn(name, 'Admin page')} <span class="mono mut">${esc(adminUrl(name))}</span></p>`;
      h += IX.issues.filter(i => i.dev === name).map(issueHtml).join('');
      /* power */
      const ins = upLinks(name);
      if (ins.length || powerOut(name).length || d.expectedPower !== 'none') {
        h += '<h3>Power</h3>';
        for (const ref of switchesOf(name)) h += `<p>Switched by: ${refBtn(ref)} ${webBtn(refDev(ref), refDev(ref) + ' admin')}</p>`;
        if (ins.length) { h += '<p class="lbl">Powered from</p>'; for (const ch of chainsUp(name)) h += '<div class="chain">' + ch.slice().reverse().map(l => refBtn(l.a) + ' ' + tagBtn(l)).join('<span class="ar">→</span>') + '<span class="ar">→</span><b>' + esc(name) + '</b></div>'; }
        else h += `<p class="mut">No inlet cable${d.expectedPower !== 'none' ? ' (expected: ' + EXP[d.expectedPower] + ')' : ''}.</p>`;
        const c = cascade(new Set([name]));
        if (c.down.length) h += `<p class="lbl">If switched off, these go down (${c.down.length})</p><div class="chain">` + c.down.map(x => devBtn(x)).join(', ') + '</div>';
        if (c.degraded.length) h += '<p class="lbl">Lose one inlet</p><div class="chain">' + c.degraded.map(x => devBtn(x)).join(', ') + '</div>';
      }
      /* ports: network columns only when the device has a network port */
      h += `<h3>Ports (${d.ports.length})</h3><div class="tw"><table class="pt"><thead><tr><th>Port</th><th>Connection</th><th>Cable</th>${net ? '<th>IP</th><th>VLAN</th>' : ''}</tr></thead><tbody>`;
      for (const p of d.ports) {
        const ref = name + ':' + p.name, ls = linksOf(ref);
        h += `<tr class="pr${open.has(p.name) ? ' open' : ''}" data-act="p-tog" data-p="${esc(p.name)}"><td><b class="mono">${esc(p.name)}</b><br>${kindChip(p.kind)}</td><td class="mono">${ls.map(l => esc(l.a === ref ? l.b : l.a)).join('<br>') || '<span class="mut">' + (p.virtual ? '—' : 'free') + '</span>'}</td><td>${ls.map(l => `<span class="tag">${esc(l.id)}</span>`).join('<br>')}</td>${net ? `<td class="mono">${esc(p.ip || '')}</td><td>${esc(p.vlan || '')}${p.vlans ? '<br><span class="mut">+ ' + esc(p.vlans.join(', ')) + '</span>' : ''}</td>` : ''}</tr>`;
        if (!open.has(p.name)) continue;
        h += `<tr class="pd"><td colspan="${cols}">`;
        const kv2 = [['MAC', p.mac], ['Services', p.services], ['Notes', p.notes]].filter(x => x[1]);
        if (kv2.length) h += '<dl class="kv">' + kv2.map(([k, v]) => `<dt>${k}</dt><dd class="${k === 'MAC' ? 'mono' : ''}">${esc(v)}</dd>`).join('') + '</dl>';
        for (const l of ls) h += `<div>${tagBtn(l)} ${esc(l.notes || '')}</div>`;
        const rs = routesFrom(ref).filter(r => r.hops.length > 1);
        if (rs.length) h += '<p class="lbl">Full route</p>' + rs.slice(0, 8).map(routeHtml).join('') + (rs.length > 8 ? `<p class="mut">+${rs.length - 8} routes.</p>` : '');
        h += `<p><button class="btn sm pri ed" data-act="p-conn" data-p="${esc(p.name)}">+ Cable on ${esc(p.name)}</button></p></td></tr>`;
      }
      return h + '</tbody></table></div>';
    },
    foot: () => (S.devices[name] ? '<button class="btn" data-act="see">Map</button><button class="btn pri ed" data-act="link">+ Cable</button><button class="btn ed" data-act="edit">Edit</button><button class="btn ed" data-act="dup">Duplicate</button><button class="btn ed" data-act="tpl">To template</button><button class="btn ed dan" data-act="del">Delete</button>' : ''),
    on: {
      'p-tog': el => { const p = el.dataset.p; if (open.has(p)) open.delete(p); else open.add(p); renderDlg(); },
      'p-conn': el => wizLink({ from: name + ':' + el.dataset.p }),
      link: () => wizLink({ fromDev: name }),
      see: () => { closeDlg(true); UI.sel = name; UI.selLink = null; UI.center = name; if (UI.project && (S.devices[name].project || '') !== UI.project) UI.project = ''; setTab('map'); },
      edit: () => wizDevice({ edit: name }),
      dup: () => wizDevice({ dup: name }),
      tpl: () => tplFromDevice(name),
      del: () => { const k = (IX.byDev.get(name) || []).length; confirmDlg(`Delete ${name}` + (k ? ` and its ${plural(k, 'cable')}?` : '?'), () => {
        if (commit(`Device ${name} deleted` + (k ? ` with ${plural(k, 'cable')}` : ''), s => { delete s.devices[name]; s.links = s.links.filter(l => refDev(l.a) !== name && refDev(l.b) !== name); for (const e of s.ipUse) if (e.iface && refDev(e.iface) === name) delete e.iface; })) { if (UI.sel === name) UI.sel = null; closeDlg(true); renderTab(); }
      }, 'Delete', true); }
    }
  });
}

/* ---------- Cable sheet ---------- */
const endHtml = ref => { const P = IX.ports.get(ref); return refBtn(ref) + ' ' + (P ? kindChip(P.p.kind) : '<span class="k" style="color:var(--err)">missing</span>'); };
function cableSheet(id) {
  const get = () => S.links.find(x => x.id === id);
  openDlg({
    title: () => 'Cable ' + id,
    body() {
      const l = get();
      if (!l) return '<p class="mut">Cable deleted.</p>';
      const lay = linkLayer(l);
      let h = `<p><span class="tag">${esc(l.id)}</span> <span class="k k-${lay}">${LAYERS[lay].label}</span></p>`;
      h += `<div class="chain">${endHtml(l.a)}<span class="ar">${lay === 'power' ? '→' : '↔'}</span>${endHtml(l.b)}</div>`;
      if (l.notes) h += `<p>${esc(l.notes)}</p>`;
      h += IX.issues.filter(i => i.link === id).map(issueHtml).join('');
      const left = routesFrom(l.b, l), right = routesFrom(l.a, l), full = [];
      for (const r1 of left) for (const r2 of right) { if (full.length >= 6) break; const hops = r1.hops.slice(1).reverse().map(x => ({ link: x.link, from: x.to, to: x.from })).concat(r2.hops); if (hops.length > 1) full.push({ hops }); }
      if (full.length) h += '<p class="lbl">Full route</p>' + full.map(routeHtml).join('');
      return h;
    },
    foot: () => (get() ? '<button class="btn" data-act="see">Map</button><button class="btn ed" data-act="edit">Edit</button><button class="btn ed dan" data-act="del">Remove</button>' : ''),
    on: {
      see: () => { const l = get(); closeDlg(true); UI.selLink = id; UI.sel = null; UI.layers[linkLayer(l)] = true; UI.center = refDev(l.a); setTab('map'); },
      edit: () => wizLink({ edit: id }),
      del: () => { const l = get(); if (l && commit(`Cable ${id} removed (${l.a} ↔ ${l.b})`, s => { s.links = s.links.filter(x => x !== l); })) closeDlg(); }
    }
  });
}

/* ---------- Device wizard: create, edit, duplicate ---------- */
function wizDevice(o) {
  o = o || {};
  const cur = o.edit ? S.devices[o.edit] : null, src = cur || (o.dup ? S.devices[o.dup] : null);
  const w = {
    edit: cur ? o.edit : null, tpl: '', pattern: cur ? o.edit : src ? patternFrom(o.dup) : 'device-{nn}', qty: 1, addType: CAT.portTypes.rj45 ? 'rj45' : catKeys()[0] || '', addQty: 1,
    f: { types: src ? src.types.slice() : ['other'], model: src ? src.model : '', serial: cur ? cur.serial : '', project: src ? src.project : UI.project || '', owner: src ? src.owner : '',
      location: src ? src.location : '', notes: src ? src.notes : '', admin: src ? src.admin : '', expectedPower: src ? src.expectedPower : 'none' },
    portsText: src ? portsToText(src.ports) : '', meta: {}, open: new Set()
  };
  if (src) for (const p of src.ports) w.meta[p.name] = { vlan: p.vlan || '', vlans: (p.vlans || []).join(', '), ip: cur ? p.ip || '' : '', mac: cur ? p.mac || '' : '', services: p.services || '', notes: p.notes || '' };
  const qty = () => Math.max(1, Math.min(50, +w.qty || 1));
  const names = () => genNames(w.pattern, qty());
  const metaOf = n => w.meta[n] || (w.meta[n] = { vlan: '', vlans: '', ip: '', mac: '', services: '', notes: '' });
  const prevHtml = () => {
    if (w.edit) return '';
    const nm = names();
    return `<p class="mut">Name: <span class="mono">${esc(nm.slice(0, 6).join(', '))}${nm.length > 6 ? '…' : ''}</span>` + (qty() > 1 ? '. IP: next free one each. MAC and serial are not copied.' : '') + '</p>';
  };
  const portsHtml = () => {
    const ports = parsePorts(w.portsText), vl = Object.keys(S.vlans).sort(natCmp), bad = [...new Set(ports.filter(p => p.unknown).map(p => p.kind))];
    let h = bad.length ? `<div class="iss err"><b>Error</b><span>Type not in the catalog: ${esc(bad.join(', '))}</span></div>` : '';
    h += `<p class="lbl">${plural(ports.length, 'port')}</p>`;
    for (const p of ports) {
      const m = metaOf(p.name), key = 'meta|' + p.name + '|', net = isNetKind(p.kind);
      h += `<div class="pbox"><button class="ph" data-act="w-port" data-p="${esc(p.name)}"><b class="mono">${esc(p.name)}</b>${kindChip(p.kind)}<span class="mono mut">${esc(net ? [m.ip, m.vlan].filter(Boolean).join(' · ') : '')}</span></button>`;
      if (w.open.has(p.name)) h += '<div class="pbd">' + (net ? '<div class="g2">' + fld('VLAN', `<select data-f="${esc(key)}vlan">${opt('', '—', m.vlan)}${vl.map(v => opt(v, v, m.vlan)).join('')}</select>`) +
        `<div class="fld"><span>IP</span><span class="inl">${inp(key + 'ip', m.ip, 'inputmode="decimal" aria-label="IP"')}<button class="btn sm" data-act="w-free" data-p="${esc(p.name)}">free</button></span></div>` +
        fld('MAC', inp(key + 'mac', m.mac)) + fld('Services', inp(key + 'services', m.services)) + '</div>' + fld('Tagged VLANs (trunk), comma separated', inp(key + 'vlans', m.vlans || '')) : '') + fld('Notes', inp(key + 'notes', m.notes)) + '</div>';
      h += '</div>';
    }
    return h;
  };
  const fields = () => { const d = { types: w.f.types.length ? w.f.types.slice() : ['other'] }; for (const k of ['model', 'serial', 'project', 'owner', 'location', 'notes', 'admin']) d[k] = String(w.f[k] || '').trim(); d.expectedPower = w.f.expectedPower; return d; };
  const build = () => parsePorts(w.portsText).map(p => {
    const m = w.meta[p.name] || {}, q = { name: p.name, kind: p.kind };
    if (p.virtual) q.virtual = true;
    for (const k of isNetKind(p.kind) ? ['ip', 'mac', 'vlan', 'services', 'notes'] : ['notes']) { const v = String(m[k] || '').trim(); if (v) q[k] = v; }
    const tg = isNetKind(p.kind) ? String(m.vlans || '').split(/[\s,]+/).filter(Boolean) : [];
    if (tg.length) q.vlans = tg;
    return q;
  });

  function saveEdit() {
    const ports = build(), nn = w.pattern.trim(), old = w.edit;
    if (!nn || nn.includes(':')) return toast('Name empty or containing ":".');
    if (nn !== old && S.devices[nn]) return toast(`${nn} already exists.`);
    const keep = new Set(ports.map(p => p.name)), gone = new Set(S.devices[old].ports.map(p => old + ':' + p.name).filter(r => !keep.has(splitRef(r)[1])));
    const orphans = S.links.filter(l => gone.has(l.a) || gone.has(l.b));
    const apply = () => {
      const ok = commit(`Device ${old} changed` + (nn !== old ? ` (now ${nn})` : '') + (orphans.length ? `; ${plural(orphans.length, 'cable')} removed` : ''), s => {
        const dead = new Set(orphans);
        s.links = s.links.filter(l => !dead.has(l));
        for (const e of s.ipUse) if (e.iface && gone.has(e.iface)) delete e.iface;
        const d = Object.assign(fields(), { ports });
        if (nn !== old) {
          delete s.devices[old];
          const ren = r => { const [dn, pn] = splitRef(r); return dn === old ? nn + ':' + pn : r; };
          for (const l of s.links) { l.a = ren(l.a); l.b = ren(l.b); }
          for (const e of s.ipUse) if (e.iface) e.iface = ren(e.iface);
        }
        s.devices[nn] = d;
      });
      if (ok) { closeDlg(true); if (UI.sel === old) UI.sel = nn; devSheet(nn); }
    };
    if (!orphans.length) return apply();
    const lost = [...gone].filter(r => orphans.some(l => l.a === r || l.b === r)).map(r => splitRef(r)[1]);
    confirmDlg(`Ports with a cable: ${lost.join(', ')}. Also remove the orphan ${orphans.length === 1 ? 'cable' : 'cables'} ${orphans.map(l => l.id).join(', ')}?`, apply, 'Remove', true);
  }
  function saveNew() {
    const nm = names(), ports = build();
    if (nm.some(n => !n || n.includes(':'))) return toast('Name empty or containing ":".');
    const clash = nm.find(n => S.devices[n]);
    if (clash) return toast(`${clash} already exists. Use {nn} in the name.`);
    const taken = {}, last = {};
    const devs = nm.map((n, i) => {
      const d = Object.assign(fields(), { ports: clone(ports) });
      if (i > 0) d.serial = '';
      for (const p of d.ports) {
        if (i > 0) delete p.mac;
        if (!p.ip) continue;
        const t = taken[p.vlan || ''] || (taken[p.vlan || ''] = new Set());
        if (i === 0) { const x = ipToInt(p.ip); if (x != null) { t.add(x); last[p.name] = x; } continue; }
        const x = p.vlan && last[p.name] != null ? freeIp(p.vlan, last[p.name], t) : null;
        if (x == null) delete p.ip; else { p.ip = intToIp(x); t.add(x); last[p.name] = x; }
      }
      return d;
    });
    if (commit(nm.length === 1 ? `Device ${nm[0]} added` : `${nm.length} devices added: ${nm.join(', ')}`, s => nm.forEach((n, i) => { s.devices[n] = devs[i]; }))) { closeDlg(); if (nm.length === 1) devSheet(nm[0]); }
  }

  openDlg({
    title: () => (w.edit ? 'Edit ' + w.edit : o.dup ? 'Duplicate ' + o.dup : 'New device'),
    body() {
      const tk = Object.keys(CAT.templates).sort((a, b) => natCmp(CAT.templates[a].label, CAT.templates[b].label));
      let h = '';
      if (!w.edit) {
        h += fld('Template', `<select data-f="tpl">${opt('', '— blank —', w.tpl)}${tk.map(k => opt(k, CAT.templates[k].label, w.tpl)).join('')}</select>`);
        h += '<div class="g2">' + fld('Name ({nn} = number)', inp('pattern', w.pattern, 'data-re')) + fld('Quantity', `<input type="number" inputmode="numeric" min="1" max="50" data-f="qty" data-re value="${esc(w.qty)}">`) + '</div>';
      } else h += fld('Name (label and hostname)', inp('pattern', w.pattern));
      h += `<div id="w-prev">${prevHtml()}</div>`;
      h += '<p class="lbl">Device type (one or more)</p><div class="lays">' + Object.keys(TYPES).map(t => `<button class="lay${w.f.types.includes(t) ? ' on' : ''}" data-act="w-type" data-t="${t}" aria-pressed="${w.f.types.includes(t)}">${esc(TYPES[t].label)}</button>`).join('') + '</div>';
      h += '<div class="g2">' + fld('Project', inp('f|project', w.f.project, 'list="dl-proj"')) + fld('Owner', inp('f|owner', w.f.owner, 'list="dl-people" placeholder="jsmith"')) + fld('Location', inp('f|location', w.f.location)) + fld('Model', inp('f|model', w.f.model)) +
        fld('Serial', inp('f|serial', w.f.serial)) + fld('Expected power', `<select data-f="f|expectedPower">${Object.keys(EXP).map(k => opt(k, EXP[k], w.f.expectedPower)).join('')}</select>`) + '</div>';
      h += fld('Admin page', inp('f|admin', w.f.admin, 'placeholder="http://{ip}"')) + fld('Notes', inp('f|notes', w.f.notes));
      h += '<h3>Ports</h3><div class="row">' + `<select class="grow" data-f="addType" aria-label="Port type">${catKeys().map(k => opt(k, k + ' · ' + CAT.portTypes[k].label, w.addType)).join('')}</select>` +
        `<input type="number" inputmode="numeric" min="1" max="96" data-f="addQty" value="${esc(w.addQty)}" style="width:76px" aria-label="How many"><button class="btn sm pri" data-act="w-add">Add</button></div>`;
      h += fld('One per line: name type. Range: eth[0-3] rj45', `<textarea data-f="portsText" data-re rows="6" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="eth0 rj45&#10;uart0 uart&#10;dc-in dc-in">${esc(w.portsText)}</textarea>`);
      return h + `<div id="w-ports">${portsHtml()}</div>`;
    },
    foot: () => `<button class="btn" data-act="dlg-back">Cancel</button><button class="btn pri" data-act="save">${w.edit ? 'Save' : 'Create'}</button>`,
    set(f, v) { const p = f.split('|'); if (p[0] === 'meta') metaOf(p[1])[p[2]] = v; else if (p[0] === 'f') w.f[p[1]] = v; else w[f] = v; },
    fix(f) {
      if (f !== 'tpl') return;
      const t = CAT.templates[w.tpl];
      if (!t) return;
      w.f.types = t.types.slice(); w.pattern = t.pattern; w.portsText = t.ports.join('\n'); w.f.expectedPower = t.power; w.f.admin = t.admin || ''; w.f.model = t.model || ''; w.f.notes = t.notes || ''; w.meta = {}; w.open.clear();
      for (const pn of Object.keys(t.meta || {})) w.meta[pn] = Object.assign({ vlan: '', vlans: '', ip: '', mac: '', services: '', notes: '' }, t.meta[pn]);
    },
    partial() { const a = $('#w-prev'), b = $('#w-ports'); if (a) a.innerHTML = prevHtml(); if (b) b.innerHTML = portsHtml(); },
    on: {
      'w-type': el => { const t = el.dataset.t, i = w.f.types.indexOf(t); if (i >= 0) w.f.types.splice(i, 1); else w.f.types.push(t); renderDlg(); },
      'w-port': el => { const p = el.dataset.p; if (w.open.has(p)) w.open.delete(p); else w.open.add(p); renderDlg(); },
      'w-add': () => {
        if (!CAT.portTypes[w.addType]) return;
        const used = new Set(parsePorts(w.portsText).map(p => p.name)), lines = suggestPorts(w.addType, Math.max(1, Math.min(96, +w.addQty || 1)), used);
        w.portsText = (w.portsText.trim() ? w.portsText.replace(/\s+$/, '') + '\n' : '') + lines.join('\n');
        renderDlg();
      },
      'w-free': el => {
        const m = metaOf(el.dataset.p);
        if (!m.vlan) return toast('Choose the VLAN first.');
        const skip = new Set();
        for (const k of Object.keys(w.meta)) if (k !== el.dataset.p && w.meta[k].vlan === m.vlan) { const x = ipToInt(w.meta[k].ip); if (x != null) skip.add(x); }
        const n = freeIp(m.vlan, null, skip);
        if (n == null) return toast('No free IP in ' + m.vlan + '.');
        m.ip = intToIp(n); renderDlg();
      },
      save: () => {
        if (!NET.editing) return toast('Edit mode required.');
        const bad = [...new Set(parsePorts(w.portsText).filter(p => p.unknown).map(p => p.kind))];
        if (bad.length) return toast(`Type not in the catalog: ${bad.join(', ')}`, { sticky: true });
        if (w.edit) saveEdit(); else saveNew();
      }
    }
  });
}
/* Save a real device as a template for the next ones. */
function tplFromDevice(name) {
  const d = S.devices[name];
  if (!d) return;
  const base = name.replace(/[-_]?\d+$/, '') || name;
  const w = { key: CAT.templates[base] ? base + '-2' : base, label: d.model || typeLabel(d.types[0]) };
  openDlg({
    title: 'Save as template',
    body: () => '<div class="g2">' + fld('Key', inp('key', w.key)) + fld('Name', inp('label', w.label)) + '</div><p class="mut">Without IP, MAC or serial.</p>',
    foot: () => '<button class="btn" data-act="dlg-back">Cancel</button><button class="btn pri" data-act="save">Save</button>',
    set(f, v) { w[f] = v; },
    on: { save: () => {
      const key = String(w.key || '').trim().replace(/\s+/g, '-');
      if (!key) return toast('Key missing.');
      const meta = {};
      for (const p of d.ports) { const m = {}; if (p.services) m.services = p.services; if (p.notes) m.notes = p.notes; if (Object.keys(m).length) meta[p.name] = m; }
      const t = { label: String(w.label || key).trim(), types: d.types.slice(), model: d.model || '', pattern: patternFrom(name), power: d.expectedPower, admin: d.admin || '', notes: d.notes || '', ports: portsToText(d.ports).split('\n').filter(Boolean), meta };
      if (commit(`Template ${key} ${CAT.templates[key] ? 'updated' : 'created'} from ${name}`, s => { s.catalog.templates[key] = t; })) closeDlg();
    } }
  });
}

/* ---------- Connection wizard: create and edit cables ---------- */
function portOk(devName, p, f, ignoreId) {
  if (p.virtual) return false;
  const lay = layerOf(p.kind);
  if (f.layer && lay !== f.layer) return false;
  if (f.dir) { const d = powerDir(p.kind); if (d && d !== f.dir) return false; }
  if (f.noUp && S.devices[devName].types.includes('hub') && /^up/i.test(p.name)) return false;
  if (lay === 'radio' || lay === 'bus') return true;                  // these take several cables
  return !linksOf(devName + ':' + p.name).some(l => l.id !== ignoreId);
}
function devOk(n, f, ignoreId) {
  const d = S.devices[n];
  if (f.types && !d.types.some(t => f.types.includes(t))) return false;
  if (f.notTypes && d.types.some(t => f.notTypes.includes(t))) return false;
  return d.ports.some(p => portOk(n, p, f, ignoreId));
}
function wizLink(o) {
  o = o || {};
  const L = o.edit ? S.links.find(l => l.id === o.edit) : null;
  const w = { edit: L ? L.id : null, sc: 'free', strict: !L, a: { dev: '', port: '' }, b: { dev: '', port: '' }, type: L ? L.type : 'auto', id: L ? L.id : '', idManual: !!L, notes: L ? L.notes || '' : '', pin: '', hold: '', count: 1 };
  if (L) { [w.a.dev, w.a.port] = splitRef(L.a); [w.b.dev, w.b.port] = splitRef(L.b); }
  else if (o.from && IX.ports.has(o.from)) {
    const [dn, pn] = splitRef(o.from), P = IX.ports.get(o.from), lay = layerOf(P.p.kind), t = P.d.types;
    const end = lay === 'power' && powerDir(P.p.kind) === 'in' ? 'b' : 'a';
    w[end] = { dev: dn, port: pn }; w.pin = end;
    const sc = SHORTCUTS.find(s => s.k !== 'free' && s[end].layer === lay && (!s[end].dir || powerDir(P.p.kind) === s[end].dir) && (!s[end].types || t.some(x => s[end].types.includes(x))) && !(s[end].notTypes && t.some(x => s[end].notTypes.includes(x))));
    w.sc = sc ? sc.k : 'free';
  } else if (o.fromDev && S.devices[o.fromDev]) { w.a.dev = o.fromDev; w.pin = 'a'; w.hold = 'a'; }      // from a device: the port is chosen by hand
  const ref = e => (w[e].dev && w[e].port ? w[e].dev + ':' + w[e].port : '');
  const portAt = e => { const P = IX.ports.get(ref(e)); return P ? P.p : null; };
  /* candidate filter for one end; in "Free" it is derived from the other end */
  const filt = end => {
    const sc = SHORTCUTS.find(s => s.k === w.sc) || SHORTCUTS[0], f = Object.assign({}, sc[end]);
    if (sc.k === 'free') { const p = portAt(end === 'a' ? 'b' : 'a'); if (p) { const lay = layerOf(p.kind); if (lay !== 'other') f.layer = lay; if (lay === 'power') { const d = powerDir(p.kind); if (d) f.dir = d === 'in' ? 'out' : 'in'; } } }
    return f;
  };
  /* proposes the first free, compatible device and port for whatever is missing */
  const fix = () => {
    for (const end of ['a', 'b']) {
      const e = w[end], other = w[end === 'a' ? 'b' : 'a'], f = filt(end);
      if (e.dev && !S.devices[e.dev]) { e.dev = ''; e.port = ''; }
      if (!e.dev && w.sc !== 'free' && other.dev && other.port) e.dev = IX.names.find(n => n !== other.dev && devOk(n, f, w.edit)) || '';
      if (e.dev && !e.port && w.hold !== end) { const p = S.devices[e.dev].ports.find(p => portOk(e.dev, p, f, w.edit)) || (w.strict ? null : S.devices[e.dev].ports[0]); if (p) e.port = p.name; }
    }
  };
  const autoType = () => { const pa = portAt('a'), pb = portAt('b'), la = pa ? layerOf(pa.kind) : 'other', lb = pb ? layerOf(pb.kind) : 'other'; return la !== 'other' ? la : lb; };
  const resType = () => (w.type === 'auto' ? autoType() : w.type);
  const curId = () => (w.idManual ? String(w.id || '').trim() : nextCableId(resType()));
  const warns = () => {
    const out = [], pa = portAt('a'), pb = portAt('b');
    if (!pa || !pb) return ['Ends missing.'];
    if (ref('a') === ref('b')) out.push('Both ends are the same port.');
    const la = layerOf(pa.kind), lb = layerOf(pb.kind);
    if (la !== lb && la !== 'other' && lb !== 'other') out.push(`Different types: ${pa.kind} ↔ ${pb.kind}.`);
    if (w.type !== 'auto' && w.type !== la && w.type !== lb) out.push(`Forced type: ${LAYERS[w.type].label}.`);
    for (const e of ['a', 'b']) { const p = portAt(e), lay = layerOf(p.kind), ls = linksOf(ref(e)).filter(l => l.id !== w.edit); if (ls.length && lay !== 'radio' && lay !== 'bus') out.push(`${ref(e)} already has ${ls.map(l => l.id).join(', ')}.`); }
    if (resType() === 'power') { const da = powerDir(pa.kind), db = powerDir(pb.kind); if (da === 'in' && db === 'out') out.push('Reversed: the first end must be the outlet.'); else if (da && da === db) out.push(`Joins two power ${da === 'in' ? 'inlets' : 'outlets'}.`); }
    const id = curId();
    if (!id) out.push('No id.'); else if (S.links.some(l => l.id === id && l.id !== w.edit)) out.push(`Id ${id} already used.`);
    return out;
  };
  const count = () => (w.edit ? 1 : Math.max(1, Math.min(96, +w.count || 1)));
  /* consecutive ports of the same type after the chosen one (only free ones when strict) */
  const seq = (end, n) => {
    const e = w[end], d = S.devices[e.dev];
    if (!d || !e.port) return [];
    const i = d.ports.findIndex(p => p.name === e.port), out = [e.port];
    if (i < 0) return [];
    for (let j = i + 1; j < d.ports.length && out.length < n; j++) { const p = d.ports[j]; if (p.kind !== d.ports[i].kind || p.virtual || (w.strict && !portOk(e.dev, p, {}, w.edit))) continue; out.push(p.name); }
    return out;
  };
  const pairs = () => { const n = count(), A = seq('a', n), B = seq('b', n), k = Math.min(A.length, B.length); return Array.from({ length: k }, (_, i) => [w.a.dev + ':' + A[i], w.b.dev + ':' + B[i]]); };
  const warnHtml = () => {
    const warn = m => `<div class="iss warn"><b>Warning</b><span>${esc(m)}</span></div>`, n = count();
    let h = warns().map(warn).join('');
    if (n > 1) { const ps = pairs(); if (ps.length < n) h += warn(`Only ${ps.length} consecutive ports available.`); h += `<p class="lbl">${plural(ps.length, 'cable')}</p><div class="chain">` + ps.slice(0, 6).map(p => esc(p[0]) + ' ↔ ' + esc(p[1])).join('<br>') + (ps.length > 6 ? '<br>…' : '') + '</div>'; }
    return h;
  };
  const doSave = keepOpen => {
    if (!NET.editing) return toast('Edit mode required.');
    const ps = pairs();
    if (!ps.length) return toast('Ends missing.');
    const type = resType(), notes = String(w.notes || '').trim();
    let ok;
    if (w.edit) { const id = curId() || nextCableId(type), [a, b] = ps[0]; ok = commit(`Cable ${id} changed: ${a} ↔ ${b}`, s => { Object.assign(s.links.find(x => x.id === w.edit), { id, type, a, b, notes }); }); }
    else {
      const taken = new Set(), ids = ps.map((p, i) => { const id = (i === 0 && curId()) || nextCableId(type, taken); taken.add(id); return id; });
      ok = commit(ps.length === 1 ? `Cable ${ids[0]}: ${ps[0][0]} ↔ ${ps[0][1]}` : `${ps.length} cables ${ids[0]}…${ids[ids.length - 1]}: ${w.a.dev} ↔ ${w.b.dev}`, s => { ps.forEach((p, i) => s.links.push({ id: ids[i], type, a: p[0], b: p[1], notes })); });
    }
    if (!ok) return;
    if (w.edit) closeDlg(true);
    else if (keepOpen) { w.a.port = ''; w.b.port = ''; w.hold = ''; w.id = ''; w.idManual = false; fix(); renderDlg(); }      // same devices, next free ports
    else closeDlg();
  };
  const endHtmlSel = (end, label) => {
    const e = w[end], f = filt(end);
    let devs = w.strict ? IX.names.filter(n => devOk(n, f, w.edit)) : IX.names.slice();
    if (e.dev && !devs.includes(e.dev)) devs.unshift(e.dev);
    let h = `<p class="lbl">${label}</p><div class="g2">` + fld('Device', `<select data-f="${end}|dev">${opt('', '— choose —', e.dev)}${devs.map(n => opt(n, n + (S.devices[n].project ? ' · ' + S.devices[n].project : ''), e.dev)).join('')}</select>`);
    let ports = [];
    if (e.dev && S.devices[e.dev]) { const all = S.devices[e.dev].ports; ports = w.strict ? all.filter(p => portOk(e.dev, p, f, w.edit) || p.name === e.port) : all; }
    h += fld('Port', `<select data-f="${end}|port">${opt('', ports.length || !e.dev ? '— choose —' : 'none free', e.port)}${ports.map(p => { const ls = linksOf(e.dev + ':' + p.name).filter(l => l.id !== w.edit); return opt(p.name, p.name + ' · ' + p.kind + (ls.length ? ' · ' + ls.map(l => l.id).join(', ') : ''), e.port); }).join('')}</select>`) + '</div>';
    return h;
  };
  fix();
  openDlg({
    title: () => (w.edit ? 'Edit cable ' + w.edit : 'New cable'),
    body() {
      const pow = resType() === 'power';
      let h = '<div class="lays">' + SHORTCUTS.map(s => `<button class="lay${s.k === w.sc ? ' on' : ''}" data-act="w-sc" data-k="${s.k}" aria-pressed="${s.k === w.sc}">${esc(s.label)}</button>`).join('') + '</div>';
      h += `<label class="tog"><input type="checkbox" data-f="strict"${w.strict ? ' checked' : ''}> Only free, compatible ports</label>`;
      h += endHtmlSel('a', pow ? 'From (outlet)' : 'From') + endHtmlSel('b', pow ? 'To (inlet)' : 'To');
      h += '<div class="g2">' + fld('Cable type', `<select data-f="type">${opt('auto', 'Auto: ' + LAYERS[autoType()].label, w.type)}${LAYER_KEYS.map(k => opt(k, LAYERS[k].label, w.type)).join('')}</select>`) + fld('Id (label)', inp('id', curId())) + '</div>';
      h += '<div class="g2">' + fld('Note', inp('notes', w.notes)) + (w.edit ? '' : fld('How many (consecutive ports)', `<input type="number" inputmode="numeric" min="1" max="96" data-f="count" data-re value="${esc(w.count)}">`)) + '</div>';
      return h + '<div id="w-warn">' + warnHtml() + '</div>';
    },
    foot: () => `<button class="btn" data-act="dlg-back">Cancel</button>${w.edit ? '<button class="btn dan" data-act="del">Remove</button>' : ''}${w.edit ? '' : '<button class="btn" data-act="next">Connect + next</button>'}<button class="btn pri" data-act="save">${w.edit ? 'Save' : 'Connect'}</button>`,
    partial() { const a = $('#w-warn'); if (a) a.innerHTML = warnHtml(); },
    set(f, v) { const p = f.split('|'); if (p.length === 2) { w[p[0]][p[1]] = v; if (p[1] === 'dev') w[p[0]].port = ''; if (p[0] === w.hold) w.hold = ''; } else { w[f] = v; if (f === 'id') w.idManual = true; } },
    fix,
    on: {
      'w-sc': el => { w.sc = el.dataset.k; w.hold = ''; for (const e of ['a', 'b']) if (e !== w.pin) w[e] = { dev: '', port: '' }; fix(); renderDlg(); },
      del: () => { const l = S.links.find(x => x.id === w.edit); if (l && commit(`Cable ${l.id} removed (${l.a} ↔ ${l.b})`, s => { s.links = s.links.filter(x => x !== l); })) closeDlg(true); },
      save: () => doSave(false),
      next: () => doSave(true)
    }
  });
}

/* ---------- IPs: one address, IP notes and VLANs ---------- */
function ipDlg(vn, n) {
  const res = () => { const V = IX.ip[vn]; return !!(V && V.cidr && V.cidr.bits < 31 && (n === V.cidr.base || n === V.cidr.last)); };
  openDlg({
    title: () => intToIp(n),
    body() {
      const info = ipInfo(vn, n), lab = { free: ['free', 'ok'], fixed: ['on a port', ''], noted: ['noted', ''], conf: ['conflict', 'err'] }[info.state];
      let h = `<p><span class="chip">VLAN ${esc(vn || '?')}</span> <span class="chip ${lab[1]}">${res() ? 'network / broadcast' : lab[0]}</span></p>`;
      if (info.gw) h += '<p>VLAN gateway.</p>';
      if (info.fixed.length) h += '<p class="lbl">On port</p>' + info.fixed.map(r => { const P = IX.ports.get(r); return `<div>${refBtn(r)} ${P ? kindChip(P.p.kind) : ''}${P && P.p.services ? ' <span class="mut">' + esc(P.p.services) + '</span>' : ''}</div>`; }).join('');
      if (info.uses.length) h += '<p class="lbl">Noted</p>' + info.uses.map(u => `<div class="pbox"><div class="pbd"><b>${esc(u.e.who || '?')}</b> · <span class="mono">${esc(u.e.from)}${u.e.to ? '–' + esc(u.e.to) : ''}</span>${u.e.iface ? '<br>Only for ' + refBtn(u.e.iface) : ''}${u.e.notes ? '<br>' + esc(u.e.notes) : ''}<div class="row ed" style="margin-top:6px"><button class="btn sm" data-act="ipuse-edit" data-i="${u.i}">Edit</button><button class="btn sm dan" data-act="ipuse-del" data-i="${u.i}">Delete</button></div></div></div>`).join('');
      if (info.state === 'conf') h += '<div class="iss err"><b>Conflict</b><span>More than one use, or inside a range reserved for another interface.</span></div>';
      return h + `<p class="lbl">Check from the server</p><pre class="cmd" id="cmd">arping -D -c 3 -I ${esc(serverIface(vn))} ${intToIp(n)}</pre><p><button class="btn sm" data-act="copy" data-src="cmd">Copy</button></p>`;
    },
    foot: () => (res() ? '' : `<button class="btn pri ed" data-act="ip-give" data-v="${esc(vn)}" data-ip="${n}">Use this IP</button>`)
  });
}
function ipUseDlg(o) {
  const e0 = o.i != null ? S.ipUse[o.i] : null;
  const w = { i: e0 ? o.i : null, vlan: e0 ? e0.vlan || '' : o.vlan || UI.vlan || Object.keys(S.vlans).sort(natCmp)[0] || '', from: e0 ? e0.from || '' : '', to: e0 ? e0.to || '' : '', who: e0 ? e0.who || '' : UI.lastWho || UI.user, notes: e0 ? e0.notes || '' : '', dev: '', port: '' };
  if (e0 && e0.iface) [w.dev, w.port] = splitRef(e0.iface);
  const propose = next => { const n = freeIp(w.vlan, next ? ipToInt(w.from) : null); w.from = n == null ? '' : intToIp(n); w.to = ''; };
  if (!e0) { if (o.ip != null) w.from = intToIp(o.ip); else propose(); }
  const stateHtml = () => {
    const n = ipToInt(w.from), warn = m => `<div class="iss warn"><b>Warning</b><span>${esc(m)}</span></div>`;
    if (!w.from) return warn('No free IP, or no subnet.');
    if (n == null) return warn('Invalid IP.');
    const info = ipInfo(w.vlan, n), mine = info.uses.filter(u => u.i !== w.i), V = IX.ip[w.vlan], out = [];
    if (V && V.cidr && (n < V.cidr.base || n > V.cidr.last)) out.push('Outside the subnet.');
    if (info.fixed.length) out.push('In use: ' + info.fixed.join(', ') + '.');
    if (mine.length) out.push('Noted: ' + mine.map(u => u.e.who || '?').join(', ') + '.');
    return out.length ? out.map(warn).join('') : '<p class="mut">Free.</p>';
  };
  const iface = () => (w.dev && w.port ? w.dev + ':' + w.port : '');
  openDlg({
    title: () => (e0 ? 'IP note' : 'Give me an IP'),
    body() {
      const vl = Object.keys(S.vlans).sort(natCmp), d = S.devices[w.dev];
      let h = fld('VLAN', `<select data-f="vlan">${vl.map(v => opt(v, v + ' · ' + (S.vlans[v].subnet || ''), w.vlan)).join('')}${w.vlan && !S.vlans[w.vlan] ? opt(w.vlan, w.vlan, w.vlan) : ''}</select>`);
      h += `<div class="fld"><span>IP (first free)</span><span class="inl">${inp('from', w.from, 'inputmode="decimal" data-re aria-label="IP"')}<button class="btn sm" data-act="next">Next</button></span></div>`;
      h += `<div id="ipu-st">${stateHtml()}</div>`;
      h += fld('To (range, optional)', inp('to', w.to, 'inputmode="decimal"'));
      h += '<div class="g2">' + fld('User', inp('who', w.who, 'list="dl-people" placeholder="jsmith"')) + fld('Notes', inp('notes', w.notes)) + '</div>';
      h += '<p class="lbl">Interface (optional)</p><div class="g2">' + fld('Device', `<select data-f="dev">${opt('', '— none —', w.dev)}${IX.names.map(n => opt(n, n, w.dev)).join('')}</select>`) +
        fld('Port', `<select data-f="port">${opt('', '—', w.port)}${d ? d.ports.filter(p => isNetKind(p.kind) || p.name === w.port).map(p => opt(p.name, p.name + ' · ' + p.kind + (p.ip ? ' · ' + p.ip : ''), w.port)).join('') : ''}</select>`) + '</div>';
      return h;
    },
    foot: () => `<button class="btn" data-act="dlg-back">Cancel</button><button class="btn${iface() ? '' : ' pri'}" data-act="note">${e0 ? 'Save' : 'Note it'}</button>${iface() && !e0 ? '<button class="btn pri" data-act="pin">Set on port</button>' : ''}`,
    set(f, v) { w[f] = v; if (f === 'dev') w.port = ''; },
    fix(f) {
      if (f === 'vlan' && !e0 && o.ip == null) propose();
      if (f === 'dev' && S.devices[w.dev]) { const ps = S.devices[w.dev].ports, p = ps.find(p => !p.ip && isNetKind(p.kind)) || ps.find(p => isNetKind(p.kind)); if (p) w.port = p.name; }
    },
    partial() { const a = $('#ipu-st'); if (a) a.innerHTML = stateHtml(); },
    on: {
      next: () => { propose(true); renderDlg(); },
      note: () => {
        const from = String(w.from || '').trim(), to = String(w.to || '').trim();
        if (!from) return toast('IP missing.');
        const e = { vlan: w.vlan, from, who: String(w.who || '').trim(), notes: String(w.notes || '').trim() };
        if (to && to !== from) e.to = to;
        if (iface()) e.iface = iface();
        UI.lastWho = e.who;
        if (commit(`IP ${from}${e.to ? '–' + e.to : ''} ${e0 ? 'note changed' : 'noted'} for ${e.who || '?'} (${w.vlan || 'no VLAN'})`, s => { if (w.i != null) s.ipUse[w.i] = e; else s.ipUse.push(e); })) closeDlg();
      },
      pin: () => {
        const from = String(w.from || '').trim(), r = iface();
        if (!from || !IX.ports.has(r)) return toast('IP or port missing.');
        if (commit(`IP ${from} set on ${r} (${w.vlan || 'no VLAN'})`, s => { const p = s.devices[w.dev].ports.find(p => p.name === w.port); p.ip = from; if (w.vlan) p.vlan = w.vlan; })) closeDlg();
      }
    }
  });
}
function vlanDlg(name) {
  const v0 = name ? S.vlans[name] : null;
  const w = { orig: v0 ? name : null, name: v0 ? name : '', id: v0 && v0.id != null ? String(v0.id) : '', subnet: v0 ? v0.subnet || '' : '', gateway: v0 ? v0.gateway || '' : '', dns: v0 ? v0.dns || '' : '', scope: v0 ? v0.scope || 'local' : 'local', notes: v0 ? v0.notes || '' : '' };
  const maskHtml = () => { const c = parseCidr(w.subnet); return c ? `<p class="mut">Netmask <span class="mono">${maskOf(c)}</span> · ${hostRange(c)[1] - hostRange(c)[0] + 1} usable</p>` : '<p class="mut">Format: 192.168.50.0/24</p>'; };
  openDlg({
    title: () => (w.orig ? 'VLAN ' + w.orig : 'New VLAN'),
    body: () => '<div class="g2">' + fld('Name', inp('name', w.name)) + fld('Id (802.1Q)', inp('id', w.id, 'inputmode="numeric"')) + '</div>' + fld('Subnet (CIDR)', inp('subnet', w.subnet, 'inputmode="decimal" data-re placeholder="192.168.50.0/24"')) + `<div id="v-mask">${maskHtml()}</div>` +
      '<div class="g2">' + fld('Gateway', inp('gateway', w.gateway, 'inputmode="decimal"')) + fld('DNS', inp('dns', w.dns)) + '</div>' +
      fld('Scope', `<select data-f="scope">${opt('local', 'Local (lab only)', w.scope)}${opt('it', 'IT', w.scope)}</select>`) + fld('Notes', inp('notes', w.notes)),
    foot: () => `<button class="btn" data-act="dlg-back">Cancel</button>${w.orig ? '<button class="btn dan" data-act="del">Delete</button>' : ''}<button class="btn pri" data-act="save">Save</button>`,
    set(f, v) { w[f] = v; },
    partial() { const a = $('#v-mask'); if (a) a.innerHTML = maskHtml(); },
    on: {
      save: () => {
        const nm = String(w.name || '').trim();
        if (!nm) return toast('Name missing.');
        if (nm !== w.orig && S.vlans[nm]) return toast(`${nm} already exists.`);
        const idn = String(w.id).trim(), v = { id: idn === '' ? null : isNaN(+idn) ? idn : +idn, subnet: String(w.subnet || '').trim(), gateway: String(w.gateway || '').trim(), dns: String(w.dns || '').trim(), scope: w.scope, notes: String(w.notes || '').trim() };
        if (commit(w.orig ? `VLAN ${w.orig} changed` + (nm !== w.orig ? ` (now ${nm})` : '') : `VLAN ${nm} added`, s => {
          if (w.orig && w.orig !== nm) { delete s.vlans[w.orig]; for (const n of Object.keys(s.devices)) for (const p of s.devices[n].ports) if (p.vlan === w.orig) p.vlan = nm; for (const e of s.ipUse) if (e.vlan === w.orig) e.vlan = nm; }
          s.vlans[nm] = v;
        })) { UI.vlan = nm; closeDlg(); renderTab(); }
      },
      del: () => { const k = [...IX.ports.values()].filter(P => P.p.vlan === w.orig).length; confirmDlg(`Delete VLAN ${w.orig}?` + (k ? ` Used by ${plural(k, 'port')}.` : ''), () => { if (commit(`VLAN ${w.orig} deleted`, s => { delete s.vlans[w.orig]; })) closeDlg(true); }, 'Delete', true); }
    }
  });
}

/* ---------- Data: export and import the two layers (lab and catalog) ---------- */
const LAYER_FILE = { lab: 'lab.yaml', cat: 'catalog.yaml' };
function fileDlg(name, text) {
  openDlg({
    title: name,
    body: () => `<textarea id="exp" readonly rows="16" wrap="off" spellcheck="false">${esc(text)}</textarea>`,
    foot: () => '<button class="btn" data-act="cp">Copy</button><button class="btn pri" data-act="dl">Save file</button>',
    on: { cp: () => copyText(text, $('#exp')), dl: () => saveFile(name, text) }
  });
}
/* One row per cable, for a label printer: the id goes on both ends. */
function labelsCsv(ls) {
  const q = v => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return ['id,layer,from_device,from_port,to_device,to_port,notes'].concat(ls.map(l => [l.id, linkLayer(l)].concat(splitRef(l.a), splitRef(l.b), [l.notes || '']).map(x => q(String(x))).join(','))).join('\r\n') + '\r\n';
}
/* A static, self-contained page: the map and the tables. Print it to get a PDF. */
function reportHtml() {
  const table = (head, rows) => '<table><thead><tr>' + head.map(x => `<th>${x}</th>`).join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  const devs = IX.names.map(n => { const d = S.devices[n]; return [n, d.types.map(typeLabel).join(', '), d.project, d.model, d.serial, d.location, d.owner, d.ports.filter(p => p.ip).map(p => p.name + ' ' + p.ip + (p.vlan ? ' (' + p.vlan + ')' : '')).join(', '), switchesOf(n).join(', '), d.notes]; });
  const cabs = S.links.slice().sort((a, b) => natCmp(a.id, b.id)).map(l => [l.id, LAYERS[linkLayer(l)].label, l.a, l.b, l.notes]);
  const vl = Object.keys(S.vlans).sort(natCmp).map(v => { const x = S.vlans[v], c = parseCidr(x.subnet); return [v, x.id == null ? '' : x.id, x.subnet || '', c ? maskOf(c) : '', x.gateway || '', x.dns || '', x.notes || '']; });
  const notes = S.ipUse.map(e => [e.vlan || '', e.from + (e.to ? '–' + e.to : ''), e.who || '', e.iface || '', e.notes || '']);
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Labmap report · rev ' + S.rev + '</title><style>body{font:13px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0}h2{font-size:15px;margin:28px 0 8px}p{color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top;font-size:12px}th{background:#eee}svg{max-width:100%;height:auto}@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>' +
    `<h1>Labmap report</h1><p>rev ${S.rev} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${plural(IX.names.length, 'device')} · ${plural(S.links.length, 'cable')}</p>` +
    '<h2>Map</h2>' + exportMapSvg() + '<h2>Devices</h2>' + table(['Name', 'Type', 'Project', 'Model', 'Serial', 'Location', 'Owner', 'IPs', 'Switched by', 'Notes'], devs) +
    '<h2>Cables</h2>' + table(['Id', 'Layer', 'From', 'To', 'Notes'], cabs) + '<h2>VLANs</h2>' + table(['Name', 'Id', 'Subnet', 'Netmask', 'Gateway', 'DNS', 'Notes'], vl) +
    '<h2>IP notes</h2>' + table(['VLAN', 'Address', 'User', 'Interface', 'Notes'], notes) + '</body></html>\n';
}
function exportDlg(kind) {
  const make = { lab: () => [LAYER_FILE.lab, toYaml(S)], cat: () => [LAYER_FILE.cat, toCatalogYaml(S.catalog)], labels: () => ['cable-labels.csv', labelsCsv(shownCables())], svg: () => ['labmap.svg', exportMapSvg()], report: () => ['labmap-report.html', reportHtml()] }[kind];
  if (!make) return;
  if (kind === 'lab') NET.localDirty = false;
  const f = make();
  fileDlg(f[0], f[1]);
}
/* Backups kept by the server: list, look, restore (as a normal, undoable change). */
const backupTime = t => String(t).replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)$/, '$1-$2-$3 $4:$5:$6');
async function backupText(file) {
  const r = await httpJson('GET', 'api/backup?file=' + encodeURIComponent(file));
  if (r.status !== 200 || !r.j) throw new Error('HTTP ' + r.status);
  return r.j.text;
}
function restoreBackup(b, text) {
  confirmDlg(`Restore the ${b.layer} as it was at rev ${b.rev} (${backupTime(b.time)})?`, () => {
    try {
      const obj = readData(text);
      if (b.layer === 'catalog') { const c = normCatalog(obj); if (!Object.keys(c.portTypes).length) throw new Error('portTypes missing'); if (commit(`Catalog restored from the backup of rev ${b.rev}`, s => { s.catalog = c; })) closeDlg(true); return; }
      obj.catalog = clone(S.catalog);
      const st = normalize(obj);
      if (commit(`Lab restored from the backup of rev ${b.rev}`, s => { for (const k of ['vlans', 'devices', 'links', 'ipUse']) s[k] = st[k]; })) { UI.sel = UI.selLink = null; UI.project = ''; closeDlg(true); renderTab(); }
    } catch (e) { toast('Backup not readable (' + e.message + ').', { sticky: true }); }
  }, 'Restore', true);
}
function backupsDlg() {
  const w = { list: null, err: '' };
  const dlg = {
    title: 'Backups',
    body() {
      if (w.err) return `<div class="iss err"><b>Error</b><span>${esc(w.err)}</span></div>`;
      if (!w.list) return '<p class="mut">Loading…</p>';
      if (!w.list.length) return '<p class="mut">No backups yet.</p>';
      return '<div class="list">' + w.list.map((b, i) => `<div class="item"><span class="chip">${esc(b.layer)}</span><span class="mono">rev ${esc(b.rev)}</span><span class="sp mut" style="font-size:12px">${esc(backupTime(b.time))}</span><span class="sub"><button class="btn sm" data-act="view" data-i="${i}">View</button> <button class="btn sm ed" data-act="restore" data-i="${i}">Restore</button></span></div>`).join('') + '</div>';
    },
    on: {
      view: async el => { const b = w.list[+el.dataset.i]; try { fileDlg(b.file, await backupText(b.file)); } catch (e) { toast('Backup not available (' + e.message + ').', { sticky: true }); } },
      restore: async el => { const b = w.list[+el.dataset.i]; try { restoreBackup(b, await backupText(b.file)); } catch (e) { toast('Backup not available (' + e.message + ').', { sticky: true }); } }
    }
  };
  openDlg(dlg);
  httpJson('GET', 'api/backups').then(r => { if (r.status !== 200 || !r.j) throw new Error('HTTP ' + r.status); w.list = r.j.backups || []; }).catch(e => { w.err = 'Backups not available (' + e.message + ').'; }).then(() => { if (topDlg() === dlg) renderDlg(); });
}
function catEditDlg() {
  const w = { text: toCatalogYaml(S.catalog) };
  openDlg({
    title: 'Catalog (YAML)',
    body: () => `<textarea data-f="text" rows="20" wrap="off" spellcheck="false" autocapitalize="off">${esc(w.text)}</textarea>`,
    foot: () => '<button class="btn" data-act="dlg-back">Cancel</button><button class="btn pri" data-act="save">Save</button>',
    set(f, v) { w[f] = v; },
    on: { save: () => {
      let c;
      try { c = normCatalog(readData(w.text)); } catch (e) { return toast(e.message, { sticky: true }); }
      if (!Object.keys(c.portTypes).length) return toast('portTypes missing.', { sticky: true });
      if (commit(`Catalog edited: ${plural(Object.keys(c.templates).length, 'template')}, ${plural(Object.keys(c.portTypes).length, 'type')}`, s => { s.catalog = c; })) closeDlg(true);
    } }
  });
}
/* Add = the import is merged and wins over what already has the same name or id. */
function mergeLab(s, st) {
  Object.assign(s.vlans, st.vlans); Object.assign(s.devices, st.devices);
  const byId = new Map(s.links.map((l, i) => [l.id, i]));
  for (const l of st.links) { if (l.id && byId.has(l.id)) s.links[byId.get(l.id)] = l; else s.links.push(l); }
  const seen = new Set(s.ipUse.map(e => JSON.stringify([e.vlan, e.from, e.to || '', e.iface || ''])));
  for (const e of st.ipUse) if (!seen.has(JSON.stringify([e.vlan, e.from, e.to || '', e.iface || '']))) s.ipUse.push(e);
}
/* Example template with every field, to write one without having a file. */
const TPL_EXAMPLE = () => ['# Edit and press Import. Delete what you do not need.',
  '# types: ' + Object.keys(TYPES).join(', '), '# power: ' + Object.keys(EXP).join(', '), '# ports: one line per port, "name type"; range eth[0-3]', '# meta: optional, data per port',
  'templates:', '  example:', '    label: "Example name"', '    types: [instrument]', '    model: "Brand Model"', '    pattern: "example-{nn}"', '    power: pdu', '    admin: "http://{ip}"', '    notes: "Device notes"',
  '    ports:', '      - "eth0 rj45"', '      - "usb[1-2] usb"', '      - "ac-in ac-in"', '    meta:', '      eth0: { services: "http, ssh", notes: "Port note" }',
  '# layer: ' + LAYER_KEYS.join(', '), '# optional: dir: in|out, net: true, virtual: true, pass: true',
  'portTypes:', '  example-type: { label: "Example type", layer: other, name: "ex{n}", first: 1, alias: [other-name] }', ''].join('\n');
function importDlg(kind) {
  const w = { text: kind === 'cat' ? TPL_EXAMPLE() : '', mode: 'add' };
  openDlg({
    title: 'Import ' + (kind === 'cat' ? 'catalog' : 'lab'),
    body: () => fld('Mode', `<select data-f="mode">${opt('add', 'Add (imported wins on equal name)', w.mode)}${opt('replace', 'Replace everything', w.mode)}</select>`) +
      `<p><input type="file" id="imp-file" accept=".yaml,.yml,.txt,.json" aria-label="File ${LAYER_FILE[kind]}"></p>` + fld('YAML', `<textarea data-f="text" id="imp" rows="12" wrap="off" spellcheck="false" autocapitalize="off" placeholder="${LAYER_FILE[kind]} file or pasted YAML">${esc(w.text)}</textarea>`),
    foot: () => '<button class="btn" data-act="dlg-back">Cancel</button><button class="btn pri" data-act="go">Import</button>',
    set(f, v) { w[f] = v; },
    file(text) { w.text = text; renderDlg(); },
    on: { go: () => {
      if (!NET.editing) return toast('Edit mode required.');
      let obj;
      try { obj = readData(w.text); } catch (e) { return toast(e.message, { sticky: true }); }
      const isCat = isObj(obj) && (isObj(obj.portTypes) || isObj(obj.templates)), isLab = isObj(obj) && (isObj(obj.devices) || Array.isArray(obj.links) || isObj(obj.vlans));
      if (kind === 'cat') {
        if (!isCat) return toast(isLab ? 'This is a lab, not a catalog.' : 'portTypes or templates missing.', { sticky: true });
        const c = normCatalog(obj), np = Object.keys(c.portTypes).length, nt = Object.keys(c.templates).length;
        if (w.mode === 'replace' && !np) return toast('Replace needs portTypes.', { sticky: true });
        if (commit(`Catalog ${w.mode === 'replace' ? 'replaced' : 'extended'}: ${plural(nt, 'template')}, ${plural(np, 'type')}`, s => { if (w.mode === 'replace') s.catalog = c; else { Object.assign(s.catalog.portTypes, c.portTypes); Object.assign(s.catalog.templates, c.templates); } })) closeDlg(true);
        return;
      }
      if (!isLab) return toast(isCat ? 'This is a catalog, not a lab.' : 'devices, links or vlans missing.', { sticky: true });
      obj.catalog = clone(S.catalog);                           // kinds are resolved against the current catalog
      const st = normalize(obj), nd = Object.keys(st.devices).length;
      if (commit(`Lab ${w.mode === 'replace' ? 'replaced' : 'extended'}: ${plural(nd, 'device')}, ${plural(st.links.length, 'cable')}`, s => { if (w.mode === 'replace') for (const k of ['vlans', 'devices', 'links', 'ipUse']) s[k] = st[k]; else mergeLab(s, st); })) { UI.sel = UI.selLink = null; UI.project = ''; closeDlg(true); renderTab(); }
    } }
  });
}
/* Loads the demo lab (example/lab.yaml) in place of the current one. */
function loadExample() {
  confirmDlg('Replace the lab with the example?', async () => {
    try {
      const r = await fetch('example/lab.yaml', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ex = readData(await r.text());
      ex.catalog = clone(S.catalog);
      if (replaceState(normalize(ex), 'Example lab loaded')) { UI.sel = UI.selLink = null; UI.project = ''; renderTab(); }
    } catch (e) { toast('Example not available (' + e.message + ').', { sticky: true }); }
  }, 'Load', true);
}

/* ---------------------------------------------------------------------------
   17. Actions (data-act) and events
   --------------------------------------------------------------------------- */
const ACT = {
  tab: el => { setTab(el.dataset.tab); },
  'toggle-edit': () => (NET.editing ? leaveEdit() : enterEdit()),
  layer: el => { UI.layers[el.dataset.l] = !UI.layers[el.dataset.l]; renderMapTab(); },
  'layers-all': () => { for (const k of LAYER_KEYS) UI.layers[k] = true; renderMapTab(); },
  'layers-none': () => { for (const k of LAYER_KEYS) UI.layers[k] = false; renderMapTab(); },
  zoom: el => { UI.fit = false; UI.zoom = Math.max(0.3, Math.min(3, UI.zoom * (+el.dataset.z > 0 ? 1.25 : 0.8))); renderMapTab(); },
  fit: () => { UI.fit = !UI.fit; if (!UI.fit) UI.zoom = 1; renderMapTab(); },
  'map-bg': () => { if (UI.sel || UI.selLink) { UI.sel = UI.selLink = null; renderMap(); } },
  dev: el => { const n = el.dataset.dev; if (!S.devices[n]) return toast(`${n} does not exist.`); if (el.dataset.map) { UI.sel = n; UI.selLink = null; renderMap(); } devSheet(n); },
  cable: el => { const id = el.dataset.id; if (!S.links.some(l => l.id === id)) return; if (el.closest('svg')) { UI.selLink = id; UI.sel = null; renderMap(); } cableSheet(id); },
  'add-dev': () => wizDevice(),
  'add-link': () => wizLink(),
  vlan: el => { UI.vlan = el.dataset.v; UI.ipBlock = null; renderIps(); },
  'ip-block': el => { UI.ipBlock = +el.dataset.b; renderIps(); },
  'vlan-edit': el => vlanDlg(el.dataset.v),
  ip: el => ipDlg(el.dataset.v, +el.dataset.ip),
  'ip-give': el => ipUseDlg({ vlan: el.dataset.v || undefined, ip: el.dataset.ip != null ? +el.dataset.ip : null }),
  'ipuse-edit': el => ipUseDlg({ i: +el.dataset.i }),
  'ipuse-del': el => { const i = +el.dataset.i, e = S.ipUse[i]; if (e) commit(`IP note ${e.from}${e.to ? '–' + e.to : ''} deleted (${e.who || '?'})`, s => { s.ipUse.splice(i, 1); }); },
  issue: el => { const d = el.dataset; if (d.link && S.links.some(l => l.id === d.link)) cableSheet(d.link); else if (d.dev && S.devices[d.dev]) devSheet(d.dev); else if (d.v) { UI.vlan = d.v; setTab('ips'); } },
  export: el => exportDlg(el.dataset.k),
  backups: () => backupsDlg(),
  import: el => importDlg(el.dataset.k === 'cat' ? 'cat' : 'lab'),
  'cat-edit': () => catEditDlg(),
  'tpl-del': el => { const k = el.dataset.k; if (CAT.templates[k]) commit(`Template ${k} deleted`, s => { delete s.catalog.templates[k]; }); },
  user: () => userDlg(),
  example: () => loadExample(),
  undo: () => undo(),
  'toast-x': () => hideToast(),
  'dlg-close': () => closeDlg(true),
  'dlg-back': () => closeDlg(),
  copy: el => { const src = $('#' + el.dataset.src); if (src) copyText(src.textContent, src); },
  'log-more': () => { UI.logN += 100; renderData(); },
  'err-close': el => { el.hidden = true; }
};

let deb = 0;
const debounce = (fn, ms) => { clearTimeout(deb); deb = setTimeout(fn, ms || 180); };
function wire() {
  document.addEventListener('click', e => {
    NET.lastAct = Date.now();
    if (e.target.id === 'dlg-back') return closeDlg(true);
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, d = topDlg();
    if (d && d.on && d.on[act] && $('#dlg').contains(el)) { e.preventDefault(); return d.on[act](el, e); }
    if (ACT[act]) { e.preventDefault(); ACT[act](el, e); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    NET.lastAct = Date.now();
    if (el.dataset && el.dataset.f != null && $('#dlg').contains(el)) {
      const d = topDlg();
      if (!d || !d.set) return;
      d.set(el.dataset.f, el.type === 'checkbox' ? el.checked : el.value);
      if (el.dataset.re != null && d.partial) debounce(() => { if (topDlg() === d) d.partial(); }, 250);     // only the part that depends on the text
      return;
    }
    if (el.id === 'q') { UI.q = el.value; debounce(() => { const h = UI.q.trim() ? [...searchMatch(UI.q.trim().toLowerCase())] : []; if (h.length) UI.center = h.find(n => LAYOUT && LAYOUT.box.has(n)) || null; renderMap(); }); }
    else if (el.id === 'dq') { UI.dq = el.value; debounce(renderDevices); }
    else if (el.id === 'cq') { UI.cq = el.value; debounce(renderCables); }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'imp-file') { const f = el.files && el.files[0], d = topDlg(); if (!f || !d || !d.file) return; const r = new FileReader(); r.onload = () => d.file(String(r.result || '')); r.onerror = () => toast('Could not read the file.'); r.readAsText(f); return; }
    if (el.dataset && el.dataset.f != null && $('#dlg').contains(el)) {
      const d = topDlg();
      if (!d || !(el.tagName === 'SELECT' || el.type === 'checkbox')) return;
      if (d.set) d.set(el.dataset.f, el.type === 'checkbox' ? el.checked : el.value);
      if (d.fix) d.fix(el.dataset.f);
      renderDlg();
      return;
    }
    if (el.id === 'f-proj') { UI.project = el.value; UI.sel = UI.selLink = null; renderMapTab(); const w = $('#mapwrap'); w.scrollTop = 0; w.scrollLeft = 0; }
    else if (el.id === 'd-type') { UI.dtype = el.value; renderDevices(); }
    else if (el.id === 'c-layer') { UI.clayer = el.value; renderCables(); }
  });
  document.addEventListener('keydown', e => { NET.lastAct = Date.now(); if (e.key === 'Escape' && topDlg()) closeDlg(); });
  document.addEventListener('pointerdown', () => { NET.lastAct = Date.now(); }, { passive: true });
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== UI.tab) setTab(t); });
  window.addEventListener('beforeunload', e => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });      // ask before losing unsaved changes
  window.addEventListener('pagehide', () => {                                      // release the lock when the page closes
    if (!NET.editing || NET.mode === 'local') return;
    try { navigator.sendBeacon('api/lock', new Blob([JSON.stringify({ holder: holder(), by: who(), ttlMs: 1000 })], { type: 'application/json' })); } catch (e) {}
  });
}

/* ---------------------------------------------------------------------------
   18. Start: draw an empty lab, then ask the server; without one, local mode
   --------------------------------------------------------------------------- */
async function boot() {
  S = normalize({}); reindex();
  wire();
  try { UI.user = cleanUser(localStorage.getItem('labmap.user')); } catch (e) {}
  setTab(location.hash.slice(1) || 'map');
  if (!(await connectServer())) {
    try {
      const r = await fetch('defaults/catalog.yaml', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      CATALOG0 = normCatalog(readData(await r.text()));
    } catch (e) { showError('Default catalog not loaded (' + e.message + '). Import one in Catalog.'); }
    S = normalize({}); refreshAll();
    setMode('local');
  }
  setInterval(tick, 5000);
}

/* Pure functions in view: for tests, for the console and for tools/ (Node). */
const API = {
  VERSION, get state() { return S; }, get index() { return IX; }, get net() { return NET; }, get ui() { return UI; },
  layerOf, powerDir, isNetKind, kindKey, mapCol, exportMapSvg, reportHtml, labelsCsv, routesFrom, routeText, chainsUp, cascade, switchesOf, upLinks, pairedIn, validate: () => IX.issues, ipInfo, freeIp, parsePorts, portsToText, suggestPorts, genNames, nextCableId,
  FORMAT, toYaml, toCatalogYaml, parseYaml, readData, normCatalog, normalize, setCatalog0: c => { CATALOG0 = normCatalog(c); }, ipToInt, intToIp, commit, enterEdit, leaveEdit, setTab, refreshAll, replaceState,
  /* load a lab without edit mode or saving (tests and console) */
  load: st => { st.catalog = st.catalog || clone(S.catalog); S = normalize(st); UNDO = null; refreshAll(); }
};
if (typeof window !== 'undefined') { window.LAB = API; boot(); }
if (typeof module !== 'undefined' && module.exports) module.exports = API;
