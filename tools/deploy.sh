#!/bin/sh
# Deploy the local Graphite build to a live OpenWrt host over SSH.
#   tools/deploy.sh                 # root@192.168.10.1
#   tools/deploy.sh root@192.168.1.1
set -e
cd "$(dirname "$0")/.."
HOST="${1:-root@192.168.10.1}"
VER="$(cat VERSION)"

say() { printf '[*] %s\n' "$1"; }
ok()  { printf '[+] %s\n' "$1"; }
die() { printf '[-] %s\n' "$1" >&2; exit 1; }

command -v ssh >/dev/null 2>&1 || die "ssh not found"
sh tools/build.sh

say "Uploading graphite.css ($VER) to $HOST"
# OpenWrt often has no sftp-server; stream the file over ssh instead of scp.
ssh -o BatchMode=yes "$HOST" 'cat > /www/luci-static/graphite/graphite.css' \
  < htdocs/luci-static/graphite/graphite.css

say "Busting LuCI cache"
ssh -o BatchMode=yes "$HOST" "env VER=$VER sh -s" <<'EOF'
set -e
sed -i "s#graphite.css?v=[^\"]*#graphite.css?v=$VER#" \
  /usr/share/ucode/luci/template/themes/graphite/header.ut
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
wc -c /www/luci-static/graphite/graphite.css
grep graphite.css /usr/share/ucode/luci/template/themes/graphite/header.ut
EOF

ok "Deployed to $HOST. Hard-reload LuCI (Ctrl+F5 / Cmd+Shift+R)."
