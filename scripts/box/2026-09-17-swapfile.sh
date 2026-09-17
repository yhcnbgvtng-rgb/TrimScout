#!/usr/bin/env bash
# Deals box: a 2 GB swap file + low swappiness, so the OOM killer stops taking out the pm2 API
# servers (deals :3004, auth/directory :3003) during the nightly inventory sync and the crawl jobs.
# 2026-09-16: both APIs were found dead (connection refused) mid-QA and flapped after restart.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-swapfile.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-swapfile.sh && bash 2026-09-17-swapfile.sh
# Idempotent: skips each step that's already done. Nothing restarts; no downtime.
set -euo pipefail
SWAP=/swapfile
SIZE=2G

echo "== before"; free -m; swapon --show || true
df -h / | tail -1

if swapon --show --noheadings | grep -q "^$SWAP"; then
  echo "swap already active at $SWAP — nothing to create"
else
  if [ ! -f "$SWAP" ]; then
    avail_kb=$(df --output=avail / | tail -1)
    [ "$avail_kb" -gt 3000000 ] || { echo "need ~3 GB free on / for a $SIZE swap file; have $((avail_kb/1024)) MB — aborting"; exit 1; }
    sudo fallocate -l "$SIZE" "$SWAP" || sudo dd if=/dev/zero of="$SWAP" bs=1M count=2048 status=progress
    sudo chmod 600 "$SWAP"
    sudo mkswap "$SWAP"
    echo "created $SWAP ($SIZE)"
  fi
  sudo swapon "$SWAP"
  echo "swap on"
fi

grep -q "^$SWAP " /etc/fstab || echo "$SWAP none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
echo "fstab: $(grep "^$SWAP " /etc/fstab)"

# Prefer RAM; swap is a cushion for spikes, not a working set.
sudo sysctl -q vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-trimscout-swap.conf >/dev/null

echo "== after"; free -m; swapon --show
echo "== recent OOM kills (empty is good)"; sudo dmesg -T 2>/dev/null | grep -iE "out of memory|killed process" | tail -5 || true
echo "== api health"
curl -s -o /dev/null -w "3003 %{http_code}\n" "http://127.0.0.1:3003/api/dealerships?limit=1" || true
curl -s -o /dev/null -w "3004 %{http_code}\n" http://127.0.0.1:3004/api/inventory/stats || true
echo "done — swap is live now and survives reboot"
