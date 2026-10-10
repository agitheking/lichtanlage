#!/usr/bin/env bash
# Startet das Lichtpult. Beispiele:  ./run.sh   ./run.sh --sim   ./run.sh --host 0.0.0.0
cd "$(dirname "$0")" && exec uv run python -m lichtpult "$@"
