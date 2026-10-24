#!/usr/bin/env python3
"""Export, delete, reimport and load an original user-owned KiCad component."""
import hashlib
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

import pcbnew

ROOT = Path(__file__).resolve().parents[2]
SYMBOL_SOURCE = ROOT / "examples/libraries/DemonX_User/DemonX_User.kicad_sym"
FOOTPRINT_SOURCE = ROOT / "examples/libraries/DemonX_User.pretty/DX_User_Header_1x02.kicad_mod"
NAME = "DX_User_Header_1x02"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix="demonx-library-roundtrip-") as tmp:
    tmp = Path(tmp)
    workspace = tmp / "test-workspace"
    source = workspace / "export-source"
    imported = workspace / "reimported"
    (source / "DemonX_User.pretty").mkdir(parents=True)
    shutil.copy2(SYMBOL_SOURCE, source / SYMBOL_SOURCE.name)
    shutil.copy2(FOOTPRINT_SOURCE, source / "DemonX_User.pretty" / FOOTPRINT_SOURCE.name)
    shutil.copy2(SYMBOL_SOURCE.parent / "README.md", source / "README.md")
    archive = tmp / "DemonX_User-CC0-1.0.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for item in sorted(source.rglob("*")):
            if item.is_file():
                bundle.write(item, item.relative_to(source).as_posix())
    expected = {item.relative_to(source).as_posix(): sha256(item) for item in source.rglob("*") if item.is_file()}
    shutil.rmtree(source)
    imported.mkdir(parents=True)
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            target = (imported / entry.filename).resolve()
            if not target.is_relative_to(imported.resolve()):
                raise RuntimeError(f"Unsafe library archive path: {entry.filename}")
        bundle.extractall(imported)
    actual = {item.relative_to(imported).as_posix(): sha256(item) for item in imported.rglob("*") if item.is_file()}
    if actual != expected:
        raise RuntimeError("Library reimport content hashes differ from exported content")

    cli = os.environ.get("KICAD_CLI", "kicad-cli")
    import subprocess
    normalized_library = tmp / "DemonX_User-native.kicad_sym"
    upgraded = subprocess.run(
        [cli, "sym", "upgrade", "--force", "--output", str(normalized_library), str(imported / "DemonX_User.kicad_sym")],
        capture_output=True, text=True,
    )
    if upgraded.returncode != 0 or not normalized_library.is_file():
        raise RuntimeError(f"KiCad could not parse/re-export the imported symbol library: {upgraded.stdout}\n{upgraded.stderr}")

    symbol_dir = tmp / "symbols"
    symbol_dir.mkdir()
    result = subprocess.run([cli, "sym", "export", "svg", "--output", str(symbol_dir), str(normalized_library)], capture_output=True, text=True)
    symbol_files = list(symbol_dir.glob(f"{NAME}.svg"))
    if result.returncode != 0 or len(symbol_files) != 1:
        raise RuntimeError(f"KiCad could not parse the imported symbol library: {result.stdout}\n{result.stderr}")
    symbol_svg = symbol_files[0]

    footprint = pcbnew.FootprintLoad(str(imported / "DemonX_User.pretty"), NAME)
    if footprint is None or sorted(pad.GetNumber() for pad in footprint.Pads()) != ["1", "2"]:
        raise RuntimeError("KiCad could not load the reimported 1x02 footprint with both numbered pads")
    board = pcbnew.BOARD()
    footprint.SetReference("J1")
    footprint.SetValue(NAME)
    footprint.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(50), pcbnew.FromMM(50)))
    board.Add(footprint)
    board_file = tmp / "component-reuse.kicad_pcb"
    pcbnew.SaveBoard(str(board_file), board)
    reopened = pcbnew.LoadBoard(str(board_file))
    if reopened is None or len(list(reopened.GetFootprints())) != 1:
        raise RuntimeError("KiCad could not reopen a board reusing the imported user footprint")

    output = ROOT / "reports/native-reference/library-roundtrip"
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(archive, output / archive.name)
    shutil.copy2(symbol_svg, output / symbol_svg.name)
    shutil.copy2(board_file, output / board_file.name)
    print("PASS: original CC0 user library exported to ZIP, source test workspace deleted, ZIP reimported, and content hashes match.")
    print("PASS: KiCad 10.0.7 parsed the imported symbol SVG and pcbnew loaded/reused both footprint pads in a reopened board.")
    print(f"Archive: {archive.name} ({archive.stat().st_size} bytes)")
    for name, digest in sorted(actual.items()):
        print(f"SHA256 {digest}  {name}")
    print(f"Board footprint count after reopen: {len(list(reopened.GetFootprints()))}")
