# Installing Graphite with an AI agent

Use the router and SSH account specified by the operator. Keep the current SSH
session open until LuCI has been checked. Graphite changes the LuCI theme and
does not require a reboot.

## 1. Check the target over SSH

Run these commands **on the router**.

```sh
id -u
cat /etc/openwrt_release
command -v apk || command -v opkg
uci -q get luci.main.mediaurlbase
df -h /overlay /tmp
```

- The UID must be `0`. Graphite requires ucode-based LuCI and `luci-theme-bootstrap`.
- OpenWrt 24.10 uses `opkg` and the `_all.ipk` asset. OpenWrt 25.12 uses
  `apk` and the `.apk` asset. Stop if the version and package manager do not match.
- Record the original `luci.main.mediaurlbase` value before installation.
- Check that `luci-base` and `luci-theme-bootstrap` are installed with
  `apk info -e luci-base && apk info -e luci-theme-bootstrap` (25.12) or
  `opkg status luci-base luci-theme-bootstrap` (24.10; look for `installed` in each
  package's `Status:` field).

## 2. Install a specific release

1. Open the [official releases](https://github.com/4nzor/luci-theme-graphite/releases).
   Use the requested tag, or the latest stable release when the operator has not
   specified a version. Choose the matching Graphite package from that release's
   assets. Use the exact asset URL shown by GitHub.
2. Download the package to the router and check the download before running the
   package manager. Set `ASSET_URL` to the exact URL first.

   ```sh
   FILE="/tmp/${ASSET_URL##*/}"
   wget -O "$FILE" "$ASSET_URL" && test -s "$FILE"
   ```

   If the router cannot reach GitHub, download the same asset locally and copy it
   over SSH. For older OpenWrt versions without an SFTP server, use `scp -O`.
   If GitHub provides an asset digest, compare the downloaded package against it
   with `sha256sum "$FILE"` before installation.

3. Use the command for the package format you verified above. `--allow-untrusted`
   is required for the local GitHub APK asset. Keep it scoped to this command.

   ```sh
   # OpenWrt 24.10
   opkg install "$FILE"

   # OpenWrt 25.12
   apk add --allow-untrusted "$FILE"
   ```

   If installation fails, keep the original theme setting and report the actual
   package-manager error. Check for missing dependencies using the router's own
   OpenWrt feeds. Do not install packages from a different firmware branch.

## 3. Verify activation

The package registers and activates Graphite. Check both the LuCI setting and
the installed files.

```sh
test "$(uci -q get luci.themes.Graphite)" = /luci-static/graphite &&
test "$(uci -q get luci.main.mediaurlbase)" = /luci-static/graphite &&
test -s /www/luci-static/graphite/graphite.css &&
test -s /usr/share/ucode/luci/template/themes/graphite/header.ut
```

For v1.2.0 and later, also check that
`test -s /www/luci-static/graphite/navigation.js` succeeds.

If the package installed successfully but activation is missing, run the
following commands and repeat the checks above.

```sh
uci set luci.themes.Graphite=/luci-static/graphite &&
uci set luci.main.mediaurlbase=/luci-static/graphite &&
uci commit luci &&
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
```

Open the router's LuCI page and hard-refresh. Disable any older Graphite Stylus
override when testing the installed theme. Report the release tag, package
format, theme setting and whether LuCI was verified in a browser.

## Roll back

Restore the theme path recorded in step 1. Use `/luci-static/bootstrap` if
Graphite was already active or there is no previous setting. Set
`PREVIOUS_THEME` to the chosen path first.

```sh
uci set "luci.main.mediaurlbase=$PREVIOUS_THEME" &&
uci commit luci &&
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
```

After confirming the restored theme loads, remove Graphite if requested with
`opkg remove luci-theme-graphite` (24.10) or `apk del luci-theme-graphite` (25.12).
