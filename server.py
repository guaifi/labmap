#!/usr/bin/env python3
"""Labmap server. Needs only Python 3.7+ (standard library, nothing to install).

Usage:   python3 server.py [--port 8080] [--host 0.0.0.0]

Serves the web page (index.html, app.js) and stores the data in data-do-not-edit/:
    data-do-not-edit/lab.yaml       devices, cables, VLANs, IPs and change log
    data-do-not-edit/catalog.yaml   port types and device templates
    data-do-not-edit/backups/       the previous version of every save

The data folder is created on first run (catalog copied from defaults/catalog.yaml)
and is git-ignored: updating the code never touches it.

API (used by app.js):
    GET  /api/state  -> { labmap, rev, lab, cat }      lab and cat are YAML text
    GET  /api/rev    -> { rev }
    PUT  /api/state  <- { rev, base, holder, by, msg, lab, cat }
                     -> 200 { rev } | 409 current state (base mismatch) | 423 { by } (locked by another)
    POST /api/lock   <- { holder, by, ttlMs }           small ttlMs = release
                     -> { acquired, by, expiresAt }

No passwords and no HTTPS: meant for the lab network. Do not expose it to the Internet.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, 'data-do-not-edit')
BACKUPS = os.path.join(DATA, 'backups')
LAB = os.path.join(DATA, 'lab.yaml')
CAT = os.path.join(DATA, 'catalog.yaml')
DEFAULT_CAT = os.path.join(BASE, 'defaults', 'catalog.yaml')
MAX_BACKUPS = 300
MAX_BODY = 20 * 1024 * 1024
EMPTY_LAB = '# LABMAP DATABASE · lab\n# DO NOT EDIT BY HAND: change it from the web page.\nrev: 0\nvlans:\ndevices:\nlinks: []\nipUse: []\nlog: []\n'
# The only files served besides the API. Everything else is 404.
STATIC = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/defaults/catalog.yaml': (os.path.join('defaults', 'catalog.yaml'), 'text/plain; charset=utf-8'),
    '/example/lab.yaml': (os.path.join('example', 'lab.yaml'), 'text/plain; charset=utf-8'),
}

mutex = threading.Lock()
lock = {'holder': None, 'by': '', 'exp': 0.0}


def read(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return ''


def rev_of(text):
    m = re.search(r'^rev:\s*(\d+)', text, re.M)
    return int(m.group(1)) if m else 0


def write_atomic(path, text):
    """Temporary file in the same folder, then rename."""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def backup(path, rev):
    """Keep the version about to be replaced and prune the oldest ones."""
    if not os.path.exists(path):
        return
    os.makedirs(BACKUPS, exist_ok=True)
    name = os.path.splitext(os.path.basename(path))[0]
    stamp = datetime.datetime.now().strftime('%Y%m%dT%H%M%S')
    shutil.copy2(path, os.path.join(BACKUPS, '%s-rev%06d-%s.yaml' % (name, rev, stamp)))
    old = sorted(f for f in os.listdir(BACKUPS) if f.startswith(name + '-rev'))
    for f in old[:-MAX_BACKUPS]:
        os.remove(os.path.join(BACKUPS, f))


def state():
    lab = read(LAB) or EMPTY_LAB
    return {'labmap': 1, 'rev': rev_of(lab), 'lab': lab, 'cat': read(CAT)}


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

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/state':
            with mutex:
                return self.json(200, state())
        if path == '/api/rev':
            with mutex:
                return self.json(200, {'rev': rev_of(read(LAB))})
        if path in STATIC:
            name, ctype = STATIC[path]
            try:
                with open(os.path.join(BASE, name), 'rb') as f:
                    return self.send(200, f.read(), ctype)
            except FileNotFoundError:
                pass
        return self.send(404, b'not found', 'text/plain; charset=utf-8')

    do_HEAD = do_GET

    def do_POST(self):
        if self.path.split('?')[0] != '/api/lock':
            return self.send(404, b'not found', 'text/plain; charset=utf-8')
        b = self.body()
        if not b or not b.get('holder'):
            return self.json(400, {'error': 'holder missing'})
        ttl = max(1.0, min(600.0, float(b.get('ttlMs') or 30000) / 1000.0))
        now = time.time()
        with mutex:
            free = lock['holder'] in (None, b['holder']) or lock['exp'] < now
            if free:
                lock.update(holder=b['holder'], by=str(b.get('by') or ''), exp=now + ttl)
            return self.json(200, {'acquired': free, 'by': lock['by'], 'expiresAt': iso(lock['exp'])})

    def do_PUT(self):
        if self.path.split('?')[0] != '/api/state':
            return self.send(404, b'not found', 'text/plain; charset=utf-8')
        b = self.body()
        if not b or not isinstance(b.get('lab'), str) or not isinstance(b.get('rev'), int):
            return self.json(400, {'error': 'invalid body'})
        if rev_of(b['lab']) != b['rev'] or 'devices:' not in b['lab']:
            return self.json(400, {'error': 'the lab YAML does not match the revision'})
        with mutex:
            now = time.time()
            if lock['holder'] not in (None, b.get('holder')) and lock['exp'] > now:
                return self.json(423, {'by': lock['by'], 'expiresAt': iso(lock['exp'])})
            current = state()
            if b.get('base') != current['rev']:
                return self.json(409, current)
            backup(LAB, current['rev'])
            write_atomic(LAB, b['lab'])
            cat = b.get('cat')
            if isinstance(cat, str) and 'portTypes:' in cat and cat != current['cat']:
                backup(CAT, current['rev'])
                write_atomic(CAT, cat)
        print('%s  rev %d  %s  %s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), b['rev'], b.get('by') or '?', str(b.get('msg') or '')[:160]), flush=True)
        return self.json(200, {'rev': b['rev']})


def main():
    ap = argparse.ArgumentParser(description='Labmap server')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--host', default='0.0.0.0')
    a = ap.parse_args()
    if not os.path.exists(os.path.join(BASE, 'index.html')):
        sys.exit('index.html must be next to server.py')
    os.makedirs(BACKUPS, exist_ok=True)
    if not os.path.exists(LAB):
        write_atomic(LAB, EMPTY_LAB)
    if not os.path.exists(CAT) and os.path.exists(DEFAULT_CAT):
        shutil.copyfile(DEFAULT_CAT, CAT)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print('Labmap at http://%s:%d  ·  data in %s  ·  rev %d' % (a.host, a.port, DATA, rev_of(read(LAB))), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
