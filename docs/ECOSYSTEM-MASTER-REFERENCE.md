# THE ECOSYSTEM — MASTER REFERENCE
### Boutik+ × Shop+ × Séra · how each app is, and how each app works
**Purpose:** the single place where the whole system is explained end-to-end — piece by piece, option by option, flow by flow. Every rule here traces to canon (the three Build Specs, the three Building Plans, the Execution Contract). Where something is **gated** or **undecided**, it says so.

---

# PART 0 — THE WHOLE THING IN ONE PAGE

**The business, plainly.** A supplier in Ouagadougou has goods but no customers. A young woman has customers — her WhatsApp, her quartier, her clientes — but no goods and no capital. A buyer wants to order without being cheated. Nobody trusts anybody, and there are no street addresses.

The ecosystem resolves all four problems at once:

| App | Who it serves | What it manufactures | The one sentence |
|---|---|---|---|
| **Boutik+** | Suppliers (and, gated, the platform's own PackLab stock) | **Trust in supply** | *Publish truthfully, prepare honestly, get paid after validated delivery — with no deposit, ever.* |
| **Shop+** | Resellers **and** buyers | **Demand** | *Sell without stock: add your markup, share your link, keep your net.* |
| **Séra** | Riders + dispatch (employed fleet) | **Proof** | *Verify, seal, carry, hand over only when the money is confirmed.* |

**But three apps is not three surfaces. There are six** — and two of them are internal, which is exactly why they are the ones people forget to design:

| # | Surface | Ships from | Who uses it | Covered in |
|---|---|---|---|---|
| 1 | **Boutik+ supplier app** | `boutik-plus` | Suppliers | Part 4 |
| 2 | **Shop+ reseller app** | `shop-plus` | Resellers | Part 5 |
| 3 | **The client PWA** *(no install, no account)* | `shop-plus` | **Buyers** | **Part 6** |
| 4 | **Séra rider app** | `sera` | Riders | Part 7 |
| 5 | **The dispatch console** | `sera` | **Dispatchers** | **Part 8** |
| 6 | **The platform Ops console** | ⚠ *no home yet — decision open* | **Ops, risk, finance, moderation** | **Part 9** |

**The client and the two internal surfaces are not afterthoughts.** The client is the only participant with no account and no relationship with the platform — she must be won cold, in five seconds. And the dispatcher and the ops operator are the two humans standing between a clean ledger and a silent disaster.

**The chain, compressed:** Boutik+ holds the product truth → Shop+ turns it into a reseller's offer and a buyer's checkout → the buyer pays through a licensed provider → Séra verifies at pickup, seals, carries, and hands over only after payment is authoritatively confirmed → the buyer's drop code closes the loop → the ledger settles everyone.

**The three non-negotiables that make it work:**
1. **No app ever holds money.** The licensed provider does. Webhooks are the only payment truth.
2. **Custody is never assumed — it is verified, sealed, and transferred.** Never before the money is confirmed.
3. **Every franc reconciles.** `11 500 = 8 500 + 2 000 + 1 000` on the baseline order, always, everywhere.

---

# PART 1 — THE FOUR PLANES (who rules what)

Every feature request in this ecosystem is answered by one question: *which plane is this on, and does it respect that plane's ruler?*

| Plane | Ruler | What that means concretely |
|---|---|---|
| **Supply** | **The supplier, fully** | Base price (B), commission (C), stock, readiness, restocking, withdrawal. Boutik+ is their instrument. |
| **Demand** | **The reseller, fully** | Markup (M), storefront, campaigns, customer relationships, promotions. Shop+ is her instrument. Suppliers hold **no demand levers**. |
| **Custody** | **The platform executes — everyone sees** | No participant has physical levers over goods in transit. Radical transparency instead: verification, seals, timestamps, photo proof. |
| **Money** | **Rules — nobody's discretion** | A deterministic waterfall. No VIP early release. No manual "just this once." Predictability *is* the product. |

**The single-channel rule (B+I-15):** suppliers **never sell directly to buyers**. Resellers are the only consumer channel. Even PackLab (the platform's own stock) is a *supply mode*, not a storefront. This is what makes the reseller's business real — she is not a middleman the platform can route around.

**Repo topology (locked):** three separate apps, three repos, three deployables — `boutik-plus`, `shop-plus`, `sera` — plus a fourth shared repo **`platform-contracts`** (shapes, events, kernel, i18n catalog + French copy-lint, design tokens), consumed by all three as a pinned versioned package with a CI drift-check. Never one unified app.

---

# PART 2 — THE MONEY (the spine, franc by franc)

## 2.1 The five variables

| Symbol | Name | Who sets it | Visible to buyer? |
|---|---|---|---|
| **B** | Seller base price | Supplier (Boutik+) | No — folded into the price |
| **C** | Seller-funded reseller commission | Supplier (Boutik+) | **Never** — showing C to a buyer is a violation (SP-I03) |
| **M** | Reseller markup | Reseller (Shop+) | No — folded into the price |
| **D** | Delivery fee | **Séra alone** (`DeliveryFeeQuote`) | Yes, as a separate line |
| — | Fees | Platform (fixed) | No |

## 2.2 The waterfall (NORMATIVE — identical in all three specs)

```
productSubtotal = B + M
buyerTotal      = B + M + D
sellerFee       = 0.05 × B
sellerNet       = B − C − (0.05 × B)
resellerNet     = 0.80 × (C + M)
platformRevenue = (0.05 × B) + (0.20 × (C + M))
```

**Two rules that stop most disasters:**
- **C is never added to the buyer's price a second time.** The commission comes *out of the supplier's margin*, not on top of the buyer. A supplier raising C is *hiring reseller energy with his own money*.
- **D (delivery) is outside every fee base.** The platform takes no percentage of Séra's funding. Séra is funded to the franc — never more, never less.

## 2.3 The canonical baseline (memorize this; it is the reconciliation test)

| Line | Value |
|---|---|
| Seller base (B) | 10 000 FCFA |
| Seller commission (C) | 1 000 FCFA |
| Reseller markup (M) | 1 500 FCFA |
| Delivery (D) | 1 000 FCFA |
| **Buyer product subtotal (B+M)** | **11 500 FCFA** |
| **Buyer total (B+M+D)** | **12 500 FCFA** |
| Seller fee (5% × B) | 500 FCFA |
| **Seller net (B − C − fee)** | **8 500 FCFA** |
| Reseller gross (C+M) | 2 500 FCFA |
| Reseller fee (20% × gross) | 500 FCFA |
| **Reseller net** | **2 000 FCFA** |
| **Platform revenue** | **1 000 FCFA** |
| **Séra funding** | **1 000 FCFA** |

**The reconciliation:** `11 500 = 8 500 + 2 000 + 1 000` ✓ (product side) — and the delivery leg `1 000` sits beside it, untouched by fees. If any screen, any test, any ledger entry fails this identity, the build is broken. This is a CI gate in all three repos.

## 2.4 What the reseller sees — **net, always** (SP-I04, SP-I12)

She sees **2 000 FCFA**, never "2 500 FCFA gross (minus fees)". Gross-first display is *prohibited*. The 20% fee is real from launch and shown honestly. **Rationale:** a reseller who discovers a fee after the sale never trusts the platform again.

## 2.5 The two payment options (this is the buyer's real choice)

`paymentMode ∈ {FULL_PREPAY, DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR}`

### **Option A — FULL_PREPAY**
- Buyer pays **12 500 FCFA now** (product + delivery), held at the licensed provider.
- Available to **everyone, always**. The only option for provisional sellers.
- At the door: buyer inspects, accepts, gives the drop code. No money moves at the door.

### **Option B — DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR** *(the trust-builder)*
- Buyer pays **1 000 FCFA delivery now**; pays **11 500 FCFA product at the door**, after inspecting.
- Option B is available only when **all five** hold: seller tier ≥ **verified** · category **inspectable** · order ≤ the price cap (pilot ~25 000 FCFA) · **network-reliable zone** · `PayAtDoorEligibility.state = allowed`.
- **The hard rule (SE-I11):** custody does **not** transfer until the door payment is **authoritatively confirmed by the provider**. Not the rider's word. Not a screenshot. The webhook.
- **Why it exists:** in a market where nobody trusts a stranger's link, "you pay when you see it" is the single most powerful conversion lever available — and it is *safe* only because the custody chain makes it safe.

### The one derived rule (Cercle-related, gated)
**A campaign that makes delivery fully free (customer pays 0 FCFA) forces FULL_PREPAY.** Otherwise a buyer could summon a rider at zero personal cost and refuse at the door — free sabotage. (SP-I16)

## 2.6 Who never touches money
- **Boutik+:** no wallet, no balance, no withdrawal button. It *reads* `SettlementObligation` and shows it.
- **Shop+:** same. Earnings are *projections of the ledger*, never a live recomputation (SP-I04).
- **Séra (SE-I09):** never computes proceeds, never holds product funds, never marks anything paid. Rider wages are a **workforce cost**, not a slice of customer money.
- **The provider** holds the funds. Its **webhook is the only payment truth** in the system.

## 2.7 Seller economics — the promise that wins suppliers
- **Zero deposit. Zero caution. Zero reserve. Ever.** (B+I-12) No field, no flow, no exception.
- **Seller-fault losses do not debit the seller** — the **Protection Fund** absorbs them (capitalized *before* launch, not from float).
- **Buyer refunds are never gated on the fund's solvency** (B+I-13). A buyer owed money gets it, period.
- Trust tiers: **provisional → verified → trusted**, earned by evidence, unlocking Option B and higher limits.

---

# PART 3 — THE CUSTODY CHAIN (the trust spine)

## 3.1 The four secrets (never substitutable, never combined)

| Secret | Held by | Proves |
|---|---|---|
| **Readiness challenge** | Supplier → server | The package is genuinely prepared |
| **Pickup verification** | Rider, at the supplier | The goods objectively match the locked order |
| **`HandoffAuthorization`** | the signed handoff authorization (Option B door confirmation / break-glass) | never substitutable — a rider's word is not payment truth |
| **`buyerDropCode`** | The buyer alone | The buyer actually received it |

The custody seal is an openly recorded artifact (`custodySealId`) — essential, but not a secret; it lives in the custody chain, not this table.

**The law that prevents the biggest fraud:** the **`buyerDropCode` NEVER appears in readiness evidence** — a supplier must not be able to manufacture proof of a delivery that never happened. This is a CI gate.

## 3.2 The sequence (SE-I05 — verify → seal → custody)

```
Funded per mode  →  provider hold  →  stock reserved  →  SUPPLIER READINESS confirmed
   →  DISPATCH (single lease, one assignment authority — SE-I01)
   →  RIDER PICKUP VERIFICATION  (objective conformity only — SE-I12)
   →  CUSTODY SEAL registered    →  CUSTODY BEGINS  (never before)
   →  TRANSIT (one current stop — SE-I03; exactly one custodian — SE-I04)
   →  ARRIVAL + BUYER INSPECTION (category rules, dwell 2–4 min)
   →  [Option B: buyer pays product → PROVIDER CONFIRMS → HandoffAuthorization]
   →  CUSTODY → CUSTOMER      (buyerDropCode entered LAST)
   →  ValidationDecision      →  settlement becomes eligible
```

## 3.3 What a rider may and may not verify (SE-I12 — this bounds the whole liability model)

**MAY verify (objective, observable):** order reference · variant/colour/size label · quantity · piece count · visible damage · manufacturer seal intact.
**MAY NOT verify:** authenticity · quality · hidden defects · performance · ingredients · warranty.

**Why this line matters:** a rider who "verifies quality" would make Séra liable for every fake handbag in Burkina Faso. A rider who verifies *conformity* makes the supplier liable for what's inside the sealed package — which is exactly right, and is what makes seal-after-verification a coherent liability boundary.

## 3.4 Evidence supports; it never releases (SE-I06, SE-I07)
A photo, a GPS ping, a rider's declaration — **none of these release money**. They are *supporting evidence* attached to a decision made by the server against an authoritative payment fact. Location is never proof on its own. Offline evidence may queue, but **custody validation and financial release stay pending until the server acknowledges**.

## 3.5 Fault classes — who pays when it breaks

| Fault | Who absorbs the cost | Mechanism |
|---|---|---|
| **Seller fault** (not ready, mismatch at pickup) | **Protection Fund** — *never the seller's balance* | `faultClass = seller` claim |
| **Séra fault** (loss, damage in custody) | **Séra** | `CustodyLiabilityClaim` — a *separate* instrument, not the fund |
| **Buyer fault** (refusal on a whim, no-show) | **The buyer** forfeits the delivery fee | Refusal ladder + `PayAtDoorEligibility` |
| **Provider fault** | The provider arrangement | Reconciliation case |
| **Platform/system fault** | Platform loss account | — |

**The reseller never loses money because another participant failed.** That principle is load-bearing for reseller retention.

---

# PART 4 — BOUTIK+ (the supply app)

**Repo:** `boutik-plus` · **User:** the supplier (a wholesaler, a boutique owner, a workshop) · **Promise:** *« Vendez sans dépôt, sans caution. Vous êtes payé dès que la livraison est confirmée. »*

**What Boutik+ is:** a supplier's instrument for publishing truth and preparing packages. **What it is not:** a storefront, a wallet, a chat app, or a place where a supplier can reach a buyer.

## B+1 — Onboarding & verification *(flow)*

**Screens:** identity → phone (WhatsApp reverse-handshake) → business facts → zone/landmark → payout account → agreement.

**Options at the decision points:**
- **Payout destination:** Mobile Money account in the supplier's verified name. *(No internal balance exists to choose from — money leaves the provider and lands on his MoMo.)*
- **Trust tier — not chosen, earned:** starts **provisional**.

| Tier | How you get there | What it unlocks |
|---|---|---|
| **Provisional** | Sign up (free) | 1 active order at a time · approved categories only · **buyer must FULL_PREPAY** · mandatory readiness photo · rider verifies every pickup |
| **Verified** | Clean validated deliveries, no unresolved disputes | **Option B enabled for his products** · more concurrent orders |
| **Trusted** | Sustained performance | Highest limits, lightest friction |

**The zero-deposit law (B+I-12):** no screen ever asks for money. No "caution", no "reserve", no "guarantee". If a future feature needs one, the feature is wrong.

## B+2 — Boutik+ Studio *(the trust factory)*

Guided capture: hero shot, detail shots, scale reference, defect honesty. **Deterministic imaging only (B+I-11): no generative AI, ever.** Crop, rotate, straighten, background clean-up — yes. Inventing pixels — never.

- **B+I-02:** product images are **price-free and supplier-contact-free**. A phone number in a photo would let a reseller be routed around; it fails moderation.
- **B+I-08:** originals are private and immutable; edits create **versioned derivatives**.
- **B+I-09:** "proof of access" claims are described honestly — *never* presented as proof of ownership, authenticity, or current quantity.

## B+3 — Product / variant / moderation

**B+I-01:** a product goes live only with approved facts + ≥1 active variant + an approved price-free canonical hero. *(abridged — the complete five-condition text lives in the Boutik+ spec)*
**Moderation states:** draft → submitted → changes-requested (with *specific* reasons) → approved → paused → retired.

## B+4 — Offer & commission *(where the supplier's real power lives)*

The supplier sets **B** and **C**, and sees the whole waterfall before committing:

> *Prix de base 10 000 · Commission revendeuse 1 000 · Frais Boutik+ 500 · **Votre net : 8 500 FCFA***

**Options:** raise C to attract more resellers (it costs *his* margin, not the buyer's price) · lower C to protect margin · change either at will.

**B+I-04 (forward-only):** an offer change creates a **new version**. It **never** touches an accepted quote or a confirmed order — in either direction. A reseller who advertised a price yesterday is never betrayed today.

## B+5 — Inventory & stock truth
**B+I-03:** every active variant maps to ≥1 active inventory pool. Reservations are server-side and concurrency-safe (no overselling). Stock-out **auto-pauses** downstream offers and (when gated Cercle exists) campaigns.

## B+6 — Fulfillment & package readiness *(the first secret)*

**Flow:** funded order arrives → supplier prepares → **confirms "Produit prêt"** with readiness evidence (photo + challenge response) → the order becomes dispatchable.

**B+I-06:** Séra is **not** called until readiness is confirmed. A rider sent to a supplier who hasn't packed is a wasted trip charged to nobody — so it must not happen.
**The forbidden shortcut:** readiness evidence **must never contain the `buyerDropCode`**.

## B+7 — Séra pickup handoff (seal-after-verification) *(the moment custody is born)*

**B+I-07:** the supplier **cannot mark custody transferred**. He hands over; the *rider verifies*; the *seal registers*; the **Custody Service** — not the supplier, not the rider — declares custody begun.
**B+I-14:** for a **provisional** seller, no rider takes custody until the product is verified against the locked order. (Verification is bounded per SE-I12 — conformity, not quality.)

## B+8 — Supplier proceeds & statements

- Shows `SettlementObligation`, read-only. **No withdrawal button. No balance.**
- **Payout: same/next-day after validated acceptance**, with a provider-confirmed reference before it reads *Paid*.
- **B+I-05:** the receivable shown equals the **locked ledger obligation** (`sellerNet`) — never a live recomputation that might drift.
- **Seller-fault losses do not debit him.** He sees the fault, the consequence, and his tier — but the fund absorbs the money.

## B+9 — PackLab *(BUILD-GATED — see Part 12)*
The platform's own `PLATFORM_OWNED` composite packs: BOM over shared components, hub kitting (kit → QC → seal-at-kitting), three recede ceilings, Restock Law, pack covenant. **Not in scope until its gate opens.**

## What Boutik+ must NEVER do
Hold funds · compute another domain's amounts · sell directly to a buyer · expose contact details to a reseller or buyer · mark custody transferred · demand a deposit · use generative AI on imagery.

---

# PART 5 — SHOP+ (the demand app — two faces)

**Repo:** `shop-plus` · **Users:** the reseller (app) **and** the buyer (PWA, no install) · **Promise:** *« Gagnez sans acheter de stock. Votre boutique, vos clientes — et votre gain net toujours affiché avant de partager. »*

---

## 5A — THE RESELLER FACE

### SP1 — Activation & payout readiness
**Activation = payout-ready + ≥1 commission agreement + ≥1 listing + ≥1 shared link.** (Anything less is a signup, not a business.) No stock purchase, no fee, no recruitment.

### SP2 — Opportunity discovery *(« Opportunités »)*
Every product card leads with **her net earning**, not the price.

> Robe wax · Prix client **11 500 FCFA** · **Vous gagnez 2 000 FCFA net**

**Options per product:** choose it · adjust markup (M) · see the seller's tier and reliability · see stock · see delivery eligibility.
**SP-I05:** discovery returns **reseller stores, not a cross-reseller product pool** — the platform never turns her customers into a commodity pool other resellers can fish in.
**SP-I03:** she sees a *product*, never the supplier's identity or contact. (One bounded exception exists — the diaspora **Enseigne** trust projection — and it is out of scope for now.)

### SP3 — Listing & storefront *(« Ma vitrine »)*
She adds the product to her storefront with **her markup**. Her store is *hers*: name, banner, her products, her link.
**SP-I02:** a listing must reference an active product version + active commission agreement + eligible offer version. **Markup is versioned and forward-only** — changing M never rewrites a live order.

### SP4 — Marketing studio *(+ the PackLab Media Kit, gated)*
Generates from **price-free canonical assets**: WhatsApp status card · Facebook post · story · QR poster · **customer card showing her price and her CTA — and never the commission**.
**SP-I08:** she may add lifestyle context, but **canonical product assets cannot be replaced** by her own product photos. (Truth in supply is not hers to override.)

### SP5 — Attribution *(the mechanism her whole income rests on)*
**SP-I09:** every share link encodes a **signed attribution-token identity**.
**SP-I01:** every confirmed order carries **exactly one `reseller_id`**, locked at confirmation from a qualified attribution or the storefront used at checkout.
**Tamper → fails closed.** A broken token never pays a random reseller; it pays nobody and raises an alert.

### SP7 — Sales workspace
Her orders, their real state (funded → ready → picked up → in transit → delivered → paid), the customer's masked contact, the problem path as prominent as the happy path.
**SP-I07:** customer tools are **relationship- and consent-scoped**. Other resellers' orders are invisible to her, and hers to them.

### SP8 — Earnings & reputation
**Net-first, always** (SP-I04, SP-I12). States: Projected → Locked → Eligible → Payable → Processing → Paid (plus Held / Adjusted).
**Réputation = le nombre de ventes livrées** (founder ruling 2026-07-15): an **exact count**, never a rank/score/comparison — sourced from `delivery.validated.v1` attributed via the locked `Order.resellerId` (SP-I01), rendered **« N ventes livrées »**, shown from the first delivered sale (floor 1, founder-overridable), deterministic and explainable. See `docs/derivations/REPUTATION-LAW.md`.
**SP-I06:** earnings are **single-level**. No recruitment, no downline, no team bonus, no "build your network". Not a feature we lack — a feature we refuse.

### SP9 — Cercle *(BUILD-GATED — Part 12)*

---

## 5B — The client surface lives in Shop+, but it is its own component
The buyer PWA (**SP6**) ships from the `shop-plus` repo — but it is not a sub-screen of the reseller app. It has its own users, its own trust job, its own design language, and its own failure behavior. **It gets its own part: see Part 6.**

---

# PART 6 — THE CLIENT SURFACE (the buyer PWA — a component in its own right)

**Ships from:** `shop-plus` (SP6) · **User:** *la cliente* — a woman in Ouagadougou who tapped a link in WhatsApp · **Install:** **never**

## 6.1 Why the client is its own component

Every other participant has an account, an app, and a relationship with the platform. **The client has none of those.** She has a relationship with *Aïcha*. She arrives cold, from a WhatsApp status, on a borrowed-feeling web page, about to consider giving money to a stranger's link in a country where that is how people get robbed.

**Everything about this surface follows from that fact:**
- **No install wall. No account wall.** She can buy without ever creating anything.
- **Trust must be earned in seconds, cold, with no history.** The reseller's name, « Livré par Séra », « Paiement protégé » — visible before anything is asked of her.
- **The reseller is the face; the platform is the guarantee behind her.** Never the reverse (SP-I03).

## 6.2 The client journey — screen by screen, option by option

### 1. Arrival (the signed link)
She taps Aïcha's link. **The attribution token is decoded and locked to Aïcha** (SP-I09) — before she has done anything. A tampered token **fails closed**: it pays nobody and raises an alert; it never silently pays a different reseller.

### 2. The product page
**She sees:** photos (canonical, price-free, never AI-generated) · the facts · **Aïcha's price — 11 500 FCFA** · « Livré par Séra » · « Paiement protégé » · « Vérifiez avant d'accepter ».
**She never sees:** the supplier's name, the supplier's contact, the base price, or **the commission** (SP-I03 — a violation if breached).
**Options:** choose variant/size · open the inspection explainer · *(gated: view Aïcha's Cercle)*.

### 3. Location — the no-street-address primitive
Ouagadougou does not run on street addresses, so **the system never asks for one**.
> `Location { pin, zone, landmark, directions, maskedRelay }`

**Her options:** drop a pin on the map · pick her **zone** · name a **landmark** (« en face de la station Shell ») · **record a voice note of directions** — voice is a first-class input, not a fallback, because that is how people actually give directions here.

### 4. Delivery — priced by Séra alone
| Option | Price | When it appears |
|---|---|---|
| **Standard** (today, 16h–18h) | **1 000 FCFA** | Always |
Delivery is priced by **Séra alone** via `DeliveryFeeQuote`. Zone fee tables, any free-delivery thresholds, and delivery windows are an **open Decision (⏳ D6)** — every figure or window that appears in examples here is illustrative, never canon.
| *(gated)* **Cercle campaign** (« Samedi à Tampouy — 400 FCFA ») | reseller-funded | Only if a live campaign covers her zone and budget remains |

The price comes from Séra's `DeliveryFeeQuote`. **No other party may invent it.**

### 5. Payment — her real choice (the conversion moment)
| | **Option A — FULL_PREPAY** | **Option B — pay the product at the door** |
|---|---|---|
| Pays now | **12 500 FCFA** (product + delivery) | **1 000 FCFA** (delivery only) |
| Pays at the door | — | **11 500 FCFA** (the product) |
| Who can use it | **Everyone, always** | Option B is available only when **all five** hold: seller tier ≥ **verified** · category **inspectable** · order ≤ the price cap (pilot ~25 000 FCFA) · **network-reliable zone** · `PayAtDoorEligibility.state = allowed`. |
| Her protection | Held at the licensed provider until validated delivery | **She sees the product before she pays for it** |

**When Option B is unavailable, it is shown disabled — with the honest reason**, never hidden:
> *« Indisponible — vendeur en période d'essai (prépaiement uniquement) »* · *« Indisponible au-delà de 25 000 FCFA »*

**The screen states plainly what is paid now and what is due at delivery** (SP-I13). No confirmed order without the funded legs for its mode. **A retry never charges her twice.**

### 6. Confirmation & tracking
A receipt she understands: what she paid, what she owes at the door, when it comes. Then **coarse, honest progress** — *not* a live GPS dot (SE-I08). If she needs the rider, a **masked relay** connects them; **neither ever sees the other's real number**.

### 7. At the door — the inspection (her power, made real)
The rider arrives with a **sealed** package. She inspects it — **2–4 minutes**, per the category matrix:
right item · right variant/colour/size label · right quantity · pieces present · no visible damage · seal intact.

**What inspection does NOT promise her** (stated honestly, in the app):
> *« La vérification à l'enlèvement réduit les erreurs évidentes ; elle ne certifie pas l'authenticité, la qualité, la performance, ni les défauts cachés. »*

### 8. Her decision — the fork
| She chooses | What happens | What it costs her |
|---|---|---|
| **Accept** | *(Option B)* she pays 11 500 FCFA → **the provider confirms** → `HandoffAuthorization` → **custody transfers** → she enters her **drop code, last** → delivery validated | Nothing beyond the price |
| **Refuse — justified** (wrong item, damaged, seal broken) | Structured reason + evidence. She is **protected and refunded**. The package returns under custody. | **Nothing** — the Protection Fund absorbs it |
| **Refuse — changed her mind** | The package returns. | **The delivery fee** (Séra genuinely did the work). Recorded on her `PayAtDoorEligibility`. |
| **Cannot pay (Option B)** | **No handoff.** Custody stays with the rider. Retry / reschedule / return. | Delivery fee |

**The refusal path is exactly as easy and as dignified as the acceptance path.** One tap. No shaming, no friction penalty for exercising a right.

### 9. After
Receipt · *(gated)* **« Laisser un avis vérifié »** — proof that **only a validated delivery can produce**. A cancelled or refunded order can never generate one, which is precisely why hers is worth something.

## 6.3 The client's bill of rights (the promises this surface makes)
1. **Inspect before you accept** — always, on every order.
2. **Refuse for a real reason → fully protected**, refunded, no argument.
3. **Never charged twice**, ever, on any retry.
4. **Never asked for a street address** you don't have.
5. **Your number is never given to a stranger** — masked relay, both directions.
6. **You never see, and never pay, a hidden commission** — the price is the price.
7. **No account, no install, no trap** — buy and leave.
8. **Your data belongs to the relationship you chose** — consent-scoped to Aïcha; invisible to other resellers (SP-I07).

## 6.4 The refusal ladder (the one place the client faces consequences)
Refusing on a whim is a *right*, not a crime — but it is not free, and it is not infinite:

`PayAtDoorEligibility { state, reason, buyerRefusalCount, buyerRiskState, requiredDeposit, prepayOnlyUntil }`

**1st ordinary buyer-fault** → next order requires a higher delivery commitment or a small product deposit · **2nd** → `FULL_PREPAY` for the next 3 orders (`prepayOnlyUntil`) · **repeated abuse** → pay-at-door suspended · **fraud** → immediate restriction and review. She is always told which state she is in and why. Justified refusals **never** count against her.

## 6.5 What the client surface must NEVER do
Force an account · force an install · show the supplier or the commission · request a street address · expose a phone number · charge twice · take custody-money at the door without provider confirmation · use a dark pattern, a fake countdown, or a fake stock number.

---

# PART 7 — SÉRA (the rider app — the custody spine)

**Repo:** `sera` · **Users:** riders (employed, not gig) + dispatchers · **Promise:** *« On vérifie, on scelle, on remet — et seulement une fois le paiement confirmé. »*

**Séra is the only reason the other two apps can be trusted.** It is the proof machine.

## SE1 — Onboarding, certification, shift
Riders are **employees**: wages and fuel are a **workforce cost, never a slice of customer money** (SE-I09). Certification gates who may carry what. Shift state controls everything downstream — including location collection (SE-I08: **location only on shift/active task**).

## SE2 — Ready-queue & dispatch *(the funded-dispatch gate)*
**SE-I02:** a task enters the queue **only** when it is:
- **funded per payment mode** — full for FULL_PREPAY; the **delivery fee** for Option B, *(and, gated, a campaign share counts as funding: `customerShare + campaignShare == DeliveryFeeQuote`)*
- **supplier-ready** (readiness confirmed), and
- **not cancelled**.

**SE-I01:** exactly **one assignment authority**. A courier **cannot self-assign** — an atomic lease prevents two riders racing to the same package.

## SE3 — Route manifest & one-current-stop
**SE-I03:** one active manifest, **one current stop**. No juggling. No "I'll grab both and sort it out."
**SE-I04:** every package has **exactly one current custodian** — and **task status is never custody truth**. (A task can say "delivered" while custody says otherwise; custody wins, and the discrepancy is an incident.)
*(Operational batching is deliberately deferred to a later era — dispatch stays single-job until density justifies it.)*

## SE4 — Landmark-first navigation & masked relay
Navigation is built for a city without addresses: pin + zone + **landmark** + voice directions. Contact with the buyer runs through a **masked relay** — the rider never sees a raw number, the buyer never sees his.

## SE5 — Supplier pickup, verification & the custody seal *(the heart)*
1. Rider arrives, presents the task.
2. **Bounded verification (SE-I12):** objective conformity **only** — order ref, variant, colour/size label, quantity, pieces, visible damage, manufacturer seal. **Never** authenticity, quality, hidden defects, ingredients, warranty. Dwell: **2–4 minutes**.
3. **Mismatch → refuse custody.** The buyer is refunded, there is **no round-trip**, and the cost lands on the **Protection Fund** with `faultClass = seller`. The supplier's balance is *not* debited.
4. **Match → custody seal registered → custody begins** (SE-I05). Not one second earlier.

## SE6 — Customer delivery, inspection & doorstep handoff
- Buyer inspects (category rules, 2–4 min dwell).
- **Option B (SE-I11):** buyer pays the product leg → **provider confirms authoritatively** → `HandoffAuthorization` → custody transfers. A rider's confirmation is **not** payment truth.
- **`buyerDropCode` is entered last** — it is the buyer's proof, not the rider's.
- Then, and only then: `ValidationDecision` → settlement becomes eligible.
- **Break-glass:** a signed `HandoffAuthorization` exists for genuine edge cases — logged, exceptional, never routine.

## SE7 — Failed delivery & return
**SE-I10:** every failure reason produces an **explicit** behavior — retry, reschedule, return, cancellation, support, or incident. **There is no generic "failed" terminal state, and a package is never unowned.**
Returns travel back under custody and are handed to the supplier via a **two-key return handoff + inspection** — the same discipline in reverse.

## SE8 — Safety, SOS, incident
A rider carrying goods through a real city gets a real safety path: SOS, incident capture, and an operational response. Non-negotiable for an employed fleet.

## SE9 — Fleet, shift & payroll *(the discipline that keeps the unit economics honest)*
- **Delivery cost is decomposed, never a single "fully-loaded" number** — so nobody can hide a loss in an average.
- **Staged fleet-release gates: start with 3–5 electric motorcycles, not 15.** The next tranche of ~5 releases **only** when: **≥8 deliveries/moto/day sustained ~2 weeks** · **failed-delivery rate < 8%** · **positive delivery contribution** · a charging/battery-spare plan exists.
- **The law that prevents the classic death spiral:** *the fleet follows validated order density — the business must never generate unprofitable orders to justify idle motorcycles.*

## What Séra must NEVER do
Compute proceeds · hold product funds · mark anything paid · invent a delivery price · verify quality/authenticity · self-assign · treat GPS as proof · release money on rider evidence alone.

---

# PART 8 — THE DISPATCH CONSOLE (Séra's operational heart)

**Ships from:** `sera` (web console, beside the rider app) · **Users:** the dispatcher, the fleet manager · **Doctrine:** **dispatch is human.**

## 8.1 Why a human dispatches (and no model does)
There is **no route-optimization model, no ETA model, no ML** in Séra — by law (deterministic-only doctrine). The console may offer a **deterministic nearest-available suggestion**; the human decides. At 3–5 motorcycles, a dispatcher who knows the city beats a model that doesn't — and, more importantly, **a human is accountable**. A model cannot be asked why it stranded a package.

## 8.2 The dispatcher's screens — flow by flow

### 1. The ready queue *(what is even allowed to exist here)*
A task appears **only** when it is **funded per payment mode** + **supplier-ready** + **not cancelled** (SE-I02). An unfunded or unprepared order is not "at the bottom of the list" — **it is not in the room.** *(Gated Cercle: a campaign's `campaignShare` counts as funding, exactly like buyer money — `customerShare + campaignShare == DeliveryFeeQuote`.)*

### 2. Assignment *(the single atomic lease)*
**SE-I01 — exactly one assignment authority.** The dispatcher assigns; **a rider can never self-assign**. The lease is an **atomic Durable Object** — two dispatchers (or two clicks) can never hand the same package to two riders. Deterministic suggestion offered; human decides.

### 3. The live board
One **RouteManifest** per rider · **one current stop** (SE-I03) · **exactly one custodian per package** (SE-I04). And the rule that catches the ugliest bugs: **task status is never custody truth** — if the task says *delivered* and custody says otherwise, **custody wins**, and the divergence is an incident.

### 4. The exceptions desk *(the most important screen in the building)*
Every failure lands here with a **structured reason + evidence**. The dispatcher applies exactly one explicit outcome:
**retry · reschedule · return · incident** — and **there is no generic "failed"** (SE-I10). A package is **never unowned**: custody stays with the rider or the hub until a **two-key return handoff + inspection** puts it back with the supplier.

### 5. Break-glass verification *(the maker-checker seam)*
Two different people, deliberately:
- **The authorized payment operator** *verifies the provider transaction* and **issues** the break-glass `HandoffAuthorization`. He **may not** fabricate custody or authorize on unverified evidence.
- **The dispatcher** performs **break-glass handoff verification** on the ground. He **may not** touch the ledger.

**Nobody holds both halves.** That is the whole point.

### 6. Signals & drills
Pickup dwell **over 2–4 min is an ops signal** (a supplier who is slow to verify is a supplier trending toward a fault). **A live SOS + dispatcher-response drill must pass before the pilot** — an employed rider carrying a stranger's goods through a real city gets a real safety path.
*(Gated Cercle: `ScheduledDeliveryCluster{campaignId, zone, window}` appears as a **grouping aid** — same-zone, same-window single jobs. It is not automated batching; one current stop still holds.)*

## 8.3 What the dispatcher MAY and MAY NOT do
| MAY | MAY NOT |
|---|---|
| Assign / reassign tasks | **Edit the ledger** |
| Resolve exceptions (retry/reschedule/return/incident) | **Issue a refund or a payout** |
| Verify a break-glass handoff on the ground | **Issue** the break-glass authorization (that is the payment operator) |
| Open incidents, trigger SOS response | **Fabricate custody**, or release money on a rider's word |

---

# PART 9 — THE PLATFORM OPS CONSOLE (the back-office — and an honest gap)

> **⚠ FOUNDER DECISION REQUIRED.** The ops **roles** are defined across all three specs (Boutik+: "verification/moderation operator — Ops only"; Séra: payment operator, fleet manager, HR/payroll maker-checker). But the repo topology we locked — three apps + `platform-contracts` — **gives the cross-app Ops surface no home.** Protection Fund solvency, claims adjudication, and provider reconciliation are *inherently cross-domain*: they cannot live inside any one app without that app becoming a de-facto platform brain. **Recommendation: a fifth repo, `platform`** (github.com/beurni2/platform) — its own deployable, consuming the same pinned `platform-contracts`, reading through the authoritative services and **never writing to another domain's database.** (Alternatives: scatter admin screens per-app — but then the fund and reconciliation have no owner; or fold Ops into `platform-contracts` — rejected, contracts must stay a pure package, not a deployable.)

## 9.1 The iron rule of Ops
> **Ops never edits the ledger. No human ever "just fixes" money.**

Every ops action is a **permissioned, evented, audited command** through the same authoritative services as everything else — with **maker-checker** on anything touching money or custody. **If a human can silently move a franc, every guarantee in this document is theater.**

## 9.2 What lives in Ops — desk by desk

### Desk 1 — The Protection Fund
Solvency state, capitalization (funded **before** launch, never from float), and claims by `faultClass`.
**The law that must never bend (B+I-13): buyer refunds are NEVER gated on the fund's solvency.** A buyer owed money is paid whether the fund is healthy or empty. The fund protects *sellers* from fault-cost; it never stands between a buyer and her refund.

### Desk 2 — Claims adjudication *(who pays — the routing table)*
| Fault | Instrument |
|---|---|
| **Seller fault** (not ready, pickup mismatch) | Protection Fund · `faultClass = seller` · **the seller's balance is never debited** |
| **Séra fault** (loss/damage in custody) | **`CustodyLiabilityClaim`** — Séra's own instrument, **separate from the fund** |
| **Buyer fault** (whim refusal, no-show) | Buyer forfeits the delivery fee · refusal ladder updates |
| **Provider fault** | Provider arrangement · reconciliation case |
| **Platform/system fault** | Platform loss account |

### Desk 3 — Moderation *(Boutik+ product truth)*
The queue for facts, media, and categories. **Specific, actionable reasons** — never a silent rejection. **No self-moderation** (a supplier can never approve his own listing). Deterministic imaging rules enforced: no generative AI, no price in images, no supplier contact in images.

### Desk 4 — Trust & safety / related-party review
**Auto-void** (no human needed): same verified identity · same phone · same wallet · a reseller buying through her own customer identity.
**Manual review** (a human must look): shared device · shared household · shared landmark · shared network.
**The principle:** a low-confidence signal **may not** auto-void a legitimate reward or order. Suspicion is not proof.

### Desk 5 — Provider reconciliation
The ledger's obligations vs. the **provider's truth** (the webhooks). On divergence: **open a case · alert · protect existing customer promises · pause what is safe to pause.** *(Gated Cercle: divergence pauses **new** campaign reservations — never the promises already made to customers.)*

### Desk 6 — Buyer refusal ladder oversight
`PayAtDoorEligibility` states across the buyer population: good standing → deposit required → prepay-only. Tuned with pilot data, never punitive by default. **Justified refusals never count against a buyer.**

### Desk 7 — Flags & kill-switches
Every capability can be **turned off without a deploy** (Execution Contract). This is the difference between "we found a bug at 22h" and "we shipped a fix at 04h."

### Desk 8 — The audit log
**Append-only.** Every ops action: who, what, why, when, against which order, with which evidence. Money and custody actions are **maker-checker** — two humans, or it does not happen.

## 9.3 Who works these desks (roles, per canon)
**Verification/moderation operator** (Boutik+ — Ops only) · **Authorized payment operator** (verifies provider transactions; issues break-glass authorizations; **may not** fabricate custody) · **Ops/fleet manager** · **HR/payroll** (maker-checker) · **Risk/T&S reviewer**.
**Standard prohibitions, everywhere:** no ledger edits · no self-moderation · no cross-supplier visibility · no releasing money on unverified evidence.

## 9.4 What the Ops console must NEVER become
A place where a human can: pay someone early · forgive a fee · fabricate a delivery · unlock a payout "just this once" · see a buyer's raw phone number without cause · or overrule the provider's payment truth. **Every one of those is a feature request that will eventually arrive. Every one of them is refused.**

---

# PART 10 — THE GOLDEN PATH (one order, every surface, step by step)

**Cast:** *Ousmane* (supplier), *Aïcha* (reseller), *Awa* (buyer), *Moussa* (rider).

| # | Where | What happens | The rule enforcing it |
|---|---|---|---|
| 1 | **Boutik+** | Ousmane publishes a wax dress: **B 10 000**, **C 1 000**. Studio photos approved, price-free, contact-free. | B+I-01, B+I-02, B+I-11 |
| 2 | **Boutik+** | He sees his math *before* committing: net **8 500 FCFA** after the 500 FCFA fee. No deposit asked. | B+I-12 |
| 3 | **Shop+** | Aïcha sees it in Opportunités: « **Vous gagnez 2 000 FCFA net** ». She adds **M 1 500** and lists it. | SP-I04, SP-I12 |
| 4 | **Shop+** | She taps « Partager » → a WhatsApp card with **her price (11 500 FCFA)**, her name, her **signed attribution link**. Commission is nowhere on it. | SP-I03, SP-I09 |
| 5 | **Buyer PWA** | Awa opens the link. Sees the dress, 11 500 FCFA, « Livré par Séra », « Paiement protégé ». | SP-I03 |
| 6 | **Buyer PWA** | She drops a pin, picks her zone, names a landmark, records a voice note of directions. **No street address is ever requested.** | Kernel `Location` |
| 7 | **Buyer PWA** | Delivery: **Standard 1 000 FCFA** (Séra's quote — the only price authority). | Séra owns D |
| 8 | **Buyer PWA** | She chooses **Option B**: pays **1 000 FCFA now**, **11 500 FCFA at the door**. (Allowed: Ousmane is *verified*, order ≤ 25 000 FCFA.) | SP-I13, tiers |
| 9 | **Ledger** | Quote locked & immutable: 8 500 / 2 000 / 1 000 / 1 000. `reseller_id` locked to Aïcha. | SP-I01, B+I-04 |
| 10 | **Boutik+** | Ousmane packs, confirms **« Produit prêt »** with readiness evidence. *(No drop code in it — ever.)* | B+I-06 |
| 11 | **Séra** | Task enters the queue — **funded (delivery leg) + ready + not cancelled**. Dispatcher assigns Moussa via a single atomic lease. | SE-I02, SE-I01 |
| 12 | **Séra** | Moussa verifies at pickup: right dress, right size label, 1 piece, undamaged. **Conformity only.** | SE-I12 |
| 13 | **Séra** | **Seal registered → custody begins.** Ousmane could not have declared this himself. | SE-I05, B+I-07 |
| 14 | **Séra** | Transit. One current stop. One custodian. Awa sees coarse progress, not a live dot. | SE-I03, SE-I04, SE-I08 |
| 15 | **At the door** | Awa inspects (2–4 min): right item, right size, undamaged, seal intact. | Inspection matrix |
| 16 | **At the door** | She pays **11 500 FCFA** → **the provider confirms** → `HandoffAuthorization` → **custody transfers**. Moussa's word alone would not have sufficed. | **SE-I11** |
| 17 | **At the door** | Awa enters her **drop code** — last. `ValidationDecision` recorded. | Four secrets |
| 18 | **Ledger** | Settlement eligible. **Ousmane 8 500** (same/next-day) · **Aïcha 2 000 net** · **Séra funded 1 000** · **platform 1 000**. | Waterfall |
| 19 | **All three** | `11 500 = 8 500 + 2 000 + 1 000` ✓ | The CI gate |

**Notice what never happened:** no app held money · no deposit was taken · no supplier contact leaked · no commission was shown to the buyer · nobody's word substituted for a provider webhook · and every franc reconciles.

---

# PART 11 — EVERY FAILURE PATH (option by option)

**The design principle:** *the problem path is as prominent and as dignified as the happy path.* A system that only works when everything goes right is a demo, not a business.

| Failure | What the system does | Who pays | Rule |
|---|---|---|---|
| **Payment never confirms** | Order does not confirm. Stock reservation released. No dispatch. | Nobody | SP-I13, SE-I02 |
| **Payment retried** | **No duplicate charge.** Idempotent. | Nobody | SP-I13 |
| **Supplier never confirms readiness** | Task never enters the queue. No rider is sent. Order cancelled + buyer refunded. | **Protection Fund** (seller fault) | B+I-06 |
| **Pickup mismatch** (wrong item/size/count/damage) | Rider **refuses custody**. Buyer refunded. **No round-trip.** Seller's tier takes the consequence — **his balance does not.** | **Protection Fund**, `faultClass=seller` | SE-I12, B+I-13 |
| **Buyer refuses at the door — justified** (wrong item, damaged) | Buyer protected and refunded. Product returns under custody, two-key handoff to supplier. | **Protection Fund** (seller fault) | SE-I10 |
| **Buyer refuses at the door — changed her mind** | Product returns. **Buyer forfeits the delivery fee** (Séra really did the work). Refusal is recorded on her `PayAtDoorEligibility`. | **Buyer** | Refusal ladder |
| **Buyer can't pay at the door (Option B)** | **No handoff.** Custody stays with the rider. Structured reason → retry / reschedule / return. | Buyer forfeits delivery | **SE-I11** |
| **Buyer no-show** | Explicit behavior: retry or return. Never a silent "failed". | Buyer | SE-I10 |
| **Repeat refuser** | **1st ordinary buyer-fault** → next order requires a higher delivery commitment or a small product deposit · **2nd** → `FULL_PREPAY` for the next 3 orders (`prepayOnlyUntil`) · **repeated abuse** → pay-at-door suspended · **fraud** → immediate restriction and review. | Buyer | `PayAtDoorEligibility` |
| **Goods lost/damaged in custody** | **`CustodyLiabilityClaim`** — Séra's own instrument, *separate from the Protection Fund*. Buyer made whole regardless. | **Séra** | Fault routing |
| **Rider goes offline mid-task** | Evidence queues. **Custody validation and money release stay pending** until server ack. Never auto-completed. | — | SE-I06 |
| **Provider/webhook failure** | Reconciliation case opened. **Buyer refunds are never gated on the fund.** | Provider arrangement | B+I-13 |
| **Attribution token tampered** | **Fails closed** — pays nobody, raises an alert. Never pays a random reseller. | — | SP-I09 |
| **Self-dealing / fake referral** (gated Cercle) | Related-party tiers: same identity/phone/wallet → **auto-void**; shared device/household → **manual review**. | — | SP-I17 |
| **Stock runs out mid-campaign** (gated) | Offers and campaigns **auto-pause**. Advertised benefits stop being advertised. | — | B+I-03 |

---

# PART 12 — THE GATED LAYERS (direction, not yet work orders)

These are **specified, canonical, and deliberately not being built yet**. Each has a gate that is about *evidence*, not capacity — you cannot build your way past them, only earn your way through.

## 9.1 Cercle (SP9) — reseller-owned community commerce
**What it is:** each reseller gets a consent-based customer community (« Le Cercle d'Aïcha »): a public vitrine, members, **3-gesture campaigns** (recipe → product → budget) with a **sacred economic preview**, campaigns funded from her **settled earnings** (never pending), verified-delivery reviews, single-level referrals.
**The strategic gem — recette Quartier:** a reseller spends *her own money* to concentrate orders into one zone and one delivery window. It is the only mechanism in the ecosystem where a reseller's marketing spend directly buys **Séra route density** — the exact input the fleet gates need.
**Key laws:** `K ≤ 0.80(C+M)` (a campaign can never make her earnings negative) · one benefit per order · `customerShare + campaignShare == DeliveryFeeQuote` (Séra always whole) · fully-free delivery ⇒ FULL_PREPAY · only validated deliveries produce proof · reporting says *"attributed"*, never *"generated"*.
**Gate:** ≥20 active resellers (≥3 validated deliveries each) · ≥150 cumulative validated deliveries · **the drop-code → settlement loop stable for 4 consecutive weeks** · Séra scheduled windows live · payment-partner campaign-allocation structure confirmed. *(abridged — the complete ten-item gate lives in the Shop+ spec, SP9)*

## 9.2 PackLab (B+9) — the Founding Catalog Engine
**What it is:** the platform's own composite packs (BOM over shared components, hub-kitted), seeding the launch catalog and setting the visual standard — then **receding** as supplier/consignment supply grows into that standard.
**Governed by three ceilings** (because a purchase order happens *before* GMV exists): **cash exposure blocks the PO** · **promoted-catalog share caps the shelf** · **rolling 90-day owned-GMV share throttles promotion** (60–80% M0–3 → ~50% waypoint → **≤30% by M9–12**, readiness-gated).
**Plus:** the **Restock Law** (the first buy is a test; the restock is where graveyards are born), the **six-question gate**, the **pack covenant** (PackLab may never replicate a supplier's proven SKU without first offering him the component-supply path), and the **Supplier Upgrade Path** (the standard is an on-ramp, not a wall).
**The doctrine:** *PackLab manufactures the standard; the ecosystem grows into it.*

## 9.3 Diaspora — **explicitly out of scope**
Specified (hub consignment, the owner cockpit, four planes, the settlement waterfall, « Mon Enseigne ») and **deliberately parked** by founder decision. The supervising agent must refuse Diaspora work until it is reopened.

---

# PART 13 — THE CROSS-CUTTING LAWS (true on every surface)

These are enforced by **CI gates in every repo**, not by good intentions.

### 10.1 Deterministic only
**No generative AI. No ML ranking, segmentation, routing, or ETA. No server inference. Anywhere in product logic or imaging.** Suggestions are **rule-based and explainable**; if a screen says *why* it's suggesting something, it must be a real rule, statable in one sentence. Voice = **recorded audio**, never synthesized.
*Why:* in a market built on trust, an unexplainable decision is an untrustworthy one — and a hallucinated product photo is fraud.

### 10.2 Offline-first — and the rule that saves you
**Queued = pending, never done.** An offline action never claims success. And **custody/delivery validation and financial release are never final offline** (SE-I06) — they wait for the server. Everything else queues gracefully and syncs.

### 10.3 The French Voice Standard *(Execution Contract §10.5)*
> *« Le français de l'écosystème : celui d'une commerçante qui réussit — clair quand il s'agit d'argent, chaleureux quand il s'agit de vendre, jamais celui d'un bureau. »*

- **Money & trust moments → calm, precise, reassuring.** *« Vous payez 1 000 FCFA maintenant, en sécurité — et 11 500 FCFA à la livraison. »*
- **Selling & community moments → warm, familiar, captivating.** *« Séra livre — et votre gain net vous revient. »*
- **6th-grade reading level.** Many resellers did not finish school. No administrative French. No « séquestre ». No word a market seller wouldn't say out loud.
- French-first, with **Mooré/Dioula** and **voice notes** — because many people sell and buy *by voice*.
- **CI-enforced** by a copy-lint over the i18n catalog (register tags, banned tokens, reading-level budget). Strings live in the catalog, never inline.

### 10.4 No street addresses, ever
`Location { pin, zone, landmark, directions, maskedRelay }` + a gazetteer. The city is navigated by landmarks and voice, because that is how the city actually works.

### 10.5 Phone is an alias, never the key
WhatsApp reverse-handshake identity. A phone number is a *contact alias* — never the database key, never exposed raw between parties. All party-to-party contact runs through a **masked relay**.

### 10.6 Single-level, everywhere
No recruitment income. No downline. No team tree. No "earn from your network." A reseller earns from **her own delivered sales** — full stop. This is a permanent refusal, not a missing feature.

### 10.7 Low-end Android first
Performance budgets are named at E0 and enforced: 60fps feel on a 1GB device, skeleton loading, network-sized images, interaction-latency budgets. **A beautiful screen that stutters is a failed screen.**

### 10.8 The design North Star (how "never seen before in Burkina" is made testable)
- **The 5-second test:** Aïcha — market seller, mid-literacy, hot phone, sun on the screen — understands any screen's purpose and its one primary action in **five seconds**.
- **The trust test:** every money moment makes someone **calmer**, never more anxious.
- **One primary action per screen.** Honest states (empty, offline, pending) are **designed** states, never apologetic error walls.
- **Celebration with dignity** — the first sale, the first verified review. Zero dark patterns, zero fake urgency, zero confetti-spam.
- **A shared design system as code** (`platform-contracts/ui`): one token family, three app identities — Boutik+ (grounded supply confidence), Shop+ (warm commerce energy), Séra (road-and-custody clarity).

---

# PART 14 — BUILD ORDER (what gets built, when, and why in that order)

**The principle:** the gates are **epistemic, not resourcing**. You cannot build your way past them — the loop has to actually run, in Ouagadougou, with real money and real riders. Capacity buys you *speed to the gate* and *readiness at it*, never the right to skip it.

| Era | What | Why here |
|---|---|---|
| **E0** | `platform-contracts` repo (shapes, events, kernel, i18n catalog + copy-lint, UI tokens) published as a pinned package → then each app repo's workspace + **CI harness with every invariant gate live from PR #1** | *A gate added later is a gate that already let something through.* |
| **E1 — the walking skeleton** | **One thin transaction path across all three apps:** one supplier lists one product → one reseller shares one signed link → one buyer pays (sandbox) → Séra verifies, seals, delivers → drop code → settlement reconciles | Nothing else is knowable until this loop closes. **Sparse ≠ ugly:** design tokens + French Voice from the first screen. |
| **E2–E3** | Failure-completeness (refusal ladder, fault routing, Protection Fund) + provider reconciliation | The core must survive reality, not just the happy path. |
| **E4+** | Depth per app, then the **gated layers** in gate order | — |
| **Gated** | **Cercle (SP9)** after the 4-week stable settlement loop · **PackLab (B+9)** after its ceilings/legal structure are set · **Diaspora** only when reopened | The gates are what the pilot must *teach* you. |

**The failure mode to avoid, stated plainly:** building Cercle's ten recipes, PackLab's media engine, and the Diaspora cockpit *before one real order has validated the spine* — and then having to re-propagate a pilot lesson across three elaborate layers at once.

---

# PART 15 — WHAT IS NOT DECIDED (the honest ledger)

| Open decision | Blocks | Safest default in force |
|---|---|---|
| **Aggregator selection + written BCEAO perimeter confirmation** (two-leg fees, refund fees, auth/capture, split-payout) | Real money | Sandbox rails; *pending* everywhere |
| **Protection Fund opening capital + allocation %** | Launch | Seed conservative, calibrate to pilot loss |
| Merchant-of-record & agency model | Legal | — |
| Buyer-facing legal disclosure of who is responsible for what | Launch | — |
| Consent / data retention / deletion (BF law) | Launch | Strictest |
| Delivery fee table + zones + min-margin gate | Séra pricing | — |
| Category floor + final launch/prohibited categories | Catalog | Conservative list |
| Tax / invoice / record retention | Launch | Retain everything |
| **PackLab:** the three ceiling values · restock multiple · upgrade score · platform-as-owner legal structure | B+9 | Gate closed |
| **Cercle:** campaign-allocation structure at the partner · MoMo top-up legality · moderation SLA | SP9 | Gate closed |
| **⚠ Where the platform Ops console lives** (recommend a fifth repo `platform`) — see Part 9 | Fund, claims, reconciliation, moderation, T&S, kill-switches | **Undecided — ops functions are specified but homeless** |
| Dispatcher/incident-response staffing SLA | Pilot | Contract E-exit requires it |

**The discipline:** an open decision is **never** closed by an agent or by convenience. It is implemented at its documented safest default, flagged, and escalated to the founder.

---

# THE LAST WORD

**Boutik+ manufactures trust in supply. Shop+ manufactures demand. Séra manufactures proof. The money moves on rules — never on anyone's goodwill.**

Three apps, three repos, one contract. A supplier who never pays a deposit. A reseller who never buys stock and always sees her net. A buyer who can inspect before she pays. A rider who carries proof, not just packages. And a ledger where every franc has a seat, and `11 500 = 8 500 + 2 000 + 1 000` — every single time.
