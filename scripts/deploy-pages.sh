#!/usr/bin/env bash
#
# Publishes the built UI to the `gh-pages` branch.
#
# The branch holds only build output and shares no history with the source
# branch. The first commit is an orphan; later runs parent onto the previous
# deploy so pushes fast-forward and the deploy history stays readable.
#
# Nothing here touches your working tree or checked-out branch: the commit is
# assembled with a temporary index against a staging directory.
#
# Usage:
#   scripts/deploy-pages.sh                 # build, commit, push
#   scripts/deploy-pages.sh --no-push       # build and commit locally only
#   BRANCH=pages scripts/deploy-pages.sh    # different branch name

set -euo pipefail

BRANCH="${BRANCH:-gh-pages}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# GitHub Pages serves project sites from /<repo>/, so the bundle must be built
# with that prefix or every asset URL 404s.
REPO_NAME="$(basename -s .git "$(git config --get remote.origin.url)")"
BASE_PATH="${BASE_PATH:-/$REPO_NAME/}"

# The relay the app should use by default, and the relay's own key.
#
# Both are empty here on purpose. This site is public, so anything baked into
# the bundle is published with it: the URL tells the world where the Worker is,
# and the key is then the only thing standing between that Worker and anyone
# who fancies using it. Publishing both together would leave no lock at all.
#
# The cost of leaving them empty is one-time and small — a browser is asked for
# the relay once and remembers it — so it is the right default for a public
# deploy. Pass them in the environment for a build you are not publishing:
#
#   VITE_DEFAULT_RELAY=https://... VITE_DEFAULT_RELAY_KEY=... scripts/deploy-pages.sh
#
DEFAULT_RELAY="${VITE_DEFAULT_RELAY:-}"
DEFAULT_RELAY_KEY="${VITE_DEFAULT_RELAY_KEY:-}"

echo "==> building with BASE_PATH=$BASE_PATH${DEFAULT_RELAY:+ and relay $DEFAULT_RELAY}"
if [[ -n "$DEFAULT_RELAY" || -n "$DEFAULT_RELAY_KEY" ]]; then
  echo "==> WARNING: baking relay details into a public bundle — the${DEFAULT_RELAY:+ URL}${DEFAULT_RELAY:+${DEFAULT_RELAY_KEY:+ and}}${DEFAULT_RELAY_KEY:+ key} will be readable by anyone who opens the site"
fi
rm -rf ui/dist
BASE_PATH="$BASE_PATH" VITE_DEFAULT_RELAY="$DEFAULT_RELAY" \
  VITE_DEFAULT_RELAY_KEY="$DEFAULT_RELAY_KEY" npm --prefix ui run build

STAGE="$(mktemp -d)"
INDEX="$(mktemp -u)"
trap 'rm -rf "$STAGE" "$INDEX"' EXIT

cp -r ui/dist/. "$STAGE"/
# Sourcemaps are ~1.4 MB and of no use to visitors.
rm -f "$STAGE"/assets/*.map
# Without this, Pages runs Jekyll, which drops files and folders starting with _.
touch "$STAGE/.nojekyll"

SOURCE_REF="$(git rev-parse --abbrev-ref HEAD)"
SOURCE_SHA="$(git rev-parse --short HEAD)"

export GIT_DIR="$REPO_ROOT/.git"
export GIT_WORK_TREE="$STAGE"
export GIT_INDEX_FILE="$INDEX"
git add -A
TREE="$(git write-tree)"

PARENT_ARGS=()
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  PARENT_ARGS=(-p "refs/heads/$BRANCH")
fi

COMMIT="$(git commit-tree "$TREE" "${PARENT_ARGS[@]}" -m "Deploy units UI to GitHub Pages

Built from $SOURCE_REF at $SOURCE_SHA with BASE_PATH=$BASE_PATH.

This branch holds only build output. Regenerate it with
scripts/deploy-pages.sh rather than editing here.")"

git update-ref "refs/heads/$BRANCH" "$COMMIT"
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

echo "==> $BRANCH now at $(git rev-parse --short "$BRANCH")"

if [[ "${1:-}" == "--no-push" ]]; then
  echo "==> skipping push (--no-push)"
else
  git push origin "$BRANCH"
  echo "==> pushed. Enable it at Settings -> Pages -> Source: Deploy from a branch -> $BRANCH / (root)"
fi
