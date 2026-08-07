import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SE-LIVE-4c-ii · the sign-in screen's disciplines, scanned in source — the
 * house pattern for this app's visual layer (`ui-kit.test.ts`), because
 * react-native does not render under vitest here.
 *
 * ⚠ THE ONE THAT MATTERS MOST: the rider's personal code is a CREDENTIAL. It
 * opens the custody seal. It must live in memory while the rider is signed in
 * and NOWHERE else — not in the outbox, not in the document store, not in a
 * log line, not in an analytics event. These scans are the standing guard on
 * that, in the same spirit as the repo's `no-rider-asserted-payment` gate.
 */

const appDir = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(appDir, f), 'utf8');

const SCREEN = 'src/ui/faso-signin.tsx';
/** Every file that touches the code on its way to the wire. */
const CODE_PATH_FILES = [
  SCREEN,
  'src/net/rider-code.ts',
  'src/net/signin-model.ts',
  'src/net/rider-session.ts',
  'src/net/httpRiderSession.ts',
  'src/net/resolveRiderSession.ts',
];

describe('the rider code never leaves memory', () => {
  it('no file on the code path writes it to storage', () => {
    for (const f of CODE_PATH_FILES) {
      const src = read(f);
      // The two persistence surfaces this app has. A credential reaching
      // either one would survive an app kill on a phone that gets shared,
      // lost, or handed to a colleague.
      expect(src, `${f} imports the document store`).not.toMatch(/from\s+'.*documentStore'/);
      expect(src, `${f} imports the outbox`).not.toMatch(/from\s+'.*\/outbox'/);
      expect(src, `${f} touches AsyncStorage`).not.toMatch(/AsyncStorage/);
      expect(src, `${f} touches SecureStore`).not.toMatch(/SecureStore/);
      expect(src, `${f} writes a file`).not.toMatch(/writeAsStringAsync|FileSystem\./);
    }
  });

  it('no file on the code path logs anything', () => {
    // A console line is the easiest way a credential ends up in a crash
    // report or a device log a shop can read.
    for (const f of CODE_PATH_FILES) {
      expect(read(f), `${f} carries a console call`).not.toMatch(/\bconsole\.\w+\s*\(/);
    }
  });

  it('the code is not put in the URL, where proxies and logs would keep it', () => {
    const src = read('src/net/httpRiderSession.ts');
    // It must travel in the Authorization header, never a query string.
    expect(src).toMatch(/Authorization/);
    expect(src, 'the code is interpolated into the URL').not.toMatch(/\$\{root\}[^`]*\$\{code\}/);
    expect(src, 'the code is a query parameter').not.toMatch(/[?&]code=/);
  });
});

describe('the field is built for a credential read off paper', () => {
  const src = read(SCREEN);

  it('turns off every keyboard "helper" that would rewrite the code', () => {
    // Autocorrect turning « SR-ABCD » into a word is a refusal the rider
    // cannot see, explain, or work around.
    expect(src).toMatch(/autoCorrect=\{false\}/);
    expect(src).toMatch(/spellCheck=\{false\}/);
    expect(src).toMatch(/autoComplete="off"/);
    expect(src).toMatch(/autoCapitalize="characters"/);
  });

  it('cannot fire a second sign-in while one is in flight', () => {
    // On a slow network a rider taps again. That must not send a second
    // request, and the field must not be editable mid-flight.
    expect(src).toMatch(/disabled=\{working\}/);
    expect(src).toMatch(/editable=\{!working\}/);
  });

  it('⚠ does not mask the field — it shows exactly what was typed (blocker A1)', () => {
    // A controlled mask re-applied its own formatter to its own output every
    // keystroke, absorbing the rider's own S and R into the body and sending a
    // well-formed WRONG code. The field must never rewrite the rider
    // mid-entry; grouping is confirmation BELOW it. The masking helper is
    // deleted outright, so the scan below also proves it stayed deleted.
    expect(src).toMatch(/value=\{typed\}/);
    expect(src, 'the field re-masks its own output').not.toMatch(/value=\{displayRiderCode/);
    expect(src, 'the confirmation must be read-only feedback').toMatch(/confirmed/);
  });

  it('meets the ≥44px touch target and centres the code', () => {
    expect(src).toMatch(/minHeight:\s*(4[4-9]|[5-9]\d|\d{3,})/);
    expect(src).toMatch(/textAlign:\s*'center'/);
  });
});

describe('the screen obeys the design system', () => {
  const src = read(SCREEN);

  it('SCAN: zero hardcoded colours', () => {
    expect(src, 'hex colour').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src, 'rgb() colour').not.toMatch(/\brgba?\(/);
    expect(src, 'named CSS colour literal').not.toMatch(/colou?r:\s*'(?!#)[a-z]+'/);
  });

  it('carries no inline user-facing string — every word comes from the catalog', () => {
    // Contract §10.5: strings live in the i18n catalog with register tags.
    // The screen takes them as props; it must not spell any of them itself.
    // (Accented French in a JSX text position is the tell.)
    expect(src).not.toMatch(/>\s*[A-ZÉÈÀÇ][a-zéèàçêôûî]{3,}[^<]*</);
    expect(src).toMatch(/strings\./);
  });

  it('shows the refusal in place, never as an alert or a modal', () => {
    // Honest states are designed states — an error wall is not a design.
    expect(src).not.toMatch(/\bAlert\.alert\b/);
    expect(src).not.toMatch(/\bModal\b/);
    expect(src).toMatch(/refusal/);
  });
});
