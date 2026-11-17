#!/usr/bin/env bash
# Sets up Claude Code (user level) as a 4-model team:
#   Sonnet = main, Fable = advisor, Opus = checker subagent, Haiku = Explore + default subagents.
# Default run: checks + shows ONE unified diff, then asks before touching anything.
# Every existing file is backed up to <file>.bak-<timestamp> before it is changed.
# Needs: bash, python3, diff.
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
MIN_VERSION="2.1.321"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
MARKER="<!-- claude-team-setup -->"

say()  { printf '%s\n' "$*"; }
warn() { printf '!! %s\n' "$*"; }

command -v python3 >/dev/null || { say "python3 is required (used to merge settings.json safely)."; exit 1; }

# ---------- 1. Version check ----------
say "== 1. Claude Code version"
if command -v claude >/dev/null; then
  VER="$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  say "Installed: ${VER:-unknown}  (Fable 5.2 needs >= $MIN_VERSION)"
  if [ -n "$VER" ] && [ "$(printf '%s\n%s\n' "$MIN_VERSION" "$VER" | sort -V | head -1)" != "$MIN_VERSION" ]; then
    warn "Too old. Run: claude update   (then re-run this script)"
    NEEDS_UPDATE=1
  fi
else
  warn "'claude' not found on PATH; can't check the version. Make sure it is >= $MIN_VERSION."
fi

# ---------- 2. Stage the new files ----------
mkdir -p "$STAGE/agents"
SETTINGS="$CLAUDE_DIR/settings.json"

python3 - "$SETTINGS" "$STAGE/settings.json" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(src) and os.path.getsize(src) > 0:
    with open(src) as f:
        data = json.load(f)  # fails loudly on invalid JSON rather than clobbering it

def note(msg): print("!! " + msg)

for key, want in (("model", "sonnet"), ("advisorModel", "fable")):
    old = data.get(key)
    if old not in (None, want):
        note(f'settings.json "{key}" is "{old}"; it will become "{want}".')
    data[key] = want

env = data.get("env")
if env is None:
    env = data["env"] = {}
old = env.get("CLAUDE_CODE_SUBAGENT_MODEL")
if old not in (None, "haiku"):
    note(f'env CLAUDE_CODE_SUBAGENT_MODEL is "{old}"; it will become "haiku".')
env["CLAUDE_CODE_SUBAGENT_MODEL"] = "haiku"

# Things that would quietly break the setup
if str(env.get("CLAUDE_CODE_SUBAGENT_MODEL_FORCE", "")).lower() in ("1", "true"):
    note("CLAUDE_CODE_SUBAGENT_MODEL_FORCE is on: it makes the checker run on haiku instead of opus. Consider removing it.")
if str(env.get("CLAUDE_CODE_DISABLE_ADVISOR_TOOL", "")).lower() in ("1", "true"):
    note("CLAUDE_CODE_DISABLE_ADVISOR_TOOL is on: the advisor will never run. Remove it.")
if "DISABLE_TELEMETRY" in env:
    note("DISABLE_TELEMETRY is set: on the Anthropic API the advisor needs feature-flag fetching, so it may be off.")
am = data.get("availableModels")
if am:
    for m in ("sonnet", "fable", "opus", "haiku"):
        if not any(m in str(x) for x in am):
            note(f'availableModels does not seem to allow "{m}"; that part of the team will not run.')

# Effort: Sonnet 5.5 defaults to medium. Anything below that = fewer advisor calls.
def scan(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            p = f"{path}.{k}" if path else k
            if "effort" in k.lower() and isinstance(v, str) and v.lower() == "low":
                note(f'{p} = "low" lowers effort below Sonnet 5.5\'s default (medium). '
                     "At lower effort the main model consults the advisor far less.")
            scan(v, p)
scan(data)

with open(dst, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

if [ "${CLAUDE_CODE_EFFORT_LEVEL:-}" = "low" ]; then
  warn "Your shell sets CLAUDE_CODE_EFFORT_LEVEL=low (below Sonnet 5.5's default, medium): the advisor will be consulted far less."
fi

cat > "$STAGE/agents/checker.md" <<'EOF'
---
name: checker
description: Independent verifier. Use proactively before calling any task done. Runs the tests, reads the diff, and tries edge cases to break the finished work. Never edits code.
model: opus
disallowedTools: Write, Edit, NotebookEdit
---

You are the checker. Your job is to test finished work and try to break it.
You NEVER modify files: no Write/Edit, and no Bash that changes the tree
(no sed -i, no redirects into source files, no git commit/checkout/reset/stash,
no formatters with --fix/--write). Temporary files go only in a temp directory.

Process:
1. Read the change: `git status`, `git diff` (and `git diff --staged`), plus any
   new untracked files.
2. Find and run the project's tests, linter and type checker the way the repo
   defines them (package.json scripts, Makefile, pyproject, CI config).
3. Try edge cases the author likely missed: empty/null input, boundaries,
   large input, unicode, error paths, concurrency, missing config, wrong types.
   Run them where you can (a scratch script or the REPL, outside the repo).
4. Check the change actually does what was asked, not just that tests pass.

Report only real problems you saw, most severe first. For each:
- Where: file:line, or the exact command
- What you saw: the actual output or behaviour (quote it)
- Expected: what should have happened
If you find nothing, say "No problems found" and list exactly what you ran.
Do not suggest style nits. Do not fix anything.
EOF

cat > "$STAGE/agents/Explore.md" <<'EOF'
---
name: Explore
description: Fast read-only search and research agent. Use for finding files, grepping code, reading code and docs, and looking things up on the web. Returns short structured results.
model: haiku
tools: Read, Grep, Glob, WebFetch, WebSearch
---

You are a read-only search and research agent. You never create or modify files.

Find what was asked using Glob, Grep and Read (and WebFetch/WebSearch for docs).
Search broadly first, then narrow. Read excerpts, not whole large files.

Return a short structured result:
- Answer: one or two sentences
- Locations: `path:line` with a few words each
- Evidence: the minimum quoted lines or doc text that support the answer
- Not found / unsure: anything you couldn't confirm
No long file dumps, no speculation presented as fact.
EOF

CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then cp "$CLAUDE_MD" "$STAGE/CLAUDE.md"; else : > "$STAGE/CLAUDE.md"; fi
if ! grep -qF "$MARKER" "$STAGE/CLAUDE.md"; then
  [ -s "$STAGE/CLAUDE.md" ] && printf '\n' >> "$STAGE/CLAUDE.md"
  cat >> "$STAGE/CLAUDE.md" <<EOF
$MARKER
## Model team
Consult the advisor before you commit to an approach, when the same error comes back twice, and before you say a task is done. Run the checker before you call any task done. Send search and docs lookup to Explore. If a subagent must write code, give it model sonnet, never haiku. For a small task that fits in this session, skip subagents and do it yourself.
EOF
fi

# ---------- 3. One diff ----------
say ""
say "== 2. Proposed changes (nothing has been written yet)"
FILES=("settings.json" "agents/checker.md" "agents/Explore.md" "CLAUDE.md")
CHANGED=()
for f in "${FILES[@]}"; do
  cur="$CLAUDE_DIR/$f"; new="$STAGE/$f"
  if [ -f "$cur" ] && cmp -s "$cur" "$new"; then continue; fi
  CHANGED+=("$f")
  if [ -f "$cur" ]; then
    diff -u --label "a/$f" --label "b/$f" "$cur" "$new" || true
  else
    diff -u --label "/dev/null" --label "b/$f (new)" /dev/null "$new" || true
  fi
done

if [ ${#CHANGED[@]} -eq 0 ]; then
  say "Everything is already in place. Nothing to do."; exit 0
fi

say ""
read -r -p "Apply these changes to $CLAUDE_DIR? [y/N] " ans
case "$ans" in y|Y|yes|YES) ;; *) say "Nothing changed."; exit 0;; esac

# ---------- 4. Back up, then apply ----------
mkdir -p "$CLAUDE_DIR/agents"
for f in "${CHANGED[@]}"; do
  cur="$CLAUDE_DIR/$f"
  if [ -f "$cur" ]; then cp -p "$cur" "$cur.bak-$STAMP"; say "Backed up $cur -> $cur.bak-$STAMP"; fi
  cp "$STAGE/$f" "$cur"; say "Wrote $cur"
done

say ""
say "Done. Next:"
[ "${NEEDS_UPDATE:-0}" = 1 ] && say "  - Run: claude update   (Fable 5.2 needs >= $MIN_VERSION)"
say "  - Restart Claude Code."
say "  - If /model shows 'Requires usage credits' on Fable: run /model fable once, accept, then /model sonnet."
say "  - Check: /model -> Sonnet, /advisor -> fable, /agents -> checker (opus) and Explore (haiku)."
say "  - To undo: copy the .bak-$STAMP files back (new files can simply be deleted)."
