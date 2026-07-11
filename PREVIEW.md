# Aperçu Boutik+ dans Expo Go (bac à sable)

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

## Note honnête sur la version

Cette application est sur **Expo SDK 53** ; la version courante d'Expo est plus récente
(SDK 57 au registre npm, juillet 2026). La compatibilité d'Expo Go du Play Store avec le
SDK 53 n'a **pas pu être vérifiée** depuis cet environnement. Si Expo Go refuse d'ouvrir
l'aperçu : sur Android, une version d'Expo Go correspondant au SDK 53 peut être installée
depuis expo.dev/go (choisir la version du SDK). La mise à niveau du SDK est prévue comme
sa propre étape de travail (WO-4.0b) — elle n'a pas été forcée ici.

## Ce que « bac à sable » veut dire ici

Les écrans montrent le vrai design et les vrais parcours, avec des données d'essai.
Les actions « en attente du réseau » restent en attente : il n'y a pas de serveur —
c'est voulu et affiché honnêtement.
