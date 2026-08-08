import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SE-LIVE-4c-v · the door, wired into the app.
 *
 * Source-scan, the house pattern for this app's shell (`wo6-invariants`,
 * `faso-scroll`), because react-native does not render under vitest here.
 */

const appDir = join(import.meta.dirname, '..');
const app = readFileSync(join(appDir, 'App.tsx'), 'utf8');

describe('the sign-in gate', () => {
  it('shows the door only on a WIRED build, and only until a session exists', () => {
    expect(app).toMatch(/WIRED && signInState\.kind !== 'signed_in' \?/);
    // WIRED is a BUILD-time fact, read once from the resolver — not a runtime
    // toggle a screen can flip.
    expect(app).toMatch(/const WIRED = isWired\(\);/);
  });

  it('an UNWIRED build is byte-for-byte the demo app it always was', () => {
    // The founder's preview and the gallery must not change. The demo world
    // is still created unconditionally and the screen stack still starts at
    // START — the gate only chooses what the content area renders.
    expect(app).toMatch(/useState<DemoWorld>\(\(\) => createDemoWorld\(\)\)/);
    expect(app).toMatch(/useState<Screen\[\]>\(\[START\]\)/);
  });

  it('⚠ lives INSIDE the one shell — one safe area, one scroll surface', () => {
    // My first cut early-returned a second shell and two invariants caught it.
    expect(app.match(/<SafeAreaView\b/g)).toHaveLength(1);
    expect(app.match(/<ScrollView\b/g)).toHaveLength(1);
  });

  it('⚠ does not take the SOS away from a rider who has not signed in', () => {
    // « SOS visible from every rider screen » (Building Plan). A rider in
    // danger must not have to authenticate first — and this was a real design
    // error in my first cut, caught by wo6-invariants R14.
    //
    // The SOS is mounted after the scroll surface closes, so it is outside the
    // gate entirely: the sign-in branch cannot remove it.
    const gateAt = app.indexOf("WIRED && signInState.kind !== 'signed_in'");
    const sosAt = app.indexOf('<SosButton');
    const scrollClosesAt = app.indexOf('</ScrollView>');
    expect(gateAt).toBeGreaterThan(-1);
    expect(sosAt).toBeGreaterThan(scrollClosesAt);
    expect(sosAt).toBeGreaterThan(gateAt);
  });

  it('the door gets the honest offline banner, not a bespoke error', () => {
    // Offline is a designed state everywhere in this app, including here —
    // the banner is mounted above the content area, so the gate inherits it.
    const bannerAt = app.indexOf('<FasoOfflineBanner');
    const gateAt = app.indexOf("WIRED && signInState.kind !== 'signed_in'");
    expect(bannerAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeLessThan(gateAt);
  });
});

describe('the rider code stays in memory', () => {
  it('App.tsx never persists the session or the code', () => {
    // The code lives in `signInState` (React state) for the session. The
    // outbox and the document store are for evidence, never for a credential.
    const signInBlock = app.slice(app.indexOf('const [signInState'), app.indexOf('const sessionPort') + 400);
    expect(signInBlock).not.toMatch(/appendEvidence|appendSosRaise|outboxStore/);
    // And nothing anywhere in the app writes a session/code to the outbox.
    expect(app).not.toMatch(/append\w*\([^)]*signInState/);
    expect(app).not.toMatch(/kind:\s*'rider\.code'/);
  });

  it('nothing logs the sign-in state', () => {
    expect(app).not.toMatch(/console\.\w+\([^)]*signInState/);
  });

  it('a thrown port still answers the rider instead of hanging the button', () => {
    // A dead button with a spinner forever is the cruellest failure here.
    expect(app).toMatch(/setSignInState\(\{ kind: 'refused', why: 'unreachable' \}\)/);
  });
});

describe('⚠ a WIRED build shows only what a server said (blocker A3)', () => {
  it('does not fall through to the demo world after sign-in', () => {
    // The gate used to cover the SIGN-IN only: the success arm fell straight
    // into the demo tree, so a rider with a real, server-verified session
    // walked a full verify → seal → drop → « Course validée » flow that no
    // ledger anywhere recorded. §9.8, on the custody path.
    expect(app).toMatch(/\) : WIRED \? \(/);
    // The wired arm renders the session's OWN assignment…
    expect(app).toMatch(/signInState\.session\.assignment/);
    // …and the demo tree is now the third arm, reachable only when !WIRED.
    const wiredArm = app.slice(app.indexOf(') : WIRED ? ('), app.indexOf(') : (\n          <>'));
    expect(wiredArm).not.toMatch(/world\.courses/);
    expect(wiredArm).not.toMatch(/SEAL_ID/);
    expect(wiredArm).not.toMatch(/DROP_CODE_LEN/);
  });

  it('⚠ walks SE-I05 in order — the seal does not exist until the LEDGER accepted the verification', () => {
    // « Custody begins only after rider pickup verification AND custody-seal
    // registration. » The seal screen is gated on `maySeal`, which reads the
    // server's answer — never « the request worked ». A refused package stops
    // at the verification, with the seller keeping it.
    expect(app).toMatch(/maySeal\(verifyPhase\)/);
    expect(app).toMatch(/holdsPackage\(sealPhase\)/);
    // And the acts go to the real ports, not the demo store.
    expect(app).toMatch(/custodyActs\.verifyPickup/);
    expect(app).toMatch(/custodyActs\.beginCustody/);
  });

  it('⚠ dwell is MEASURED, never invented', () => {
    // The policy targets 120–240 s and RECORDS whether the real dwell fell
    // inside it. Padding a quick rider into looking compliant would make the
    // record a lie about how long they actually stood there.
    expect(app).toMatch(/dwellSec: Math\.max\(0, Math\.round\(\(Date\.now\(\) - dwellStart\.current\)/);
    expect(app, 'a hardcoded dwell').not.toMatch(/dwellSec:\s*\d+/);
  });

  it('⚠ the command id is stable PER CONTENT, not per mount (blocker A3)', () => {
    // I first minted it once per mount and called retries safe. Custody's
    // idempotency is CONTENT-keyed — `fingerprint()` excludes only command_id
    // and `at` — so the same id with any changed field is
    // `command_id_reused_with_other_content`, which my readAnswer shows to the
    // rider as « Séra a refusé ». Measured on the shipped Worker: correcting a
    // mistyped code, and even a byte-identical retry after a timeout, both
    // conflicted — the second while the ledger had ACCEPTED.
    expect(app).toMatch(/attemptFor\(`verify\|/);
    expect(app).toMatch(/attemptFor\(`seal\|/);
    // The key must cover every field that enters the fingerprint.
    expect(app).toMatch(/attemptFor\(`verify\|\$\{liveAssignment\.orderId\}\|\$\{pickupCode\}\|\$\{JSON\.stringify\(checks\)\}`\)/);
    // …and the id must NOT be re-minted per mount any more.
    expect(app).not.toMatch(/verifyActId = useRef\(mintActId\(\)\)/);
    expect(app).not.toMatch(/sealActId = useRef\(mintActId\(\)\)/);
  });

  it('⚠ dwell is FROZEN with the attempt, not recomputed per send', () => {
    // dwellSec is part of the fingerprint, so a moving number makes every
    // retry a fresh conflict — that is how an ACCEPTED verification came back
    // to the rider as a refusal.
    expect(app).toMatch(/dwellSec: attempt\.dwellSec/);
    // Measured in exactly ONE place — `attemptFor`, where the attempt is
    // created — and read from the frozen attempt everywhere else.
    expect(app.match(/Date\.now\(\) - dwellStart\.current/g)).toHaveLength(1);
    const sendSite = app.slice(app.indexOf('custodyActs.verifyPickup'), app.indexOf('const sendSeal'));
    expect(sendSite, 'dwell recomputed at send time').not.toMatch(/Date\.now\(\)/);
  });

  it('⚠ no photo, no act — neither ref is ever fabricated (blocker A7)', () => {
    // `ev-<uuid>` named a bundle that never existed, defeating the spine's
    // no_evidence_refs guard and writing a dangling pointer into the ledger.
    expect(app, 'a synthetic evidence ref').not.toMatch(/`ev-\$\{/);
    expect(app).toMatch(/if \(verifyBundleId === null\) return;/);
    expect(app).toMatch(/if \(sealPhotoRefs\.length === 0\) return;/);
  });

  it('⚠ the SOS is actually sent on a wired build (blocker A1)', () => {
    // It used to flush through `async () => 'applied'`, and outbox.flush DROPS
    // an entry reported applied — so the alert was deleted, never sent.
    expect(app).toMatch(/httpSosSender\(base, code\)/);
    expect(app, 'the old always-applied sender').not.toMatch(/sandboxReconnectSender/);
    // …and the SOS carries the real rider, not the demo id.
    expect(app).toMatch(/const sosRiderId = WIRED \?/);
  });

  it('⚠ no dispatch stand-in can answer on a wired build (blocker A2)', () => {
    // One tap on the « (aperçu) » ack flipped the sheet to « Quelqu'un arrive
    // pour vous » — the same false promise, on a real build.
    expect(app).toMatch(/if \(WIRED\) return;/);
    expect(app).toMatch(/WIRED \? \{\} : \{ onSandboxAck: sosSandboxAck \}/);
  });

});

describe('⚠ the door claims no identity it has not been given (blocker A6)', () => {
  it('does not show a demo rider name above « Votre code »', () => {
    // `subtitle={t('service.certified_name')}` — « Moussa K. · Séra 2026 » —
    // was unconditional, so a wired build's sign-in asserted a certified rider
    // that no server confirmed and who was not the person holding the phone.
    expect(app).not.toMatch(/subtitle=\{t\('service\.certified_name'\)\}/);
    expect(app).toMatch(/signInState\.session\.displayName/);
  });

  it('keeps the demo dock and the demo footer out of a wired build', () => {
    expect(app).toMatch(/\{!WIRED && HUBS\.includes\(screen\)/);
    expect(app).toMatch(/\{!WIRED && <View style=\{styles\.footer\}>/);
  });
});

describe('⚠ the SOS does not promise what no server receives (blocker A2)', () => {
  it('a wired build does not say « Alerte envoyée »', () => {
    // There is NO SOS route on any Worker. In the demo world the raise drains
    // through a sandbox sender that always answers `applied`, so the banner
    // clears as if delivered — a false safety promise on a build a real rider
    // signs into, and the one string here not labelled demo.
    expect(app).toMatch(/raised: WIRED \? t\('sos\.not_wired'\) : t\('sos\.raised'\)/);
    expect(app).toMatch(/raisedHint: WIRED \? t\('sos\.not_wired_hint'\)/);
  });

  it('but the gesture itself is untouched — SOS still reaches every screen', () => {
    // Building Plan l.88. Changing the WORDS must never remove the disc.
    expect(app.match(/<SosButton /g)).toHaveLength(1);
    expect(app.indexOf('<SosButton')).toBeGreaterThan(app.indexOf('</ScrollView>'));
  });
});

describe('⚠ an unfinished checklist can never reach the pickup code (A4 + A8)', () => {
  it('every check is ANSWERED, never implied by an untouched box', () => {
    // `verifyPickup` CONSUMES the single-use code before the policy runs, so a
    // partial submit burned it and left the order unverifiable for ever — and
    // an unticked box became a REFUSAL, permanently recording the supplier at
    // fault. Both were the same ambiguity: unticked meant "not looked at yet"
    // AND "fails".
    expect(app).toMatch(/<FasoCheckAnswer/);
    expect(app, 'the old binary box').not.toMatch(/<FasoCheckRow[\s\S]{0,200}POLICY_CHECK_IDS/);
    expect(app).toMatch(/answer=\{checks\[id\]\}/);
    expect(app).toMatch(/onAnswer=\{\(value\) => setChecks/);
  });

  it('the send is gated on ANSWERED, not on all-conforme', () => {
    // `allChecked` (all true) would block a legitimate refusal; `allAnswered`
    // blocks only an unfinished list.
    expect(app).toMatch(/const allAnswered = POLICY_CHECK_IDS\.every\(\(id\) => checks\[id\] !== undefined\)/);
    expect(app).toMatch(/canSend=\{allAnswered\}/);
  });

  it('and the screen says what is missing rather than a dead button', () => {
    expect(app).toMatch(/verify\.answer_all/);
  });
});

describe('⚠ a rider reads places and words, never enums or UUIDs (A10)', () => {
  it('renders the assignment landmark-first, not its identifiers', () => {
    // « État · active_unacknowledged » and « Course · task-<uuid> » were the
    // server's own English enums and UUIDs, inline where the copy-lint cannot
    // see them (Law 6), and useless to someone navigating by « la pharmacie du
    // marché ». SE0.3 fixes the order for BOTH shells: landmark, then
    // indications, then zone — the GPS pin never leads.
    expect(app).toMatch(/<FasoLandmarkCard[\s\S]{0,200}lines=\{assignmentLines\}/);
    expect(app).toMatch(/repereLabel=\{t\('assignment\.landmark_label'\)\}/);

    // Scoped to what the rider SEES. `liveAssignment.orderId` is legitimate off
    // screen — it addresses the custody act and keys the attempt id — so a
    // whole-file scan here would fail on correct code and teach us to weaken
    // the rule. The ban is on RENDERING an id or an enum, so the slice is the
    // wired render arm alone.
    const wiredArm = app.slice(app.indexOf(') : WIRED ? ('), app.indexOf('R1 « Service »'));
    expect(wiredArm.length).toBeGreaterThan(500); // the slice anchors still exist
    expect(wiredArm, 'a raw id printed on screen').not.toMatch(
      /\{liveAssignment\.(orderId|taskId)\}/,
    );
    expect(wiredArm, 'an id interpolated into screen text').not.toMatch(/\$\{liveAssignment\./);
    expect(wiredArm, 'a raw status enum on screen').not.toMatch(/\{liveAssignment\.status\}/);
  });

  it('the status becomes a catalog word, and an unknown one degrades safely', () => {
    expect(app).toMatch(/assignmentStateKey\(liveAssignment\.status\)/);
  });

  it('says so honestly when the server sent no landmark', () => {
    // Never an invented address, and never a raw id as a fallback.
    expect(app).toMatch(/assignment\.no_landmark/);
  });
});
