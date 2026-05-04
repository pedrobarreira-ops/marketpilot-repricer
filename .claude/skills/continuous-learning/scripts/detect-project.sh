#!/bin/bash
# Project detection helper for continuous-learning system.
#
# Sets:
#   PROJECT_ID    — 12-char hash, stable across machines (from git remote URL)
#   PROJECT_NAME  — human-readable name (from repo path or remote URL)
#   PROJECT_ROOT  — absolute path to git repo root
#   PROJECT_DIR   — ~/.claude/instincts/projects/<PROJECT_ID>/
#
# Adapted from ECC's detect-project.sh. Same hash strategy — same git remote
# URL produces the same PROJECT_ID across machines, so observations from
# different dev machines on the same repo merge into one project's instincts.
#
# Resolution order:
#   1. CLAUDE_PROJECT_DIR env var (highest priority — set by Claude Code)
#   2. git remote get-url origin → hashed (machine-portable)
#   3. git rev-parse --show-toplevel (machine-specific path fallback)
#   4. PWD (last resort — global fallback)
#
# Source this file from observe.sh; do not execute directly.

set -e

# --- 1. Determine PROJECT_ROOT ---
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
  PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
elif _git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  PROJECT_ROOT="$_git_root"
else
  PROJECT_ROOT="$PWD"
fi

# --- 2. Determine PROJECT_ID (hash from git remote, fallback to path) ---
_git_remote=""
if _git_remote="$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null)"; then
  # Hash the normalized remote URL — strips https://, .git, trailing slashes
  _normalized="$(echo "$_git_remote" | sed -E 's|^https?://||; s|^git@||; s|:|/|g; s|\.git$||; s|/$||' | tr '[:upper:]' '[:lower:]')"
  if command -v sha256sum >/dev/null 2>&1; then
    PROJECT_ID="$(echo -n "$_normalized" | sha256sum | cut -c1-12)"
  elif command -v shasum >/dev/null 2>&1; then
    PROJECT_ID="$(echo -n "$_normalized" | shasum -a 256 | cut -c1-12)"
  else
    # Fallback: cksum (less collision-resistant but always available)
    PROJECT_ID="$(echo -n "$_normalized" | cksum | cut -d' ' -f1)"
  fi
else
  # No git remote — hash the path instead (machine-specific, less portable)
  if command -v sha256sum >/dev/null 2>&1; then
    PROJECT_ID="$(echo -n "$PROJECT_ROOT" | sha256sum | cut -c1-12)"
  else
    PROJECT_ID="$(echo -n "$PROJECT_ROOT" | cksum | cut -d' ' -f1)"
  fi
fi

# --- 3. Determine PROJECT_NAME ---
if [ -n "$_git_remote" ]; then
  # Extract repo name from URL: github.com/user/repo.git → repo
  PROJECT_NAME="$(basename "$_git_remote" .git)"
else
  PROJECT_NAME="$(basename "$PROJECT_ROOT")"
fi

# --- 4. Determine PROJECT_DIR (where observations + instincts live) ---
PROJECT_DIR="${HOME}/.claude/instincts/projects/${PROJECT_ID}"
mkdir -p "${PROJECT_DIR}/instincts/personal" 2>/dev/null || true

# --- 5. Update project registry (id → name + root + remote URL) ---
REGISTRY="${HOME}/.claude/instincts/projects.json"
mkdir -p "${HOME}/.claude/instincts" 2>/dev/null || true

# Use Python if available for clean JSON manipulation; fallback to append.
if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
  _python="$(command -v python3 || command -v python)"
  "$_python" -c "
import json, os, sys
path = os.environ.get('REGISTRY', '${REGISTRY}')
pid = os.environ.get('PROJECT_ID', '${PROJECT_ID}')
data = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception:
        data = {}
data[pid] = {
    'name': os.environ.get('PROJECT_NAME', '${PROJECT_NAME}'),
    'root': os.environ.get('PROJECT_ROOT', '${PROJECT_ROOT}'),
    'remote': os.environ.get('_git_remote', '${_git_remote}'),
}
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || true
fi

export PROJECT_ID PROJECT_NAME PROJECT_ROOT PROJECT_DIR
