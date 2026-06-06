#!/bin/bash
# Rend chaque maquette HTML en PNG 24-bit aux dimensions exactes du Chrome Web Store.
# Stratégie : render headless Chrome en DPR 2 (supersampling) puis downscale via sips.
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE="http://localhost:7777"
OUT="out"
mkdir -p "$OUT"
STAMP=$(date +%s)

render() {
  local file="$1" w="$2" h="$3" name="$4"
  local w2=$((w*2)) h2=$((h*2))
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$w,$h" --screenshot="/tmp/${name}_2x.png" \
    "$BASE/${file}?v=$STAMP" 2>/dev/null
  sips -z "$h" "$w" "/tmp/${name}_2x.png" --out "$OUT/${name}.png" >/dev/null 2>&1
  local got=$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$OUT/${name}.png" | grep -E 'pixel|Alpha' | tr '\n' ' ')
  echo "  $OUT/${name}.png  →  $got"
}

echo "Rendering store assets..."
render "screenshot1.html" 1280 800  "screenshot1"
render "screenshot2.html" 1280 800  "screenshot2"
render "screenshot3.html" 1280 800  "screenshot3"
render "screenshot4.html" 1280 800  "screenshot4"
render "promo-small.html"  440 280  "promo-small-440x280"
render "promo-marquee.html" 1400 560 "promo-marquee-1400x560"
echo "Done → $(pwd)/$OUT"
