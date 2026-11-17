# Labmap

Living documentation for a lab, office or home network: which devices exist, which
ports they have, which cables join them, how they are powered and which IP each one
uses. One web page, one small Python server, two YAML files. No dependencies.

- **Map** drawn from the data in five columns: power (sockets, UPS, strips, PDUs, relays),
  supplies, devices (grouped by project), adapters and hubs, network (routers, switches,
  servers). One colour per layer (network, power, serial, JTAG, USB, video, buses, RF,
  radio, discrete). Export as SVG, or as a static HTML report (print it to PDF).
- **Device sheet**: ports, cables, power chain ("powered from", "if switched off, these
  go down"), which PDU or relay outlet switches it, link to its admin page.
- **Routes** through adapters, hubs and bus couplers: follow a serial console from a
  board to the server it ends up on.
- **IP addresses** per VLAN: grid of free / on a port / noted / conflicting addresses,
  netmask, gateway, DNS, "give me a free IP", and the ports in each VLAN (access and
  tagged trunk ports).
- **Cables in bulk** (consecutive ports) and a **labels CSV** for the label printer.
- **Validation** that never blocks: duplicate IP or MAC, cable to a missing port,
  mismatched port types, device with no power cable.
- **Catalog** of port types and device templates, editable from the page.
- **Edit lock**, change log, undo, and backups you can restore from the page. A save
  that fails while the server is down is kept and retried. Works on a phone.

## Install

Needs Python 3.7 or later (Linux, Windows or macOS). Nothing else to install. Pick a
released version from the [tags](https://github.com/guaifi/labmap/tags):

```bash
git clone --branch v0.6.0 --depth 1 https://github.com/guaifi/labmap.git /opt/labmap
```

```bash
python3 /opt/labmap/server.py --port 8080
```

Without Git, download the archive of that version instead:

```bash
mkdir -p /opt/labmap && curl -L https://github.com/guaifi/labmap/archive/refs/tags/v0.6.0.tar.gz | tar xz --strip-components=1 -C /opt/labmap
```

Open `http://<host>:8080`. Press **Edit**, type a user name, add devices and cables.
**Data > Load example** loads a small demo: two wall sockets, a power strip, a router,
a switch, two PCs and a board with its serial console.

There are no passwords and no HTTPS: it is meant for a trusted lab network. Do not
expose it to the Internet.

## Three layers

| Layer   | Files                              | Contents                                   |
|---------|------------------------------------|--------------------------------------------|
| Web     | `index.html`, `app.js`, `server.py` | Code. Knows nothing about concrete devices. |
| Catalog | `data-do-not-edit/catalog.yaml`     | Port types and device templates.            |
| Lab     | `data-do-not-edit/lab.yaml`         | Devices, cables, VLANs, IP notes, change log. |

`data-do-not-edit/` is the database. The server creates it on first run (the catalog
is copied from `defaults/catalog.yaml`) and it is git-ignored. Do not edit those files
by hand: change them from the page. To keep it somewhere else (another disk, a synced
folder), start the server with `--data /path/to/folder`. Each layer has its own **Export** and **Import**
(add or replace) in the Data and Catalog tabs.

## Update

The code and the data are separate, so updating never touches the data. With Git, move
to the version you want (or back to the previous one):

```bash
cd /opt/labmap && git fetch --depth 1 origin tag v0.6.1 && git checkout v0.6.1
```

```bash
sudo systemctl restart labmap
```

Without Git, extract the new archive over the old folder (the data folder is not in the
archive, so it is kept), then restart. If the data lives outside with `--data`, the code
folder can simply be deleted and replaced. The version in use is shown next to the title.

New templates or port types from a newer `defaults/catalog.yaml` are not applied to an
existing installation automatically: import that file in **Catalog > + Template or
type** (mode "Add").

## Run as a service (Linux)

`/etc/systemd/system/labmap.service`:

```ini
[Unit]
Description=Labmap
After=network.target

[Service]
WorkingDirectory=/opt/labmap
ExecStart=/usr/bin/python3 /opt/labmap/server.py --port 8080 --data /var/lib/labmap
Restart=always
User=labmap

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin labmap
sudo mkdir -p /var/lib/labmap && sudo chown labmap: /var/lib/labmap
sudo systemctl enable --now labmap
```

## Backups and privacy

Every save keeps the previous version in `backups/` inside the data folder: the last
300 per file and, older than that, the last one of each day. **Data > Backups** lists them; **Restore** brings one back as a normal
change (logged, with Undo). The change log inside `lab.yaml` keeps the last 300 changes.

The data holds IPs, MACs, serial numbers and admin URLs: treat it as sensitive.

- Never put the data folder in a public repository. It is git-ignored here for that
  reason.
- Keep it encrypted at rest with disk encryption on the server PC (LUKS, BitLocker,
  FileVault). The page does not encrypt it: browser-side encryption with a shared
  password would add little against someone who already has the files or the page.
- Copy it off the machine. For example a nightly copy of the data folder (here the
  default one; use yours if you start the server with `--data`) to another disk:

```bash
rsync -a /opt/labmap/data-do-not-edit/ /mnt/backup/labmap/
```

  or keep the data folder in its own **private** Git repository and commit it from cron:

```bash
cd /opt/labmap/data-do-not-edit && git add -A && git commit -qm "backup $(date +%F)" && git push -q
```

To restore by hand: stop the service, copy a file from `backups/` over `lab.yaml` or
`catalog.yaml`, start it again.

## Data format

`lab.yaml` and `catalog.yaml` are plain, standard YAML: any YAML library (Python's
PyYAML, for example) reads them, so the data is never locked into this tool. Both carry
`format: 1`. New optional fields do not change the format. If a future version ever
needs a different layout, it converts older files by itself when it reads them; a
version that finds data newer than it understands opens it read-only and never writes
over it.

## Concepts

- A **device** has a name (its physical label and hostname), one or more types and a
  list of **ports**. A port has a name and a type from the catalog (`rj45`, `usb`,
  `ac-in`, `rs232`...). Only network port types take VLAN, IP, MAC and services.
- A **cable** joins two ports and has an id (`N-001` network, `P-001` power, `S-`
  serial, `J-` JTAG, `U-` USB, `V-` video, `B-` buses, `R-` RF, `W-` radio, `D-`
  discrete, `X-` other) that goes on the physical label at both ends. For power, the
  first end is the outlet.
- **Pass-through devices** (adapters, hubs, bus couplers) are crossed by routes.
- **Relay boards** use paired `relay-in` / `relay-out` ports: outlet N depends only on
  inlet N.
- **Users**: no accounts. Each person types a short user name once; it is used in the
  change log. Only one person edits at a time (2-minute lock, renewed while editing;
  edit mode closes after 10 idle minutes).

## Development

`app.js` starts with a maintainer guide: principles, data model, where to change what.

```bash
node --check app.js
npm i playwright            # once, for the browser tests
node tools/test.js          # headless tests, including server.py with two browsers
node tools/fixture.js 4 > /tmp/big.yaml     # a synthetic 270-device lab for load tests
```

Opened from static hosting (no `server.py`) the page runs in local mode: nothing is
saved, useful only for a demo.

## Limits

IPv4 only. No authentication. The map does not minimise cable crossings; with hundreds
of cables use the layer toggles, the project filter or select a device. Other browsers
see a change after about 8 seconds.
