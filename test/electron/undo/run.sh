#!/bin/bash
# Undo/redo check for #33 (Linux, needs xvfb-run). Run after `npm run build:renderer`:
#   test/electron/undo/run.sh            # SHOTS=<dir> also saves screenshots
# Not part of `npm test`: it needs a display server and an Electron that can start.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
status=0
for s in popup:index.html settings:settings.html; do
  SCENARIO="$HERE/${s%%:*}.js" timeout 120 xvfb-run -a "$ROOT/node_modules/.bin/electron" --no-sandbox "$HERE/main.js" "${s##*:}" 2>&1 | grep '^RESULT'
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
done
exit $status
