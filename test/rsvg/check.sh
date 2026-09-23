#!/usr/bin/env bash
# Renders an exported coloured Map Generator map (legend, title, data
# credit) with librsvg, the renderer Wikimedia Commons uses for SVG
# thumbnails, and with Chromium, and checks that:
#   - librsvg draws it as the reference image (test/rsvg/france-export.png);
#   - Chromium draws it the same as librsvg (text antialiasing aside).
# Catches exports that Commons would draw differently from the browser
# (unsupported CSS, misplaced legend or credit, missing text).
#
#   test/rsvg/check.sh            compare
#   test/rsvg/check.sh --update   rewrite the reference (look at it!)
#
# Runs in a Debian trixie container (librsvg 2.60, Chromium, DejaVu fonts)
# so results don't depend on the host. Needs node on the host to build the
# export, and docker.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -z "${RSVG_IN_CONTAINER:-}" ]; then
  node test/rsvg/build-export.mjs
  exec docker run --rm ${RSVG_PLATFORM:+--platform "$RSVG_PLATFORM"} -e RSVG_IN_CONTAINER=1 -v "$PWD:/w" -w /w debian:trixie bash -c \
    "apt-get update -qq && apt-get install -y -qq --no-install-recommends \
       librsvg2-bin imagemagick chromium fonts-dejavu-core >/dev/null \
     && test/rsvg/check.sh $*"
fi

UPDATE=${1:-}
OUT=test/rsvg/out
REF=test/rsvg/france-export.png
# Differing pixels (after a 10 % colour fuzz) allowed, per million, for
# librsvg against its reference. Chromium and librsvg antialias text and
# curves differently, so they are compared at a quarter of the size (4×4
# pixels averaged), where that noise fades and a missing or moved legend,
# title or credit still shows. Measured on this export: antialiasing
# ~2200 ppm; a missing credit line ~3600, title ~7000, legend ~12000.
TOLERANCE_REF=50
TOLERANCE_CHROME=3000
rsvg-convert --version

svg="$OUT/france-export.svg"
read -r width height < <(sed -n 's/.*<svg[^>]* width="\([0-9]*\)" height="\([0-9]*\)".*/\1 \2/p' "$svg" | head -1)
if warnings=$(rsvg-convert "$svg" -o "$OUT/rsvg-raw.png" 2>&1) && [ -z "$warnings" ]; then :; else
  echo "FAIL rsvg-convert: $warnings"
  exit 1
fi
convert "$OUT/rsvg-raw.png" -background white -flatten "$OUT/rsvg.png"
chromium --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$width,$height" --screenshot="$PWD/$OUT/chrome-raw.png" "file://$PWD/$svg" 2>/dev/null
convert "$OUT/chrome-raw.png" -background white -flatten -crop "${width}x${height}+0+0" +repage "$OUT/chrome.png"

if [ "$UPDATE" = "--update" ]; then
  cp "$OUT/rsvg.png" "$REF"
  echo "updated $REF"
fi

failed=0
compare_ppm() { # a b tolerance label [scale %]
  local a="$1" b="$2" tolerance="$3" label="$4" scale="${5:-100}"
  if [ "$scale" != 100 ]; then
    convert "$a" -filter Box -resize "$scale%" "$OUT/small-a.png"
    convert "$b" -filter Box -resize "$scale%" "$OUT/small-$(basename "$b")"
    a="$OUT/small-a.png"
    b="$OUT/small-$(basename "$b")"
  fi
  if [ "$(identify -format '%w %h' "$a")" != "$(identify -format '%w %h' "$b")" ]; then
    echo "FAIL $label: sizes differ ($(identify -format '%wx%h' "$a") vs $(identify -format '%wx%h' "$b"))"
    failed=1
    return
  fi
  local diff pixels ppm
  diff=$(compare -metric AE -fuzz 10% "$a" "$b" "$OUT/$(basename "$b" .png)-diff.png" 2>&1 >/dev/null || true)
  diff=${diff%% *}
  pixels=$(identify -format '%w %h' "$a" | awk '{ print $1 * $2 }')
  ppm=$(awk -v d="$diff" -v p="$pixels" 'BEGIN { if (d ~ /^[0-9.e+]+$/ && p > 0) printf "%d", d * 1000000 / p }')
  if ! [[ "$ppm" =~ ^[0-9]+$ ]]; then
    echo "FAIL $label: could not compare (${diff:-no output})"
    failed=1
  elif [ "$ppm" -gt "$tolerance" ]; then
    echo "FAIL $label: $ppm ppm differ (tolerance $tolerance); see $OUT/$(basename "$b" .png)-diff.png"
    failed=1
  else
    echo "ok   $label ($ppm ppm)"
  fi
}
compare_ppm "$REF" "$OUT/rsvg.png" "$TOLERANCE_REF" "librsvg matches the reference"
compare_ppm "$OUT/rsvg.png" "$OUT/chrome.png" "$TOLERANCE_CHROME" "Chromium matches librsvg" 25
exit "$failed"
