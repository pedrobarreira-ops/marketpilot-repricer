#!/usr/bin/env bash
# AD3 pre-commit secret scanner.
#
# Reads `git diff --cached --no-color -U0` (or stdin if data is piped — for
# unit-testability), and rejects any added line matching one of the five
# patterns below. Patterns target ASSIGNMENTS with substantial values, not
# bare mentions of env-var names — so source code referencing 'MASTER_KEY_BASE64'
# as a string literal in REQUIRED_VARS arrays does not trigger.
#
# Usage:
#   scripts/check-no-secrets.sh                      # scans staged diff
#   scripts/check-no-secrets.sh < some-file.diff     # scans piped input (tests)
#
# Exit codes:
#   0 — no matches found, commit may proceed
#   1 — at least one match found; offending file:line printed to stderr;
#       commit blocked
#
# Idempotent — script does not mutate any state.

set -euo pipefail

# Patterns per AD3 + Story 1.4 extension (POSIX ERE).
PATTERNS=(
  'MASTER_KEY[A-Z0-9_]*[ \t]*[=:][ \t]*['\''"]?[A-Za-z0-9+/=_-]{16,}'
  '(shop_api_key|SHOP_API_KEY)[ \t]*[=:][ \t]*['\''"]?[A-Za-z0-9+/=_-]{8,}'
  'sk_live_[A-Za-z0-9]{16,}'
  'sk_test_[A-Za-z0-9]{16,}'
  'Authorization:[ \t]*['\''"]?Bearer[ \t]+[A-Za-z0-9._-]{16,}'
  'COOKIE_SECRET[ \t]*[=:][ \t]*['\''"]?[A-Za-z0-9+/=_-]{16,}'
  'SUPABASE_ANON_KEY[ \t]*[=:][ \t]*['\''"]?eyJ[A-Za-z0-9._-]{16,}'
)

PATTERN_NAMES=(
  'MASTER_KEY-style assignment'
  'shop_api_key assignment'
  'Stripe live secret (sk_live_)'
  'Stripe test secret (sk_test_)'
  'Authorization Bearer token'
  'COOKIE_SECRET assignment'
  'SUPABASE_ANON_KEY (JWT) assignment'
)

# Load input — piped stdin (tests) takes precedence over staged diff (real
# commit / interactive). `-p /dev/stdin` is true ONLY for a pipe; it is false
# for a TTY (interactive run) AND false for /dev/null (git pre-commit hook
# stdin). The previous `[ -t 0 ]` check failed silently in real git invocation
# because git wires hook stdin to /dev/null, which is neither a TTY nor a pipe.
if [ -p /dev/stdin ]; then
  diff_content="$(cat)"
else
  # Path exclusions:
  # - *.env.example: template, references identifiers without values
  # - *.md: docs/runbooks legitimately mention identifiers as identifiers
  # - tests/scripts/*: hook scanner's own tests legitimately construct synthetic
  #   trigger patterns (e.g., fake JWT in Bearer-token test).
  # - tests/shared/logger.test.js: redaction tests intentionally feed
  #   synthetic shop_api_key / Authorization values to verify pino redacts them.
  # - tests/integration/key-entry.test.js: ATDD integration tests construct
  #   form payloads with shop_api_key field to exercise the key validation route.
  #   Values are synthetic test UUIDs (not real Mirakl keys).
  # General principle: any test file proving a scanner/redactor works must be
  # exempt — the test by definition needs to construct the trigger.
  diff_content="$(git diff --cached --no-color -U0 -- ':!*.env.example' ':!*.md' ':!tests/scripts/*' ':!tests/shared/logger.test.js' ':!tests/integration/key-entry.test.js' || true)"
fi

# Empty diff (e.g., commit --allow-empty) — pass.
if [ -z "$diff_content" ]; then
  exit 0
fi

# Only inspect ADDED lines (start with '+', skip '+++' file headers).
added_lines="$(printf '%s\n' "$diff_content" | grep -E '^\+' | grep -v -E '^\+\+\+' || true)"

if [ -z "$added_lines" ]; then
  exit 0
fi

found_match=0
for i in "${!PATTERNS[@]}"; do
  pattern="${PATTERNS[$i]}"
  name="${PATTERN_NAMES[$i]}"
  # grep exit codes: 0 = matches found, 1 = no matches, 2 = regex/I-O error.
  # Distinguishing 1 from 2 prevents a malformed pattern from passing silently.
  set +e
  matches="$(printf '%s\n' "$added_lines" | grep -E "$pattern")"
  rc=$?
  set -e
  if [ "$rc" -gt 1 ]; then
    printf 'scanner regex error (grep rc=%s) in pattern: %s\n' "$rc" "$pattern" >&2
    exit "$rc"
  fi
  if [ -n "$matches" ]; then
    if [ $found_match -eq 0 ]; then
      printf '\nPre-commit secret-scanning hook BLOCKED this commit:\n\n' >&2
      found_match=1
    fi
    printf '  Pattern: %s\n' "$name" >&2
    printf '%s\n' "$matches" | sed 's/^/    > /' >&2
    printf '\n' >&2
  fi
done

if [ $found_match -ne 0 ]; then
  printf 'If this is a false positive, refine the pattern in scripts/check-no-secrets.sh\n' >&2
  printf 'or remove the offending value before committing. Do NOT bypass with --no-verify.\n\n' >&2
  exit 1
fi

exit 0
