import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { seraTheme, spacing, radius, touch, type as typo, interaction, money } from '@platform/ui-tokens/legacy';
import {
  FAILURE_REASON_IDS,
  POLICY_CHECK_IDS,
  SANDBOX_DOOR_SIGNAL,
  SANDBOX_EVIDENCE_ACK,
  type PolicyCheckId,
} from './src/custody-flow';
import { SANDBOX_DISPATCH_HOURS } from './src/safety';
import { IS_PREVIEW } from './src/preview';
import { t } from './src/i18n';
import { COURSE_BACK_STEPS, JOURNEY, START, type Screen } from './src/journey';
import { attemptReturnHandover } from './src/two-key-return';
import { mintCommandId } from './src/offline/commandId';
import { appendSosRaise } from './src/offline/sos';
import { appendEvidence } from './src/offline/evidence';
import { createDocumentOutboxStore } from './src/offline/documentStore';
import { createManualConnectivity, type Connectivity } from './src/offline/connectivity';
import { bindDeviceConnectivity } from './src/offline/expoConnectivity';
import { pendingCount, drainOnReconnect } from './src/offline/backlog';
import type { FlushOutcome } from './src/offline/outbox';
import {
  acceptInspection,
  acknowledgeCourse,
  acknowledgeSos,
  applyEvidenceServerAck,
  applyProviderDoorSignal,
  beginPickup,
  captureEvidence,
  chooseFailureReason,
  clearSos,
  completeReturn,
  createDemoWorld,
  declineCourse,
  expireProposal,
  expireRetryWindow,
  passVerification,
  prepareReturn,
  raiseSos,
  refusePickup,
  registerSeal,
  reportProblem,
  retryDelivery,
  validateDropCode,
  type CourseKind,
  type CourseStep,
  type DemoCourse,
  type DemoWorld,
} from './src/demo/store';
import {
  Body,
  Card,
  CheckRow,
  CodeCells,
  DangerButton,
  EmptyState,
  GhostButton,
  Keypad,
  LandmarkCard,
  ListRow,
  OfflineBanner,
  Overline,
  PendingNotice,
  PosterTitle,
  PrimaryButton,
  QuoteRule,
  ScreenTransition,
  SealMark,
  SecondaryButton,
  StatusChip,
  TabBar,
  type ChipTone,
} from './src/ui/kit';
import { SosButton, SosSheet, type SosState } from './src/ui/faso-sos';
import { FpIn, FpPulseDot, QuoteRule as FasoQuoteRule, CornerTicks as FasoCornerTicks } from './src/ui/signature';
import { C as FASO } from './src/ui/faso';
import {
  FasoHeader,
  CourseCard as FasoCourseCard,
  ScreenTitle as FasoScreenTitle,
  PosterTitle as FasoPosterTitle,
  Card as FasoCard,
  LandmarkCard as FasoLandmarkCard,
  CheckRow as FasoCheckRow,
  SealMark as FasoSealMark,
  ProofSeal as FasoProofSeal,
  Celebration as FasoCelebration,
  TabBar as FasoTabBar,
  StatusChip as FasoStatusChip,
  FontProofStrip,
  Overline as FasoOverline,
  EmptyState as FasoEmptyState,
  Body as FasoBody,
  PrimaryButton as FasoPrimaryButton,
  SecondaryButton as FasoSecondaryButton,
  DangerButton as FasoDangerButton,
  GhostButton as FasoGhostButton,
  PendingNotice as FasoPendingNotice,
  OfflineBanner as FasoOfflineBanner,
  CodeCells as FasoCodeCells,
  Keypad as FasoKeypad,
} from './src/ui/faso-kit';
import {
  IconColis,
  IconReprendre,
  IconRefus,
  IconMoto,
  IconScelle,
  IconCamera,
  IconCle,
  IconCoche,
  type IconProps,
} from './src/ui/icons';

/**
 * WO-6.1 — LE VISAGE, Grand Teint (sera theme), over WO-4.1/4.3's walkable
 * custody world. The RESKIN law: every screen adopts the Grand Teint kit but
 * the journey spine and custody SEMANTICS stay byte-identical — same 17
 * screens, same edges, same TOTAL back law (course → liste → accueil, no pop
 * arm), same custody moves through the same demo store (which calls
 * custody-flow.ts, the rule source, and throws on any out-of-order move).
 * R1–R14 is the design bundle's vocabulary over these screens; R4 « le repère »
 * is the illustrated LandmarkCard treatment on affectation + the door, R14
 * « SOS » is an overlay mounted UNCONDITIONALLY (one gesture, every screen),
 * never a spine node. Offline law unchanged: queued = pending, never done.
 */

const C = seraTheme.colours;
const T = typo.scale;

type ShiftView = 'off' | 'pending' | 'on';

/** Course-list badges: honest status per step (keys live in the catalog). */
const STATUS_KEY: Record<CourseStep, string> = {
  affectation: 'courses.statut_a_ramasser',
  verify: 'courses.statut_a_ramasser',
  seal: 'courses.statut_a_ramasser',
  refused: 'refuse.status',
  evidence: 'courses.statut_en_route',
  evidence_pending: 'evidence.pending',
  door_inspection: 'courses.statut_en_route',
  payment_wait: 'courses.statut_en_route',
  drop: 'courses.statut_en_route',
  delivered: 'delivered.status',
  refusal_reason: 'courses.statut_en_route',
  retry_window: 'courses.statut_en_route',
  refused_final: 'refused_final.status',
  reschedule_planned: 'reschedule.status',
  retour_colis: 'courses.statut_retour_en_cours',
};

const statusKeyFor = (course: DemoCourse): string =>
  course.proposalOutcome === 'declined'
    ? 'courses.statut_rendue'
    : course.proposalOutcome === 'expired'
      ? 'courses.statut_expiree'
      : course.step === 'affectation' && course.ack === 'decline_pending'
        ? 'assignment.decline_pending'
        : course.step === 'retour_colis' && course.closed
          ? 'courses.statut_retour_fait'
          : STATUS_KEY[course.step];

/** Chip tones mirror the honest status — never a fake green, never a shame red. */
const STATUS_TONE: Record<CourseStep, ChipTone> = {
  affectation: 'info',
  verify: 'info',
  seal: 'info',
  refused: 'muted',
  evidence: 'info',
  evidence_pending: 'warn',
  door_inspection: 'info',
  payment_wait: 'warn',
  drop: 'info',
  delivered: 'ok',
  refusal_reason: 'warn',
  retry_window: 'warn',
  refused_final: 'bad',
  reschedule_planned: 'info',
  retour_colis: 'info',
};

const toneFor = (course: DemoCourse): ChipTone =>
  course.proposalOutcome !== null
    ? 'muted' // a closed proposal is honest and at rest — never a shame red
    : course.step === 'affectation' && course.ack === 'decline_pending'
      ? 'warn' // queued = pending, never done
      : course.step === 'retour_colis' && course.closed
        ? 'ok'
        : STATUS_TONE[course.step];

/** R2 card register (planche R2): the offer window (affectation, not closed) is the
 * gold proposed card; a closed course is the receded done card; the accepted walk
 * is the hairline active card. The honest status/tone still ride the states law. */
const variantFor = (course: DemoCourse): 'proposed' | 'active' | 'done' =>
  course.closed ? 'done' : course.step === 'affectation' ? 'proposed' : 'active';

/** Course glyphs by kind — icons always paired with text (the chip + title). */
const KIND_ICON: Record<CourseKind, (p: IconProps) => React.JSX.Element> = {
  livraison: IconColis,
  deuxieme_passage: IconReprendre,
  retour: IconRefus,
};

/** The bottom hubs (WO-4.2R): Service · Courses — waypoint resets only. */
const HUBS: readonly Screen[] = ['service', 'courses'];

/** WO-4.3 — the demo's answer window for a proposed course (« Réponds
 * avant : HH:MM »). ⚠ CTO safest default: reuses WO-1.2's founder-reviewed
 * ACK_DEADLINE_MS (5 min — assignment-lease-ttl.v1). */
const proposalDeadlineHhmm = (): string => {
  const until = new Date(Date.now() + 5 * 60_000);
  return `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`;
};

/** A fixed demo rider identity for the SOS incident (obviously not real). */
const DEMO_RIDER_ID = 'rider-moussa-demo';

/** The buyer's code is six digits (demo). The store's validateDropCode owns
 * finality; this is only the entry surface, and it exists ONLY on the drop
 * screen — which the spine makes reachable only after provider confirmation. */
const DROP_CODE_LEN = 6;

export default function App() {
  const [world, setWorld] = useState<DemoWorld>(() => createDemoWorld());
  // SERA-S3: the device-durable SOS outbox (document dir — survives kill+reboot).
  // ONE durable outbox for every rider write kind (SOS raise, delivery evidence):
  // a single document-dir queue, entries discriminated by `kind`.
  const outboxStore = useMemo(() => createDocumentOutboxStore(), []);
  // SERA-S4: connectivity is REAL, behind a port (expo-network on device); the
  // manual port also backs the demo toggle. `offline` is DERIVED from it — the
  // retired compile-time connectivity constant is gone. `backlog` is the REAL
  // count of pending durable writes; `persistFailed` is where a background-persist
  // failure surfaces (the offline banner is that surface).
  const net = useMemo(() => createManualConnectivity(), []);
  const [connectivity, setConnectivity] = useState<Connectivity>('online');
  const [backlog, setBacklog] = useState(0);
  const [persistFailed, setPersistFailed] = useState(false);
  const offline = connectivity === 'offline';
  const [stack, setStack] = useState<Screen[]>([START]);
  const [shift, setShift] = useState<ShiftView>('off');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Partial<Record<PolicyCheckId, boolean>>>({});
  const [windowUntil, setWindowUntil] = useState('');
  const [proposalUntil, setProposalUntil] = useState(proposalDeadlineHhmm);
  const [playing, setPlaying] = useState(false);
  const [codeStr, setCodeStr] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [sos, setSos] = useState<SosState>('closed');
  const [key1, setKey1] = useState(false);
  const [key2, setKey2] = useState(false);
  const [oneKeyMsg, setOneKeyMsg] = useState(false);
  const screen = stack[stack.length - 1] ?? START;
  const active = world.courses.find((c) => c.id === activeId) ?? null;
  const allChecked = POLICY_CHECK_IDS.every((id) => checks[id] === true);

  // SERA-S4 · the reconnect drain sender. The LIVE sender posts each queued write to
  // its service at assembly; here it models the server accepting on reconnect
  // ('applied', like SANDBOX_EVIDENCE_ACK) so the backlog drains truthfully in the
  // walkable demo. The rider never asserts this.
  const sandboxReconnectSender = useCallback(async (): Promise<FlushOutcome> => 'applied', []);
  const refreshBacklog = useCallback(() => {
    // a durable-read failure is itself a durability-health signal → surface it,
    // never an unhandled rejection.
    void pendingCount(outboxStore).then(setBacklog, () => setPersistFailed(true));
  }, [outboxStore]);
  // The port drives `connectivity`; on device expo-network feeds the same port.
  useEffect(() => {
    const unsubscribe = net.subscribe(setConnectivity);
    const unbind = bindDeviceConnectivity(net);
    return () => {
      unsubscribe();
      unbind();
    };
  }, [net]);
  // Reconnect → flush the durable outbox, the banner clears with the backlog; offline
  // just re-counts what is queued (queued = pending, never done — SE-I06 family).
  useEffect(() => {
    if (connectivity === 'online') {
      void drainOnReconnect(outboxStore, sandboxReconnectSender).then((remaining) => {
        setBacklog(remaining);
        if (remaining === 0) setPersistFailed(false);
      });
    } else {
      refreshBacklog();
    }
  }, [connectivity, outboxStore, sandboxReconnectSender, refreshBacklog]);

  // SOS hold timer — a deliberate HOLD fires the SOS; released or unmounted, it
  // is cleared. There are NO post-fire timers: the acknowledgment comes from the
  // store (a real dispatch/network response), never a fake countdown.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);
  useEffect(() => clearHold, [clearHold]);

  const go = useCallback((next: Screen) => {
    if (!JOURNEY[stack[stack.length - 1] ?? START].includes(next)) return;
    setStack((s) => [...s, next]);
  }, [stack]);
  // The course list is a fixed waypoint, never a pushed layer: every in-course
  // « Retour aux courses » lands here, so the list can never sit above a stale
  // course screen (the verifier's push-then-pop route).
  const toCourses = useCallback(() => setStack([START, 'courses']), []);
  const back = useCallback(() => {
    // WO-4.1 rule (journaled; a TOTAL rule after two verifier findings — stale
    // in-course screens must be unreachable BY CONSTRUCTION): a course's truth
    // lives in course.step, so no course screen is ever revealed by popping.
    // « Retour » on a course screen goes to the course list; on the list it
    // goes home; on the root it does nothing. No pop arm exists.
    const current = stack[stack.length - 1] ?? START;
    if (current === 'courses') {
      setStack([START]);
      return;
    }
    if (COURSE_BACK_STEPS.includes(current)) {
      setStack([START, 'courses']);
    }
  }, [stack]);
  const reset = useCallback(() => {
    clearHold();
    // createDemoWorld() also clears any incident (incident: null).
    setWorld(createDemoWorld());
    setStack([START]);
    setShift('off');
    net.set('online');
    setBacklog(0);
    setPersistFailed(false);
    setActiveId(null);
    setChecks({});
    setWindowUntil('');
    setProposalUntil(proposalDeadlineHhmm());
    setPlaying(false);
    setCodeStr('');
    setCelebrate(false);
    setSos('closed');
    setKey1(false);
    setKey2(false);
    setOneKeyMsg(false);
  }, [clearHold, net]);

  /** Every custody move: the store calls custody-flow (throws out-of-order),
   * the world re-renders, the stack follows the rule's outcome. */
  const walk = useCallback((move: (w: DemoWorld) => CourseStep) => {
    const next = move(world);
    setWorld({ ...world });
    go(next);
  }, [world, go]);

  const openCourse = useCallback((course: DemoCourse) => {
    setActiveId(course.id);
    setChecks({});
    setCodeStr('');
    setPlaying(false);
    setKey1(false);
    setKey2(false);
    setOneKeyMsg(false);
    go(course.step);
  }, [go]);

  // The arrival celebration fires when the drop code lands the course at
  // 'delivered' — ≤ 800 ms, non-blocking, tap-to-skip, static under reduced
  // motion (the component owns that).
  useEffect(() => {
    if (screen === 'delivered') setCelebrate(true);
  }, [screen]);

  // SOS — one gesture from any screen; opening only reveals the sheet, firing
  // requires a deliberate HOLD (neither accidental nor missable).
  const openSos = useCallback(() => setSos('confirm'), []);
  const cancelSos = useCallback(() => {
    clearHold();
    setSos('closed');
  }, [clearHold]);
  // Firing builds the REAL incident in the store (custody-safe: no course is
  // read or moved) and drives the sheet from its honest status — queued
  // (offline, no ack) / raised (in-hours) / escalated (out-of-hours). SERA-S4:
  // the connectivity is now the REAL port signal (the dispatch-hours stay a typed
  // sandbox value the live roster feed drives at assembly).
  const fireSos = useCallback(() => {
    // SERA-S3: mint the command_id ONCE at the gesture (the incident's stable
    // identity), raise the in-memory incident INSTANTLY (a safety SOS never waits
    // on disk), then persist the raise to the outbox in the background — so it
    // survives a kill+reboot and flushes at-least-once with dedup on this id.
    const commandId = mintCommandId();
    const raised = raiseSos(world, commandId, {
      riderId: DEMO_RIDER_ID,
      onShift: shift === 'on',
      activeCourseId: activeId,
      connectivity,
      hours: SANDBOX_DISPATCH_HOURS,
    });
    setWorld({ ...world });
    // SERA-S4: the S3-named `.catch` hardening lands here — a background-persist
    // failure routes to the banner surface (persistFailed); success refreshes the
    // real backlog count. The safety incident already showed instantly regardless.
    void appendSosRaise(outboxStore, commandId, {
      riderId: DEMO_RIDER_ID,
      hours: SANDBOX_DISPATCH_HOURS,
      onShift: shift === 'on',
      activeCourseId: activeId,
      raisedAt: raised.raisedAt,
    }).then(refreshBacklog, () => setPersistFailed(true));
    const status = raised.status;
    if (status === 'queued') setSos('queued');
    else if (status === 'escalated') setSos('escalated');
    else if (status === 'acknowledged') setSos('acknowledged');
    else setSos('raised');
  }, [world, shift, activeId, connectivity, outboxStore, refreshBacklog]);
  const sosHoldStart = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(fireSos, 650);
  }, [fireSos]);
  const sosHoldEnd = useCallback(() => clearHold(), [clearHold]);
  // The rider CANNOT self-acknowledge. This is the dispatch/network response
  // arriving — a SANDBOX stand-in that drives the store's acknowledgeSos (which
  // THROWS on a queued incident), never the rider's own hand.
  const sosSandboxAck = useCallback(() => {
    if (world.incident === null) return;
    acknowledgeSos(world, world.incident.responder);
    setWorld({ ...world });
    setSos('acknowledged');
  }, [world]);
  const sosSafe = useCallback(() => setSos('over'), []);
  const sosClose = useCallback(() => {
    clearSos(world);
    setWorld({ ...world });
    clearHold();
    setSos('closed');
  }, [world, clearHold]);

  const arriving = world.courses.find((c) => !c.closed && c.step === 'affectation') ?? null;
  const shiftAction = shift === 'off' ? t('shift.start_action') : t('shift.end_action');

  const headerChip = screen === 'service' ? (shift === 'on' ? t('shift.on') : t('shift.off')) : t('assignment.title');

  const voiceFor = () => ({
    label: playing ? t('repere.voice_playing') : t('repere.voice'),
    time: '0:11',
    playing,
    onPress: () => setPlaying((p) => !p),
  });
  // The seal ID's digit grouping uses the canon narrow-no-break-space (U+202F,
  // money.groupSeparator) — the one place any grouping surfaces in Séra, which
  // carries NO franc amount anywhere. Its glyph is whitespace; the fallback
  // system face carries it, so no tofu.
  const SEAL_ID = `SC-77${money.groupSeparator}412`;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" backgroundColor={C.paper} />
      {/* R1's chrome retired: the Faso monogram header (planche l.32–42) — the woven
          strip, the « S » monogram, the « Séra » identity + the rider certification,
          the right state chip. The screen NAME lives in each view's body title. */}
      <FasoHeader
        title={t('app.title')}
        subtitle={t('service.certified_name')}
        backLabel={`‹ ${t('nav.retour')}`}
        onBack={stack.length > 1 ? back : undefined}
        right={<FasoStatusChip tone={shift === 'on' ? 'ok' : 'muted'} label={headerChip} />}
      />
      {offline && (
        <FasoOfflineBanner
          label={
            backlog === 0
              ? t('offline.banner')
              : `${t('offline.backlog_prefix')} ${backlog} ${backlog === 1 ? t('offline.backlog_suffix_one') : t('offline.backlog_suffix_many')}`
          }
        />
      )}
      {/* SERA-S4: a background-persist failure surfaces HERE (the CTO's banner
          surface) — honest « à réessayer », never a lost-in-silence write. */}
      {persistFailed && <FasoPendingNotice lines={[t('offline.persist_failed')]} />}
      {IS_PREVIEW && (
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerText}>{t('preview.banner')}</Text>
        </View>
      )}

      <ScreenTransition screenKey={screen}>
        <View style={styles.content}>
          {/* R1 « Service » — Faso Premium (planche l.55–94): the old skeleton
              retired. shiftOff = a white cert card + « Prendre mon service »;
              shiftPending = the honest fpBar pending (queued confers NOTHING — R1
              law); shiftOn = the warm accent « En service » card w/ a live pulse. */}
          {screen === 'service' && (
            <FpIn style={styles.stackGap}>
              {/* The font-proof strip (STEP 0, the type question) — preview-only,
                  so the founder judges the two faces on the device. */}
              {IS_PREVIEW && <FontProofStrip />}
              {shift === 'off' && (
                <>
                  <FasoPosterTitle>{t('service.off_title')}</FasoPosterTitle>
                  <FasoBody>{t('service.off_body')}</FasoBody>
                  <FasoCard>
                    <View style={styles.certRow}>
                      <IconScelle size={T.body.size} color={FASO.accent} />
                      <FasoBody style={styles.certText}>{t('service.location_note')}</FasoBody>
                    </View>
                    <View style={styles.certRow}>
                      <FasoStatusChip tone="accent" label={t('service.certified')} />
                      <FasoBody style={styles.certText}>{t('service.certified_name')}</FasoBody>
                    </View>
                  </FasoCard>
                  <FasoPrimaryButton
                    label={shiftAction}
                    onPress={() => {
                      // No server in the sandbox: a start stays queued = PENDING —
                      // an offline shift-start confers NOTHING (R1 law).
                      setShift('pending');
                    }}
                  />
                </>
              )}
              {shift === 'pending' && (
                // Queued = pending, never done — never a fake « En service ».
                <FasoPendingNotice title={t('shift.pending_title')} lines={[t('service.pending_note')]} />
              )}
              {shift === 'on' && (
                <>
                  <FasoCard accent>
                    <View style={styles.onRow}>
                      <FpPulseDot color={FASO.okFg} />
                      <FasoPosterTitle>{t('shift.on')}</FasoPosterTitle>
                    </View>
                    <FasoBody>{t('service.on_note')}</FasoBody>
                  </FasoCard>
                  {arriving !== null && (
                    <FasoCourseCard
                      variant="proposed"
                      code={arriving.id.toUpperCase()}
                      status={{ label: t('courses.statut_proposee'), tone: 'accent' }}
                      deadline={`${t('courses.before')} ${proposalUntil}`}
                      title={arriving.locationLines[0]}
                      subtitle={`${arriving.locationLines[2]} · ${t('assignment.landmark_label')}`}
                      onPress={() => openCourse(arriving)}
                    />
                  )}
                  <FasoPrimaryButton label={t('courses.title')} onPress={() => go('courses')} />
                  <FasoSecondaryButton label={t('shift.end_action')} onPress={() => setShift('off')} />
                </>
              )}
              <FasoSecondaryButton label={t('offline.toggle')} onPress={() => net.set(offline ? 'online' : 'offline')} />
            </FpIn>
          )}

          {/* R2 « Mes courses » — Faso Premium (WO-FP-SERA proof view 2/3), TRUE
              planche anatomy (« Sera - Redesign » R2, lines 96–141): a Bricolage-800
              screen title over editorial CourseCards — the proposed course is the
              gold-glow card (left bar · CRS eyebrow · filled PROPOSÉE pill · « avant
              HH:MM » deadline), NOT a glyph-tile row. The custody semantics + the
              honest status vocabulary (statusKeyFor/toneFor) ride the states law. */}
          {screen === 'courses' && (
            <FpIn style={styles.listWrap}>
              <FasoScreenTitle>{t('courses.overline')}</FasoScreenTitle>
              <FlatList
                data={world.courses}
                keyExtractor={(c) => c.id}
                initialNumToRender={6}
                windowSize={5}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={<FasoEmptyState Icon={IconMoto} title={t('shell.no_task')} hint={t('courses.empty_hint')} />}
                ListFooterComponent={<Text style={styles.listFoot}>{t('courses.one_guardian')}</Text>}
                renderItem={({ item }) => {
                  // The offer window (affectation, not yet acted, not closed) shows
                  // « Proposée » + the response deadline — the REAL ack/decline
                  // window; every other course shows its honest status + tone.
                  const proposed = item.step === 'affectation' && item.ack === 'none' && !item.closed;
                  return (
                    <FasoCourseCard
                      variant={variantFor(item)}
                      code={item.id.toUpperCase()}
                      status={proposed ? { label: t('courses.statut_proposee'), tone: 'accent' } : { label: t(statusKeyFor(item)), tone: toneFor(item) }}
                      deadline={proposed ? `${t('courses.before')} ${proposalUntil}` : undefined}
                      lineage={item.attempt === 2 ? t('courses.lineage_2e') : undefined}
                      title={item.locationLines[0]}
                      subtitle={`${item.locationLines[2]} · ${item.name}`}
                      onPress={item.closed ? undefined : () => openCourse(item)}
                    />
                  );
                }}
              />
            </FpIn>
          )}

          {/* R3 « Course proposée » + R4 « Le repère » (planche l.143–223) — the
              app's affectation screen carries both: the response deadline, the
              illustrated repère card (voice playable), then the ack/decline arms.
              Offline law + SERA-S4 connectivity semantics untouched. */}
          {screen === 'affectation' && (
            active === null ? (
              <FasoCard style={styles.flexCard}><FasoEmptyState Icon={IconMoto} title={t('shell.no_task')} /></FasoCard>
            ) : (
              <FpIn style={styles.stackGap}>
                <FasoOverline>{`${t('assignment.deadline')} ${proposalUntil}`}</FasoOverline>
                <FasoLandmarkCard
                  zone={active.locationLines[2]}
                  lines={active.locationLines}
                  repereLabel={t('assignment.landmark_label')}
                  indicationsLabel={t('repere.indications')}
                  illustrated
                  voice={voiceFor()}
                />
                <FasoQuoteRule>{t('repere.no_gps')}</FasoQuoteRule>
                {active.ack === 'decline_pending' ? (
                  /* The refusal went out WITHOUT the network: queued = PENDING, it
                     confers nothing — only a server-confirmed decline releases; the
                     window still runs. */
                  <FasoPendingNotice lines={[t('assignment.decline_pending')]} />
                ) : active.ack === 'ack_pending' ? (
                  <>
                    {/* Queued = PENDING; walking to the pickup is navigation. */}
                    <FasoPendingNotice lines={[t('assignment.ack_pending')]} />
                    <FasoPrimaryButton label={t('assignment.pickup_action')} onPress={() => walk((w) => beginPickup(w, active.id))} />
                    <FasoDangerButton
                      label={t('assignment.decline_action')}
                      onPress={() => {
                        // SERA-S4: the REAL connectivity decides queued-vs-sent —
                        // offline = decline_pending (confers nothing), online =
                        // server-confirmed decline. The retired constant lied here.
                        declineCourse(world, active.id, connectivity);
                        setWorld({ ...world });
                        toCourses();
                      }}
                    />
                  </>
                ) : (
                  <>
                    <FasoPrimaryButton
                      label={t('assignment.ack_action')}
                      onPress={() => {
                        acknowledgeCourse(world, active.id);
                        setWorld({ ...world });
                      }}
                    />
                    <FasoDangerButton
                      label={t('assignment.decline_action')}
                      onPress={() => {
                        declineCourse(world, active.id, connectivity);
                        setWorld({ ...world });
                        toCourses();
                      }}
                    />
                  </>
                )}
                <FasoGhostButton
                  label={t('assignment.expired_action')}
                  onPress={() => {
                    expireProposal(world, active.id);
                    setWorld({ ...world });
                    toCourses();
                  }}
                />
              </FpIn>
            )
          )}

          {/* The custody walk — every transition below goes through the demo
              store, which calls custody-flow.ts (the rule source) and throws
              on any out-of-order move. */}
          {/* R5 « Vérification » (planche l.225–253) — objective conformity only,
              never quality/authenticity. The checks fill green; the refusal arm is
              the screen's one DangerButton (the app models a single checkbox, not
              the planche's per-row bad-button). */}
          {screen === 'verify' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('verify.title')}</FasoPosterTitle>
              <FasoBody>{t('verify.body')}</FasoBody>
              <FasoCard>
                {POLICY_CHECK_IDS.map((id) => (
                  <FasoCheckRow key={id} label={t(`check.${id}`)} checked={checks[id] === true} onPress={() => setChecks({ ...checks, [id]: !checks[id] })} />
                ))}
              </FasoCard>
              <FasoPrimaryButton
                label={t('verify.accept_action')}
                disabled={!allChecked}
                onPress={() => walk((w) => passVerification(w, active.id, checks))}
              />
              {/* The refusal arm is as dignified as acceptance — its own
                  polished danger style, never a shame path. */}
              <FasoDangerButton label={t('verify.refuse_action')} onPress={() => walk((w) => refusePickup(w, active.id))} />
            </FpIn>
          )}

          {/* R6 « Le refus digne » (planche l.256–291, r6Done) — money-register calm:
              what happened, what happens next; the course closes with dignity. */}
          {screen === 'refused' && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('refuse.status')}</FasoPosterTitle>
              <FasoBody>{t('refuse.next')}</FasoBody>
              <FasoSecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
            </FpIn>
          )}

          {/* R7 « Le scellé » (planche l.293–334) — custody begins HERE, not a second
              before. Offline: the seal is queued = PENDING; the garde does not begin
              offline (seal.offline honesty verbatim). */}
          {screen === 'seal' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('seal.title')}</FasoPosterTitle>
              <FasoBody>{t('seal.body')}</FasoBody>
              <FasoSealMark code={SEAL_ID} label={t('seal.single_use')} />
              {offline ? (
                <FasoPendingNotice lines={[t('seal.offline')]} />
              ) : (
                <FasoPrimaryButton label={t('seal.action')} onPress={() => walk((w) => registerSeal(w, active.id))} />
              )}
            </FpIn>
          )}

          {/* R8 « En route » — the proof-photo moment (SE-I06). The documentary
              frame with corner ticks (signature element 5); the capture lands
              evidence_pending INSTANTLY, then persists in the background. */}
          {screen === 'evidence' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('evidence.title')}</FasoPosterTitle>
              <View style={styles.photoFrame}>
                <IconCamera size={T.display.size} color={FASO.accentSoft} />
                <FasoCornerTicks />
              </View>
              <FasoPrimaryButton
                label={t('evidence.action')}
                onPress={() => {
                  // SERA-S2 · SE-I06: mint the command_id ONCE at the gesture (the
                  // capture's identity), land evidence_pending INSTANTLY, then persist
                  // the capture to the outbox in the background — durable across a
                  // kill+reboot, flushed at-least-once with dedup on this id. The drop
                  // stays LOCKED until that flush returns the authoritative server ack;
                  // being online is not being acked.
                  const commandId = mintCommandId();
                  walk((w) => captureEvidence(w, active.id));
                  // SERA-S4 `.catch`: a background-persist failure routes to the
                  // banner surface; success refreshes the real backlog count.
                  void appendEvidence(outboxStore, commandId, {
                    courseId: active.id,
                    capturedAt: new Date().toISOString(),
                  }).then(refreshBacklog, () => setPersistFailed(true));
                }}
              />
            </FpIn>
          )}

          {screen === 'evidence_pending' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* SE-I06: capturing queued the photo = PENDING and the drop is
                  LOCKED. The rider CANNOT unlock it — ONLY the authoritative
                  server ack (the outbox flush outcome) advances this screen. Being
                  online is not being acked; offline shows only the wait. The
                  sandbox constant stands in for the live flush outcome at assembly. */}
              {!offline && SANDBOX_EVIDENCE_ACK === 'applied' ? (
                <>
                  <FasoPosterTitle>{t('evidence.confirmed_status')}</FasoPosterTitle>
                  <FasoPrimaryButton
                    label={t('evidence.continue_action')}
                    onPress={() => walk((w) => applyEvidenceServerAck(w, active.id, SANDBOX_EVIDENCE_ACK))}
                  />
                </>
              ) : (
                <>
                  <FasoPendingNotice lines={[t('evidence.pending')]} />
                  <FasoSecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
                </>
              )}
            </FpIn>
          )}

          {/* R9 « À la porte » — door inspection. The buyer opens, verifies; the
              rider waits (2–4 min, noted, never imposed). The rider stands at the
              repère, never a street address. */}
          {screen === 'door_inspection' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('inspect.title')}</FasoPosterTitle>
              <FasoBody>{t('inspect.body')}</FasoBody>
              {active.attempt === 2 && <FasoStatusChip tone="info" label={t('courses.lineage_2e')} />}
              <FasoLandmarkCard
                zone={active.locationLines[2]}
                lines={active.locationLines}
                repereLabel={t('assignment.landmark_label')}
                indicationsLabel={t('repere.indications')}
              />
              <FasoPrimaryButton label={t('inspect.accept_action')} onPress={() => walk((w) => acceptInspection(w, active.id))} />
              <FasoDangerButton label={t('problem.action')} onPress={() => walk((w) => reportProblem(w, active.id))} />
              <FasoGhostButton label={t('inspect.cantpay')} onPress={() => walk((w) => reportProblem(w, active.id))} />
            </FpIn>
          )}

          {screen === 'payment_wait' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* R9 « à la porte » — SE-I11: the rider CANNOT assert payment.
                  No button, no field, no gesture advances this screen; ONLY the
                  provider signal does. The waiting screen is UNSKIPPABLE. The
                  sandbox constant stands in for the live signal at assembly. */}
              {SANDBOX_DOOR_SIGNAL === 'confirmed' ? (
                <>
                  <FasoPosterTitle>{t('pay_ok.status')}</FasoPosterTitle>
                  <FasoBody>{t('pay_ok.body')}</FasoBody>
                  <FasoPrimaryButton
                    label={t('pay_ok.continue_action')}
                    onPress={() => walk((w) => applyProviderDoorSignal(w, active.id, SANDBOX_DOOR_SIGNAL))}
                  />
                </>
              ) : (
                <>
                  <FasoPosterTitle>{t('pay_wait.status')}</FasoPosterTitle>
                  <FasoPendingNotice lines={[t('pay_wait.hint'), t('pay_wait.operator')]} />
                </>
              )}
            </FpIn>
          )}

          {/* R10 « le code de remise » — Faso Premium (WO-FP-SERA proof view 3/3):
              the buyer's code is the LAST key. The gold-cursor cells + white keypad
              on the Séra paper; the honesty (drop.title/hint) renders verbatim. This
              entry exists ONLY here; the spine makes 'drop' reachable only after the
              provider-confirmed payment (custody semantics untouched). */}
          {screen === 'drop' && active !== null && (
            <FpIn style={styles.dropWrap}>
              {/* planche R10 codeEntry: the overline + honesty are CENTERED over the
                  gold-cursor cells + white keypad. drop.title/hint render verbatim. */}
              <FasoOverline center>{t('drop.title')}</FasoOverline>
              <FasoBody style={styles.dropHint}>{t('drop.hint')}</FasoBody>
              <FasoCodeCells value={codeStr} length={DROP_CODE_LEN} />
              <FasoKeypad
                onKey={(d) => setCodeStr((c) => (c.length < DROP_CODE_LEN ? c + d : c))}
                onBack={() => setCodeStr((c) => c.slice(0, -1))}
              />
              <FasoPrimaryButton
                label={t('drop.action')}
                disabled={codeStr.length !== DROP_CODE_LEN}
                onPress={() => walk((w) => validateDropCode(w, active.id))}
              />
              {/* WO-2.2 refusal ladder entry — as dignified as the purchase
                  path; it whispers, never shouts. */}
              <FasoGhostButton label={t('problem.action')} onPress={() => walk((w) => reportProblem(w, active.id))} />
            </FpIn>
          )}

          {/* R12 « L'échelle des échecs » (planche l.460–502) — no generic « échec »
              exists; a colis never has zero guardian. The family picker → retry /
              refused_final / reschedule; the drop code stays LAST, behind payment. */}
          {screen === 'refusal_reason' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('reason.title')}</FasoPosterTitle>
              {FAILURE_REASON_IDS.map((id) => (
                <FasoGhostButton
                  key={id}
                  label={t(`reason.${id}`)}
                  onPress={() => {
                    // The ONE retry window (~15 min policy default; the live
                    // windowExpiresAt arrives with the service outcome at
                    // assembly — the display is honest either way).
                    const until = new Date(Date.now() + 15 * 60_000);
                    setWindowUntil(`${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`);
                    walk((w) => chooseFailureReason(w, active.id, id));
                  }}
                />
              ))}
            </FpIn>
          )}

          {screen === 'retry_window' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* R12 retry arm — the honest countdown window, shown never hidden. */}
              <FasoPosterTitle>{t('retry.status')}</FasoPosterTitle>
              <FasoStatusChip tone="warn" label={`${t('retry.until')} ${windowUntil}`} />
              <FasoPrimaryButton label={t('retry.retry_action')} onPress={() => walk((w) => retryDelivery(w, active.id))} />
              <FasoGhostButton label={t('retry.expired_action')} onPress={() => walk((w) => expireRetryWindow(w, active.id))} />
            </FpIn>
          )}

          {screen === 'refused_final' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* Buyer-fault refusal, register:money — calm, cause and
                  what-happens-next stated; no shame, no jargon. */}
              <FasoPosterTitle>{t('refused_final.status')}</FasoPosterTitle>
              <FasoBody>{t('refused_final.fee')}</FasoBody>
              <FasoBody>{t('refused_final.next')}</FasoBody>
              <FasoPrimaryButton label={t('refused_final.retour_action')} onPress={() => walk((w) => prepareReturn(w, active.id))} />
            </FpIn>
          )}

          {screen === 'reschedule_planned' && (
            <FpIn style={styles.stackGap}>
              {/* The non-escalating arm: honest absence / provider failure —
                  nothing is lost, the order stays whole; the 2e passage appears
                  on the course list with its lineage. */}
              <FasoPosterTitle>{t('reschedule.status')}</FasoPosterTitle>
              <FasoBody>{t('reschedule.next')}</FasoBody>
              <FasoStatusChip tone="info" label={t('reschedule.lineage')} />
              <FasoSecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
            </FpIn>
          )}

          {/* R13 « Le retour à deux clés » (planche l.504–541, SE6.2): the seller's
              key and the rider's key, both or neither. A single key REFUSES — the
              garde does not move on one hand (attemptReturnHandover is the pure gate). */}
          {screen === 'retour_colis' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('retour.title')}</FasoPosterTitle>
              <FasoQuoteRule accent>{t('retour.custodian')}</FasoQuoteRule>
              <FasoOverline>{t('retour.two_keys')}</FasoOverline>
              <FasoCard>
                <View style={styles.keyRow}>
                  <View style={styles.keyLabel}>
                    <IconCle size={T.body.size} color={FASO.accentDeepAlt} />
                    <FasoBody style={styles.keyText}>{t('retour.key_seller')}</FasoBody>
                  </View>
                  {key1 ? (
                    <IconCoche size={T.title.size} color={FASO.okFg} />
                  ) : (
                    <FasoGhostButton label={t('retour.key_seller_action')} onPress={() => setKey1(true)} />
                  )}
                </View>
                <View style={styles.keyRow}>
                  <View style={styles.keyLabel}>
                    <IconCle size={T.body.size} color={FASO.accentDeepAlt} />
                    <FasoBody style={styles.keyText}>{t('retour.key_rider')}</FasoBody>
                  </View>
                  {key2 ? (
                    <IconCoche size={T.title.size} color={FASO.okFg} />
                  ) : (
                    <FasoGhostButton
                      label={t('retour.key_rider_action')}
                      onPress={() => {
                        // A single-key attempt REFUSES: both hands, or the custody
                        // does not move (attemptReturnHandover is the pure gate).
                        if (attemptReturnHandover({ seller: key1, rider: true }) === 'refused') {
                          setOneKeyMsg(true);
                          return;
                        }
                        setKey2(true);
                      }}
                    />
                  )}
                </View>
              </FasoCard>
              {oneKeyMsg && !key2 && (
                <View style={styles.refuseNote}>
                  <Text style={styles.refuseNoteText}>{t('retour.one_key_refused')}</Text>
                </View>
              )}
              <FasoPrimaryButton
                label={t('retour.action')}
                disabled={attemptReturnHandover({ seller: key1, rider: key2 }) === 'refused'}
                onPress={() => {
                  completeReturn(world, active.id);
                  setWorld({ ...world });
                  toCourses();
                }}
              />
            </FpIn>
          )}

          {/* R11 « Course validée » (planche l.442–458) — the proof is complete;
              Séra emits a SIGNAL, never money. A gold proof seal, the three-line
              proof, the no-money quote; the celebration overlays it on entry. */}
          {screen === 'delivered' && (
            <FpIn style={styles.stackGap}>
              <View style={styles.validHead}>
                <FasoProofSeal />
                <FasoPosterTitle>{t('delivered.status')}</FasoPosterTitle>
              </View>
              <FasoCard>
                <ProofLine label={t('delivered.proof_package')} />
                <ProofLine label={t('delivered.proof_seal')} />
                <ProofLine label={t('delivered.proof_code')} />
              </FasoCard>
              <FasoQuoteRule>{t('delivered.no_money')}</FasoQuoteRule>
              <FasoSecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
              {celebrate && <FasoCelebration label={t('delivered.next')} sublabel={t('delivered.proof_complete')} onDone={() => setCelebrate(false)} />}
            </FpIn>
          )}
        </View>
      </ScreenTransition>

      <View style={styles.footer}>
        <Text style={styles.footerHint}>{t('demo.donnees')}</Text>
        <Pressable style={styles.resetAction} onPress={reset}>
          <Text style={styles.resetActionText}>{t('nav.recommencer')}</Text>
        </Pressable>
      </View>

      {HUBS.includes(screen) && (
        <FasoTabBar
          items={[
            { key: 'service', Icon: IconMoto, label: t('nav.tab_service'), active: screen === 'service', onPress: () => setStack([START]) },
            { key: 'courses', Icon: IconColis, label: t('nav.tab_courses'), active: screen === 'courses', onPress: () => toCourses() },
          ]}
        />
      )}

      {/* R14 « SOS » — mounted UNCONDITIONALLY, outside every screen branch: one
          gesture from ANY screen, unmissable, never accidentally triggerable. */}
      <SosButton label={t('sos.label')} onOpen={openSos} />
      <SosSheet
        state={sos}
        strings={{
          title: t('sos.title'),
          confirmHint: t('sos.confirm_hint'),
          hold: t('sos.hold'),
          cancel: t('sos.cancel'),
          holdNote: t('sos.hold_note'),
          queued: t('sos.queued'),
          queuedHint: t('sos.queued_hint'),
          raised: t('sos.raised'),
          raisedHint: t('sos.raised_hint'),
          escalated: t('sos.escalated'),
          escalatedHint: t('sos.escalated_hint'),
          transportPending: t('sos.transport_pending'),
          acknowledged: t('sos.acknowledged'),
          acknowledgedHint: t('sos.acknowledged_hint'),
          previewAck: t('sos.preview_ack'),
          previewAckEscalated: t('sos.preview_ack_escalated'),
          safe: t('sos.safe'),
          over: t('sos.over'),
          overHint: t('sos.over_hint'),
          close: t('sos.close'),
        }}
        onHoldStart={sosHoldStart}
        onHoldEnd={sosHoldEnd}
        onCancel={cancelSos}
        onSandboxAck={sosSandboxAck}
        onSafe={sosSafe}
        onClose={sosClose}
      />
    </SafeAreaView>
  );
}

function ProofLine({ label }: { label: string }) {
  return (
    <View style={styles.proofRow}>
      <IconCoche size={T.body.size} color={FASO.okFg} />
      <Text style={styles.proofText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: FASO.paper },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  flexCard: { flex: 0 },
  stackGap: { gap: spacing.md, paddingTop: spacing.sm },
  listWrap: { flex: 1, gap: spacing.sm },
  dropWrap: { flex: 1, gap: spacing.lg, justifyContent: 'center', paddingHorizontal: spacing.md },
  dropHint: { textAlign: 'center' },
  listContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  listFoot: { color: C.muted, fontSize: T.caption.size, lineHeight: T.caption.size * T.caption.lh, textAlign: 'center', paddingVertical: spacing.md },
  checkList: { gap: spacing.sm },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  certText: { flex: 1 },
  onRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  onDot: { width: spacing.sm, height: spacing.sm, borderRadius: radius.pill, backgroundColor: C.success },
  photoFrame: {
    minHeight: spacing.xxl * 3,
    borderWidth: interaction.hairline.thin,
    borderColor: C.hairlineMid,
    backgroundColor: C.sand,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  cornerTick: { position: 'absolute', width: interaction.cornerTick.sizePx, height: interaction.cornerTick.sizePx, borderColor: C.scrim },
  tickTL: { top: spacing.sm, left: spacing.sm, borderTopWidth: interaction.cornerTick.strokePx, borderLeftWidth: interaction.cornerTick.strokePx },
  tickTR: { top: spacing.sm, right: spacing.sm, borderTopWidth: interaction.cornerTick.strokePx, borderRightWidth: interaction.cornerTick.strokePx },
  tickBL: { bottom: spacing.sm, left: spacing.sm, borderBottomWidth: interaction.cornerTick.strokePx, borderLeftWidth: interaction.cornerTick.strokePx },
  tickBR: { bottom: spacing.sm, right: spacing.sm, borderBottomWidth: interaction.cornerTick.strokePx, borderRightWidth: interaction.cornerTick.strokePx },
  linkRow: { alignItems: 'center', paddingVertical: spacing.sm, minHeight: touch.minTargetPx, justifyContent: 'center' },
  linkText: { color: C.accentStrong, fontSize: T.label.size, lineHeight: T.label.size * T.label.lh, fontWeight: '800', letterSpacing: T.label.ls, textTransform: 'uppercase', textDecorationLine: 'underline' },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touch.minTargetPx },
  keyLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  keyText: { flex: 1 },
  refuseNote: { borderRadius: spacing.lg, backgroundColor: FASO.dangerBg, padding: spacing.md },
  refuseNoteText: { color: FASO.dangerFg, fontSize: T.body.size, lineHeight: T.body.size * T.body.lh, fontWeight: '600' },
  validRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  validHead: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  proofList: { gap: spacing.sm },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  proofText: { color: C.onInk, fontSize: T.body.size, lineHeight: T.body.size * T.body.lh, flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    minHeight: touch.minTargetPx,
  },
  footerHint: { color: C.soft, fontSize: T.caption.size, lineHeight: T.caption.size * T.caption.lh },
  resetAction: { minHeight: touch.minTargetPx, justifyContent: 'center', paddingHorizontal: spacing.md },
  resetActionText: { color: C.muted, fontSize: T.caption.size, lineHeight: T.caption.size * T.caption.lh, fontWeight: '800', letterSpacing: T.label.ls, textTransform: 'uppercase' },
  previewBanner: {
    backgroundColor: C.warningTint,
    borderBottomWidth: interaction.hairline.thin,
    borderBottomColor: C.warningStripe,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  previewBannerText: {
    color: C.warning,
    fontSize: T.labelXS.size,
    lineHeight: T.labelXS.size * T.labelXS.lh,
    fontWeight: '800',
    letterSpacing: T.labelXS.ls,
    textTransform: 'uppercase',
  },
});
