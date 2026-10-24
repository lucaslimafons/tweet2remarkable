#!/bin/sh
# Downloads the pinned rmapi release (github.com/ddvk/rmapi) into ./bin and verifies its checksum.
# rmapi talks to an unofficial, reverse-engineered API: bump the version deliberately, never float it.
set -eu

VERSION="v0.0.35"
DEST="${1:-bin}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="rmapi-macos-arm64.zip"; SHA256="fb55b6c782b83dc0ccbb236359d738727c4c600378feae920fcab505862f624a" ;;
  Darwin-x86_64) ASSET="rmapi-macos-intel.zip"; SHA256="1afc2c4d73ddde60e22e0ff8d2bc737450dfcaeaa723eb6a3b863ac96cb2102c" ;;
  Linux-x86_64) ASSET="rmapi-linux-amd64.tar.gz"; SHA256="117616151d11937446ead6972b0934f97155443087f8406141db38fd1ac8fb25" ;;
  Linux-aarch64 | Linux-arm64) ASSET="rmapi-linux-arm64.tar.gz"; SHA256="645c170d8119b4dcb652cf79612e362fcb032dc0e5869ff520eec1324da39637" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/$ASSET" "https://github.com/ddvk/rmapi/releases/download/$VERSION/$ASSET"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP/$ASSET" | cut -d' ' -f1)"
else
  ACTUAL="$(shasum -a 256 "$TMP/$ASSET" | cut -d' ' -f1)"
fi
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "checksum mismatch for $ASSET: expected $SHA256, got $ACTUAL" >&2
  exit 1
fi

mkdir -p "$TMP/out" "$DEST"
case "$ASSET" in
  *.zip) unzip -q "$TMP/$ASSET" -d "$TMP/out" ;;
  *.tar.gz) tar -xzf "$TMP/$ASSET" -C "$TMP/out" ;;
esac
install -m 0755 "$TMP/out/rmapi" "$DEST/rmapi"
echo "installed rmapi $("$DEST/rmapi" version) to $DEST/rmapi"
