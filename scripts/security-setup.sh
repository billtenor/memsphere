#!/bin/sh

set -eu

name="$(git config --local --get user.name || true)"
email="$(git config --local --get user.email || true)"

if [ -z "$name" ] || [ -z "$email" ]; then
  printf 'Set a repository-local Git user.name and user.email before security setup.\n' >&2
  exit 1
fi

git config --local user.useConfigOnly true
git config --local memsphere.securityExpectedName "$name"
git config --local memsphere.securityExpectedEmail "$email"
husky

printf 'Local security checks initialized for %s <%s>.\n' "$name" "$email"
