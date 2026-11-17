#!/usr/bin/env bash
# Kit créatif Claude Code (niveau utilisateur) : sites web, vidéos, visuels/affiches.
# Sources vérifiées depuis le catalogue uwarp.design/agent-skills (gratuites / open source uniquement).
#
#   bash setup-creative-kit.sh                     -> affiche le plan, demande "y" avant d'installer
#   bash setup-creative-kit.sh --with-impeccable   -> ajoute aussi Impeccable (voir avertissement)
#
# Tout est réversible : plugins -> `claude plugin uninstall`, skills -> `npx skills remove -g`,
# MCP -> `claude mcp remove playwright -s user`. Sauvegardes .bak-<date> faites avant écriture.
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WITH_IMPECCABLE=0
[ "${1:-}" = "--with-impeccable" ] && WITH_IMPECCABLE=1
export DO_NOT_TRACK=1 DISABLE_TELEMETRY=1   # pas de télémétrie pour le CLI "skills"

SKILLS_CLI="skills@1.9.0"
PLAYWRIGHT_MCP="@playwright/mcp@0.0.85"

# marketplace GitHub | plugin@marketplace | à quoi ça sert
PLUGINS=(
  "anthropics/skills|example-skills@anthropic-agent-skills|Anthropic officiel : frontend-design, canvas-design (affiches PNG/PDF), algorithmic-art, theme-factory, brand-guidelines, slack-gif-creator, web-artifacts-builder, webapp-testing"
  "leonxlnx/taste-skill|taste-skill@taste-skill|Sites vitrines haut de gamme (anti « look IA générique »)"
  "nextlevelbuilder/ui-ux-pro-max-skill|ui-ux-pro-max@ui-ux-pro-max-skill|Base de 80 styles, 192 palettes, 74 paires de polices, logos, design system"
  "heygen-com/hyperframes|hyperframes@hyperframes|Vidéo en HTML -> MP4 : motion design, sous-titres, voix off, slideshows, capture de site"
)
[ "$WITH_IMPECCABLE" = 1 ] && PLUGINS+=("pbakaus/impeccable|impeccable@impeccable|Polish UI (24 commandes /impeccable ...) — ajoute des hooks à chaque édition")

# repo GitHub | skills (séparés par des virgules) | à quoi ça sert
SKILLS=(
  "remotion-dev/skills|remotion-best-practices,remotion-create,remotion-render,remotion-captions|Vidéo en React (Remotion) : créer, rendre, sous-titrer"
  "vercel-labs/agent-skills|web-design-guidelines|Revue UI selon les guidelines Vercel"
  "emilkowalski/skills|emil-design-eng|Animations et détails d'interface soignés"
  "shadcn/ui|shadcn|Composants shadcn/ui"
)

say()  { printf '%s\n' "$*"; }
warn() { printf '!! %s\n' "$*"; }

# ---------- Prérequis ----------
say "== Prérequis"
MISSING=0
for c in claude git node npx python3 ffmpeg; do
  if command -v "$c" >/dev/null; then say "  ok  $c"; else warn "manque : $c"; MISSING=1; fi
done
if command -v node >/dev/null; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge 20 ] || warn "Node $NODE_MAJOR : Remotion/HyperFrames veulent Node 20+."
fi
if [ "$MISSING" = 1 ]; then
  say "   macOS : brew install node ffmpeg git python   |   Ubuntu : sudo apt install nodejs npm ffmpeg git python3"
  command -v claude >/dev/null && command -v npx >/dev/null || { say "claude et npx sont obligatoires. Arrêt."; exit 1; }
  say "   (ffmpeg/python3 manquants : l'installation peut continuer, mais le rendu vidéo / certains scripts échoueront.)"
fi

# ---------- Plan ----------
say ""
say "== Ce qui sera installé (niveau utilisateur, tous les projets)"
say "Plugins Claude Code :"
for p in "${PLUGINS[@]}"; do IFS='|' read -r repo id what <<<"$p"; say "  + $id  ($repo)"; say "      $what"; done
say "Skills (via npx $SKILLS_CLI, copiés dans $CLAUDE_DIR/skills) :"
for s in "${SKILLS[@]}"; do IFS='|' read -r repo names what <<<"$s"; say "  + $names  ($repo)"; say "      $what"; done
say "Serveur MCP :"
say "  + playwright ($PLAYWRIGHT_MCP) : Claude ouvre tes pages dans un navigateur, fait des captures, vérifie le rendu"
say "Agent :"
say "  + $CLAUDE_DIR/agents/design-critic.md (opus, lecture seule) : critique visuelle d'un site / d'une affiche / d'une vidéo rendue"
[ "$WITH_IMPECCABLE" = 0 ] && say "(Impeccable non inclus : relance avec --with-impeccable si tu le veux.)"
say ""
say "Fichiers sauvegardés avant modification : $CLAUDE_DIR/settings.json, ~/.claude.json"
read -r -p "Installer ? [y/N] " ans
case "$ans" in y|Y|yes|YES|o|O|oui) ;; *) say "Rien n'a été modifié."; exit 0;; esac

# ---------- Sauvegardes ----------
for f in "$CLAUDE_DIR/settings.json" "$HOME/.claude.json" "$CLAUDE_DIR/agents/design-critic.md"; do
  [ -f "$f" ] && cp -p "$f" "$f.bak-$STAMP" && say "Sauvegarde : $f.bak-$STAMP"
done

FAILED=()
# ---------- Plugins ----------
for p in "${PLUGINS[@]}"; do
  IFS='|' read -r repo id what <<<"$p"
  say ""; say "-> $id"
  claude plugin marketplace add "$repo" || true      # déjà présent = pas grave
  claude plugin install "$id" --scope user || FAILED+=("$id")
done

# ---------- Skills ----------
for s in "${SKILLS[@]}"; do
  IFS='|' read -r repo names what <<<"$s"
  say ""; say "-> $repo : $names"
  args=(); IFS=',' read -ra list <<<"$names"; for n in "${list[@]}"; do args+=(--skill "$n"); done
  npx -y "$SKILLS_CLI" add "$repo" "${args[@]}" -g -a claude-code --copy -y || FAILED+=("$repo")
done

# ---------- MCP Playwright ----------
say ""; say "-> MCP playwright"
if claude mcp get playwright >/dev/null 2>&1; then say "   déjà configuré"; else
  claude mcp add --scope user playwright -- npx -y "$PLAYWRIGHT_MCP" || FAILED+=("mcp playwright")
fi

# ---------- Agent design-critic ----------
mkdir -p "$CLAUDE_DIR/agents"
cat > "$CLAUDE_DIR/agents/design-critic.md" <<'EOF'
---
name: design-critic
description: Visual design critic. Use after building or changing a website, poster/visual, or rendered video, before calling it done. Looks at the real output (screenshots, rendered frames, exported images) and reports concrete visual problems. Never edits.
model: opus
disallowedTools: Write, Edit, NotebookEdit
---

You are a demanding art director. You judge the real rendered output, never just the code.

1. Get pixels: for a site, open it with the Playwright MCP tools (or a local server)
   and screenshot desktop (1440px) and mobile (390px). For a video, extract a few
   frames with `ffmpeg -ss <t> -i <file> -frames:v 1 /tmp/frame_<t>.png`.
   For a poster/image, open the exported file. Temporary files go in /tmp only.
2. Judge: hierarchy and focal point, typography (pairing, sizes, line length,
   widows), color and contrast (WCAG AA for text), spacing rhythm and alignment,
   consistency with the brief/brand, anything that looks generic or "AI-made",
   overflow/cropping, broken or placeholder content. For video: pacing, legibility
   of text on screen, safe areas, transitions, audio/caption sync.
3. Report problems most severe first. For each: where (page + viewport, timecode,
   or poster area), what you saw, why it hurts, and the specific fix.
   End with the 3 changes that would improve it most. No praise padding.
You never modify project files.
EOF
say "-> agent design-critic écrit"

# ---------- Résumé ----------
say ""
if [ ${#FAILED[@]} -gt 0 ]; then warn "Échecs : ${FAILED[*]} (relance le script, il est idempotent)"; else say "Tout est installé."; fi
say "Redémarre Claude Code, puis vérifie : /plugin (plugins), /mcp (playwright), /agents (design-critic), et demande « quels skills as-tu ? »."
