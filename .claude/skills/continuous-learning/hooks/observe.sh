#!/bin/bash
# Continuous-learning observation hook.
#
# Captures every PreToolUse + PostToolUse event from Claude Code, writes to
# project-scoped observations.jsonl. Background extractor (run via
# /evolve or `node scripts/observation-extract.js`) reads the log and
# extracts atomic instincts.
#
# Adapted from ECC's observe.sh. Direct copy of the 5-layer self-loop guard
# (non-negotiable — without it, this hook will observe its own observer
# subagent runs in a recursive loop and burn quota indefinitely).
#
# Hook phase passed as $1: "pre" (PreToolUse) or "post" (PostToolUse).
# Claude Code passes hook data via stdin as JSON.
#
# Registered in .claude/settings.json (or settings.local.json).

set -e

HOOK_PHASE="${1:-post}"

# ─────────────────────────────────────────────────────────────────
# Read stdin (Claude Code hook JSON)
# ─────────────────────────────────────────────────────────────────
INPUT_JSON="$(cat)"
[ -z "$INPUT_JSON" ] && exit 0

# ─────────────────────────────────────────────────────────────────
# 5-LAYER SELF-LOOP GUARD (do not remove or reorder)
#
# These layers prevent the observer from recursively observing itself
# and burning quota in a feedback loop. ECC pattern, learned from
# real-world incident — leaving any layer out is a known failure mode.
# ─────────────────────────────────────────────────────────────────

# Layer 1: only interactive entrypoints. Other entrypoints are
# automated/background — skip. Add new interactive entrypoints here as
# Claude Code expands (currently: terminal CLI, Agent SDK, desktop app,
# VS Code extension).
case "${CLAUDE_CODE_ENTRYPOINT:-cli}" in
  cli|sdk-ts|claude-desktop|claude-vscode) ;;
  *) exit 0 ;;
esac

# Layer 2: minimal hook profile (env-controlled global suppression).
[ "${ECC_HOOK_PROFILE:-standard}" = "minimal" ] && exit 0

# Layer 3: cooperative skip env var (set by automated sessions).
[ "${ECC_SKIP_OBSERVE:-0}" = "1" ] && exit 0

# Layer 4: subagent sessions are automated by definition. Detect via
# the agent_id field in stdin JSON. Use jq if available, else Python,
# else regex grep.
_AGENT_ID=""
if command -v jq >/dev/null 2>&1; then
  _AGENT_ID="$(echo "$INPUT_JSON" | jq -r '.agent_id // empty' 2>/dev/null || true)"
elif command -v python3 >/dev/null 2>&1; then
  _AGENT_ID="$(echo "$INPUT_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("agent_id",""))' 2>/dev/null || true)"
elif command -v python >/dev/null 2>&1; then
  _AGENT_ID="$(echo "$INPUT_JSON" | python -c 'import json,sys; print(json.load(sys.stdin).get("agent_id",""))' 2>/dev/null || true)"
fi
[ -n "$_AGENT_ID" ] && exit 0

# Layer 5: path-based exclusions (observer-session paths, claude-mem).
# Read cwd from stdin to compare against exclusion patterns.
_STDIN_CWD=""
if command -v jq >/dev/null 2>&1; then
  _STDIN_CWD="$(echo "$INPUT_JSON" | jq -r '.cwd // empty' 2>/dev/null || true)"
elif command -v python3 >/dev/null 2>&1; then
  _STDIN_CWD="$(echo "$INPUT_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cwd",""))' 2>/dev/null || true)"
fi
_SKIP_PATHS="${OBSERVE_SKIP_PATHS:-observer-sessions,.claude-mem}"
if [ -n "$_STDIN_CWD" ]; then
  IFS=',' read -ra _SKIP_ARR <<< "$_SKIP_PATHS"
  for _pattern in "${_SKIP_ARR[@]}"; do
    _pattern="${_pattern#"${_pattern%%[![:space:]]*}"}"
    _pattern="${_pattern%"${_pattern##*[![:space:]]}"}"
    [ -z "$_pattern" ] && continue
    case "$_STDIN_CWD" in *"$_pattern"*) exit 0 ;; esac
  done
fi

# ─────────────────────────────────────────────────────────────────
# Disable switch — quick way to turn off observation without
# unregistering the hook
# ─────────────────────────────────────────────────────────────────
[ -f "${HOME}/.claude/instincts/disabled" ] && exit 0

# ─────────────────────────────────────────────────────────────────
# Resolve project context from cwd in stdin
# ─────────────────────────────────────────────────────────────────
if [ -n "$_STDIN_CWD" ] && [ -d "$_STDIN_CWD" ]; then
  _GIT_ROOT="$(git -C "$_STDIN_CWD" rev-parse --show-toplevel 2>/dev/null || true)"
  export CLAUDE_PROJECT_DIR="${_GIT_ROOT:-$_STDIN_CWD}"
fi

# Source project detection (sets PROJECT_ID, PROJECT_NAME, PROJECT_ROOT, PROJECT_DIR)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=../scripts/detect-project.sh
. "${SKILL_ROOT}/scripts/detect-project.sh"

OBSERVATIONS_FILE="${PROJECT_DIR}/observations.jsonl"

# ─────────────────────────────────────────────────────────────────
# Auto-purge old observation files (>30 days) — run once per day
# ─────────────────────────────────────────────────────────────────
PURGE_MARKER="${PROJECT_DIR}/.last-purge"
if [ ! -f "$PURGE_MARKER" ] || [ "$(find "$PURGE_MARKER" -mtime +1 2>/dev/null)" ]; then
  find "${PROJECT_DIR}" -name "observations-*.jsonl" -mtime +30 -delete 2>/dev/null || true
  touch "$PURGE_MARKER" 2>/dev/null || true
fi

# ─────────────────────────────────────────────────────────────────
# Append observation as one JSONL line
# ─────────────────────────────────────────────────────────────────
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EVENT_TYPE="${HOOK_PHASE}_tool_use"

# Build the JSONL entry. Use Python for safe JSON construction; bash heredoc fallback.
if command -v python3 >/dev/null 2>&1; then
  _python="python3"
elif command -v python >/dev/null 2>&1; then
  _python="python"
else
  _python=""
fi

if [ -n "$_python" ]; then
  export TIMESTAMP EVENT_TYPE PROJECT_ID PROJECT_NAME
  echo "$INPUT_JSON" | "$_python" -c "
import json, sys, os
data = json.load(sys.stdin)
out = {
    'timestamp': os.environ['TIMESTAMP'],
    'event': os.environ['EVENT_TYPE'],
    'project_id': os.environ.get('PROJECT_ID', ''),
    'project_name': os.environ.get('PROJECT_NAME', ''),
    'tool_name': data.get('tool_name', ''),
    'tool_input': data.get('tool_input', {}),
    'tool_response': data.get('tool_response', {}) if os.environ['EVENT_TYPE'] == 'post_tool_use' else None,
    'cwd': data.get('cwd', ''),
}
print(json.dumps(out, separators=(',', ':')))
" >> "$OBSERVATIONS_FILE" 2>/dev/null || true
fi

exit 0
