#!/bin/sh
# Build htdocs/luci-static/graphite/graphite.css from the Stylus source
# (stylus/graphite.user.css) plus the bundled @font-face rules, and stamp the
# theme version into the header template for cache busting.
set -e
cd "$(dirname "$0")/.."
VER="$(cat VERSION)"
SRC=stylus/graphite.user.css
OUT=htdocs/luci-static/graphite/graphite.css

sed -i.bak "s/^@version .*/@version        $VER/" "$SRC" && rm -f "$SRC.bak"
{
  echo "/* luci-theme-graphite $VER | Apache-2.0 | built from stylus/graphite.user.css */"
  cat tools/fonts.css
  # drop the Stylus wrapper (first @-moz-document line and its closing brace) and the Google Fonts import
  sed -n '/^@-moz-document/,$p' "$SRC" | sed '1d;$d' | grep -v '^@import url("https://fonts.googleapis.com'
} > "$OUT"
sed -i.bak "s#graphite.css?v=[^\"]*#graphite.css?v=$VER#" ucode/template/themes/graphite/header.ut && rm -f ucode/template/themes/graphite/header.ut.bak
echo "built $OUT ($(wc -c < "$OUT") bytes), version $VER"
