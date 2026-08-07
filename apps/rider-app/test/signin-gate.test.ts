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
