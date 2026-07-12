# COPY — le catalogue des chaînes
### French Voice · 6th-grade register · every string tagged · v1.0.0

Registers: **`money`** (calm, precise, reassuring) · **`selling`** (warm, familiar) · **`neutral`** (wayfinding, labels).
Rule: no administrative French; no word a market seller wouldn't say out loud. Amounts always full, tabular, « 11 500 F ».

## Chrome (all surfaces)

| Screen | String | Register |
|---|---|---|
| ribbon | « APERÇU — BAC À SABLE » | neutral |
| offline banner | « Hors ligne : vos actions sont en attente, jamais perdues. » | money |
| privacy footer | « Votre numéro reste privé. » | money |

## C1 · La page produit

| String | Register |
|---|---|
| « CHEZ AÏCHA » · « Vérifiée » | selling |
| « Photo réelle — ce que vous recevrez. » | selling |
| « Vendu par Aïcha » | selling |
| « PRIX » | money |
| « Livraison Séra en plus — affichée à part, jamais cachée. » | money |
| « Livré par Séra, à votre repère » | selling |
| « Paiement protégé — inspectez avant de payer » | money |
| « Vos protections » | money |
| « COMMANDER » | selling |
| « ÉPUISÉ » · « Ce produit est épuisé pour le moment. Revenez voir la boutique d'Aïcha — elle ajoute souvent de nouveaux articles. » | selling |

## C2 · Vos protections (sheet)

| String | Register |
|---|---|
| « VOS PROTECTIONS » | money |
| « Vous inspectez avant de payer » — « Ouvrez le colis à la porte. Prenez 2 à 4 minutes. Payez seulement si c'est bon. » | money |
| « Le remboursement n'est jamais bloqué » — « Un problème avéré, c'est un remboursement. Sans condition cachée, sans attente d'un fonds. » | money |
| « Votre numéro reste privé » — « Le livreur passe par un relais. Personne ne voit votre numéro. » | money |
| « Le code de remise fait foi » — « La remise n'existe que quand vous donnez votre code. C'est votre preuve. » | money |
| « COMPRIS » | neutral |

## C3 · La localisation

| String | Register |
|---|---|
| « OÙ LIVRER ? » | neutral |
| « Pas besoin d'adresse — ici, un bon repère vaut mieux. Le livreur connaît la ville. » | selling |
| « VOTRE ZONE » · « LE REPÈRE » · « OU DITES-LE DE VIVE VOIX » | neutral |
| placeholder « Ex. : Face à la pharmacie du marché » · « Indication en plus (facultatif) » | neutral |
| « ENREGISTRER LE REPÈRE » · « ARRÊTER » · « REFAIRE » | neutral |
| recording hint « Parlez comme au marché : “Face à la pharmacie, portail bleu.” » | selling |
| queued « Note vocale gardée. C'est noté — en attente du réseau. » | money |
| mic refused « Le micro n'est pas disponible. Écrivez le repère au-dessus — ça marche aussi bien. » | neutral |
| « Le livreur passe par un relais. Votre numéro reste privé. » | money |
| « CONTINUER » | neutral |

## C4 · La livraison

| String | Register |
|---|---|
| « LA LIVRAISON » · « MODIFIER » | neutral |
| « Le prix de la course est fixé par Séra. Il est affiché à part — jamais caché dans le prix du produit. » | money |
| « AUJOURD'HUI, AVANT 19 H » — « Un livreur Séra vérifie et scelle le colis avant de partir. » | selling |
| « DEMAIN, 9 H – 12 H » — « Course groupée dans votre zone — un peu moins chère. » *(gated on proposals.md §1)* | selling |
| « La course est payée à Séra. Chaque franc a sa place. » | money |

## C5 · Le paiement

| String | Register |
|---|---|
| « LE PAIEMENT » · « COMMENT PAYER ? » | neutral |
| « Livraison Séra — jamais cachée » | money |
| reconcile line « 12 500 = 11 500 + 1 000 — chaque franc a sa place. » | money |
| « TOUT PAYER MAINTENANT » — « 12 500 F maintenant, en sécurité. Rien à payer à la porte. » | money |
| « PAYER À LA LIVRAISON » — « 1 000 F maintenant — et 11 500 F à la porte, après votre inspection. » | money |
| B ineligible « Pas disponible pour cette commande. Vous pouvez tout payer maintenant, en sécurité — et toujours inspecter avant d'accepter. » | money |
| « ÉCOUTER LA NOTE » | neutral |
| quote « Vous inspectez le colis avant de payer le reste. » | money |
| CTA « PAYER 12 500 F » / « PAYER 1 000 F MAINTENANT » / disabled « CHOISISSEZ POUR CONTINUER » | money |
| « ORANGE MONEY · MOOV MONEY » | neutral |
| submitting « ENVOI SÉCURISÉ » — « Un instant. » — « Nous envoyons votre demande de paiement de 1 000 F à l'opérateur. » | money |
| provider wait « Confirmez sur votre téléphone » — « Composez votre code secret Orange Money pour valider 1 000 F. » — « En attente de la confirmation de l'opérateur… » — « Rien n'est confirmé tant que l'opérateur n'a pas répondu. Nous ne dirons jamais le contraire. » | money |

## C6 · La confirmation

| String | Register |
|---|---|
| « Commande enregistrée. » — « Paiement de 1 000 F confirmé par l'opérateur. » | money |
| next steps « Aïcha prépare votre commande » · « Séra vérifie et scelle le colis » · « Nous vous prévenons à chaque étape » | selling |
| pending « C'est noté. » — « En attente du réseau. Votre commande est gardée sur ce téléphone — elle part dès que le réseau revient. » — chip « EN ATTENTE — JAMAIS PERDUE » | money |
| offline « Hors ligne — rien n'est perdu. » — « Votre commande attend sur ce téléphone. Le paiement partira quand le réseau reviendra. Nous ne dirons jamais “payé” avant l'opérateur. » | money |
| « SUIVRE MA COMMANDE » | neutral |

## C7 · Le suivi

| String | Register |
|---|---|
| « LE SUIVI » · « CMD-2417 » | neutral |
| « Nous vous prévenons à chaque étape. Pas besoin de rester sur cette page. » | selling |
| steps: « Commande enregistrée » / « Préparée par la vendeuse » / « Vérifiée et scellée par Séra » / « En route » / « À votre porte » / « Remise » + one-line descriptions | neutral |
| step descriptions: « Nous avons bien reçu votre commande. » · « Aïcha prépare votre colis. » · « Le livreur contrôle le colis avant de partir. » · « Le colis est en chemin vers votre repère. » · « Inspectez avant de payer le reste. » · « Votre code fait foi. » | selling/money |
| chip « MAINTENANT » | neutral |
| problem banner « Problème signalé. Une personne s'en occupe. La commande reste protégée. » | money |
| « JE SUIS À LA PORTE » · « VOS PROTECTIONS » · « SIGNALER UN PROBLÈME » | neutral |
| footer « Pas de point GPS — des étapes claires, et nous vous prévenons. » | selling |

## C8 · À la porte

| String | Register |
|---|---|
| « À LA PORTE » | neutral |
| « Ouvrez. Vérifiez. Ensuite seulement, payez. » | money |
| « Prenez votre temps — 2 à 4 minutes, c'est votre droit. Le livreur attend. » | money |
| checklist « C'est le bon article — celui de la photo » · « La bonne taille — M » · « En bon état » | neutral |
| « Reste à payer, après inspection » | money |
| « TOUT EST BON » · « UN PROBLÈME » | neutral |
| « Les deux chemins se valent. Un refus justifié ne compte jamais contre vous. » | money |
| leg-2 « Payez le reste, en sécurité » — « Composez votre code secret Orange Money pour valider 11 500 F. » — « Le livreur ne peut pas dire “payé” à votre place. Seul l'opérateur confirme. » | money |
| report « Qu'est-ce qui ne va pas ? » — « Dites-le simplement. Vous ne payez rien de plus. » | money |
| reasons « Ce n'est pas le bon article » · « Il est abîmé » · « Il manque quelque chose » | neutral |
| resolution « Le colis repart avec le livreur. Vous ne payez rien de plus. La commande reste protégée. » — « C'EST NOTÉ » | money |

## C9 · Le code de remise

| String | Register |
|---|---|
| « LE CODE DE REMISE » · « VOTRE PREUVE » | money |
| hidden « Votre code apparaîtra ici dès que le paiement sera confirmé par l'opérateur. Jamais avant. » | money |
| « Ce code est votre preuve. » — « Donnez-le au livreur seulement au moment de la remise. Montrez-le, ou dites-le à voix haute. » | money |
| SMS mirror « Gardé aussi dans vos SMS — même sans réseau. » *(gated on proposals.md §3)* | money |

## B7 / S6 / R11 (celebration screens)

| String | Register |
|---|---|
| B7 « Commande payée. Préparez le colis — Séra viendra le chercher. » · « Le colis correspond à la photo » · « Fermé, prêt à partir » · « CONFIRMER : PRODUIT PRÊT » · « Produit prêt » · « Dès que c'est confirmé, Séra vient chercher le colis. » · « Avant ce soir 18 h. » | selling/money |
| S6 « VOTRE GAIN NET » · « PREMIÈRE VENTE ! » · « Robe brodée bogolan — livrée et validée » · « Règlement — sous 24 h » · « Votre gain net d'abord, toujours. Réglé après la livraison validée. » | money |
| R11 « Paiement confirmé par l'opérateur » · « CODE DE REMISE DE L'ACHETEUSE » · « VALIDER LE CODE » · « VALIDÉ » · « Course validée » · « La preuve est complète. Le colis est remis, la course est réglée. » · « L'acheteuse vous donne son code. C'est sa preuve — et la vôtre. » · « RETOUR À LA FILE » | money |

---

# Extension — les autres surfaces livrées

## S5 / Hub de partage (+ composeur, OG, vitrine)

| String | Register |
|---|---|
| « Votre prix : 11 500 F » · chip « + 2 000 F NET » | money |
| « ENVOYER LE LIEN » — « Le lien s'ouvre direct, avec l'aperçu du produit. » | selling |
| « PUBLIER UNE IMAGE » — « Pour Instagram, TikTok et le Statut — le lien vit dans votre bio. » | selling |
| « COPIER LE LIEN » / « LIEN COPIÉ » · « CODE : AÏCHA-4821 » · « écrit sur chaque carte » | neutral |
| « Collez le lien dans votre bio Instagram ou TikTok. Vos clientes vous retrouvent toujours — la vente vous revient. » | selling |
| « VOIR MA VITRINE COMME UNE CLIENTE » | selling |
| OG « CE QUE VERRA VOTRE CLIENTE » · « Votre lien est signé — la vente vous revient, toujours. » · « ENVOYER SUR WHATSAPP » | money/selling |
| banners « Partagé sur {canal}. La vente vous revient, toujours. » · « C'est noté. Le partage sur {canal} part dès que le réseau revient. » | selling/money |
| composeur « STORY 9:16 » · « CARRÉ 1:1 » · « AFFICHE » / « NUIT » · « 2 modèles, jamais générés » · « Ce que vos clientes verront — exactement. » · « CRÉER L'IMAGE » — « Rendue sur votre téléphone — rien n'est envoyé. » · « Carte prête — ≈ 40 Ko, rapide même en 3G. » · « PUBLIER SUR {canal} » / « METTRE EN STATUT » · « Votre carte est prête. Le partage part dès que le réseau revient. » · « Partage annulé. Votre carte reste enregistrée sur ce téléphone. » | selling/money |
| bio hint « Sur {canal}, le lien du post ne se clique pas. Mettez celui-ci dans votre bio — il est à vous pour toujours. » | selling |
| vitrine « CHEZ AÏCHA » · « Vendeuse vérifiée · Rood Woko, Ouagadougou » · « LIVRÉ PAR SÉRA » · « PAIEMENT PROTÉGÉ » · « Le paiement est protégé. Votre numéro reste privé. » | money |

## Boutik+ B4–B6 (le Studio → l'offre)

| String | Register |
|---|---|
| B4 « Pour vendre, il faut montrer. » — « Boutik+ utilise l'appareil photo seulement ici, pour vos produits. Rien d'autre. » · « AUTORISER L'APPAREIL PHOTO » · « PLUS TARD » | selling |
| B4 refusée « Pas d'appareil photo ? Pas grave. » — « Importez une photo depuis la galerie — ça marche aussi bien. » · « IMPORTER DE LA GALERIE » · « RÉESSAYER L'AUTORISATION » | selling |
| B4 guidage « Posez la robe bien à plat, en pleine lumière — rien autour. » · « Approchez sur la broderie et l'étiquette — c'est la preuve. » · « 1/2 · LA PHOTO HÉRO » · « 2/2 · LA PREUVE » · « TOUT LE PRODUIT DANS LE CADRE » · « LE DÉTAIL QUI PROUVE » | selling |
| B4 échec « La photo n'a pas pu être prise — réessayez. » | neutral |
| B5 « Ce que l'acheteur verra » — « Exactement ces images, exactement ces octets. Rien de retouché en route. » · « REPRENDRE » / « GARDER » · « Reprendre coûte le même geste que garder — c'est voulu. » · « La légende ci-dessus est celle que verra l'acheteur — votre nom n'y apparaît jamais. » | money/selling |
| B6 « VOUS RECEVREZ » (héros) — « Payé après livraison validée. Aucun dépôt, jamais. » · « VOTRE PRIX » · « LA PART DE LA REVENDEUSE » — « Une part motivante fait vendre plus vite. C'est vous qui décidez. » · « Frais de service (5 %) » · reconcile « 8 500 = 10 000 − 1 000 − 500 — chaque franc a sa place. » | money |
| B6 plancher « Le prix plancher des vêtements est 8 000 F — remontez un peu. C'est pour protéger la valeur de votre travail. » | money |
| B6 v2 « Version 2 de votre offre. La v1 reste servie tant que la v2 n'est pas validée. » · « PUBLIER L'OFFRE » | money |
| B7 files d'attente « Envoyé — en attente de confirmation. Le réseau est lent, rien n'est perdu. » · « C'est noté. En attente du réseau — votre confirmation partira toute seule. » | money |

## Shop+ S2 (+ S6 compléments)

| String | Register |
|---|---|
| « VOUS GAGNEZ + 2 000 F NET » (première ligne de chaque carte) · « Prix conseillé : 11 500 F — livré par Séra » · « AJOUTER » / « AJOUTÉ ✓ » / « ÉPUISÉ » | money |
| « Le net que vous voyez est déjà votre part — rien à calculer. » | money |
| skeleton « Le catalogue arrive — même taille, même place, rien ne saute. » | neutral |
| vide « Rien dans cette catégorie — pour l'instant. » — « Le catalogue grandit chaque semaine. Regardez une autre catégorie, ou revenez demain. » · « VOIR TOUT LE CATALOGUE » | selling |
| hors ligne « Hors ligne : le catalogue affiché est celui d'hier soir. » | money |
| S6 zéro « Votre première vente arrive. » — « Choisissez un produit, ajoutez votre marge, partagez votre lien. C'est tout — Séra et le paiement protégé font le reste. » · « 0 F aujourd'hui, c'est juste le point de départ. » · « CHOISIR UN PRODUIT » | selling |
| S6 « Réglé, sur votre compte » · « En attente — livraison validée » · reconcile « 6 040 = 4 040 + 2 000 — chaque franc a sa place. » · « Versement Orange Money en cours — sous 24 h. Nous vous prévenons quand c'est déposé. » · chips « RÉGLÉ » / « EN ATTENTE » | money |

## Séra R4–R6

| String | Register |
|---|---|
| R4 « LIVRAISON — Un seul arrêt. Rien d'autre à penser. » · « LE REPÈRE » · « LES INDICATIONS » · « ÉCOUTER LES INDICATIONS » · « APPELER — NUMÉRO MASQUÉ » — « Le relais protège votre numéro et le sien. » · « RELAIS EN COURS… Les deux numéros restent privés. » · « RACCROCHER » · « JE SUIS ARRIVÉ » · « Pas de point GPS sur vous — seulement les étapes. » | money/neutral |
| R5 « Vérifiez ce qui se voit. » — « L'objectif seulement — jamais la qualité, jamais l'authenticité. Ce n'est pas votre travail, et c'est voulu. » · « {n} / 7 vérifiés — prenez le temps qu'il faut. » · « Quelque chose ne correspond pas. Le colis ne partira pas — et c'est le bon réflexe. » · « LE COLIS NE PART PAS » · « TOUT EST CONFORME — SCELLER » · « Scellé — SC-77 412 » — « La garde commence maintenant. Pas une seconde avant. » | money |
| R6 « Le colis ne part pas. » — « Le vendeur va corriger. La commande reste protégée. Dites simplement pourquoi. » · motifs « Article différent de la commande » · « Modèle ou couleur différents » · « Taille différente » · « Il manque des pièces » · « Dégât visible » · « Ajouter une photo du problème » — « La photo va au bureau des exceptions — elle protège tout le monde, vous compris. » · « CONFIRMER LE REFUS » · « Refus enregistré. » · « Motif : {motif}. Le colis reste chez le vendeur — vous n'avez jamais eu la garde. » · « Vous repartez — la course revient dans la file » · « Refuser bien, c'est protéger tout le monde — vous d'abord. » | money |

## Consoles (D4 + Ops) — registre `money` partout (moments de confiance)

« LA FILE — PLUS ANCIEN D'ABORD » · « Une commande non financée n'apparaît jamais ici — elle n'est pas dans la pièce. » · « GARDE : … — la garde prime sur le statut » · « LE CONSTAT — STRUCTURÉ, JAMAIS LIBRE » · « ATTENDU / TROUVÉ » · « L'ISSUE — UNE SEULE, EXPLICITE » · « APPLIQUER L'ISSUE » — « Appliquée une fois, journalisée pour toujours. Personne ne “corrige” en silence. » · « RÉSOLU — {issue} » · « File vide. Tout est à sa place. » — « Le calme est un résultat, pas une absence. » · SOS « Réponse en route. Tout le reste attend. » / « PRIS EN CHARGE » ·· Ops : « Aucune édition du registre n'existe ici — seulement des commandes journalisées. » · « LA FAUTE — ELLE DÉCIDE QUI PAIE » · « Faute vendeur → le Fonds rembourse l'acheteuse. Le solde du vendeur n'est JAMAIS débité. » · « MOITIÉ 1 — ÉMISE PAR / MOITIÉ 2 — VÉRIFIÉE PAR » · « Vous tenez déjà l'autre moitié. Une deuxième personne doit vérifier — c'est la règle de fer, pas une option. » · « La commande s'applique toute seule quand les deux moitiés sont signées par deux personnes différentes. Il n'existe pas de bouton “appliquer” — c'est voulu. » · « Solvable. Et même à zéro, le remboursement d'une acheteuse part quand même — c'est la loi. » · interrupteurs « Chaque capacité se coupe sans déploiement — jamais sans trace. » / « Tapez le nom exact de la capacité pour couper » / « COUPER » · journal « Il n'existe aucun état “modifier” à dessiner — c'est le principe. »

## Le Cercle (gated — design-ahead)

« PORTE FERMÉE — DESIGN-AHEAD (§7.7.1) » · « 34 clientes ont dit oui — elles choisissent, elles peuvent partir quand elles veulent, jamais plus de 2 messages par semaine. » (selling) · « Le consentement n'est pas un piège. » · recettes « PRIX DOUX » / « LIVRAISON OFFERTE » / « LA RECETTE QUARTIER » — « Une zone, un créneau : les commandes se groupent, la tournée se remplit — votre argent achète de la densité Séra. » (selling) · « Plafond : 2 000 F par commande — 80 % de (C + M). Au-delà, votre gain deviendrait négatif : la loi l'interdit. » (money) · « Au plafond, vous ne gagnez rien sur ces commandes. C'est permis — mais c'est votre choix, en pleine lumière. » (money) · « BUDGET TOTAL — DEPUIS VOS GAINS RÉGLÉS » — « L'argent en attente ne peut jamais servir — c'est la loi. » (money) · aperçu « VOUS DÉPENSEZ / VOUS GARDEZ » · « au maximum, réglés seulement » / « au moins, jamais négatif » · « Séra reçoit toujours 1 000 F par course : {part cliente} + {part campagne}. » · « LIVRAISON 100 % OFFERTE ⇒ TOUT PRÉPAYÉ » · « Une seule offre par commande. » (money) · parrainage « UN SEUL NIVEAU, POUR TOUJOURS. Pas d'arbre. Pas d'équipe. Pas de revenu sur le réseau. Ce n'est pas une fonctionnalité manquante — c'est un refus définitif. » (money) · reporting « Nous disons “attribué” — jamais “généré”. Nous ne réclamons que ce que nous pouvons prouver. » (money)
