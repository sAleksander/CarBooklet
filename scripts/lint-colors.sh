#!/usr/bin/env sh
# Holds the hardcoded-colour count at zero.
#
# Installed at zero (end of the light/dark-mode change) so it never has to be
# introduced with a backlog. Every colour in src/ outside src/components/ui/
# must resolve through a token in src/styles/global.css.
#
# src/components/ui/ is excluded wholesale: it holds four LEGITIMATE literals
# (button.tsx's contrast-locked text-white and the three bg-black/50 modal
# scrims) which are shadcn-owned and get overwritten by `npx shadcn add`.
# Policing them is permanent merge friction for no benefit.
#
# The pattern deliberately avoids \b: this repo's `grep` may be ugrep, which
# rejects it as an empty sub-expression. Keep it POSIX-safe.
set -e

PREFIX='(text|bg|border|ring|from|via|to|fill|stroke|placeholder|divide|outline|decoration|caret|shadow)'
COLOR='(white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'

status=0

check() {
  label="$1"
  pattern="$2"
  if grep -rnE "$pattern" src --include='*.astro' --include='*.tsx' --exclude-dir=ui; then
    echo ""
    echo "  ✗ $label"
    status=1
  fi
}

check "Tailwind palette literal — use a token from src/styles/global.css" "${PREFIX}-${COLOR}"
check "raw hex colour — use a token, or add it to global.css" '#[0-9a-fA-F]{3,8}'
check "rgba() colour — use a token, or color-mix() over one" 'rgba\('

if [ "$status" -ne 0 ]; then
  echo ""
  echo "  Tokens live in src/styles/global.css; the domain->token mappers and cva"
  echo "  variants live in src/lib/theme.ts. Remember the two-step rule: a raw value"
  echo "  in BOTH :root and .dark, plus a --color-* alias in @theme inline."
  exit 1
fi

echo "lint:colors — no hardcoded colours outside src/components/ui/"
