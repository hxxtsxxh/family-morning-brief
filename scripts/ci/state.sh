#!/usr/bin/env bash
# restore | save — persists state between GitHub Actions runs:
#   * the WhatsApp linked-device session (~/.openclaw/credentials)
#   * the brief history (state/history.json: what was sent, to avoid duplicates)
# Stored ENCRYPTED (AES-256, key = STATE_PASSPHRASE secret) as the single commit on the
# `state` branch of this private repo. Plaintext never touches git.
set -euo pipefail
: "${STATE_PASSPHRASE:?STATE_PASSPHRASE secret is missing}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/brief-state"
BRANCH=state
FILE=state.tar.gz.enc
mkdir -p "$WORK"

case "${1:-}" in
  restore)
    if ! git -C "$ROOT" fetch --quiet --depth=1 origin "$BRANCH" 2>/dev/null; then
      echo "no saved state yet (first run)"; echo "restored=false" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 0
    fi
    git -C "$ROOT" show "FETCH_HEAD:$FILE" > "$WORK/$FILE"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:STATE_PASSPHRASE -in "$WORK/$FILE" | tar -xz -C "$WORK"
    mkdir -p "$HOME/.openclaw" "$ROOT/state"
    [ -d "$WORK/credentials" ] && cp -a "$WORK/credentials" "$HOME/.openclaw/"
    [ -f "$WORK/history.json" ] && cp "$WORK/history.json" "$ROOT/state/history.json"
    chmod -R go-rwx "$HOME/.openclaw" || true
    linked=false; ls "$HOME"/.openclaw/credentials/whatsapp/*/creds.json >/dev/null 2>&1 && linked=true
    echo "state restored (whatsapp linked: $linked)"
    echo "restored=true" >> "${GITHUB_OUTPUT:-/dev/null}"
    echo "linked=$linked" >> "${GITHUB_OUTPUT:-/dev/null}"
    rm -rf "$WORK"
    ;;
  save)
    STAGE="$WORK/stage"; rm -rf "$STAGE"; mkdir -p "$STAGE"
    [ -d "$HOME/.openclaw/credentials" ] && cp -a "$HOME/.openclaw/credentials" "$STAGE/"
    [ -f "$ROOT/state/history.json" ] && cp "$ROOT/state/history.json" "$STAGE/"
    if [ -z "$(ls -A "$STAGE")" ]; then echo "nothing to save"; exit 0; fi
    # Never overwrite a linked session with an unlinked one unless explicitly allowed (logout).
    if ! ls "$STAGE"/credentials/whatsapp/*/creds.json >/dev/null 2>&1 && [ "${ALLOW_UNLINKED_SAVE:-false}" != "true" ] \
       && git -C "$ROOT" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
      echo "::warning::WhatsApp session missing locally — keeping the previously saved state"; exit 0
    fi
    tar -cz -C "$STAGE" . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:STATE_PASSPHRASE -out "$WORK/$FILE"
    REPO="$WORK/repo"; rm -rf "$REPO"; mkdir -p "$REPO"
    git -C "$REPO" init --quiet -b "$BRANCH"
    cp "$WORK/$FILE" "$REPO/"
    printf 'Encrypted runtime state for the morning-brief workflow. Do not edit.\n' > "$REPO/README.md"
    git -C "$REPO" add -A
    git -C "$REPO" -c user.name="morning-brief-bot" -c user.email="actions@users.noreply.github.com" commit --quiet -m "state $(date -u +%FT%TZ)"
    : "${GITHUB_TOKEN:?GITHUB_TOKEN is required to save state}" "${GITHUB_REPOSITORY:?}"
    git -C "$REPO" push --quiet --force "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BRANCH:$BRANCH"
    echo "state saved (single encrypted commit on '$BRANCH')"
    rm -rf "$WORK"
    ;;
  *) echo "usage: $0 restore|save" >&2; exit 2 ;;
esac
