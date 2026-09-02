#!/usr/bin/env sh
# Holds the hardcoded-colour count at zero.
#
# Installed at zero (end of the light/dark-mode change) so it never has to be
# introduced with a backlog. Every colour in src/ outside src/components/ui/
# must resolve through a token in src/styles/global.css.
#
# src/components/ui/ is excluded wholesale: it holds four LEGITIMATE literals
# (button.tsx's contrast-locked white text and the three black/50 modal
# scrims) which are shadcn-owned and get overwritten by `npx shadcn add`.
# Policing them is permanent merge friction for no benefit. The exclusion is a
# PATH filter, not `--exclude-dir=ui`: the latter also excludes any future
# directory that merely happens to be named `ui`.
#
# .ts is scanned as well as .astro/.tsx. src/lib/theme.ts holds every cva
# colour class string in the repo, so leaving it out put the design system's
# own source file outside its own gate.
#
# .css is deliberately NOT scanned: src/styles/global.css is legitimately full
# of raw colour values, and carving it out would be the same kind of permanent
# exception this gate exists to avoid.
#
# The pattern deliberately avoids \b: this repo's `grep` may be ugrep, which
# rejects it as an empty sub-expression. Keep it POSIX-safe.
set -eu

ROOTS='src scripts'
EXCLUDED_PATH='^src/components/ui/'

# Assert the roots exist rather than trusting grep's exit code for this case:
# ugrep returns 1 (indistinguishable from "no match") for a missing directory,
# where GNU grep returns 2. Without this, renaming src/ would make the gate
# report green forever.
for root in $ROOTS; do
  if [ ! -d "$root" ]; then
    echo "  ✗ lint:colors could not run: '$root' is not a directory." >&2
    echo "    Refusing to report green." >&2
    exit 2
  fi
done

PREFIX='(text|bg|border|ring|from|via|to|fill|stroke|placeholder|divide|outline|decoration|caret|shadow)'
COLOR='(white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'

status=0

check() {
  label="$1"
  pattern="$2"

  # grep's exit code is load-bearing and must not be swallowed: 0 = matched,
  # 1 = no match, >1 = grep itself failed (missing directory, bad regex). The
  # old `if grep ...` form and a bare `|| true` both collapse 2 into "clean",
  # so a renamed src/ or a broken pattern would report green forever in both
  # the pre-commit hook and CI. A gate that under-reports is worse than none.
  if hits=$(grep -rnE "$pattern" $ROOTS \
    --include='*.astro' --include='*.tsx' --include='*.ts'); then
    rc=0
  else
    rc=$?
  fi

  if [ "$rc" -gt 1 ]; then
    echo "  ✗ lint:colors could not run: grep exited $rc while checking '$label'." >&2
    echo "    Refusing to report green. Check that $ROOTS exist and the pattern is valid." >&2
    exit 2
  fi

  hits=$(printf '%s\n' "$hits" | grep -vE "$EXCLUDED_PATH") || true

  if [ -n "$hits" ]; then
    echo "$hits"
    echo ""
    echo "  ✗ $label"
    status=1
  fi
}

check "Tailwind palette literal — use a token from src/styles/global.css" "${PREFIX}-${COLOR}"
check "raw hex colour — use a token, or add it to global.css" '#[0-9a-fA-F]{3,8}'
check "rgb()/hsl() colour — use a token, or color-mix() over one" '(rgba?|hsla?)\('

if [ "$status" -ne 0 ]; then
  echo ""
  echo "  Tokens live in src/styles/global.css; the domain->token mappers and cva"
  echo "  variants live in src/lib/theme.ts. Remember the two-step rule: a raw value"
  echo "  in BOTH :root and .dark, plus a --color-* alias in @theme inline."
  exit 1
fi

echo "lint:colors — no hardcoded colours outside src/components/ui/"
