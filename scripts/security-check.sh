#!/bin/sh

set -eu

gitleaks_bin="${GITLEAKS_BIN:-gitleaks}"
if ! command -v "$gitleaks_bin" >/dev/null 2>&1; then
  printf 'Gitleaks is required. Install it or set GITLEAKS_BIN to its executable path.\n' >&2
  exit 1
fi

check_local_identity() {
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
}

check_commit_emails() {
  if git log "$@" --format='%ae%n%ce' \
    | tr '[:upper:]' '[:lower:]' \
    | grep -Eq '@bytedance[.]com$'; then
    printf 'Corporate email found in Git author or committer metadata.\n' >&2
    return 1
  fi
}

case "${1:-}" in
  --staged)
    check_local_identity
    exec "$gitleaks_bin" git --config .gitleaks-privacy.toml --pre-commit --redact --staged --verbose .
    ;;
  --range)
    if [ "$#" -ne 2 ] || [ -z "$2" ]; then
      printf 'The --range mode requires one Git revision range, for example origin/master..HEAD.\n' >&2
      exit 2
    fi
    case "$2" in
      -*|*" "*|*"	"*)
        printf 'The Git revision range must be a single revision expression, not additional options.\n' >&2
        exit 2
        ;;
    esac
    git rev-list "$2" >/dev/null
    check_commit_emails "$2"
    exec "$gitleaks_bin" git --config .gitleaks-privacy.toml --log-opts="$2" --redact --verbose .
    ;;
  --all)
    check_commit_emails --branches --tags
    exec "$gitleaks_bin" git --config .gitleaks-privacy.toml --log-opts="--branches --tags" --redact --verbose .
    ;;
  *)
    printf 'Usage: scripts/security-check.sh --staged | --range <base..head> | --all\n' >&2
    exit 2
    ;;
esac
