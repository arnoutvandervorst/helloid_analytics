#!/usr/bin/env bash
# Serve this folder over http so the browser allows local snapshot storage.
cd "$(dirname "$0")"
exec python3 devserve.py "${1:-8123}"
