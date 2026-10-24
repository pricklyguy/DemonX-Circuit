#!/usr/bin/env python3
"""Import a Specctra session through KiCad 10's documented pcbnew API."""
import sys

import pcbnew


if len(sys.argv) != 3:
    raise SystemExit("Usage: import_session.py <board.kicad_pcb> <session.ses>")
board_file, ses_file = sys.argv[1:]
board = pcbnew.LoadBoard(board_file)
if board is None:
    raise RuntimeError(f"KiCad could not reopen the generated reference PCB: {board_file}")
if not pcbnew.ImportSpecctraSES(board, ses_file):
    raise RuntimeError(f"KiCad rejected the FreeRouting Specctra session: {ses_file}")
pcbnew.SaveBoard(board_file, board)
print(f"Imported FreeRouting SES into KiCad board: {board_file}")
print(f"Footprints after route import: {len(list(board.GetFootprints()))}")
print(f"Tracks after route import: {len(list(board.GetTracks()))}")
