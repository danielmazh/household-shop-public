#!/usr/bin/env bash
# Rebuild the Android app (Trusted Web Activity) for https://household-shop.pages.dev
# Outputs: android/out/household-shop.apk (install directly) and
#          android/out/household-shop.aab (for Google Play).
#
# Needs (one-time setup, outside the repo):
#   ~/.bubblewrap/config.json   -> jdkPath (JDK 17) and androidSdkPath
#   ~/.config/household-shop/android/upload-keystore.jks  (alias "upload")
#   ~/.config/household-shop/android/keystore.env  (KEYSTORE_PASSWORD, KEY_PASSWORD)
# The passwords are read from keystore.env and never printed.
set -euo pipefail

BUBBLEWRAP_VERSION="1.27.0"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
OUT_DIR="$ANDROID_DIR/out"
KEY_DIR="${HOUSEHOLD_SHOP_KEY_DIR:-$HOME/.config/household-shop/android}"
KEYSTORE="$KEY_DIR/upload-keystore.jks"
ENV_FILE="$KEY_DIR/keystore.env"

[ -f "$KEYSTORE" ] || { echo "Missing keystore: $KEYSTORE" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing password file: $ENV_FILE" >&2; exit 1; }

set +x
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export BUBBLEWRAP_KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD"
export BUBBLEWRAP_KEY_PASSWORD="$KEY_PASSWORD"
unset KEYSTORE_PASSWORD KEY_PASSWORD

cd "$ANDROID_DIR"
# Regenerate the Gradle project from twa-manifest.json (keeps the version numbers as written).
npx -y "@bubblewrap/cli@$BUBBLEWRAP_VERSION" update --skipVersionUpgrade < /dev/null
npx -y "@bubblewrap/cli@$BUBBLEWRAP_VERSION" build --skipPwaValidation \
  --signingKeyPath="$KEYSTORE" --signingKeyAlias=upload < /dev/null

mkdir -p "$OUT_DIR"
cp app-release-signed.apk "$OUT_DIR/household-shop.apk"
cp app-release-bundle.aab "$OUT_DIR/household-shop.aab"
ls -l "$OUT_DIR"
