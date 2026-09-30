#!/usr/bin/env bash
# Installs OpenClaw + its WhatsApp plugin on a GitHub Actions runner and applies
# config/openclaw.patch.json5. Idempotent. Never prints credentials.
set -euo pipefail
: "${OPENCLAW_VERSION:?set OPENCLAW_VERSION (pinned in the workflow)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "::group::Install OpenClaw ${OPENCLAW_VERSION}"
npm install -g "openclaw@${OPENCLAW_VERSION}" --no-audit --no-fund --loglevel=error
openclaw --version
echo "::endgroup::"

echo "::group::Configure OpenClaw (broadcast-only WhatsApp)"
openclaw config patch --file "$ROOT/config/openclaw.patch.json5"
if ! openclaw plugins list 2>/dev/null | grep -q "whatsapp"; then
  openclaw plugins install @openclaw/whatsapp
fi
openclaw config validate
echo "::endgroup::"
