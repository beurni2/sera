import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';

/**
 * ═══ RENDU-RÉEL — PROFIL-PUBLIÉ (founder ruling 2026-09-30, Boutik+
 * AUDIT-B+2 F-55: « No live pages should show any test mode banner ») ═══
 *
 * The rider app's published channel is the road to real riders, and it wore
 * « Aperçu — bac à sable » on every screen: the publish step set no profile,
 * and an unset profile means `preview`. Shop+'s reseller app was fixed the
 * same way (PROFIL-PUBLIÉ, AUDIT-SHOP-2 F-43).
 *
 * The walk reads the profile FROM THE PUBLISH STEP ITSELF, sets it, mounts
 * the real app and walks a rider in: no banner on the sign-in screen, none on
 * the course, and the rider still reaches « Vérifier le colis ». The CONTROL
 * mounts with the profile unset (a local Expo Go run): the banner IS there —
 * which makes the first walk's « not there » a measurement, not a vacuous pass.
 *
 * Appearance is not claimed (the standing order forbids it) — only which
 * strings are in the tree and that the rider can still get to the next step.
 */

const BANDEAU = 'Aperçu — bac à sable';
const CODE = 'SR-ABCD-EFGH-JKMN';
const appDir = join(import.meta.dirname, '..');

/** The value the publish step gives `EXPO_PUBLIC_PROFILE` — from its `env:`
 *  block only (it ends where `run:` begins), never from a comment or the script. */
function profilPublie(): string | undefined {
  const workflow = readFileSync(join(appDir, '..', '..', '.github', 'workflows', 'expo-preview.yml'), 'utf8');
  const debut = workflow.indexOf('Publish rider-app preview update');
  if (debut < 0) throw new Error('the publish step is not in the workflow — this walk is watching nothing');
  const step = workflow.slice(debut);
  const finEnv = step.indexOf('\n        run:');
  if (finEnv < 0) throw new Error('the publish step has no run: line');
  return /^\s+EXPO_PUBLIC_PROFILE: '([^']*)'$/m.exec(step.slice(0, finEnv))?.[1];
}

/** `/rider/moi` and the ack door, in the shapes the logistics Worker sends
 *  (the same stand-in `rendu-course` walks, reduced to one waiting course). */
const logistics = (): Route => {
  let status = 'active_unacknowledged';
  return (path) => {
    if (path === '/rider/moi') {
      return {
        status: 200,
        json: {
          ok: true,
          rider: {
            riderId: 'rider-profil', displayName: 'Boss', certified: true, privacyAckOk: true,
            shift: { status: 'on_shift' },
            assignment: {
              assignmentId: 'as-1', taskId: 'task-1', orderId: 'ord-profil-1', status,
              ackDeadline: null,
              location: { landmark: 'La pharmacie du marché', directions: 'Après le carrefour', zone: 'Gounghin, Ouagadougou' },
              preuvePhotoRefs: [], repereAudioRef: null,
              codeRamassage: 'ABC-DEF',
              ramassageConfirmeAt: null, codeVerification: null, codeScelle: null,
            },
          },
        },
      };
    }
    if (path === '/rider/assignment/ack') {
      status = 'acknowledged';
      return { status: 200, json: { ok: true } };
    }
    return null;
  };
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  __resetFiles();
  wiredEnv();
});
afterEach(() => {
  delete process.env['EXPO_PUBLIC_PROFILE'];
  vi.useRealTimers();
});

describe('PROFIL-PUBLIÉ — the published rider app wears no test banner; a local run still does', () => {
  it('on the profile the publish step sets: no banner at the door or on the course, and the rider still reaches « Vérifier le colis »', async () => {
    const profil = profilPublie();
    expect(profil, 'the publish step sets no EXPO_PUBLIC_PROFILE — the live app would wear the banner').toBe('production');
    process.env['EXPO_PUBLIC_PROFILE'] = profil;
    wire([logistics()]);
    const s = await mountRider();

    expect(s.canPress('Entrer'), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows(BANDEAU), 'the sign-in screen wears the test banner on the live profile').toBe(false);

    await s.type(CODE);
    await s.press('Entrer');
    expect(s.shows('Une course pour vous'), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows(BANDEAU), 'the course screen wears the test banner on the live profile').toBe(false);

    await s.press('Accepter la course');
    expect(s.shows('Vérifier le colis'), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows(BANDEAU)).toBe(false);
    s.unmount();
  });

  it('CONTROL — profile unset (a local Expo Go run): the banner IS on screen, at the door and on the course', async () => {
    delete process.env['EXPO_PUBLIC_PROFILE'];
    wire([logistics()]);
    const s = await mountRider();
    expect(s.shows(BANDEAU), 'the local default lost its banner — the walk above would measure nothing').toBe(true);
    await s.type(CODE);
    await s.press('Entrer');
    expect(s.shows('Une course pour vous')).toBe(true);
    expect(s.shows(BANDEAU)).toBe(true);
    s.unmount();
  });
});
