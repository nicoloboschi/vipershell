#!/bin/sh
# node-pty@1.1.0 ships prebuilt binaries without the execute bit set, which
# causes "posix_spawnp failed" at runtime on macOS/Linux. Fix it here.
PREBUILDS="$PWD/node_modules/node-pty/prebuilds"
if [ -d "$PREBUILDS" ]; then
  find "$PREBUILDS" \( -name "spawn-helper" -o -name "*.node" \) -exec chmod +x {} \; 2>/dev/null || true
fi
