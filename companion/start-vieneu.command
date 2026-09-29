#!/bin/bash
# Double-click on macOS, or run: bash companion/start-vieneu.command
set -euo pipefail
cd -- "$(dirname -- "$0")"
export HF_HOME="$PWD/.cache/huggingface"
export PYTHONUNBUFFERED=1
if [[ ! -x .venv/bin/python ]]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.12 .venv
  elif [[ -x "$HOME/.local/bin/uv" ]]; then
    "$HOME/.local/bin/uv" venv --python 3.12 .venv
  else
    python3 -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else "Cần Python 3.12 hoặc uv. Xem README.md để cài đặt.")'
    python3 -m venv .venv
  fi
fi
if command -v uv >/dev/null 2>&1; then
  uv pip sync --python .venv/bin/python requirements.txt
elif [[ -x "$HOME/.local/bin/uv" ]]; then
  "$HOME/.local/bin/uv" pip sync --python .venv/bin/python requirements.txt
else
  .venv/bin/python -m pip install -r requirements.txt
fi
printf 'VieNeu: preparing local model. First launch downloads model files.\n'
exec .venv/bin/python server.py
