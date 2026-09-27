#!/bin/sh
# luci-theme-graphite installer for OpenWrt.
#   wget -qO- https://raw.githubusercontent.com/4nzor/luci-theme-graphite/main/install.sh | sh
# Picks .apk (OpenWrt 25.x) or .ipk (24.x) from the latest GitHub release,
# installs it and switches LuCI to the theme.
set -e

REPO="4nzor/luci-theme-graphite"
PKG="luci-theme-graphite"
API="https://api.github.com/repos/$REPO/releases/latest"
ATOM="https://github.com/$REPO/releases.atom"
TMP="/tmp/graphite-install"

say()  { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
die()  { printf '[-] %s\n' "$1" >&2; exit 1; }

fetch() {  # fetch URL to stdout
	if command -v wget >/dev/null 2>&1; then wget -qO- "$1" 2>/dev/null
	elif command -v curl >/dev/null 2>&1; then curl -fsSL "$1" 2>/dev/null
	elif command -v uclient-fetch >/dev/null 2>&1; then uclient-fetch -q -O - "$1" 2>/dev/null
	else die "no downloader found (wget, curl or uclient-fetch)"; fi
}

if command -v apk >/dev/null 2>&1; then EXT=apk
elif command -v opkg >/dev/null 2>&1; then EXT=ipk
else die "neither apk nor opkg found - is this OpenWrt?"; fi
[ -f /etc/openwrt_release ] && . /etc/openwrt_release && ok "Detected ${DISTRIB_DESCRIPTION:-OpenWrt}, package format .$EXT"

say "Looking up the latest release"
URL="$(fetch "$API" | grep -o "https://[^\"]*${PKG}[^\"]*\.${EXT}" | head -n1 || true)"
if [ -z "$URL" ]; then
	# API rate limit or no API access: resolve the tag via the Atom feed, then scan the release page
	TAG="$(fetch "$ATOM" | grep -o 'releases/tag/[^"]*' | head -n1 | sed 's|.*/||')"
	[ -n "$TAG" ] || die "could not find a release - see https://github.com/$REPO/releases"
	URL="$(fetch "https://github.com/$REPO/releases/expanded_assets/$TAG" | grep -o "/$REPO/releases/download/[^\"]*\.${EXT}" | head -n1)"
	[ -n "$URL" ] || die "release $TAG has no .$EXT asset"
	URL="https://github.com$URL"
fi

rm -rf "$TMP" && mkdir -p "$TMP"
FILE="$TMP/$(basename "$URL")"
say "Downloading $(basename "$URL")"
fetch "$URL" > "$FILE"
[ -s "$FILE" ] || die "download failed: $URL"

say "Installing"
if [ "$EXT" = apk ]; then
	apk add --allow-untrusted "$FILE" >/dev/null
else
	opkg install --force-reinstall "$FILE" >/dev/null
fi

uci set luci.themes.Graphite=/luci-static/graphite
uci set luci.main.mediaurlbase=/luci-static/graphite
uci commit luci
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache "$TMP"
ok "Graphite installed and activated. Reload LuCI in the browser (Ctrl+F5 / Cmd+Shift+R)."
