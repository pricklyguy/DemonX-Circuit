#!/usr/bin/env python3
"""Install a hash-verified pip wheel into an isolated temporary directory."""

import hashlib
import io
import json
import pathlib
import urllib.request
import zipfile


VERSION = "25.2"
EXPECTED_SHA256 = "6d67a2b4e7f14d8b31b8b52648866fa717f45a1eb70e83002f4331d07e953717"
METADATA_URL = f"https://pypi.org/pypi/pip/{VERSION}/json"


metadata = json.load(urllib.request.urlopen(METADATA_URL, timeout=30))
wheel = next(
    item for item in metadata["urls"]
    if item["filename"] == f"pip-{VERSION}-py3-none-any.whl"
)
if wheel["digests"]["sha256"] != EXPECTED_SHA256:
    raise SystemExit("Unexpected published pip wheel checksum")

with urllib.request.urlopen(wheel["url"], timeout=60) as response:
    archive = response.read()
if hashlib.sha256(archive).hexdigest() != EXPECTED_SHA256:
    raise SystemExit("pip wheel checksum verification failed")

target = pathlib.Path("/tmp/pip-bootstrap")
target.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(io.BytesIO(archive)) as wheel_file:
    wheel_file.extractall(target)
print(f"Verified and unpacked pip {VERSION} into {target}")
