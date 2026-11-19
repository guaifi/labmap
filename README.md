# Labmap

Living documentation for a lab, office or home network: devices, ports, cables, power and
IP addresses, on a map anyone on the network can open. One web page, one small Python
server, plain YAML files. Nothing to install besides Python 3.7+.

- **Physical map**: power on one side, network on the other, devices and adapters in the
  middle. In edit mode, tap a port and then another to connect them.
- **VLAN map**: one column per VLAN with its members, deduced from cables and switch
  ports. Tap a device to see the VLANs it is in and which devices it reaches.
- **Device sheet**: ports, power chain, what goes down if an outlet is switched off,
  routes through adapters and hubs (e.g. a serial console to its server).
- **IP addresses** per VLAN: free and used, gateway, DNS, "give me a free IP".
- **Checks that never block**: duplicate IP or MAC, wrong port types, missing power,
  VLANs that do not match on both ends of a trunk.
- **Several sites** on one server, sharing a catalog of device templates.
- Edit lock, change log, undo, automatic backups, exports (SVG, HTML report, CSV).

No passwords and no HTTPS: for a trusted internal network only.

## Try it

On any computer with Python 3 (Linux, macOS, Windows):

```bash
git clone --branch v0.9.0 --depth 1 https://github.com/guaifi/labmap.git
```

```bash
python3 labmap/server.py --port 8080
```

Without Git, download `labmap-0.9.0.tar.gz` (or `.zip`) from the
[releases](https://github.com/guaifi/labmap/releases) page and extract it. On Windows
the command is `py labmap\server.py --port 8080`; on a Mac, `xcode-select --install`
gives you `python3`.

Open `http://localhost:8080`, press **Edit**, type a user name and add devices, or use
**Data > Load example**. Ctrl+C stops it. The data stays in `labmap/data-do-not-edit/`.

## Install as a service (Linux, Raspberry Pi)

It starts with the computer and restarts if it stops. Code in `/opt/labmap`, data in
`/var/lib/labmap`. Choose the name of your site now (lower case, digits and `-`); it is
`lab-1` below.

**1. Code.** With Internet access:

```bash
sudo git clone --branch v0.9.0 --depth 1 https://github.com/guaifi/labmap.git /opt/labmap
```

Without it, copy `labmap-0.9.0.tar.gz` to `/tmp` (USB stick, `scp`) and:

```bash
sudo mkdir -p /opt/labmap && sudo tar xzf /tmp/labmap-0.9.0.tar.gz --strip-components=1 -C /opt/labmap
```

**2. A user for the server and a folder for the data:**

```bash
sudo useradd -r -s /usr/sbin/nologin labmap && sudo mkdir -p /var/lib/labmap && sudo chown labmap: /var/lib/labmap
```

**3. The service** (paste it whole, down to `EOF`):

```bash
sudo tee /etc/systemd/system/labmap.service > /dev/null <<'EOF'
[Unit]
Description=Labmap
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/labmap/server.py --port 8080 --data /var/lib/labmap --site lab-1
Restart=always
User=labmap

[Install]
WantedBy=multi-user.target
EOF
```

**4. Start it:**

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now labmap
```

**5. Check it.** It must say `active (running)`; then open `http://<ip>:8080` from
another computer.

```bash
systemctl status labmap --no-pager
```

If it does not start, `journalctl -u labmap -n 20 --no-pager` says why.

## Update

The data in `/var/lib/labmap` is never touched; only the code changes. The version in
use is shown next to the title. First say which version you want (the latest is on the
[releases](https://github.com/guaifi/labmap/releases) page; an older one to go back):

```bash
V=v0.9.0
```

With Git:

```bash
cd /opt/labmap && sudo git fetch --depth 1 origin tag $V && sudo git checkout $V && sudo systemctl restart labmap
```

Without Internet access, copy `labmap-0.9.0.tar.gz` (that version) to `/tmp` and:

```bash
sudo systemctl stop labmap && sudo rm -rf /opt/labmap && sudo mkdir /opt/labmap && sudo tar xzf /tmp/labmap-${V#v}.tar.gz --strip-components=1 -C /opt/labmap && sudo systemctl start labmap
```

Reload the page in the browser afterwards. New templates of a newer version are not
added to your catalog by themselves: import `defaults/catalog.yaml` in **Catalog**
(mode "Add") if you want them.

## Data and backups

- The data folder holds `catalog.yaml` (templates, shared) and `sites/NAME/lab.yaml`
  (one per site). Change them from the page, not by hand. `--data FOLDER` puts it
  anywhere (another disk, a synced folder such as iCloud Drive: then run only one
  server on it and keep the folder downloaded).
- Every save keeps the previous version in `backups/` (the last 300, then one a day).
  **Data > Backups** restores one from the page.
- It holds IPs, MACs and serial numbers: never put it in a public repository, keep the
  disk encrypted, and copy it off the machine now and then, for example:

```bash
rsync -a /var/lib/labmap/ /mnt/backup/labmap/
```

- The files are standard YAML (`format: 1`). Newer versions read older data; an older
  version opens newer data read-only and never writes over it.

## Sites

The menu next to the title switches site or creates one (**+ New site**). Each site has
its own lab, log and edit lock; the catalog is shared. A link can open a site directly:
`http://<host>:8080/?site=lab-2`. To rename or remove a site, stop the server and rename
or move its folder in `sites/`.

## Concepts

- **Device**: a name (its label and hostname, any pattern), types and **ports**; each
  port has a type from the catalog (`rj45`, `usb`, `ac-in`...).
- **Cable**: joins two ports and has an id (`N-001` network, `P-001` power...). Tick
  **Physical label** only for cables that carry it on a label. For power, the outlet
  goes first.
- **VLANs** on a switch port: the **access** (untagged) VLAN is what a plugged device
  gets; **tagged** VLANs share the cable marked, for another switch or a device set up
  for them (`eth0.20`). A port with tagged VLANs is a **trunk**; both ends must match.
  A VLAN is a name plus an id: the same name on switches no trunk joins is warned
  (missing cable?); separate networks use different names, even with the same id.
- **Users**: no accounts. Each person types a short user name once, for the log. One
  person edits a site at a time.

## Development

`app.js` starts with a maintainer guide: principles, data model, where to change what.

```bash
npm i playwright && node tools/test.js
```

`tools/fixture.js` builds the synthetic lab the tests use (`node tools/fixture.js 4`
for a 280-device one).

## License

MIT. See [LICENSE](LICENSE).
