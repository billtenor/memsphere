#!/bin/sh

set -eu

name="$(git config --local --get user.name || true)"
email="$(git config --local --get user.email || true)"

if [ -z "$name" ] || [ -z "$email" ]; then
  printf 'Set a repository-local Git user.name and user.email before security setup.\n' >&2
  exit 1
fi

normalized_email="$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')"
case "$normalized_email" in
  *@bytedance.com)
    printf 'Corporate Git email is not allowed for this public repository.\n' >&2
    exit 1
    ;;
esac

git config --local user.useConfigOnly true
git config --local memsphere.securityExpectedName "$name"
git config --local memsphere.securityExpectedEmail "$email"
husky

printf 'Local security checks initialized for %s <%s>.\n' "$name" "$email"
