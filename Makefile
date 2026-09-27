#
# luci-theme-graphite: dark control-panel theme for OpenWrt LuCI
# Licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-graphite
# Local builds use these defaults; CI overrides them from the release tag.
GRAPHITE_VERSION?=1.0.0
GRAPHITE_RELEASE?=1

PKG_VERSION:=$(GRAPHITE_VERSION)
PKG_RELEASE:=$(GRAPHITE_RELEASE)

LUCI_TITLE:=Graphite - dark control-panel theme
LUCI_DEPENDS:=+luci-base +luci-theme-bootstrap
LUCI_PKGARCH:=all

LUCI_MINIFY_CSS:=0
LUCI_MINIFY_UT:=0
PKG_LICENSE:=Apache-2.0 OFL-1.1
PKG_LICENSE_FILES:=LICENSE NOTICE

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || {
	[ -f /etc/uci-defaults/30_luci-theme-graphite ] && sh /etc/uci-defaults/30_luci-theme-graphite >/dev/null 2>&1
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache >/dev/null 2>&1
	true
}
exit 0
endef

define Package/$(PKG_NAME)/postrm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || {
	if [ "$$(uci -q get luci.main.mediaurlbase)" = "/luci-static/graphite" ]; then
		uci set luci.main.mediaurlbase=/luci-static/bootstrap
	fi
	uci -q delete luci.themes.Graphite
	uci commit luci
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache >/dev/null 2>&1
	true
}
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
