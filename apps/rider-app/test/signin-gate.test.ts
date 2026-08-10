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
const kit = readFileSync(join(appDir, 'src/ui/faso-act-code.tsx'), 'utf8');

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
    expect(app).toMatch(/attemptFor\(\s*`verify\|/);
    expect(app).toMatch(/attemptFor\(\s*`seal\|/);
    /**
     * ⚠ DERIVED FROM THE PAYLOAD, NOT PINNED TO A LITERAL. This assertion used
     * to be the exact key string — comment claiming « covers every field »,
     * regex pinning a key that was MISSING `evidenceBundleId`. It did not just
     * fail to catch the hole, it would have failed anyone who closed it. A test
     * that must be edited to fix the bug it names is worse than no test.
     *
     * So it now reads the call site: every value the app SENDS must appear in
     * the key, because custody's `fingerprint()` excludes only `command_id` and
     * `at`. `dwellSec` is the one exemption, and it is exempt by construction —
     * `attemptFor` mints it TOGETHER with the id and freezes both, so it cannot
     * vary for a given key. Add a field to the payload and forget the key, and
     * this fails.
     */
    const verifySite = app.slice(app.indexOf('custodyActs.verifyPickup'), app.indexOf('riderCode,\n        ),\n      );', app.indexOf('custodyActs.verifyPickup')));
    const keyExpr = (/attemptFor\(\s*`verify\|([^`]*)`/.exec(app) ?? [])[1];
    expect(keyExpr, 'the verify attempt key').toBeTypeOf('string');
    const sent = [...verifySite.matchAll(/^\s{12}(\w+):\s*(.+?),\s*$/gm)].map(([, field, expr]) => ({
      field: field as string,
      expr: (expr as string).trim(),
    }));
    // The call site really was parsed — an empty list must never pass silently.
    expect(sent.map((f) => f.field)).toContain('evidenceBundleId');
    for (const { field, expr } of sent) {
      if (field === 'commandId' || field === 'dwellSec') continue;
      expect(keyExpr, `${field} enters custody's fingerprint, so it must key the attempt`).toContain(expr);
    }
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

  it('⚠ no photo, no SEAL — the ref custody depends on is never fabricated (blocker A7)', () => {
    // `ev-<uuid>` named a bundle that never existed, defeating the spine's
    // no_evidence_refs guard and writing a dangling pointer into the ledger.
    expect(app, 'a synthetic evidence ref').not.toMatch(/`ev-\$\{/);
    /**
     * ⚠ THE VERIFY HALF OF THIS PIN IS RETIRED BY FOUNDER RULING (2026-08-09):
     * « camera capture is optional, and it's used only in case if product on
     * pick up is different from the photos. » A7's guard had become a DEAD
     * BUTTON — « Envoyer » did nothing, silently, for any rider whose package
     * matched. What A7 was really protecting is the SEAL, whose
     * `no_evidence_refs` guard lives in the spine and is unchanged below; the
     * no-photo verification now carries a value that says so by name
     * (`sans-photo-…`), which is pinned in photo-facultative.test.ts.
     */
    /**
     * ⚠ AND THE SEAL HALF IS RETIRED TOO — FOUNDER RULING (2026-08-10):
     * « terminate that sealing code and the sealing photo proof requirement …
     * photo capture is optional and only required when one the 3 answers is
     * non. » The seal is machine-carried and registers itself; there is no
     * seal screen and no seal photo.
     *
     * A7's REAL lesson is what this now pins, and it is stronger than the old
     * line was: the app sends an EMPTY list — it does not fabricate a ref to
     * fill the gap, and it does not send a seal it was not given.
     */
    expect(app, 'the seal photo list is empty, never invented').toMatch(/sealPhotoRefs: \[\],/);
    expect(app, 'no seal id, no act — never a made-up seal').toMatch(/if \(scelle === null\) return;/);
    expect(app, 'the seal comes from the SERVER, not from a screen').toMatch(/liveAssignment\?\.codeScelle/);
    expect(app, 'the typed seal field is gone').not.toMatch(/seal\.id_placeholder/);
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
  it('a wired build claims delivery only when the outbox settled it (A2 → A5)', () => {
    /**
     * The premise changed between rounds and the test had to change with it.
     * A2: there was NO SOS route, the sandbox sender answered `applied` for
     * everything, and the sheet said « Alerte envoyée. / On cherche quelqu'un
     * pour vous. » — a false safety promise. A5: 4d built `POST /rider/sos`,
     * and the A2 fix's « le téléphone n'a pas encore de lien direct » became
     * its own lie, sending a rider in danger off to find a phone number.
     *
     * The invariant under both: **the words follow the DELIVERY FACT, never
     * the build flag and never the gesture.**
     */
    const sheet = app.slice(app.indexOf('<SosSheet'), app.indexOf('escalated: t('));
    // Three distinct states, and « reçu » is reachable only from 'reached'.
    expect(sheet).toMatch(/sosDelivered === 'reached'\s*\?\s*t\('sos\.reached'\)/);
    expect(sheet).toMatch(/sosDelivered === 'owed'/);
    expect(sheet).toMatch(/t\('sos\.sending'\)/);
    // The demo's « on cherche quelqu'un pour vous » must never reach a wired
    // rider: it is only ever the !WIRED arm of the ternary.
    expect(sheet).toMatch(/:\s*t\('sos\.raised'\)/);
    expect(sheet, 'a flat wired claim').not.toMatch(/raised: WIRED \? t\('sos\.raised'\)/);
    // And the fact itself is read from the outbox, not from « it did not throw ».
    expect(app).toMatch(/stillPending\(outboxStore, commandId\)/);
  });

  it('⚠ the ESCALATED path cannot promise a channel that is not bound', () => {
    // Unreachable today only because SANDBOX_DISPATCH_HOURS is 'in_hours'. One
    // constant flip and a wired build would say « on alerte le responsable »
    // while ESCALATION_TRANSPORT has no channel — blocker A2's false safety
    // promise, re-armed. It follows the same delivery fact as `raised`.
    const sheet = app.slice(app.indexOf('<SosSheet'), app.indexOf('previewAck:'));
    const escalated = sheet.slice(sheet.indexOf('escalated: WIRED'), sheet.indexOf('transportPending'));
    expect(escalated.length, 'the escalated arm was found').toBeGreaterThan(50);
    expect(escalated).toMatch(/sosDelivered === 'reached'/);
    expect(escalated, 'a flat wired promise').not.toMatch(/^\s*escalated: t\('sos\.escalated'\)/m);
  });

  it('⚠ a camera that never answers cannot lock the screen for ever', () => {
    // While `capturing` is true BOTH the photo button and the send are
    // disabled. An unsettled launchCameraAsync left the rider with a screen
    // they could not use and no way out.
    const body = app.slice(app.indexOf('const takePhoto = useCallback'), app.indexOf('const attempts = useRef'));
    expect(body).toMatch(/CAPTURE_DEADLINE_MS/);
    expect(body).toMatch(/setCapturing\(false\)/);
    expect(app).toMatch(/const CAPTURE_DEADLINE_MS = \d[\d_]*;/);
  });

  it('⚠ a build with no bucket says so, instead of blaming the network', () => {
    // 'unreachable' reads « La photo n'est pas partie. Réessayez. » — false
    // advice when no retry can ever work and the camera never even opened.
    expect(app).toMatch(/issue\.reason === 'unconfigured'\) return 'photo\.unconfigured'/);
  });

  it('⚠ the alert is SENT when it is raised, not only on the next reconnect (A5)', () => {
    // `fireSos` only appended to the outbox, and the sole caller of the sender
    // was a reconnect effect whose deps `fireSos` changes NONE of. A rider in
    // danger, online and signed in, held the disc — and the raise sat on the
    // handset until the device happened to bounce offline→online.
    const fire = app.slice(app.indexOf('const fireSos = useCallback'), app.indexOf('const sosHoldStart'));
    expect(fire).toMatch(/appendSosRaise/);
    expect(fire, 'the raise must leave the phone now').toMatch(/drainOnReconnect\(outboxStore, reconnectSender\)/);
    expect(fire).toMatch(/setSosDelivered/);
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
    // blocks only an unfinished list. VRAI-ROUTE (2026-08-10): the typed code
    // field is gone, so the gate now lives on the primary button itself —
    // still ANSWERED, still never the photo.
    expect(app).toMatch(/const allAnswered = POLICY_CHECK_IDS\.every\(\(id\) => checks\[id\] !== undefined\)/);
    expect(app).toMatch(/disabled=\{!allAnswered \|\| verifyPhase\.kind === 'working' \|\| capturing\}/);
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

describe('⚠ the ports are CALLED, not merely present (blockers A1 + A2, round two)', () => {
  /**
   * THE FAILURE THIS EXISTS FOR. `evidence-capture.ts` and `act-memory.ts` were
   * both written, both well tested, and both wired to NOTHING. The verifier
   * deleted the entire capture machinery from App.tsx, replaced it with
   * `const verifyBundleId = null`, and the suite still reported 260/260 with
   * typecheck 0 — because every assertion checked that the GUARDS existed, and
   * a guard is most perfectly satisfied when the thing it guards can never
   * happen. A port nothing calls is worse than a port that is missing: it reads
   * as done, and every gate stays green over it.
   *
   * So these assert CALL SITES, and each one is mutation-checked.
   */
  it('⚠ BOTH ACTS ARE MOUNTED — the send button is wired to the sender', () => {
    /**
     * ⚠ THE HOLE THE ROUND-TWO TESTS LEFT (verifier blocker A2, round three).
     * Those assertions proved the photo port and the memory port had callers.
     * They did not prove the ACTS were reachable. Mutation, verified applied:
     * replacing `onSubmit={sendVerification}` with an empty arrow left
     * **274/274 passing and typecheck 0** — the rider answers nine checks,
     * takes the photo, types the dispatcher's code, taps the enabled primary
     * button, and nothing happens for ever. Byte-for-byte the round-two
     * blocker, through a hole in the test written to prevent it.
     *
     * `noUnusedLocals` is off, so the compiler is silent about the orphaned
     * sender too. Only this can catch it.
     */
    // VRAI-ROUTE (2026-08-10): the verification's gesture is the primary
    // button itself now — the typed field (and its onSubmit) are gone.
    expect(app, 'the verification act').toMatch(/onPress=\{sendVerification\}/);
    /**
     * ⚠ THE SEAL HAS NO GESTURE ANY MORE (ROUTE-DIRECTE, 2026-08-10) — so the
     * hole this test exists to close moves with it. There is no button to
     * wire; the CALL SITE is the effect, and an effect that never fires is
     * exactly the dead-primary-action bug in a new costume. Pin the call, and
     * pin the condition that lets it fire.
     */
    expect(app, 'the seal act is CALLED, with no tap').toMatch(/sendSeal\(scelle\);/);
    expect(app, '…on the ledger accepting the verification').toMatch(/sealScreenIsDue\(verifyPhase, remembered\)/);
    expect(app, '…and never twice').toMatch(/!packageIsHeld\(sealPhase, remembered\)/);
    /**
     * ⚠ A STALE DEP ARRAY IS A DEAD PRIMARY ACTION, AND THE STRING ASSERTIONS
     * ABOVE CANNOT SEE IT. Mutation, verified applied: changing this effect's
     * deps to `[WIRED]` means it can never re-run after mount — the seal never
     * fires for ANY rider, every one of them sits on « Séra enregistre le
     * scellé » for ever, the road never opens — and the whole board stayed
     * green. Byte for byte the round-two blocker (« 260 green tests over a
     * dead primary action ») in a new costume, reachable because this slice
     * turned a tap into an effect.
     *
     * So the deps are pinned to the values the effect READS. Add a value and
     * forget the array, or trim the array, and this fails.
     */
    const sealEffect = app.slice(app.indexOf('const scelleAuto ='), app.indexOf('const sealPourRemise'));
    expect(sealEffect, 'the auto-seal effect block').toContain('sendSeal(scelle);');
    expect(sealEffect, 'every value the effect reads must be a dependency')
      .toContain('}, [WIRED, scelleAuto, liveAssignment, sendSeal]);');
    /**
     * …and the ONE recovery path, because the effect fires only from `idle`
     * and nothing resets it mid-course: a waiting answer (offline /
     * unreachable) must leave a lever the rider can actually press, or
     * « Réessayez » is a lie told to someone holding a package.
     */
    expect(app, 'a retry the rider can tap').toMatch(/label=\{t\('seal\.reessayer'\)\}/);
    expect(app, '…offered only where retrying can work').toMatch(/o\.tone === 'waiting' && scelle !== null \?/);
    expect(app, '…and the phases are per-course, so a new order is not born spent')
      .toMatch(/setSealPhase\(ACT_IDLE\);/);
    // And the senders really call the ports, in the arm that renders them.
    expect(app).toMatch(/const sendVerification = useCallback\(/);
    expect(app).toMatch(/const sendSeal = useCallback\(/);
    expect(app).toMatch(/custodyActs\.verifyPickup\(/);
    expect(app).toMatch(/custodyActs\.beginCustody\(/);
  });

  it('⚠ a captured ref actually reaches the state the act reads', () => {
    // Second mutation that survived round two: `if (false && outcome.ok)
    // keep(outcome.ref)` — camera opens, bytes upload, bucket returns a ref,
    // and the send stays disabled for ever. The keep() call is the whole
    // bridge between the port and the payload.
    const takePhotoBody = app.slice(app.indexOf('const takePhoto = useCallback'), app.indexOf('const attempts = useRef'));
    // RIDER-DELIVERY-SCREEN evolved the keep to the FULL artifact — ref plus
    // the measured hash and the bucket's own mimeType — same bridge, richer.
    expect(takePhotoBody).toMatch(/if \(outcome\.ok\) keep\(\{ ref: outcome\.ref, sha256: outcome\.sha256, mimeType: outcome\.mimeType \}\)/);
    expect(takePhotoBody, 'a short-circuited keep').not.toMatch(/if \(false|&& outcome\.ok\) keep/);
    // …and the two keeps are the two act states, not a shared scratch value.
    expect(app).toMatch(/evidenceBundleId: verifyBundleId/);
    /**
     * PORTE-SANS-PHOTO (2026-08-10): the door camera is gone too, so there is
     * exactly ONE keep left in the app — the pickup one. That single bridge is
     * the whole of what this test protects now.
     */
    expect(app.match(/keep\(\{ ref: outcome\.ref/g), 'one keep, one camera').toHaveLength(1);
    expect(app, 'the door camera must be gone').not.toMatch(/setDropArt/);
  });

  it('⚠ TWO cameras, and the pickup one only when a check says « Non »', () => {
    /**
     * FOUNDER RULING, restated 2026-08-10: « photo capture is optional and
     * only required when one the 3 answers is non ». So the rider meets a
     * camera in exactly two places, and NEITHER is the seal:
     *   · the PICKUP camera, mounted only on a reported difference, never
     *     demanded (his 2026-08-09 ruling, unchanged);
     *   · the DOOR camera, which the delivery still cannot go without.
     * The seal camera is GONE — declaration and call site both.
     */
    /**
     * ⚠ ONE CAMERA IN THE WHOLE APP — and this is the assertion that now
     * carries the founder's rule end to end. « photo capture is optional and
     * only required when one the 3 answers is non » (2026-08-10), plus « for
     * the door photo I want it gone » — so: not at the seal, not at the door,
     * once at pickup and only on a reported difference.
     */
    expect(app.match(/takePhoto\(/g), 'ONE call site: the pickup difference camera').toHaveLength(1);
    expect(app, 'the verification photo').toMatch(/onPress=\{\(\) => takePhoto\(\(art\) => setVerifyBundleId\(art\.ref\)\)\}/);
    expect(app, 'the seal camera must be gone entirely').not.toMatch(/setSealPhotoRefs/);
    expect(app, 'the door camera must be gone entirely').not.toMatch(/setDropArt/);
    // No FasoActCode photo fold survives — the seal was the only one.
    expect(app.match(/photo=\{\{/g), 'no act-code photo fold remains').toBeNull();
    expect(app, 'the verify camera, mounted only on a reported difference').toMatch(
      /\{ecartConstate \? \(/,
    );
  });

  it('the send stays shut until the BUCKET holds the photo, and says why — where the photo is REQUIRED', () => {
    // `taken` must read the ref the bucket returned — never « the camera
    // opened », which would re-admit the fabricated-ref bug (A7). On the
    // verify card (inline since VRAI-ROUTE) the same truth drives the
    // take/retake label and the « Photo enregistrée. » line.
    expect(app).toMatch(/label=\{t\(verifyBundleId !== null \? 'photo\.retake' : 'photo\.take'\)\}/);
    expect(app).toMatch(/\{verifyBundleId !== null \? <FasoBody>\{t\('photo\.taken'\)\}<\/FasoBody> : null\}/);
    /**
     * The founder's ruling, twice given (2026-08-09, restated 2026-08-10):
     * « photo capture is optional and only required when one the 3 answers is
     * non ». So the PICKUP send never reads the photo at all — and the one
     * place a photo is still REQUIRED is the door, where the bundle carries
     * the artifact the validation reads (« GPS never sole proof »).
     */
    expect(kit).toMatch(/const photoReady = photo === undefined \|\| photo\.optional === true \|\| photo\.taken/);
    expect(app, 'the verify send never waits on the photo').toMatch(
      /disabled=\{!allAnswered \|\| verifyPhase\.kind === 'working' \|\| capturing\}/,
    );
    /**
     * ⚠ AND THE DOOR SENDS AN EMPTY LIST — never a fabricated artifact to fill
     * the space the camera left. That is A7's lesson at the third and last
     * place it could have been broken.
     */
    expect(app, 'the door bundle carries no artifact').toMatch(/artifacts: \[\],/);
    expect(app, '…and is fired by the arrival, not a tap').toMatch(/sendDeliveryEvidence\(\);/);
    expect(app, '…once, and never over a held bundle').toMatch(/!evidenceIsHeld\(evidencePhase\)\s*$/m);
    // Same dep-array law as the seal: a stale array is a dead primary action.
    const preuveEffect = app.slice(app.indexOf('const preuveAuto ='), app.indexOf('const sendDrop'));
    expect(preuveEffect, 'every value the effect reads must be a dependency')
      .toContain('}, [WIRED, preuveAuto, sendDeliveryEvidence]);');
    expect(app, 'a retry the rider can tap at the door').toMatch(/label=\{t\('delivery\.preuve_reessayer'\)\}/);
    expect(kit).toMatch(/ready =[^;]*photoReady/);
    // A disabled primary action must always name what is missing.
    expect(kit).toMatch(/photo !== undefined && !photo\.taken \? <Body>\{photo\.neededLabel\}/);
  });

  it('the act memory is loaded and written, not merely defined', () => {
    expect(app, 'ruling ③ load').toMatch(/loadActMemory\(actMemoryStore, dwellOrderId\)/);
    expect(app, 'ruling ③ write').toMatch(/rememberAct\(actMemoryStore, \{/);
    // ⚠ AND ITS OWN STORE, NOT THE OUTBOX'S (blocker A1, round four). Sharing
    // one file meant an array and an object destroying each other: a raised SOS
    // that was never persisted and never sent, or a lost custody stage.
    expect(app).toMatch(/const actMemoryStore = useMemo\(\(\) => createDocumentActMemoryStore\(\), \[\]\)/);
    // And the screen consults it, so a relaunched rider is put back.
    expect(app).toMatch(/packageIsHeld\(sealPhase, remembered\)/);
    expect(app).toMatch(/sealScreenIsDue\(verifyPhase, remembered\)/);
  });

  it('⚠ the phone remembers only what the LEDGER said', () => {
    // Writing a stage the server never confirmed would put a rider on a seal
    // screen for goods nobody accepted.
    const remember = app.slice(app.indexOf('const stage: ActStage | null'), app.indexOf('}).catch(() => setPersistFailed(true));'));
    expect(remember).toMatch(/holdsPackage\(sealPhase\)/);
    expect(remember).toMatch(/maySeal\(verifyPhase\)/);
    expect(remember, 'a stage written from a mere send').not.toMatch(
      /kind === 'working'|\bdidSend\b|\bwasSent\b|\bjustSent\b/,
    );
  });

  it('⚠ and it never writes a secret to the phone', () => {
    const remember = app.slice(app.indexOf('void rememberAct('), app.indexOf('}).catch(() => setPersistFailed(true));'));
    for (const secret of ['pickupCode', 'sealId', 'riderCode', 'signInState.code']) {
      expect(remember, `${secret} must never be persisted`).not.toContain(secret);
    }
  });
});
