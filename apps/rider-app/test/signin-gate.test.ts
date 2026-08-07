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

  it('⚠ one act, one command id — reused across every retry in the session', () => {
    // Custody dedupes on it and replays its recorded answer, so a double tap
    // or a lost response can never produce two custody transitions.
    expect(app).toMatch(/verifyActId = useRef\(mintActId\(\)\)/);
    expect(app).toMatch(/sealActId = useRef\(mintActId\(\)\)/);
    expect(app).toMatch(/commandId: verifyActId\.current/);
    expect(app).toMatch(/commandId: sealActId\.current/);
    // Never re-minted at send time — that would defeat the dedup entirely.
    expect(app).not.toMatch(/commandId: mintActId\(\)/);
  });

  it('an honest empty state when the rider carries nothing', () => {
    expect(app).toMatch(/assignment\.none_title/);
    expect(app).toMatch(/assignment\.none_hint/);
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
