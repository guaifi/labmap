#!/usr/bin/env python3
"""Labmap server. Needs only Python 3.7+ (standard library, nothing to install).

Usage:   python3 server.py [--port 8080] [--host 0.0.0.0] [--data FOLDER] [--site NAME]

Serves the web page (index.html, app.js) and keeps the data in data-do-not-edit/
(or in the folder given with --data: another disk, a synced folder...):
    catalog.yaml              port types and device templates, shared by every site
    backups/                  previous versions of catalog.yaml
    sites/NAME/lab.yaml       one site (lab, office, home): devices, cables, VLANs,
                              IPs and change log
    sites/NAME/backups/       previous versions of that lab.yaml
Backups: the last 300 of each file, and older than that the last one of each day.

On first run the folder is created with one site (--site, default "main") and the
catalog copied from defaults/catalog.yaml. More sites are added from the page. The
folder is git-ignored: updating the code never touches it. Never publish it.

API (used by app.js). SITE is the site name; it can be left out when there is only one.
    GET  /api/sites                    -> { sites: [{ name, rev }] }
    POST /api/sites   <- { name }      -> 200 { name } | 400 bad name | 409 exists
    GET  /api/state?site=SITE          -> { labmap, site, rev, catRev, lab, cat }   (YAML texts)
    GET  /api/rev?site=SITE            -> { rev, catRev }
    PUT  /api/state?site=SITE  <- { rev, base, holder, by, msg, lab, cat?, catBase? }
         cat only when the catalog changed; catBase = the catRev it started from
         -> 200 { rev, catRev } | 409 current state (base or catBase mismatch)
            | 423 { by } (another user holds the lock of this site) | 400 { error }
    POST /api/lock?site=SITE   <- { holder, by, ttlMs }   small ttlMs = release
                                   -> { acquired, by, expiresAt }
    GET  /api/backups?site=SITE        -> { backups: [{ file, layer, rev, time }] }  newest first
    GET  /api/backup?site=SITE&file=NAME -> { file, text }
    503 { error } when a data file is missing (for example not downloaded from iCloud).

No passwords and no HTTPS: meant for the lab network. Do not expose it to the Internet.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = ''                                      # set by use_data()
DEFAULT_CAT = os.path.join(BASE, 'defaults', 'catalog.yaml')
MAX_BACKUPS = 300
MAX_BODY = 20 * 1024 * 1024
SITE_RE = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?')
BACKUP_RE = re.compile(r'(lab|catalog)-(?:rev(\d{6,})-)?(\d{8}T\d{6})(?:-(\d+))?\.yaml')
EMPTY_LAB = '# LABMAP DATABASE · lab\n# DO NOT EDIT BY HAND: change it from the web page.\nrev: 0\nformat: 1\nvlans:\ndevices:\nlinks: []\nipUse: []\nlog: []\n'
# The only files served besides the API. Everything else is 404.
STATIC = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/defaults/catalog.yaml': (os.path.join('defaults', 'catalog.yaml'), 'text/plain; charset=utf-8'),
    '/example/lab.yaml': (os.path.join('example', 'lab.yaml'), 'text/plain; charset=utf-8'),
}

mutex = threading.Lock()
locks = {}                                     # site -> { holder, by, exp }


class Missing(Exception):
    """A data file that should exist is not there."""


def use_data(folder):
    global DATA
    DATA = os.path.abspath(folder)


def cat_path():
    return os.path.join(DATA, 'catalog.yaml')


def site_dir(site):
    return os.path.join(DATA, 'sites', site)


def lab_path(site):
    return os.path.join(site_dir(site), 'lab.yaml')


def sites():
    d = os.path.join(DATA, 'sites')
    return sorted(s for s in os.listdir(d) if SITE_RE.fullmatch(s) and os.path.isdir(os.path.join(d, s))) if os.path.isdir(d) else []


def read(path, must=False):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        if not must:
            return ''
        cloud = os.path.join(os.path.dirname(path), '.' + os.path.basename(path) + '.icloud')
        raise Missing('%s is missing%s' % (path, ' (not downloaded from iCloud)' if os.path.exists(cloud) else ''))


def rev_of(text):
    m = re.search(r'^rev:\s*(\d+)', text, re.M)
    return int(m.group(1)) if m else 0


def format_of(text):
    m = re.search(r'^format:\s*(\d+)', text, re.M)
    return int(m.group(1)) if m else 1


def cat_rev(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]


def write_atomic(path, text):
    """Temporary file in the same folder, then rename."""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def prune(folder, kind):
    """The last MAX_BACKUPS are kept; older ones only the last of each day, so a busy
    day of editing never wipes out the previous days."""
    old = sorted(f for f in os.listdir(folder) if BACKUP_RE.fullmatch(f) and f.startswith(kind + '-'))
    days = {BACKUP_RE.fullmatch(f).group(3)[:8] for f in old[-MAX_BACKUPS:]}
    for f in reversed(old[:-MAX_BACKUPS]):
        day = BACKUP_RE.fullmatch(f).group(3)[:8]
        if day in days:
            os.remove(os.path.join(folder, f))
        days.add(day)


def backup(path, rev=None):
    """Keep the version about to be replaced (in backups/ next to it)."""
    if not os.path.exists(path):
        return
    folder = os.path.join(os.path.dirname(path), 'backups')
    os.makedirs(folder, exist_ok=True)
    kind = os.path.splitext(os.path.basename(path))[0]
    stamp = datetime.datetime.now().strftime('%Y%m%dT%H%M%S')
    name = '%s-rev%06d-%s' % (kind, rev, stamp) if rev is not None else '%s-%s' % (kind, stamp)
    n, dest = 1, os.path.join(folder, name + '.yaml')
    while os.path.exists(dest):
        n += 1
        dest = os.path.join(folder, '%s-%d.yaml' % (name, n))
    shutil.copy2(path, dest)
    prune(folder, kind)


def backup_folder(site, layer):
    return os.path.join(site_dir(site) if layer == 'lab' else DATA, 'backups')


def backups(site):
    out = []
    for layer in ('lab', 'catalog'):
        folder = backup_folder(site, layer)
        for f in os.listdir(folder) if os.path.isdir(folder) else []:
            m = BACKUP_RE.fullmatch(f)
            if m and m.group(1) == layer:
                out.append({'file': f, 'layer': layer, 'rev': int(m.group(2)) if m.group(2) else None, 'time': m.group(3)})
    out.sort(key=lambda b: (b['time'], b['file']), reverse=True)
    return out


def state(site):
    lab, cat = read(lab_path(site), True), read(cat_path(), True)
    return {'labmap': 2, 'site': site, 'rev': rev_of(lab), 'catRev': cat_rev(cat), 'lab': lab, 'cat': cat}


def new_site(site):
    os.makedirs(os.path.join(site_dir(site), 'backups'))
    write_atomic(lab_path(site), EMPTY_LAB)


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


class Handler(BaseHTTPRequestHandler):
    server_version = 'Labmap'

    def log_message(self, fmt, *args):          # only saves are logged, not every read
        pass

    def send(self, code, body, ctype):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def json(self, code, obj):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            return None
        try:
            obj = json.loads(self.rfile.read(n).decode('utf-8'))
            return obj if isinstance(obj, dict) else None
        except ValueError:
            return None

    def query(self, key):
        return (parse_qs(self.path.partition('?')[2]).get(key) or [''])[0]

    def site(self):
        """The site of the request, or None after answering with the error."""
        s, all_ = self.query('site'), sites()
        if not s and len(all_) == 1:
            return all_[0]
        if s in all_:
            return s
        self.json(404 if s else 400, {'error': ('no site "%s"' % s) if s else 'site missing', 'sites': all_})
        return None

    def run(self, fn):
        try:
            return fn()
        except Missing as e:                    # a data file vanished: say so, never serve an empty lab
            return self.json(503, {'error': str(e)})

    def do_GET(self):
        return self.run(self.get)

    def do_HEAD(self):
        return self.run(self.get)

    def do_POST(self):
        return self.run(self.post)

    def do_PUT(self):
        return self.run(self.put)

    def get(self):
        path = self.path.split('?')[0]
        if path == '/api/sites':
            with mutex:
                return self.json(200, {'sites': [{'name': s, 'rev': rev_of(read(lab_path(s)))} for s in sites()]})
        if path.startswith('/api/'):
            site = self.site()
            if not site:
                return
            if path == '/api/state':
                with mutex:
                    return self.json(200, state(site))
            if path == '/api/rev':
                with mutex:
                    return self.json(200, {'rev': rev_of(read(lab_path(site), True)), 'catRev': cat_rev(read(cat_path(), True))})
            if path == '/api/backups':
                with mutex:
                    return self.json(200, {'backups': backups(site)})
            if path == '/api/backup':
                name = self.query('file')
                m = BACKUP_RE.fullmatch(name)          # also keeps the request inside the backups folders
                if not m:
                    return self.json(400, {'error': 'invalid backup name'})
                with mutex:
                    text = read(os.path.join(backup_folder(site, m.group(1)), name))
                return self.json(200, {'file': name, 'text': text}) if text else self.json(404, {'error': 'backup not found'})
        if path in STATIC:
            name, ctype = STATIC[path]
            try:
                with open(os.path.join(BASE, name), 'rb') as f:
                    return self.send(200, f.read(), ctype)
            except FileNotFoundError:
                pass
        return self.send(404, b'not found', 'text/plain; charset=utf-8')

    def post(self):
        path = self.path.split('?')[0]
        b = self.body()
        if path == '/api/sites':
            name = str((b or {}).get('name') or '').strip().lower()
            if not SITE_RE.fullmatch(name):
                return self.json(400, {'error': 'site name: lower case letters, digits and "-", up to 32'})
            with mutex:
                if name in sites():
                    return self.json(409, {'error': 'the site already exists'})
                new_site(name)
            print('%s  new site %s  %s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), name, b.get('by') or '?'), flush=True)
            return self.json(200, {'name': name})
        if path != '/api/lock':
            return self.send(404, b'not found', 'text/plain; charset=utf-8')
        site = self.site()
        if not site:
            return
        if not b or not b.get('holder'):
            return self.json(400, {'error': 'holder missing'})
        ttl = max(1.0, min(600.0, float(b.get('ttlMs') or 30000) / 1000.0))
        now = time.time()
        with mutex:
            lock = locks.setdefault(site, {'holder': None, 'by': '', 'exp': 0.0})
            free = lock['holder'] in (None, b['holder']) or lock['exp'] < now
            if free:
                lock.update(holder=b['holder'], by=str(b.get('by') or ''), exp=now + ttl)
            return self.json(200, {'acquired': free, 'by': lock['by'], 'expiresAt': iso(lock['exp'])})

    def put(self):
        if self.path.split('?')[0] != '/api/state':
            return self.send(404, b'not found', 'text/plain; charset=utf-8')
        site = self.site()
        if not site:
            return
        b = self.body()
        if not b or not isinstance(b.get('lab'), str) or not isinstance(b.get('rev'), int):
            return self.json(400, {'error': 'invalid body'})
        if rev_of(b['lab']) != b['rev'] or 'devices:' not in b['lab']:
            return self.json(400, {'error': 'the lab YAML does not match the revision'})
        cat = b.get('cat')
        cat = cat if isinstance(cat, str) and 'portTypes:' in cat else None
        with mutex:
            now = time.time()
            lock = locks.get(site) or {'holder': None, 'exp': 0.0, 'by': ''}
            if lock['holder'] not in (None, b.get('holder')) and lock['exp'] > now:
                return self.json(423, {'by': lock['by'], 'expiresAt': iso(lock['exp'])})
            current = state(site)
            if b.get('base') != current['rev']:
                return self.json(409, current)
            if cat == current['cat']:
                cat = None
            if cat is not None and b.get('catBase') != current['catRev']:      # the catalog was changed from another site meanwhile
                return self.json(409, current)
            # a page still running older code must not rewrite newer data with less
            if format_of(b['lab']) < format_of(current['lab']) or (cat is not None and format_of(cat) < format_of(current['cat'])):
                return self.json(400, {'error': 'older data format: reload the page'})
            backup(lab_path(site), current['rev'])
            write_atomic(lab_path(site), b['lab'])
            if cat is not None:
                backup(cat_path())
                write_atomic(cat_path(), cat)
            crev = cat_rev(cat) if cat is not None else current['catRev']
        print('%s  %s rev %d  %s  %s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), site, b['rev'], b.get('by') or '?', str(b.get('msg') or '')[:160]), flush=True)
        return self.json(200, {'rev': b['rev'], 'catRev': crev})


def prepare(first_site):
    """Create the data folder on first run; move a single-lab folder (0.6) into sites/."""
    for f in ('catalog.yaml', 'lab.yaml'):
        if os.path.exists(os.path.join(DATA, '.' + f + '.icloud')):
            sys.exit('%s is not downloaded from iCloud. Open the folder in Finder, wait for it, and start again.' % os.path.join(DATA, f))
    os.makedirs(os.path.join(DATA, 'backups'), exist_ok=True)
    old = os.path.join(DATA, 'lab.yaml')
    if os.path.exists(old) and not sites():
        os.makedirs(os.path.join(site_dir(first_site), 'backups'))
        os.replace(old, lab_path(first_site))
        for f in os.listdir(os.path.join(DATA, 'backups')):
            if f.startswith('lab-'):
                os.replace(os.path.join(DATA, 'backups', f), os.path.join(site_dir(first_site), 'backups', f))
        print('lab.yaml moved to sites/%s/' % first_site, flush=True)
    if not sites():
        new_site(first_site)
    if not os.path.exists(cat_path()) and os.path.exists(DEFAULT_CAT):
        shutil.copyfile(DEFAULT_CAT, cat_path())


def main():
    ap = argparse.ArgumentParser(description='Labmap server')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--host', default='0.0.0.0', help='127.0.0.1 = only this computer')
    ap.add_argument('--data', default=os.path.join(BASE, 'data-do-not-edit'), help='data folder (default: data-do-not-edit next to server.py)')
    ap.add_argument('--site', default='main', help='name of the site created on first run (default: main)')
    a = ap.parse_args()
    if not SITE_RE.fullmatch(a.site):
        sys.exit('--site: lower case letters, digits and "-", up to 32')
    if not os.path.exists(os.path.join(BASE, 'index.html')):
        sys.exit('index.html must be next to server.py')
    use_data(a.data)
    prepare(a.site)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print('Labmap at http://%s:%d  ·  data in %s  ·  sites: %s' % (a.host, a.port, DATA, ', '.join(sites())), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
