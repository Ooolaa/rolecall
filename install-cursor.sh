#!/usr/bin/env bash
# Installs Rolecall for Cursor (user scope).
# Usage: ./install-cursor.sh              install
#        ./install-cursor.sh --uninstall  remove everything install added
# Changes no Cursor settings: custom subagents and skills are on by default.
set -euo pipefail
cd "$(dirname "$0")"

command -v git >/dev/null || { echo "git not found"; exit 1; }

# Each Upstream, cloned from its own repository. The Role files point at these paths;
# nothing here is in a Cursor skill or rule folder, so each Teammate sees only the files its Role names.
UPSTREAMS="
DietrichGebert/ponytail
multica-ai/andrej-karpathy-skills
obra/superpowers
mattpocock/skills
steipete/agent-rules
JuliusBrussee/caveman
nextlevelbuilder/ui-ux-pro-max-skill
Leonxlnx/taste-skill
pbakaus/impeccable
trailofbits/skills
"
ROLECALL=~/.cursor/rolecall
AGENTS=~/.cursor/agents
# Not "rolecall": Cursor also scans ~/.agents/skills, where the Codex lead lives.
LEAD=~/.cursor/skills/rolecall-cursor

if [ "${1:-}" = "--uninstall" ]; then
  for f in cursor/agents/*.md; do rm -f "$AGENTS/$(basename "$f")"; done
  rm -rf "$ROLECALL" "$LEAD"
  echo "Rolecall removed from Cursor. Restart Cursor."
  exit 0
fi

echo "Cloning Upstreams into $ROLECALL/upstreams..."
for repo in $UPSTREAMS; do
  dest="$ROLECALL/upstreams/$repo"
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  git clone --depth 1 -q "https://github.com/$repo.git" "$dest"
done

echo "Installing Role files and the /rolecall-cursor lead skill..."
mkdir -p "$AGENTS" "$LEAD"
cp cursor/agents/*.md "$AGENTS/"
cp cursor/skills/rolecall-cursor/SKILL.md "$LEAD/"

echo "Rolecall installed for Cursor. Restart Cursor, then run: /rolecall-cursor <your task>"
