# Labmap data files

For anyone (or any tool) who fills in a lab by editing the YAML instead of clicking
through the page. The page remains the normal way; this is for loading a lot of data at
once.

## Safe workflow

1. In the page: **Data > Export** for the lab (`lab.yaml`) and the catalog
   (`catalog.yaml`). Work on those copies, never on the live data folder while the server
   runs.
2. Edit `lab.yaml`. Add new port types or templates to `catalog.yaml` if needed.
3. Check it with the same rules as the page:

   ```bash
   node tools/lint.js lab.yaml catalog.yaml
   ```

   It lists errors and warnings. `--write` also rewrites the file in the form the page
   writes (sorted, port type aliases turned into catalog keys) and keeps a `.bak`.
4. Load it: **Catalog > Import** (mode Add) for new types or templates, then
   **Data > Import > Replace** for the lab. That is one logged, undoable change, and the
   server keeps a backup of what was there.

## lab.yaml

```yaml
rev: 12                      # managed by the page; keep the value you exported
format: 1                    # file format; do not change
vlans:
  LAB: { id: 10, subnet: "192.168.10.0/24", gateway: "192.168.10.1", dns: "192.168.10.1", dhcp: "192.168.10.200-192.168.10.249", scope: local, notes: "Lab network" }
  TEST: { id: 20, subnet: "192.168.20.0/24", scope: local }
devices:
  strip-1:
    types: [strip]
    ports:
      - { name: in, kind: ac-in }
      - { name: out1, kind: ac-out }
      - { name: out2, kind: ac-out }
  sw-1:
    types: [switch]
    model: "8-port managed switch"
    location: Rack
    expectedPower: wall
    admin: "https://{ip}"
    ports:
      - { name: p1, kind: rj45, vlan: LAB }
      - { name: p2, kind: rj45, vlan: LAB, vlans: [TEST] }     # access LAB, TEST tagged (a trunk)
      - { name: mgmt, kind: iface, ip: "192.168.10.2", vlan: LAB }
      - { name: ac-in, kind: ac-in }
  board-01:
    types: [board]
    project: DEMO
    ports:
      - { name: eth0, kind: rj45, ip: "192.168.10.20", mac: "02:00:00:00:00:05", services: "ssh" }
      - { name: uart0, kind: uart }
      - { name: dc-in, kind: dc-in }
links:
  - { id: N-001, type: net, a: "board-01:eth0", b: "sw-1:p1" }
  - { id: P-001, type: power, a: "strip-1:out1", b: "board-01:dc-in", labeled: true, notes: "12 V adapter" }
  - { id: P-002, type: power, a: "strip-1:out2", b: "sw-1:ac-in" }
ipUse:
  - { vlan: LAB, from: "192.168.10.60", to: "192.168.10.69", iface: "board-01:eth0", who: "Project DEMO", notes: "Changes IP while booting" }
log: []                      # change log; written by the page, leave it as it is
```

### Devices

- **Name** (the key): the label on the device and its hostname. Any pattern. No `:`.
- **types**: one or more of `wall` (wall socket), `ups`, `strip` (power strip), `pdu`,
  `relay` (relay board), `psu` (bench supply), `router`, `switch`, `ap` (access point),
  `server`, `radiohub`, `instrument`, `pc`, `board` (board or DUT), `sensor`, `adapter`,
  `hub`, `bus` (bus or coupler), `other`. The first type decides the map column.
- Optional: `model`, `serial`, `project`, `owner`, `location`, `notes`,
  `admin` (URL, `{ip}` is replaced by the device's first address),
  `expectedPower`: `pdu`, `dc`, `ups`, `wall`, `none`.
- Adapters, hubs and bus couplers are crossed by routes (a serial console through a
  USB adapter and a hub ends on the server). An adapter with three or more ports uses
  its first port as the common one; a hub leaves by ports named `up…`; a bus coupler
  only joins ports with the same prefix (`busA-1` with `busA-2`).

### Ports

- `name` and `kind`. The kind is a key of `portTypes` in the catalog (`rj45`, `sfp`,
  `wifi`, `iface`, `usb`, `uart`, `rs232`, `ac-in`, `ac-out`, `dc-in`, `dc-out`,
  `relay-in`, `relay-out`, …). Aliases from the catalog are accepted and converted.
- Only network kinds (`rj45`, `sfp`, `wifi`, `iface`) take `ip`, `mac`, `vlan`, `vlans`,
  `services`.
- `vlan`: the untagged (access) VLAN. `vlans`: tagged VLANs (a trunk).
  A device plugged into a switch access port does not need `vlan`: the page takes it
  from the switch port.
- A logical interface with no cable (switch management, a sub-interface) is kind
  `iface`. Sub-interfaces are named after their physical port: `eth0.20` with
  `vlan: V20` and its own `ip`.
- `services` and `notes` are free text, shown as written.
- Relay boards: outlet `outN` (`relay-out`) is fed by inlet `inN` (`relay-in`).

### Cables (links)

- `a` and `b` are `device:port`. For power, `a` is the outlet and `b` the inlet.
- `type`: `net`, `power`, `serial`, `jtag`, `usb`, `video`, `bus`, `rf`, `radio`,
  `discrete`, `other`.
- `id`: unique. The page numbers them by type: `N-001` network, `P-` power,
  `S-` serial, `J-` JTAG, `U-` USB, `V-` video, `B-` buses, `R-` RF, `W-` radio,
  `D-` discrete, `X-` other.
- `labeled: true` only if the id is on a physical label at both ends.
- Radio "cables" (Wi-Fi, Zigbee…) join a device's radio port to its access point or hub;
  a radio port can have several.

### VLANs

- `id` (802.1Q number), `subnet` (CIDR), `gateway`, `dns`, `dhcp` (ranges, comma
  separated; the end may be just the last number), `scope` (`local` or `it`), `notes`.
- One name is one network. The same name on switches no trunk joins is warned (missing
  cable?). Separate networks may reuse an id under different names.
- An untagged cable between two switches with different VLANs joins them into one
  network; set each switch port as it is configured on that switch.

### IP notes (ipUse)

Addresses or ranges in use that are not on a port: `vlan`, `from`, optional `to`,
optional `iface` (the range belongs to that port: it is not a conflict when that port
uses an address in it), `who`, `notes`.

## catalog.yaml

`portTypes` (the port kinds that can be used: `label`, `layer`, `name` pattern, `dir` for
power `in`/`out`, `net: true` for network, `virtual: true` for logical, `pass: true` for
relay contacts, `alias`) and `templates` (device models for the wizard: `types`,
`model`, `pattern`, `power`, `admin`, `notes`, `ports` as `"name kind"` lines with
ranges like `"p[1-24] rj45"`, optional `meta` per port). It is shared by every site.
