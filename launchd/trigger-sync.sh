#!/bin/sh
# Dispatches the Sync and publish workflow. Run hourly by launchd on the Mac mini.
set -eu
echo "[$(date -Iseconds)] dispatching sync-and-publish.yml"
/opt/homebrew/bin/gh workflow run sync-and-publish.yml \
  -R clockedrankings/clocked-rankings --ref main
