#!/bin/sh
# luci-theme-graphite removal:
#   wget -qO- https://raw.githubusercontent.com/4nzor/luci-theme-graphite/main/uninstall.sh | sh
PKG="luci-theme-graphite"
if [ "$(uci -q get luci.main.mediaurlbase)" = "/luci-static/graphite" ]; then
	uci set luci.main.mediaurlbase=/luci-static/bootstrap
fi
uci -q delete luci.themes.Graphite
uci commit luci
if command -v apk >/dev/null 2>&1; then apk del "$PKG" >/dev/null 2>&1
else opkg remove "$PKG" >/dev/null 2>&1; fi
rm -rf /www/luci-static/graphite /usr/share/ucode/luci/template/themes/graphite /tmp/luci-indexcache* /tmp/luci-modulecache
echo "[+] Graphite removed, LuCI switched back to Bootstrap."
