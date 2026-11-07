#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Inside the Playwright image, for scripts/e2e-docker.sh: /work is a volume kept between runs, /src holds the engine's
# and the add-ons' archives and this app's working tree (read only), /out takes what a failed spec saw.
set -euo pipefail
# CI's Node (setup-node 22), not the image's own; and a compiler for a native module with no prebuilt binary.
if [ ! -x /work/node22/bin/node ]; then
  arch=$(uname -m); [ "$arch" = aarch64 ] && arch=arm64; [ "$arch" = x86_64 ] && arch=x64
  mkdir -p /work/node22 && curl -fsSL "https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-$arch.tar.gz" | tar xz -C /work/node22 --strip-components=1
fi
export PATH=/work/node22/bin:$PATH
command -v make >/dev/null || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential >/dev/null)
corepack enable
if [ ! -f /work/adminium/apps/server/dist/cli/index.js ]; then
  if [ ! -d /work/adminium/node_modules ]; then
    rm -rf /work/adminium && mkdir -p /work/adminium && tar xf /src/archives/adminium.tar -C /work/adminium
    (cd /work/adminium && pnpm install --frozen-lockfile)
  fi
  # Docker Desktop's VM may have 4 GB: one build at a time, with room for the server's type check.
  (cd /work/adminium && NODE_OPTIONS=--max-old-space-size=3072 pnpm turbo run build --concurrency=1 --filter="@adminium/e2e...")
fi
if [ ! -f /work/add-ons/packages/forms/manifest.json ]; then
  rm -rf /work/add-ons && mkdir -p /work/add-ons && tar xf /src/archives/add-ons.tar -C /work/add-ons
  (cd /work/add-ons && npm ci --no-audit --no-fund && npm run build -w packages/invoices -w packages/inventory -w packages/forms)
fi
# The app as the working tree has it now, without the host's node_modules or build output.
mkdir -p /work/app
find /work/app -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
(cd /src/app && tar cf - --exclude=./node_modules --exclude=./dist-surface --exclude=./e2e/.results --exclude=./e2e/.stand --exclude=./.git .) | (cd /work/app && tar xf -)
cd /work/app
if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.lock-copy; then npm ci --no-audit --no-fund && cp package-lock.json node_modules/.lock-copy; fi
export CI=1 ADMINIUM_REPO=/work/adminium ADD_ONS_REPO=/work/add-ons
set +e
npm run e2e -- "$@"
status=$?
rm -rf /out/* && cp -r e2e/.results/. /out/ 2>/dev/null
echo "e2e-docker: exit $status"
exit $status
