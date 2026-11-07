#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# The browser specs on Linux, in Microsoft's Playwright image (the version this repo's lock file pins), the way
# contract.yml runs them: CI=1, Node 22, the engine and the add-ons built inside the container, a stand on SQLite.
# For a failure that shows on the CI runner and never on a Mac: the runner is a slow Linux machine, so
# DOCKER_CPUS=1 (the default) is the closer match. A drag that landed a column off on CI did so here at one CPU.
#
#   ADMINIUM_REPO=<Adminium checkout> ADD_ONS_REPO=<add-ons checkout> scripts/e2e-docker.sh [playwright args]
#
# ADMINIUM_REF / ADD_ONS_REF name what is built from each checkout (by `git archive`; default: the tags contract.yml
# names). The builds are kept in a Docker volume per pair of commits, so only the first run builds. The app is copied
# from this working tree on every run. What a failed spec saw lands in e2e/.results, as with `npm run e2e`.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
: "${ADMINIUM_REPO:?ADMINIUM_REPO must name an Adminium checkout}"
: "${ADD_ONS_REPO:?ADD_ONS_REPO must name an add-ons checkout}"
workflow="$here/.github/workflows/contract.yml"
ADMINIUM_REF=${ADMINIUM_REF:-$(sed -n 's/^ *ADMINIUM_REF: *//p' "$workflow")}
ADD_ONS_REF=${ADD_ONS_REF:-$(sed -n 's/^ *ADD_ONS_REF: *//p' "$workflow")}
playwright=$(node -p 'require(process.argv[1]).packages["node_modules/@playwright/test"].version' "$here/package-lock.json")
engine=$(git -C "$ADMINIUM_REPO" rev-parse --short "$ADMINIUM_REF^{commit}")
addons=$(git -C "$ADD_ONS_REPO" rev-parse --short "$ADD_ONS_REF^{commit}")
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git -C "$ADMINIUM_REPO" archive --format=tar -o "$src/adminium.tar" "$ADMINIUM_REF"
git -C "$ADD_ONS_REPO" archive --format=tar -o "$src/add-ons.tar" "$ADD_ONS_REF"
mkdir -p "$here/e2e/.results"
echo "e2e-docker: Playwright $playwright, Adminium $ADMINIUM_REF ($engine), add-ons $ADD_ONS_REF ($addons), ${DOCKER_CPUS:-1} CPU"
docker run --rm --ipc=host --init --cpus="${DOCKER_CPUS:-1}" \
  -v "crm-e2e-$engine-$addons:/work" \
  -v "$src:/src/archives:ro" \
  -v "$here:/src/app:ro" \
  -v "$here/e2e/.results:/out" \
  -v "$here/scripts/e2e-docker-inside.sh:/inside.sh:ro" \
  "mcr.microsoft.com/playwright:v$playwright-noble" /inside.sh "$@"
