"""Keep ONNX external weights beside their graphs, including after old downloads."""
import os
import shutil
from pathlib import Path


def prepare_cache():
    cache = Path(__file__).resolve().parent / ".cache" / "huggingface"
    os.environ["HF_HOME"] = str(cache)
    # ONNX Runtime 1.30 rejects weights whose resolved symlink escapes the graph
    # directory. HF's file-copy cache mode satisfies this without weakening ORT.
    os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
    for path in (cache / "hub").glob("models--*/snapshots/**/*"):
        if path.is_symlink() and path.is_file():
            temporary = path.with_name(path.name + ".materializing")
            shutil.copyfile(path.resolve(), temporary)
            temporary.replace(path)
