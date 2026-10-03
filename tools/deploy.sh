#!/bin/sh
# Deploy the local Graphite build to a live OpenWrt host over SSH.
#   tools/deploy.sh                 # root@192.168.10.1
#   tools/deploy.sh root@192.168.1.1
set -e
cd "$(dirname "$0")/.."
HOST="${1:-root@192.168.10.1}"
VER="$(cat VERSION)"
LUCI_URL="http://${HOST#*@}/cgi-bin/luci/admin/status/overview"

say() { printf '[*] %s\n' "$1"; }
ok()  { printf '[+] %s\n' "$1"; }
die() { printf '[-] %s\n' "$1" >&2; exit 1; }

command -v ssh >/dev/null 2>&1 || die "ssh not found"
command -v node >/dev/null 2>&1 || die "node not found (needed for nav layout check)"

sh tools/build.sh

say "Fixture nav layout check"
node tools/check-nav.mjs || die "fixture nav layout check failed"

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

say "Live nav layout check on $LUCI_URL"
SID="$(ssh -o BatchMode=yes "$HOST" 'sh -s' <<'EOF'
set -e
cp /etc/shadow /tmp/shadow.graphite.bak
printf 'graphite1\ngraphite1\n' | passwd root >/dev/null
SID=$(ubus call session login '{"username":"root","password":"graphite1","timeout":600}' | jsonfilter -e '@.ubus_rpc_session')
mv /tmp/shadow.graphite.bak /etc/shadow
TOKEN=$(hexdump -n 16 -e '16/1 "%02x"' /dev/urandom)
ubus call session set "{\"ubus_rpc_session\":\"$SID\",\"values\":{\"token\":\"$TOKEN\"}}" >/dev/null
printf '%s' "$SID"
EOF
)"
[ -n "$SID" ] || die "could not create LuCI session for layout check"
node tools/check-nav.mjs --url "$LUCI_URL" --cookie "$SID" \
  || die "live nav layout check failed — deploy aborted visually"

ok "Deployed $VER to $HOST and nav layout check passed. Hard-reload LuCI."
