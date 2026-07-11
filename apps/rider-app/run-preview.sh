#!/usr/bin/env bash
# WO-4.0 — aperçu local : installe puis lance le serveur Expo avec le QR.
# Scannez le QR avec Expo Go (même réseau Wi-Fi que l'ordinateur).
set -euo pipefail
cd "$(dirname "$0")"
command -v pnpm >/dev/null || { echo "pnpm est requis (https://pnpm.io)"; exit 1; }
pnpm install
npx expo start
