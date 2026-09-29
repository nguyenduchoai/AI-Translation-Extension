#!/usr/bin/env python3
"""Package the optional local VieNeu service without models or private state."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

REQUIRED_FILES = (
    "LICENSE",
    "companion/README.md",
    "companion/model_cache.py",
    "companion/requirements.in",
    "companion/requirements.txt",
    "companion/server.py",
    "companion/speech_engine.py",
    "companion/start-vieneu.command",
)


def build_package(root, output_dir, tag=None):
    version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError(f"Invalid Chrome extension version: {version}")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"Tag {tag!r} does not match manifest version v{version}")
    for name in REQUIRED_FILES:
        path = root / name
        # A symlinked parent could otherwise smuggle files outside the checkout.
        if not path.is_file() or path.is_symlink() or any((root / parent).is_symlink() for parent in Path(name).parents):
            raise ValueError(f"Expected a regular companion file: {name}")

    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / f"vieneu-local-v{version}.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(REQUIRED_FILES):
            entry = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            mode = 0o100755 if name.endswith(".command") else 0o100644
            entry.external_attr = mode << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, (root / name).read_bytes(), compresslevel=9)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum_path = archive_path.with_suffix(".zip.sha256")
    checksum_path.write_text(f"{digest}  {archive_path.name}\n", encoding="utf-8")
    return archive_path, checksum_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Require release tag to match manifest.version")
    parser.add_argument("--output-dir", type=Path, help="Output directory (default: project dist/)")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        archive, checksum = build_package(root, args.output_dir or root / "dist", args.tag)
    except (KeyError, OSError, ValueError) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        return 1
    print(f"Created {archive} ({len(REQUIRED_FILES)} companion files)")
    print(f"Created {checksum}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
