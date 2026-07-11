# Aperçu Séra dans Expo Go (bac à sable)

Cette page explique comment ouvrir l'application livreur **Séra** sur votre
téléphone, en mode **aperçu**. Un aperçu est un **bac à sable** : rien n'y est réel —
aucun paiement, aucune commande, aucune donnée de production. Le bandeau
**« Aperçu — bac à sable »** reste affiché en permanence pour le rappeler.

## Chemin 1 — automatique, à chaque fusion sur `main`

1. Ajoutez le secret `EXPO_TOKEN` dans GitHub : *Settings → Secrets and variables →
   Actions → New repository secret* (un jeton d'accès créé sur expo.dev, compte du projet).
   Tant que le secret est absent, la publication est simplement sautée avec une note visible —
   rien ne casse.
2. À chaque fusion sur `main`, l'action **expo-preview** publie une mise à jour sur le
   canal `preview` du projet Expo (créé automatiquement au premier passage).
3. Sur expo.dev, ouvrez le projet → *Updates* → branche `preview` → scannez le QR avec
   **Expo Go** sur le téléphone.

## Chemin 2 — local, sans GitHub

1. Sur un ordinateur avec `pnpm` : lancez `apps/rider-app/run-preview.sh`
   (ou `run-preview.bat` sous Windows).
2. Un QR s'affiche dans le terminal. Scannez-le avec **Expo Go** — le téléphone et
   l'ordinateur doivent être sur le même réseau Wi-Fi.

## Version du SDK

Cette application est sur **Expo SDK 57** (la version stable courante au registre npm,
juillet 2026 — mise à niveau WO-4.0b). **L'Expo Go du Play Store est la voie normale** :
installez-le, scannez le QR, l'aperçu s'ouvre directement.

## Note locale (cache Metro)

Après avoir changé de profil (variable `EXPO_PUBLIC_PROFILE`), relancez avec
`npx expo start --clear` : le cache de Metro ne se rafraîchit pas tout seul
quand une variable inline change.

## Ce que « bac à sable » veut dire ici

Les écrans montrent le vrai design et les vrais parcours, avec des données d'essai.
Les actions « en attente du réseau » restent en attente : il n'y a pas de serveur —
c'est voulu et affiché honnêtement.
