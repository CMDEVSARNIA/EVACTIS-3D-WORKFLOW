#!/usr/bin/env bash
# Phase 11 acceptance: two machines on an isolated network use the Site Server, with the
# server's outbound traffic blocked.
#
# Built from Linux network namespaces (no root needed beyond unprivileged user
# namespaces, as for real-app-smoke.sh):
#
#   machine A (10.77.1.2) --- 10.77.1.1 [ server ] 10.77.2.1 --- machine B (10.77.2.2)
#                                          |
#                                   192.0.2.1 "outside" (a dead end)
#
# - A and B have separate network stacks and subnets; the server does not forward, so
#   A and B cannot reach each other: guided-session audio can only cross the server's
#   own TURN relay.
# - Nothing has a route to the internet. The server's default route points into an
#   empty namespace, so any packet it tries to send off the LAN is counted on that link;
#   the run fails unless the count stays at zero.
#
#   scripts/linux/site-server-lan.sh [out-dir]      (default target/site-lan)
#
# Needs: the built Site Server (pnpm --filter @evactis-3dworkflow/site-server build), the
# demo facility, Playwright's Chromium, iproute2, nsenter, unshare -rn.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="${2:-${1:-$repo/target/site-lan}}"
[[ "${1:-}" == "--inside" ]] || exec unshare -rn bash "$0" --inside "$out"

mkdir -p "$out"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

ip link set lo up
# Each machine is a network namespace held by a sleeping process.
# (Not via $(...): the background sleep would hold the substitution's pipe open.)
holder() { unshare -n sleep infinity </dev/null >/dev/null 2>&1 & pids+=($!); }
holder; A=$!
holder; B=$!
holder; O=$!
sleep 0.3
in_ns() { local pid=$1; shift; nsenter --net="/proc/$pid/ns/net" "$@"; }
# Background work is started with nsenter itself (it execs the command), not through
# in_ns: $! must be the process, or cleanup would leave it running.
ns() { echo "--net=/proc/$1/ns/net"; }

ip link add s-a type veth peer name a-s
ip link add s-b type veth peer name b-s
ip link add s-out type veth peer name out-s
ip link set a-s netns "$A"
ip link set b-s netns "$B"
ip link set out-s netns "$O"
for i in s-a s-b s-out; do sysctl -qw "net.ipv6.conf.$i.disable_ipv6=1" 2>/dev/null || true; done
ip addr add 10.77.1.1/24 dev s-a && ip link set s-a up
ip addr add 10.77.2.1/24 dev s-b && ip link set s-b up
ip addr add 192.0.2.1/30 dev s-out && ip link set s-out up
ip route add default via 192.0.2.2
# The outside end answers ARP and logs whatever reaches it (it forwards nothing), so a
# failure says where the server tried to go.
in_ns "$O" sh -c 'ip addr add 192.0.2.2/30 dev out-s; ip link set out-s up'
nsenter "$(ns "$O")" python3 -u -c '
import socket, struct, sys
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(3))
s.bind(("out-s", 0))
while True:
    try:
        f = s.recv(65535)
    except OSError:  # the link is still coming up
        continue
    kind = struct.unpack("!H", f[12:14])[0]
    if kind == 0x0806:
        print("ARP who-has", socket.inet_ntoa(f[38:42]), "from", socket.inet_ntoa(f[28:32]))
    elif kind == 0x0800:
        ip = f[14:]; hl = (ip[0] & 15) * 4; proto = ip[9]
        port = struct.unpack("!H", ip[hl + 2:hl + 4])[0] if proto in (6, 17) else ""
        print({1: "ICMP", 6: "TCP", 17: "UDP"}.get(proto, proto), socket.inet_ntoa(ip[12:16]), "->", socket.inet_ntoa(ip[16:20]), port)
    else:
        print("ethertype", hex(kind))
' >"$out/outside.txt" 2>&1 &
pids+=($!)
in_ns "$A" sh -c 'ip link set lo up; ip addr add 10.77.1.2/24 dev a-s; ip link set a-s up; ip route add 10.77.2.0/24 via 10.77.1.1'
in_ns "$B" sh -c 'ip link set lo up; ip addr add 10.77.2.2/24 dev b-s; ip link set b-s up; ip route add 10.77.1.0/24 via 10.77.2.1'
# A new namespace may inherit forwarding from the host (Docker turns it on): switch it off.
sysctl -qw net.ipv4.ip_forward=0
[[ "$(cat /proc/sys/net/ipv4/ip_forward)" == 0 ]] || { echo "forwarding must be off" >&2; exit 2; }

outbound() {
  ip -s -j link show s-out | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].stats64.tx.packets))'
}

echo "== Site Server on 10.77.1.1 / 10.77.2.1 (no route out)"
EVX_SITE_OUT="$out/site" EVX_SITE_HOST=0.0.0.0 EVX_SITE_RELAY=10.77.1.1 \
  node "$repo/e2e/fixtures/site-server.mjs" 4190 >"$out/server.log" 2>&1 &
pids+=($!)
for _ in $(seq 600); do [[ -f "$out/site/fixture.json" ]] && break; sleep 0.5; done
[[ -f "$out/site/fixture.json" ]] || { cat "$out/server.log"; echo "the server did not start" >&2; exit 1; }
sleep 2 # let link-local chatter settle before the baseline
before=$(outbound)

echo "== machine A cannot reach machine B directly"
nsenter "$(ns "$B")" node -e 'require("http").createServer((q,r)=>r.end("b")).listen(8081,"10.77.2.2")' &
pids+=($!)
sleep 0.5
if in_ns "$A" curl -s --max-time 3 http://10.77.2.2:8081/ >/dev/null; then echo "A reached B directly" >&2; exit 1; fi
echo "   ok: no direct path"

# Each machine's browser runs inside that machine's network stack.
chrome="$(cd "$repo" && node -e 'console.log(require("@playwright/test").chromium.executablePath())')"
for m in A B; do
  pid=$([[ $m == A ]] && echo "$A" || echo "$B")
  printf '#!/bin/sh\nexec nsenter --net=/proc/%s/ns/net "%s" "$@"\n' "$pid" "$chrome" >"$out/chrome-$m"
  chmod +x "$out/chrome-$m"
done

echo "== two machines: notes and a guided session"
status=0
(cd "$repo" && SITE_A=https://10.77.1.1:4190 SITE_B=https://10.77.2.1:4190 \
  SITE_FIXTURE="$out/site/fixture.json" CHROME_A="$out/chrome-A" CHROME_B="$out/chrome-B" \
  npx playwright test -c e2e-lan/playwright.config.ts) || status=$?

after=$(outbound)
echo "== packets the server sent off the LAN: $((after - before))"
if [[ $after -ne $before ]]; then
  echo "FAIL: the server tried to reach outside the site network:" >&2
  sort "$out/outside.txt" | uniq -c >&2
  status=1
fi
if grep -q '"level":50' "$out/server.log"; then echo "FAIL: errors in the server log" >&2; grep '"level":50' "$out/server.log" >&2; status=1; fi
[[ $status -eq 0 ]] && echo "PASS: isolated-network acceptance"
exit $status
