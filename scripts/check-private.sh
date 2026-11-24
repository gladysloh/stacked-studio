#!/bin/sh
# Fails if anything that must stay private would be published: secret-looking strings,
# local paths, and the private names listed in .internal/private-patterns.txt (gitignored,
# so the names themselves are never published). Run before every commit and in CI.
set -u
cd "$(dirname "$0")/.."
files=$(git ls-files --cached --others --exclude-standard | grep -v -e "^scripts/check-private.sh$" -e "^package-lock.json$")
[ -z "$files" ] && exit 0
status=0
check() {
  # $1 = label, $2 = extended regex
  hits=$(echo "$files" | xargs grep -nIiE -- "$2" 2>/dev/null)
  if [ -n "$hits" ]; then echo "PRIVATE ($1):"; echo "$hits"; status=1; fi
}
check "API key or token" 'AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|GOCSPX-[A-Za-z0-9_-]{20,}|ya29\.[0-9A-Za-z_-]{20,}|1//[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[bpa]-[0-9A-Za-z-]{10,}'
check "connection string with password" 'postgres(ql)?://[^:/@ ]+:[^@ ]+@'
check "local path" '/Users/[A-Za-z]|C:\\Users\\'
if [ -f .internal/private-patterns.txt ]; then
  while IFS= read -r p; do
    case "$p" in ''|'#'*) continue;; esac
    check "private name" "$p"
  done < .internal/private-patterns.txt
else
  echo "note: .internal/private-patterns.txt not found; only generic checks ran"
fi
[ $status -eq 0 ] && echo "check-private: clean"
exit $status
