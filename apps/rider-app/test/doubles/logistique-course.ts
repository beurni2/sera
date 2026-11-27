import type { Route } from '../rendu';

/**
 * RENDU-RÉEL — the logistics side of one course: `/rider/moi` and the ack door,
 * answering from live state so the screen sees what a real poll would show.
 *
 * ⚠ CERTIFIED TO THE REAL WORKER (Execution Contract §3), not written from
 * memory: `services/logistics-service/test/prise-en-charge.e2e.test.ts`
 * drives the real logistics Worker and this stand-in through the same steps
 * (assign, accept, supplier confirms) and requires the same fields to be null
 * or present at each one. The bound it serves is the Worker's: the ramassage
 * code only on an accepted course, the custody code and the seals only on an
 * accepted course the supplier confirmed; her landmark, directions and
 * voice note only on an accepted course (the area alone before). A walk
 * that sets the codes before the confirmation still sees them withheld until
 * both are true — this stand-in can never be kinder than the Worker.
 *
 * Its bound, like every double here: it says nothing about appearance.
 */
export interface CourseState {
  status: 'active_unacknowledged' | 'acknowledged';
  ramassageConfirmeAt: string | null;
  codeVerification: string | null;
  codeScelle: string | null;
  /** The SE1 ladder's last rung. A rider can drop off it mid-course. */
  shift: 'on_shift' | 'off_shift';
}

export const CODE_RAMASSAGE = 'ABC-DEF';

export const freshCourse = (): CourseState => ({
  status: 'active_unacknowledged',
  ramassageConfirmeAt: null,
  codeVerification: null,
  codeScelle: null,
  shift: 'on_shift',
});

export function logistiqueCourse(state: CourseState, order: string): Route {
  return (path) => {
    if (path === '/rider/moi') {
      const acceptee = state.status === 'acknowledged';
      const remis = acceptee && state.ramassageConfirmeAt !== null;
      return {
        status: 200,
        json: {
          ok: true,
          rider: {
            riderId: 'rider-rendu', displayName: 'Boss', certified: true, privacyAckOk: true,
            shift: { status: state.shift },
            assignment: {
              assignmentId: 'as-1', taskId: 'task-1', orderId: order, status: state.status,
              ackDeadline: null,
              // Her place and her voice only on an accepted course: before,
              // the area alone (the Worker's `riderView`, same bound).
              location: acceptee
                ? { landmark: 'La pharmacie du marché', directions: 'Après le carrefour', zone: 'Gounghin, Ouagadougou' }
                : { zone: 'Gounghin, Ouagadougou' },
              preuvePhotoRefs: [], repereAudioRef: acceptee ? 'media/11111111-2222-4333-8444-555555555555' : null,
              codeRamassage: acceptee ? CODE_RAMASSAGE : null,
              ramassageConfirmeAt: state.ramassageConfirmeAt,
              codeVerification: remis ? state.codeVerification : null,
              codeScelle: remis ? state.codeScelle : null,
            },
          },
        },
      };
    }
    if (path === '/rider/assignment/ack') {
      // The Worker answers a repeated accept as the acceptance it repeats.
      const duplicate = state.status === 'acknowledged';
      state.status = 'acknowledged';
      return { status: 200, json: { ok: true, status: 'acknowledged', pending: false, anchored: true, ...(duplicate ? { duplicate: true } : {}) } };
    }
    return null;
  };
}
