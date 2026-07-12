# FLOWS — the buyer journey (PWA)
### Screens, edges, and what each edge can produce · v1.0.0

Every failure edge is a designed state (see prototype), never a generic error.

## The golden path

```
C1 Produit ──COMMANDER──▶ C3 Repère ──CONTINUER──▶ C4 Livraison ──CONTINUER──▶ C5 Paiement
   │ ▲                                                                            │
   │ └───────────────◀ retour (chevron) at every step ◀──────────────────────────┘
   └──« Vos protections » / shield ──▶ C2 Sheet (also reachable from C7)

C5 ──PAYER──▶ [envoi sécurisé] ──▶ [attente opérateur] ──▶ C6 Confirmée ──▶ C7 Suivi (étapes 1→5)
C7 (étape 5) ──JE SUIS À LA PORTE──▶ C8 Inspection ──TOUT EST BON──▶ (B: paiement du reste
        ──▶ attente opérateur) ──▶ C9 Code révélé  ·  (A: directement) ──▶ C9 Code révélé
```

## Edges and their outcomes

| From | Edge | Outcomes (all designed) |
|---|---|---|
| C1 | COMMANDER | → C3 · **épuisé**: CTA disabled, honest note · **hors ligne**: proceeds; honesty lands at C6 |
| C3 | zone / repère / voice | zone picked · repère filled · **recording → recorded** · **mic refused** → text fallback (never a wall) · **offline** → voice queued « en attente du réseau » |
| C3 | CONTINUER | gated until zone + (repère **or** voice note) — disabled state visible, never scolds |
| C4 | pick window | quote options (Séra sole authority) → selected (accent edge) |
| C5 | pick A/B | A selected · B selected · **B ineligible** → one dignified line, A remains |
| C5 | PAYER | **offline** → C6 offline (« rien n'est perdu », no payment claim) · online → envoi (≤ ~1 s) → **attente opérateur** (honest wait; USSD push) → C6 confirmée · *(provider timeout/refusal: same wait card resolves to a « l'opérateur n'a pas confirmé » state — copy pending, see proposals.md §5)* |
| C6 | SUIVRE | → C7 étape 1 · pending-network and offline variants keep full honesty (no check, no « confirmé ») |
| C7 | steps 1–6 | server-driven; **never a GPS dot** · **problème** banner state · offline keeps cached steps + banner |
| C7 | SIGNALER UN PROBLÈME | equal prominence with the happy path, always visible |
| C8 | TOUT EST BON | **A**: → C9 revealed · **B**: leg-2 provider wait → C9 revealed (code only after provider confirms) |
| C8 | UN PROBLÈME | reason picker (3 structured reasons) → resolution promise (« vous ne payez rien de plus ») → C'EST NOTÉ → C7 with problem banner. Refusal is as polished as acceptance. |
| C9 | — | **hidden** until provider-confirmed; then hero code. Terminal. |

## Money truth along the flow

- Delivery (D) enters at C4 as its own line and never merges into the product price.
- Totals recompute live if the window changes (11 500 + 1 000 = 12 500 · 11 500 + 800 = 12 300) and the reconcile line restates the sum on C5.
- Amount paid now vs at the door is bold in **both** payment options, the CTA, the provider waits, and C8's « Reste à payer ».
- The drop code appears **last**, in exactly one place, after provider confirmation. No screen ever claims payment before the operator.

## Boutik+ — publier & préparer (B4→B7, prototyped)

```
B4 Studio (permission → cadrage héro → capture → cadrage preuve → capture) ──▶ B5 Aperçu WYSIWYG
   ├ permission refusée → import galerie (repli honnête, mêmes guides)
   └ échec capture → bandeau « réessayez », shutter reste
B5 ──GARDER──▶ B6 Offre ──PUBLIER──▶ [offre en ligne]     B5 ──REPRENDRE──▶ B4 (même coût de geste)
B6 : net recalculé en direct (count-up ≤600 ms) · sous le plancher (8 000 F) → CTA bloqué, refus gentil · re-offre v2 (v1 servie jusqu'à validation)
[commande payée] ──▶ B7 Produit prêt ──CONFIRMER (checklist gate)──▶ envoi → confirmé + célébration #1
   ├ hors ligne → file « C'est noté » (pas de célébration avant confirmation)
   └ réseau lent → « envoyé — en attente »
```

## Shop+ — vendre & encaisser (S2/S6, prototyped)

```
S2 Opportunités (squelette exact → liste) ──AJOUTER──▶ [dans ma vitrine] ──(tab Partager)──▶ Hub §7.2.1
   ├ filtre sans résultat → vide digne → « voir tout »   ├ épuisé → carte muette, jamais cliquable
   └ hors ligne → catalogue d'hier, annoncé
[livraison validée] ──▶ S6 Gains : première vente (count-up + célébration #2) → gains (réglé vs en attente, réconcilié) → versement sous 24 h
```

## Hub de partage (S5, prototyped — build réel bloqué sur proposals.md §4)

```
S5 Hub ──WhatsApp/Facebook/Snapchat/SMS──▶ fiche OG (« ce que verra votre cliente ») ──ENVOYER──▶ partagé
   ├ hors ligne → « le partage part dès que le réseau revient »   └ COPIER LE LIEN → copié
S5 ──Instagram/TikTok/Statut──▶ Composeur (format 9:16|1:1 → modèle affiche|nuit) ──CRÉER──▶ rendu (sur l'appareil) → carte prête (≈40 Ko)
   ──PUBLIER──▶ partagé · hors ligne → carte en attente · annulé → carte gardée
Attribution IG/TikTok : vitrine (bio) + code AÏCHA-4821 — la vente lui revient. Vitrine = surface acheteuse (lois §8).
```

## Séra — ramassage → remise (R4–R6 prototyped ; R11 célébration)

```
R4 Repère (zone → repère → indications → voix · appel relais masqué) ──ARRIVÉ──▶ R5 Vérification bornée (7 points objectifs)
R5 tout conforme ──SCELLER──▶ garde commence (SC-…) → en route → [R8/R9/R10 à dessiner] → R11 Course validée (célébration #3)
R5 un ✗ ──▶ R6 Refus digne (motif structuré + photo preuve) ──CONFIRMER──▶ refus enregistré → la course revient dans la file
   └ hors ligne → refus en file, jamais perdu          Chaque refus/échec alimente D4 avec raison + preuves.
```

## Dispatch D4 + Ops (prototyped)

```
[échec structuré + preuves] ──▶ D4 file (plus ancien d'abord ; attente >2–4 min = signal ; SOS gèle tout)
D4 exception ouverte (garde > statut · ATTENDU/TROUVÉ · constat) ──une issue explicite──▶ journal append-only → suivante → file vide (calme)
Ops réclamation : faute → qui paie (vendeur→Fonds, jamais son solde) ──ÉMISE (paiements)──▶ ──VÉRIFIÉE (dispatch, autre humain)──▶ s'applique seule + journal
   └ même main sur les deux moitiés → refus UI. Interrupteurs : nom tapé → coupé sans déploiement, journalisé.
```

## Le Cercle (gated — design-ahead, aucune arête n'est un ordre de travail)

```
Accueil ──▶ geste 1 recette (doux | livraison | Quartier zone+créneau) ──▶ geste 2 produit ──▶ geste 3 budget (K ≤ 2 000 = 0,80×(C+M) ; gains réglés seulement)
──▶ L'APERÇU SACRÉ (dépensez/gardez, Séra entière, FULL_PREPAY si 100 %) ──LANCER──▶ reporting « attribué » (validées seulement)
Parrainage : un niveau, une fois — aucun arbre possible.
```

## Écrans restants à dessiner (aucun flux ne les invente)

Boutik+ B1–B3, B8–B11 · Shop+ S1, S3, S4, S7, S8 · Séra R1–R3, R7 (écran dédié), R8–R10, R12–R14 · Dispatch D1–D3, D5 · Ops bureaux 3–6 · Cercle : membres, vitrine publique. Leurs arêtes rejoindront ce fichier avec leurs maquettes.
