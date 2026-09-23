#!/usr/bin/env bash
# Records the Map Generator API responses the tests use, from the live API
# (or API=http://localhost:8000/api/v1; CURL overrides the curl binary).
# Re-run when the API or its data changes, then check the diff: tests
# compare against these.
#
#   test/fixtures/mapgen/record.sh
set -euo pipefail
cd "$(dirname "$0")"
API="${API:-https://map-generator.toolforge.org/api/v1}"
curl="${CURL:-curl}"
get() { "$curl" -fsS "$API/$1" -o "$2"; echo "recorded $2"; }
# As Maphue asks for them (width 1600, labels, for Commons).
spec="width=1600&labels=true&target=commons"
get "contract/fixture.svg" contract-fixture.svg
get "maps/ne-admin0/world.json?$spec" world.json
get "maps/ne-admin1/FRA.json?$spec" france.json
get "datasets/ne-admin1/regions/FRA/features" france-features.json
# A small France for the export check (and its metadata).
get "maps/ne-admin1/FRA.svg?width=800&labels=true&target=commons" france-800.svg
get "maps/ne-admin1/FRA.json?width=800&labels=true&target=commons" france-800.json
get "crosswalks" crosswalks.json
# US counties and crosswalks, trimmed to Alaska (02) and Connecticut (09),
# plus every Fairfield (a name several states use).
"$curl" -fsS "$API/datasets/us-counties/regions/USA/features" | python3 -c '
import json, sys
features = json.load(sys.stdin)
keep = [f for f in features if f["code"].startswith(("US-02", "US-09")) or f["name"].startswith("Fairfield")]
json.dump(keep, sys.stdout, ensure_ascii=False, indent=1)
' > us-counties-features.json && echo "recorded us-counties-features.json"
for id in us-counties-2010-2020 us-counties-2020-2022; do
  "$curl" -fsS "$API/crosswalks/$id.csv" | awk -F, 'NR == 1 || $1 ~ /^0[29]/' > "$id.csv"
  echo "recorded $id.csv"
done
