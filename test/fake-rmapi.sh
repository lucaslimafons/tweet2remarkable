#!/bin/sh
# Stand-in for rmapi in tests. Appends its args to $FAKE_RMAPI_LOG; $FAKE_RMAPI_MODE picks a behaviour.
echo "$*" >> "$FAKE_RMAPI_LOG"
[ "$1" = "-ni" ] || { echo "missing -ni" >&2; exit 3; }
shift
case "${FAKE_RMAPI_MODE:-ok}:$1" in
  *:version) echo "v0.0.35" ;;
  hang:*) sleep 5 ;;
  unpaired:*) echo "ERROR: 2026/10/24 12:21:47 auth.go:30: missing token, not asking, aborting" >&2; exit 1 ;;
  fail:put) echo "Error:  failed to upload file [x]: 500 Internal Server Error" >&2; exit 1 ;;
  exists:put)
    case "$2" in
      *"("*")"*) echo "uploading: [$2]...OK" ;;
      *) echo "Error:  entry already exists (use --force to recreate, --content-only to replace content)" >&2; exit 1 ;;
    esac ;;
  *:mkdir) echo "entry already exists" ;;
  *:put) echo "uploading: [$2]...OK" ;;
esac
