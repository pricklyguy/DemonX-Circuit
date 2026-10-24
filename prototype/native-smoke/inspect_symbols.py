#!/usr/bin/env python3
"""Print exact symbols, pin numbers/names and default footprints from KiCad 10 libraries."""

from pathlib import Path
import re


LIBRARY_ROOT = Path("/usr/share/kicad/symbols")
TARGETS = {
    "ESP32-S3-WROOM-1",
    "BME280",
    "TPS563201",
    "Omron_G5V-1",
    "G5V-1",
    "MMBT2222A",
    "MMSD4148",
    "1N4148",
}


def tokenize(source):
    return re.findall(r'\s+|\(|\)|"(?:\\.|[^"\\])*"|[^\s()]+', source)


def parse(tokens):
    stack = []
    root = None
    for token in tokens:
        if token.isspace():
            continue
        if token == "(":
            value = []
            if stack:
                stack[-1].append(value)
            stack.append(value)
            if root is None:
                root = value
        elif token == ")":
            if not stack:
                raise ValueError("unbalanced close parenthesis")
            stack.pop()
        else:
            value = token[1:-1] if token.startswith('"') else token
            stack[-1].append(value)
    if stack:
        raise ValueError("unbalanced open parenthesis")
    return root


def find_nodes(node, head):
    if not isinstance(node, list):
        return
    if node and node[0] == head:
        yield node
    for child in node:
        yield from find_nodes(child, head)


def direct(node, head):
    return next((child for child in node[2:] if isinstance(child, list) and child and child[0] == head), None)


def main():
    found = 0
    for path in sorted(LIBRARY_ROOT.rglob("*.kicad_sym")):
        source = path.read_text(encoding="utf-8")
        if not any(f'(symbol "{target}"' in source for target in TARGETS):
            continue
        parsed = parse(tokenize(source))
        library = path.stem if path.parent == LIBRARY_ROOT else path.parent.name.removesuffix(".kicad_symdir")
        for symbol in find_nodes(parsed, "symbol"):
            name = symbol[1]
            if name not in TARGETS:
                continue
            found += 1
            pins = []
            for pin in find_nodes(symbol, "pin"):
                pin_name = direct(pin, "name")
                pin_number = direct(pin, "number")
                if pin_number:
                    pins.append(f"{pin_number[1]}={pin_name[1] if pin_name else ''}")
            footprints = [prop[2] for prop in find_nodes(symbol, "property") if len(prop) > 2 and prop[1] == "Footprint"]
            extends = direct(symbol, "extends")
            print(f"{library}:{name}\textends={extends[1] if extends else '(none)'}\tfootprint={','.join(footprints) or '(unset)'}\tpins={'; '.join(pins)}")
    if not found:
        raise SystemExit("No requested KiCad library symbols found")


if __name__ == "__main__":
    main()
