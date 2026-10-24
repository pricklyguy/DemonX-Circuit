#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

OUTPUT_DIR="${KICAD_SMOKE_OUTPUT:-reports/native-smoke}"
PROJECT_DIR="examples/native-smoke/DX_LED_Smoke"
PROJECT="${PROJECT_DIR}/DX_LED_Smoke"
if [[ -d "$OUTPUT_DIR" ]] && find "$OUTPUT_DIR" -mindepth 1 -print -quit | grep -q .; then
  echo "Refusing to overwrite existing smoke outputs under $OUTPUT_DIR" >&2
  exit 2
fi
for file in "$PROJECT.kicad_pro" "$PROJECT.kicad_sch" "$PROJECT.kicad_pcb"; do
  if [[ -e "$file" ]]; then
    echo "Refusing to overwrite existing native project file: $file" >&2
    exit 2
  fi
done
mkdir -p "$OUTPUT_DIR/gerbers" "$OUTPUT_DIR/drill" "$OUTPUT_DIR/step"

version="$(kicad-cli version)"
printf '%s\n' "$version"
[[ "$version" == *"10.0.7"* ]] || { echo "Expected KiCad 10.0.7; got: $version" >&2; exit 2; }

: "${NATIVE_SMOKE_PYTHONPATH:?Set NATIVE_SMOKE_PYTHONPATH to the isolated kicad-sch-api package target directory}"
: "${KICAD_FOOTPRINT_DIR:?Set KICAD_FOOTPRINT_DIR to KiCad's footprints directory}"
: "${KICAD_SYMBOL_DIR:?Set KICAD_SYMBOL_DIR to KiCad's symbols directory}"
export PYTHONPATH="$NATIVE_SMOKE_PYTHONPATH${PYTHONPATH:+:$PYTHONPATH}"

python3 prototype/native-smoke/generate_schematic.py
kicad-cli sch export netlist --format kicadxml --output "$OUTPUT_DIR/DX_LED_Smoke.net" "${PROJECT}.kicad_sch"
python3 prototype/native-smoke/generate_board.py "$OUTPUT_DIR/DX_LED_Smoke.net"

echo "=== Initial schematic ERC ==="
overall_status=0
if kicad-cli sch erc --severity-all --exit-code-violations --output "$OUTPUT_DIR/erc-initial.rpt" "${PROJECT}.kicad_sch"; then
  erc_initial_status=0
else
  erc_initial_status=$?
  overall_status=1
fi
cat "$OUTPUT_DIR/erc-initial.rpt"
echo "=== Initial board DRC ==="
if kicad-cli pcb drc --severity-all --exit-code-violations --output "$OUTPUT_DIR/drc-initial.rpt" "${PROJECT}.kicad_pcb"; then
  drc_initial_status=0
else
  drc_initial_status=$?
  overall_status=1
fi
cat "$OUTPUT_DIR/drc-initial.rpt"

echo "=== Gerber X2 export ==="
kicad-cli pcb export gerbers --board-plot-params --layers F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,Edge.Cuts --output "$OUTPUT_DIR/gerbers" "${PROJECT}.kicad_pcb"
echo "=== Excellon drill export ==="
kicad-cli pcb export drill --format excellon --excellon-units mm --drill-origin absolute --output "$OUTPUT_DIR/drill" "${PROJECT}.kicad_pcb"
echo "=== Board-only STEP export ==="
kicad-cli pcb export step --board-only --output "$OUTPUT_DIR/step/DX_LED_Smoke.step" "${PROJECT}.kicad_pcb"

echo "=== Native file reopen/save cycle ==="
# These official CLI operations load each native document and save it in the
# current format; subsequent checks and exports reopen the saved documents.
kicad-cli sch upgrade --force "${PROJECT}.kicad_sch"
kicad-cli pcb upgrade --force "${PROJECT}.kicad_pcb"
kicad-cli sch export netlist --format kicadxml --output "$OUTPUT_DIR/DX_LED_Smoke-reopened.net" "${PROJECT}.kicad_sch"
if kicad-cli sch erc --severity-all --exit-code-violations --output "$OUTPUT_DIR/erc-reopened.rpt" "${PROJECT}.kicad_sch"; then
  erc_reopened_status=0
else
  erc_reopened_status=$?
  overall_status=1
fi
cat "$OUTPUT_DIR/erc-reopened.rpt"
if kicad-cli pcb drc --severity-all --exit-code-violations --output "$OUTPUT_DIR/drc-reopened.rpt" "${PROJECT}.kicad_pcb"; then
  drc_reopened_status=0
else
  drc_reopened_status=$?
  overall_status=1
fi
cat "$OUTPUT_DIR/drc-reopened.rpt"

echo "=== Export inventory ==="
find "$OUTPUT_DIR" -type f -printf '%P\t%s bytes\n' | sort
test -s "$OUTPUT_DIR/erc-initial.rpt"
test -s "$OUTPUT_DIR/drc-initial.rpt"
test -s "$OUTPUT_DIR/DX_LED_Smoke-reopened.net"
test -s "$OUTPUT_DIR/step/DX_LED_Smoke.step"
find "$OUTPUT_DIR/gerbers" -type f -name '*.gbr' -print -quit | grep -q .
find "$OUTPUT_DIR/drill" -type f -print -quit | grep -q .
printf 'ERC exit codes (initial/reopened): %s/%s\n' "$erc_initial_status" "$erc_reopened_status"
printf 'DRC exit codes (initial/reopened): %s/%s\n' "$drc_initial_status" "$drc_reopened_status"
if [[ "$overall_status" -ne 0 ]]; then
  echo "FAIL: KiCad ${version} found ERC/DRC violations; inspect the reports above." >&2
  exit "$overall_status"
fi
echo "PASS: KiCad ${version}; native project generated, checked, exported, and reopened by CLI."
