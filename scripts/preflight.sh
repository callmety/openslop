#!/usr/bin/env bash

set -euo pipefail

PASS_MARK="PASS"
FAIL_MARK="FAIL"

echo "OpenSlop preflight"
echo "==============="

if [[ -n "$(git status --porcelain)" ]]; then
  echo "${FAIL_MARK}: working tree is not clean"
  git status --short
  exit 1
fi
echo "${PASS_MARK}: working tree clean"

if ! git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  echo "${FAIL_MARK}: current branch has no upstream configured"
  exit 1
fi

git fetch --quiet

ahead_behind="$(git rev-list --left-right --count "@{u}"...HEAD)"
behind_count="${ahead_behind%%[[:space:]]*}"
ahead_count="${ahead_behind##*[[:space:]]}"

if [[ "${behind_count}" != "0" || "${ahead_count}" != "0" ]]; then
  echo "${FAIL_MARK}: branch not in sync with upstream (behind=${behind_count}, ahead=${ahead_count})"
  exit 1
fi
echo "${PASS_MARK}: branch in sync with upstream"

echo "${PASS_MARK}: preflight complete"
