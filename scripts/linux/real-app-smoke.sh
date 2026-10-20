#!/usr/bin/env bash
# Real-app smoke test on Linux: runs the built Studio and Viewer binaries (not the
# browser test build) inside a network namespace with no interfaces, on a virtual
# display, and fails on anything the reports flag: UI not ready, any blocked or
# attempted network request (this is how a CSP that blocks local images shows up),
# or a failed import. The Viewer also opens delivery packages of the demo facility
# (.evx plain and encrypted, a portable folder) and must refuse a wrong passphrase and a
# package with one altered byte. Screenshots of each run are kept for human review.
#
#   scripts/linux/real-app-smoke.sh [out-dir]     (default target/real-app-smoke)
#
# Needs: release builds from `pnpm tauri build --no-bundle` for both apps (and the built
# demo facility, `pnpm turbo run build`), the
# evx-media `import` example (release), Xvfb, ImageMagick (`import`, `convert`), ffmpeg (for the
# 360 video sample; the system one is fine for a local test), and unprivileged user
# namespaces (`unshare -rn`).
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="${1:-$repo/target/real-app-smoke}"
studio="$repo/target/release/EVACTIS-3DWORKFLOW-Studio"
viewer="$repo/target/release/EVACTIS-3DWORKFLOW-Viewer"
example="$repo/target/release/examples/import"
display=":${EVX_SMOKE_DISPLAY:-87}"

for f in "$studio" "$viewer" "$example"; do
  [[ -x "$f" ]] || { echo "missing build: $f" >&2; exit 2; }
done
rm -rf "$out"
mkdir -p "$out/shots"

echo "== test media"
"$example" --write-compass 12288 "$out/plant-room-12k.jpg"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1024x512:rate=15:duration=2' \
  -c:v mpeg4 "$out/walkthrough-360.mkv"

echo "== delivery packages"
pass='correct horse battery staple'
node "$repo/tools/package.mjs" --kind evx --out "$out/packages" --name demo >/dev/null
node "$repo/tools/package.mjs" --kind evx --out "$out/packages" --name demo-encrypted \
  --passphrase "$pass" >/dev/null
node "$repo/tools/package.mjs" --kind portable --out "$out/packages" --name portable \
  --viewer "$viewer" >/dev/null
chmod +x "$out/packages/portable/EVACTIS-3DWORKFLOW-Viewer.exe"
node "$repo/tools/smoke/alter-package.mjs" "$out/packages/demo.evx" "$out/packages/demo-altered.evx"

Xvfb "$display" -screen 0 1440x900x24 -nolisten tcp >/dev/null 2>&1 &
xvfb=$!
trap 'kill $xvfb 2>/dev/null || true' EXIT
for _ in $(seq 50); do [[ -S "/tmp/.X11-unix/X${display#:}" ]] && break; sleep 0.1; done

# run <name> <binary> <args...>: the app runs with no network interfaces at all. A
# screenshot is taken every second (the last five are kept); afterwards the newest one
# that is not blank (the window may already be closing in the very last frame) is kept.
run() {
  local name=$1 bin=$2
  shift 2
  echo "== $name"
  DISPLAY="$display" unshare -rn "$bin" "$@" >"$out/$name.log" 2>&1 &
  local app=$! i=0
  while kill -0 "$app" 2>/dev/null; do
    DISPLAY="$display" import -window root "$out/shots/$name-$i.png" 2>/dev/null || true
    rm -f "$out/shots/$name-$((i - 5)).png"
    i=$((i + 1))
    sleep 1
  done
  wait "$app" || echo "   exit code $?"
  local f
  for f in $(ls -t "$out/shots/$name"-*.png 2>/dev/null); do
    if [[ $(convert "$f" -format '%[fx:mean>0.02]' info:) == 1 ]]; then
      mv "$f" "$out/$name.png"
      break
    fi
  done
  rm -f "$out/shots/$name"-*.png
}

run studio-start "$studio" --smoke-test "$out/studio-start.json"
run viewer-start "$viewer" --smoke-test "$out/viewer-start.json"
run studio-import-12k "$studio" --smoke-test "$out/studio-import-12k.json" \
  --smoke-import "$out/plant-room-12k.jpg"
run studio-import-video "$studio" --smoke-test "$out/studio-import-video.json" \
  --smoke-import "$out/walkthrough-360.mkv"
run viewer-evx "$viewer" --smoke-test "$out/viewer-evx.json" "$out/packages/demo.evx"
run viewer-evx-encrypted "$viewer" --smoke-test "$out/viewer-evx-encrypted.json" \
  --smoke-passphrase "$pass" "$out/packages/demo-encrypted.evx"
run viewer-evx-wrong-passphrase "$viewer" --smoke-test "$out/viewer-evx-wrong-passphrase.json" \
  --smoke-passphrase "wrong $pass" "$out/packages/demo-encrypted.evx"
run viewer-evx-altered "$viewer" --smoke-test "$out/viewer-evx-altered.json" \
  "$out/packages/demo-altered.evx"
run viewer-portable "$out/packages/portable/EVACTIS-3DWORKFLOW-Viewer.exe" \
  --smoke-test "$out/viewer-portable.json"
rmdir "$out/shots" 2>/dev/null || true

node "$repo/tools/smoke/check-reports.mjs" \
  "$out/studio-start.json" "$out/viewer-start.json" \
  "$out/studio-import-12k.json=import" "$out/studio-import-video.json=import" \
  "$out/viewer-evx.json=environment" "$out/viewer-evx-encrypted.json=environment" \
  "$out/viewer-portable.json=environment" \
  "$out/viewer-evx-wrong-passphrase.json=refused:passphrase was refused" \
  "$out/viewer-evx-altered.json=refused:failed its integrity check"
