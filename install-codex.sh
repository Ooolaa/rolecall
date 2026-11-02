#!/usr/bin/env bash
# Installs Rolecall for Codex (user scope).
# Usage: ./install-codex.sh              install
#        ./install-codex.sh --uninstall  remove everything install added
# Changes no Codex settings: custom agents are on by default.
set -euo pipefail
cd "$(dirname "$0")"

command -v git >/dev/null || { echo "git not found"; exit 1; }

# Each Upstream, cloned from its own repository. The Role files point at these paths;
# nothing here is in a Codex skill folder, so each Teammate sees only the files its Role names.
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
ROLECALL=~/.codex/rolecall
AGENTS=~/.codex/agents
LEAD=~/.agents/skills/rolecall

if [ "${1:-}" = "--uninstall" ]; then
  for f in codex/agents/*.toml; do rm -f "$AGENTS/$(basename "$f")"; done
  rm -rf "$ROLECALL" "$LEAD"
  echo "Rolecall removed from Codex. Restart Codex."
  exit 0
fi

echo "Cloning Upstreams into $ROLECALL/upstreams..."
for repo in $UPSTREAMS; do
  dest="$ROLECALL/upstreams/$repo"
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  git clone --depth 1 -q "https://github.com/$repo.git" "$dest"
done

echo "Installing Role files and the \$rolecall lead skill..."
mkdir -p "$AGENTS" "$LEAD"
cp codex/agents/*.toml "$AGENTS/"
cp codex/skills/rolecall/SKILL.md "$LEAD/"

echo "Rolecall installed for Codex. Restart Codex, then run: \$rolecall <your task>"
