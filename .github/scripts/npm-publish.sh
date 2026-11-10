#!/usr/bin/env bash
# Publish the package in the current directory to npm by trusted publishing,
# unless its version is already there. Explains npm's two trusted-publishing
# refusals, which otherwise read as a permission or a not-found error.
set -uo pipefail

name=$(node -p "require('./package.json').name")
ver=$(node -p "require('./package.json').version")
if npm view "$name@$ver" version >/dev/null 2>&1; then
  echo "· $name@$ver already on npm — skipping"
  exit 0
fi

echo "· publishing $name@$ver"
log=$(mktemp)
npm publish --provenance --access public 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ]; then
  settings="https://www.npmjs.com/package/$name/access"
  if grep -q "OIDC permission denied" "$log"; then
    # npm matched this workflow to the package's trusted publisher, but that
    # entry does not allow a direct publish (entries made since 2026-09 allow
    # only `npm stage publish` by default).
    echo "::error::$name: the trusted publisher does not allow npm publish. On $settings tick \"npm publish\" under the trusted publisher's Allowed actions, then re-run this job."
  elif grep -qE "E404|ENEEDAUTH" "$log"; then
    # No trusted publisher matched, so npm saw no credential at all.
    echo "::error::$name: no trusted publisher matched this run. On $settings add GitHub Actions: denn-gubsky / loomboard / publish.yml, no environment (a new entry expires unless its first publish lands within 2 days), then re-run this job."
  fi
fi
exit "$rc"
