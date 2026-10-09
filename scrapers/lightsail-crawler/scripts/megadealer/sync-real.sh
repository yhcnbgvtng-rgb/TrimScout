#!/usr/bin/env bash
# REAL sync of the daytime job's shards. Run ONLY after an explicit GO. Same isolation as day-job.sh dry:
# input dir, checkpoint, sweep-retired dir and box label are all the daytime job's own.
# Refuses to start after 20:15 ET (20:30 end) and re-checks the shared sync lock is free first.
set -euo pipefail
MEGA="${MEGA:-$HOME/megadealer}"; RUN="$MEGA/run"
[ "${1:-}" = "--go" ] || { echo "refusing: pass --go (only after the user's GO)"; exit 2; }
hm=$(TZ=America/New_York date +%H%M); [ "$hm" -lt 2015 ] || { echo "after 20:15 ET, not starting"; exit 0; }
set -a; . "$HOME/inventory-sync/.env"; set +a
export TRIMSCOUT_BOX_LABEL="${TRIMSCOUT_BOX_LABEL:-box1-day}" SYNC_CHECKPOINT_PATH="$MEGA/sync/.checkpoint.json" SWEEP_RETIRED_DIR="$MEGA/sync/sweep-retired"
node "$HOME/inventory-sync/sync-lock-probe.mjs"
cd "$HOME/inventory-sync" && exec node inventory-sync.mjs "$RUN/data/inventory"
