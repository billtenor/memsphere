#!/usr/bin/env bash
set -euo pipefail
suite_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec /usr/bin/node "$suite_directory/run-case.mjs" "$@"
