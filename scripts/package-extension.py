#!/usr/bin/env python3
"""Build an unpackable Chrome extension ZIP using only runtime files."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile


REQUIRED_FILES = (
    "LICENSE",
    "background.js",
    "content.css",
    "content.js",
    "guide.html",
    "manifest.json",
    "sidepanel.html",
    "sidepanel.js",
)
OPTIONAL_FILES = ("settings.js",)


def build_package(root, output_dir, tag=None):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError(f"Invalid Chrome extension version: {version}")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"Tag {tag!r} does not match manifest version v{version}")

    paths = [root / name for name in REQUIRED_FILES]
    paths += [root / name for name in OPTIONAL_FILES if (root / name).exists()]
    paths += sorted((root / "lib").glob("*.js"))
    paths += sorted((root / "icons").glob("*.png"))
    for path in paths:
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Expected a regular runtime file: {path.relative_to(root)}")

    names = {path.relative_to(root).as_posix() for path in paths}
    # Fail packaging if a manifest entry points to a file outside the allowlist.
    referenced = set(manifest.get("icons", {}).values())
    referenced.update(manifest.get("action", {}).get("default_icon", {}).values())
    referenced.add(manifest["background"]["service_worker"])
    referenced.add(manifest["side_panel"]["default_path"])
    for content_script in manifest.get("content_scripts", []):
        referenced.update(content_script.get("js", []))
        referenced.update(content_script.get("css", []))
    missing = referenced - names
    if missing:
        raise ValueError(f"Manifest references unpackaged files: {', '.join(sorted(missing))}")

    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / f"ai-translate-extension-v{version}.zip"
    # Stable entry order, timestamps, and permissions make rebuilds reproducible.
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(paths):
            entry = zipfile.ZipInfo(path.relative_to(root).as_posix(), (2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, path.read_bytes(), compresslevel=9)

    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum_path = archive_path.with_suffix(".zip.sha256")
    checksum_path.write_text(f"{digest}  {archive_path.name}\n", encoding="utf-8")
    return archive_path, checksum_path, len(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Require this release tag to match manifest.version")
    parser.add_argument("--output-dir", type=Path, help="Output directory (default: project dist/)")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        archive, checksum, count = build_package(root, args.output_dir or root / "dist", args.tag)
    except (KeyError, OSError, ValueError) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        return 1
    print(f"Created {archive} ({count} runtime files)")
    print(f"Created {checksum}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
