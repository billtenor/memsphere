#!/bin/sh

set -eu

name="$(git config --local --get user.name || true)"
email="$(git config --local --get user.email || true)"
use_config_only="$(git config --local --get user.useConfigOnly || true)"
expected_name="$(git config --local --get memsphere.securityExpectedName || true)"
expected_email="$(git config --local --get memsphere.securityExpectedEmail || true)"

if [ -z "$expected_name" ] || [ -z "$expected_email" ]; then
  printf 'Local security identity is not initialized. Run npm run security:setup.\n' >&2
  exit 1
fi

if [ "$name" != "$expected_name" ] || [ "$email" != "$expected_email" ]; then
  printf 'Git identity must be %s <%s>; found %s <%s>.\n' \
    "$expected_name" "$expected_email" "${name:-unset}" "${email:-unset}" >&2
  exit 1
fi

if [ "$use_config_only" != "true" ]; then
  printf 'Git user.useConfigOnly must be true for this repository.\n' >&2
  exit 1
fi

gitleaks_bin="${GITLEAKS_BIN:-gitleaks}"
if ! command -v "$gitleaks_bin" >/dev/null 2>&1; then
  printf 'Gitleaks is required. Install it or set GITLEAKS_BIN to its executable path.\n' >&2
  exit 1
fi

case "${1:-}" in
  "")
    "$gitleaks_bin" git --log-opts=HEAD --redact --verbose .
    exec "$gitleaks_bin" git --config .gitleaks-privacy.toml --log-opts=HEAD --redact --verbose .
    ;;
  --staged)
    "$gitleaks_bin" git --pre-commit --redact --staged --verbose .
    exec "$gitleaks_bin" git --config .gitleaks-privacy.toml --pre-commit --redact --staged --verbose .
    ;;
  *)
    printf 'Usage: npm run security:check -- [--staged]\n' >&2
    exit 2
    ;;
esac
