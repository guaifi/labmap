# Labmap

Living documentation for a lab, office or home network: which devices exist, which
ports they have, which cables join them, how they are powered and which IP each one
uses. One web page, one small Python server, two YAML files. No dependencies.

- **Map** drawn from the data: infrastructure in the centre, devices grouped by project
  on both sides, one colour per layer (network, power, serial, JTAG, USB, video, buses,
  RF, radio, discrete).
- **Device sheet**: ports, cables, power chain ("powered from", "if switched off, these
  go down"), which PDU or relay outlet switches it, link to its admin page.
- **Routes** through adapters, hubs and bus couplers: follow a serial console from a
  board to the server it ends up on.
- **IP addresses** per VLAN: grid of free / on a port / noted / conflicting addresses,
  netmask, gateway, DNS, "give me a free IP".
- **Validation** that never blocks: duplicate IP or MAC, cable to a missing port,
  mismatched port types, device with no power cable.
- **Catalog** of port types and device templates, editable from the page.
- **Edit lock**, change log and undo. Works on a phone.

## Run

Needs Python 3.7 or later. Nothing to install.

```bash
git clone https://github.com/guaifi/labmap.git
cd labmap
python3 server.py --port 8080
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
by hand: change them from the page. Each layer has its own **Export** and **Import**
(add or replace) in the Data and Catalog tabs.

## Update

The code and the data are separate, so updating never touches the data:

```bash
git pull
sudo systemctl restart labmap
```

New templates or port types from a newer `defaults/catalog.yaml` are not applied to an
existing installation automatically: import that file in **Catalog > + Template or
type** (mode "Add").

## Run as a service

`/etc/systemd/system/labmap.service`:

```ini
[Unit]
Description=Labmap
After=network.target

[Service]
WorkingDirectory=/opt/labmap
ExecStart=/usr/bin/python3 /opt/labmap/server.py --port 8080
Restart=always
User=labmap

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin labmap
sudo chown -R labmap: /opt/labmap
sudo systemctl enable --now labmap
```

## Backups

Every save keeps the previous version in `data-do-not-edit/backups/` (last 300 per
file). The change log inside `lab.yaml` keeps the last 300 changes. For full history,
put the data folder in its own Git repository and commit it from cron:

```bash
cd /opt/labmap/data-do-not-edit && git add lab.yaml catalog.yaml && git commit -qm "backup $(date +%F)" && git push -q
```

To restore: stop the service, copy a file from `backups/` over `lab.yaml` or
`catalog.yaml`, start it again. Or use **Data > Import > Replace everything**.

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
