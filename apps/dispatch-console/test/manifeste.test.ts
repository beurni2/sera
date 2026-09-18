import { describe, expect, it } from 'vitest';
import {
  FIN_SERVICE_IDLE,
  annulerFin,
  commencerFin,
  demanderFin,
  etapeKey,
  finEchouee,
  finFaite,
  finRefusKey,
  manifesteRows,
  nextOwnerKey,
  refReprise,
} from '../src/manifeste';

/** MANIFESTE-1 — the desk's pure read and its one-card-at-a-time state. */

const board = {
  ok: true,
  board: {
    riders: [{ riderId: 'rider-b', displayName: 'Boss' }, { riderId: 'rider-a', displayName: 'Awa' }],
    manifestes: {
      'rider-b': {
        id: 'man-rider-b', riderId: 'rider-b', version: 2, status: 'active',
        orderedStops: ['livraison-as-1'], custodyInventory: ['pkg-1'],
        stops: [{ stopId: 'livraison-as-1', kind: 'livraison', orderId: 'ord-1' }],
        currentStop: { stopId: 'livraison-as-1', kind: 'livraison', orderId: 'ord-1' },
        custodyReadings: [{ orderId: 'ord-1', reading: 'coursier', asOf: '2026-09-18T09:00:00.000Z' }],
      },
      'rider-a': {
        id: 'man-rider-a', riderId: 'rider-a', version: 1, status: 'active',
        orderedStops: [], custodyInventory: ['pkg-2'], stops: [], currentStop: null,
        custodyReadings: [{ orderId: 'ord-2', reading: 'inconnue', asOf: null }],
      },
      '': { status: 'active' },
    },
    finDeService: {
      'rider-b': { dispatcherAckId: 'cmd-1', nextOwner: { kind: 'return_to_hub_task', ref: 'ord-1' }, packageIds: ['pkg-1'], at: '2026-09-18T18:00:00.000Z' },
    },
  },
};

describe('manifesteRows — the board’s manifests, read defensively, sorted by name', () => {
  it('one row per rider with a manifest: the one current stop or none, the packages, an unknown reading said, the pending exception', () => {
    const rows = manifesteRows(board);
    expect(rows).toEqual([
      { riderId: 'rider-a', riderName: 'Awa', currentStop: null, stopsCount: 0, packageIds: ['pkg-2'], lectureInconnue: true, finDeService: null },
      {
        riderId: 'rider-b', riderName: 'Boss', currentStop: { kind: 'livraison', orderId: 'ord-1' }, stopsCount: 1, packageIds: ['pkg-1'], lectureInconnue: false,
        finDeService: { nextOwner: 'return_to_hub_task', packageIds: ['pkg-1'], at: '2026-09-18T18:00:00.000Z' },
      },
    ]);
  });

  it('a malformed board blanks nothing: no manifests, no rows; a stop kind it does not know is no stop', () => {
    expect(manifesteRows(null)).toEqual([]);
    expect(manifesteRows({ ok: true, board: { riders: [] } })).toEqual([]);
    const rows = manifesteRows({ board: { manifestes: { r: { currentStop: { kind: 'teleport', orderId: 'o' }, custodyInventory: 'no' } } } });
    expect(rows).toEqual([{ riderId: 'r', riderName: 'r', currentStop: null, stopsCount: 0, packageIds: [], lectureInconnue: false, finDeService: null }]);
  });

  it('every word is a catalog key', () => {
    expect(etapeKey('ramassage')).toBe('manifeste.etape_ramassage');
    expect(etapeKey('livraison')).toBe('manifeste.etape_livraison');
    expect(etapeKey('retour')).toBe('manifeste.etape_retour');
    expect(nextOwnerKey('return_to_hub_task')).toBe('fin_service.base');
    expect(nextOwnerKey('reassignment')).toBe('fin_service.autre_coursier');
    expect(finRefusKey('rider_not_carrying')).toBe('fin_service.refus_pas_de_colis');
    expect(finRefusKey('custody_unverifiable')).toBe('fin_service.refus_garde_illisible');
    expect(finRefusKey('anything_else')).toBe('fin_service.echec');
  });

  it('« un autre coursier reprend » names WHICH one — blank or spaces is nobody, and nobody is refused locally', () => {
    expect(refReprise('')).toBeNull();
    expect(refReprise('   ')).toBeNull();
    expect(refReprise('  rider-awa ')).toBe('rider-awa');
  });
});

describe('the end-of-service card — one open, one in flight, the id minted once and reused on a retry', () => {
  it('demander opens ONE card and keeps its id on a re-ask; annuler closes it; commencer commits only that rider; a failure keeps the card with its reason; success closes it', () => {
    let ui = demanderFin(FIN_SERVICE_IDLE, 'rider-b', 'cmd-x');
    expect(ui.demande).toEqual({ riderId: 'rider-b', commandId: 'cmd-x' });
    ui = demanderFin(ui, 'rider-b', 'cmd-y');
    expect(ui.demande?.commandId, 'a retry reuses the minted id').toBe('cmd-x');
    ui = demanderFin(ui, 'rider-a', 'cmd-z');
    expect(ui.demande).toEqual({ riderId: 'rider-a', commandId: 'cmd-z' });
    expect(annulerFin(ui).demande).toBeNull();
    expect(commencerFin(ui, 'rider-b'), 'only the rider whose card is open').toBeNull();
    const started = commencerFin(ui, 'rider-a');
    expect(started?.commandId).toBe('cmd-z');
    expect(started?.ui.encours).toBe('rider-a');
    expect(commencerFin(started!.ui, 'rider-a'), 'nothing starts while one is in flight').toBeNull();
    expect(demanderFin(started!.ui, 'rider-b', 'cmd-w').demande?.riderId, 'no new card in flight').toBe('rider-a');
    expect(annulerFin(started!.ui).demande, 'no cancel in flight').not.toBeNull();
    const failed = finEchouee(started!.ui, 'rider-a', 'fin_service.refus_pas_de_colis');
    expect(failed.encours).toBeNull();
    expect(failed.demande?.riderId, 'the card stays open — the way out is his').toBe('rider-a');
    expect(failed.echecs).toEqual({ 'rider-a': 'fin_service.refus_pas_de_colis' });
    const retried = commencerFin(failed, 'rider-a');
    expect(retried?.commandId, 'the retry rides the SAME id').toBe('cmd-z');
    expect(retried?.ui.echecs).toEqual({});
    const done = finFaite(retried!.ui, 'rider-a');
    expect(done).toMatchObject({ demande: null, encours: null, faits: ['rider-a'] });
    expect(finFaite(done, 'rider-a').faits).toEqual(['rider-a']);
  });
});
