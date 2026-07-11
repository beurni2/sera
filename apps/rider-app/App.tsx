import { useCallback, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { seraTheme as theme } from '@platform/ui-tokens';
import {
  FAILURE_REASON_IDS,
  POLICY_CHECK_IDS,
  SANDBOX_DOOR_SIGNAL,
  type PolicyCheckId,
} from './src/custody-flow';
import { IS_PREVIEW } from './src/preview';
import { t } from './src/i18n';
import { COURSE_BACK_STEPS, JOURNEY, START, type Screen } from './src/journey';
import {
  acceptInspection,
  acknowledgeCourse,
  applyProviderDoorSignal,
  beginPickup,
  captureEvidence,
  chooseFailureReason,
  completeReturn,
  createDemoWorld,
  expireRetryWindow,
  passVerification,
  prepareReturn,
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
  AppHeader,
  Card,
  CheckRow,
  DangerButton,
  EmptyState,
  GhostButton,
  LandmarkCard,
  ListRow,
  Overline,
  PendingNotice,
  PrimaryButton,
  ScreenTransition,
  SecondaryButton,
  StatusChip,
  TabBar,
  WaxBand,
  type ChipTone,
} from './src/ui/kit';

/**
 * WO-4.2R — LE VISAGE over WO-4.1's walkable custody world. Same 17
 * screens, same edges, same TOTAL back law (course → liste → accueil, no
 * pop arm — ratified), same custody moves through the same demo store
 * (which calls custody-flow.ts, the rule source, and throws on any
 * out-of-order move) — the visual layer is the kit (src/ui/kit.tsx,
 * ui-tokens v2 seraTheme), the navigation and custody SEMANTICS are
 * untouched. Tabs are waypoint RESETS under the ratified two-level-ladder
 * law: Service = the root reset, Courses = the toCourses waypoint —
 * never a new edge, never a push. Offline law unchanged: queued =
 * pending, never done. « Recommencer la démo » resets world + stack.
 */

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
  course.step === 'retour_colis' && course.closed ? 'courses.statut_retour_fait' : STATUS_KEY[course.step];

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
  course.step === 'retour_colis' && course.closed ? 'ok' : STATUS_TONE[course.step];

/** Course glyphs by kind — icons always paired with text (the chip + title). */
const KIND_GLYPH: Record<CourseKind, string> = {
  livraison: '📦',
  deuxieme_passage: '🔁',
  retour: '↩️',
};

/** The bottom hubs (WO-4.2R): Service · Courses — waypoint resets only. */
const HUBS: readonly Screen[] = ['service', 'courses'];

export default function App() {
  const [world, setWorld] = useState<DemoWorld>(() => createDemoWorld());
  const [stack, setStack] = useState<Screen[]>([START]);
  const [shift, setShift] = useState<ShiftView>('off');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Partial<Record<PolicyCheckId, boolean>>>({});
  const [windowUntil, setWindowUntil] = useState('');
  const screen = stack[stack.length - 1] ?? START;
  const active = world.courses.find((c) => c.id === activeId) ?? null;
  const allChecked = POLICY_CHECK_IDS.every((id) => checks[id] === true);

  const go = useCallback((next: Screen) => {
    if (!JOURNEY[stack[stack.length - 1] ?? START].includes(next)) return;
    setStack((s) => [...s, next]);
  }, [stack]);
  // The course list is a fixed waypoint, never a pushed layer: every
  // in-course « Retour aux courses » lands here, so the list can never sit
  // above a stale course screen (the verifier's push-then-pop route).
  const toCourses = useCallback(() => setStack([START, 'courses']), []);
  const back = useCallback(() => {
    // WO-4.1 rule (journaled; a TOTAL rule after two verifier findings —
    // stale in-course screens must be unreachable BY CONSTRUCTION): a
    // course's truth lives in course.step, so no course screen is ever
    // revealed by popping. « Retour » on a course screen goes to the
    // course list (the course keeps its exact step and reopens there);
    // on the list it goes home; on the root it does nothing. No pop arm
    // exists — nothing is ever revealed from underneath.
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
    setWorld(createDemoWorld());
    setStack([START]);
    setShift('off');
    setActiveId(null);
    setChecks({});
    setWindowUntil('');
  }, []);

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
    go(course.step);
  }, [go]);

  const arriving = world.courses.find((c) => !c.closed && c.step === 'affectation') ?? null;
  const shiftStatus = shift === 'on' ? t('shift.on') : shift === 'pending' ? t('shift.pending') : t('shift.off');
  const shiftAction = shift === 'off' ? t('shift.start_action') : t('shift.end_action');

  const headerTitle =
    screen === 'service'
      ? t('app.title')
      : screen === 'courses'
        ? t('courses.title')
        : active !== null
          ? active.name
          : t('app.title');

  return (
    <SafeAreaView style={styles.screen}>
      {/* SDK 54: backgroundColor restored per the WO-4.0d-prep founder
          ruling ③ — pre-edge-to-edge Android draws a default bar; the
          surface token is the correct fill. */}
      <StatusBar style="dark" backgroundColor={theme.colors.surface} />
      <WaxBand />
      {IS_PREVIEW && (
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerText}>{t('preview.banner')}</Text>
        </View>
      )}

      <AppHeader
        title={headerTitle}
        subtitle={screen === 'service' ? t('service.tagline') : undefined}
        backLabel={`← ${t('nav.retour')}`}
        onBack={stack.length > 1 ? back : undefined}
      />

      <ScreenTransition screenKey={screen}>
      <View style={styles.content}>
        {screen === 'service' && (
          <View style={styles.stackGap}>
            <Card>
              <Overline>{t('shell.work_tab')}</Overline>
              {shift === 'pending' ? (
                // Queued = pending, never done — the honest waiting row,
                // never a fake « En service ».
                <PendingNotice lines={[shiftStatus]} />
              ) : (
                <StatusChip tone={shift === 'on' ? 'ok' : 'muted'} label={shiftStatus} />
              )}
              <PrimaryButton
                label={shiftAction}
                onPress={() => {
                  // No server in the sandbox: a start stays queued = PENDING —
                  // never a fake « En service ». confirmQueuedShiftStart
                  // arrives with the live service at assembly.
                  setShift(shift === 'off' ? 'pending' : 'off');
                }}
              />
            </Card>
            {shift !== 'off' && arriving !== null && (
              <ListRow
                glyph={KIND_GLYPH[arriving.kind]}
                title={t('assignment.title')}
                meta={`${t('assignment.landmark_label')} : ${arriving.locationLines[0]}`}
                chip={<StatusChip tone="info" label={t(statusKeyFor(arriving))} />}
                onPress={() => openCourse(arriving)}
              />
            )}
            <GhostButton label={t('courses.title')} onPress={() => go('courses')} />
          </View>
        )}

        {screen === 'courses' && (
          <View style={styles.listWrap}>
            <FlatList
              data={world.courses}
              keyExtractor={(c) => c.id}
              initialNumToRender={6}
              windowSize={5}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<EmptyState glyph="🛵" title={t('shell.no_task')} />}
              renderItem={({ item }) => (
                <ListRow
                  glyph={KIND_GLYPH[item.kind]}
                  title={item.name}
                  meta={`${t('assignment.landmark_label')} : ${item.locationLines[0]}, ${item.locationLines[2]}`}
                  muted={item.closed}
                  chip={
                    <>
                      <StatusChip tone={toneFor(item)} label={t(statusKeyFor(item))} />
                      {item.attempt === 2 && <StatusChip tone="info" label={t('courses.lineage_2e')} />}
                    </>
                  }
                  onPress={item.closed ? undefined : () => openCourse(item)}
                />
              )}
            />
          </View>
        )}

        {screen === 'affectation' && (
          <Card>
            {active === null ? (
              <EmptyState glyph="🛵" title={t('shell.no_task')} />
            ) : (
              <>
                <Text style={styles.stepTitle}>{t('assignment.title')}</Text>
                {/* « Repère » heads the landmark-first location block (SE0.3,
                    D18 label class) — the LandmarkCard is Séra's signature. */}
                <LandmarkCard label={t('assignment.landmark_label')} lines={active.locationLines} />
                {active.ack === 'ack_pending' ? (
                  <>
                    {/* The ack is queued = PENDING and confers nothing —
                        AssignmentBook.acknowledge('server_confirmed') closes
                        it at assembly; the ack deadline still bites a pending
                        ack (assignment.expired.v1 → back to queue). Walking
                        to the pickup is navigation, not finality. */}
                    <PendingNotice lines={[t('assignment.ack_pending')]} />
                    <PrimaryButton label={t('assignment.pickup_action')} onPress={() => walk((w) => beginPickup(w, active.id))} />
                  </>
                ) : (
                  <PrimaryButton
                    label={t('assignment.ack_action')}
                    onPress={() => {
                      acknowledgeCourse(world, active.id);
                      setWorld({ ...world });
                    }}
                  />
                )}
              </>
            )}
          </Card>
        )}

        {/* The custody walk — every transition below goes through the demo
            store, which calls custody-flow.ts (the rule source) and throws
            on any out-of-order move. */}
        {screen === 'verify' && active !== null && (
          <Card>
            <Text style={styles.stepTitle}>{t('verify.title')}</Text>
            <View style={styles.checkList}>
              {POLICY_CHECK_IDS.map((id) => (
                <CheckRow key={id} label={t(`check.${id}`)} checked={checks[id] === true} onPress={() => setChecks({ ...checks, [id]: !checks[id] })} />
              ))}
            </View>
            <PrimaryButton
              label={t('verify.accept_action')}
              disabled={!allChecked}
              onPress={() => walk((w) => passVerification(w, active.id, checks))}
            />
            {/* The refusal arm is as dignified as acceptance — its own
                polished danger style, never a shame path. */}
            <DangerButton label={t('verify.refuse_action')} onPress={() => walk((w) => refusePickup(w, active.id))} />
          </Card>
        )}

        {screen === 'refused' && (
          <Card>
            {/* The refusal path, money-register calm — what happened, what
                happens next; the course closes with dignity. */}
            <Text style={styles.stepTitle}>{t('refuse.status')}</Text>
            <Text style={styles.stepHint}>{t('refuse.next')}</Text>
            <SecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
          </Card>
        )}

        {screen === 'seal' && active !== null && (
          <Card style={styles.momentCard}>
            <Text style={styles.momentGlyph} accessibilityElementsHidden>
              🔏
            </Text>
            <Text style={styles.momentTitle}>{t('seal.title')}</Text>
            <PrimaryButton label={t('seal.action')} onPress={() => walk((w) => registerSeal(w, active.id))} />
          </Card>
        )}

        {screen === 'evidence' && active !== null && (
          <Card>
            <Text style={styles.stepTitle}>{t('evidence.title')}</Text>
            <View style={styles.photoFrame}>
              <Text style={styles.photoGlyph} accessibilityElementsHidden>
                📷
              </Text>
            </View>
            <PrimaryButton
              label={t('evidence.action')}
              onPress={() => {
                // WO-2.4: the door inspection precedes the drop in BOTH
                // modes; offline evidence still locks everything downstream
                // (queued = pending — the store walks the honest branch).
                walk((w) => captureEvidence(w, active.id));
              }}
            />
          </Card>
        )}

        {screen === 'evidence_pending' && (
          <Card>
            {/* Offline law: the photo is queued = pending; the drop step is
                LOCKED — finality never happens offline. */}
            <PendingNotice lines={[t('evidence.pending')]} />
            <SecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
          </Card>
        )}

        {screen === 'door_inspection' && active !== null && (
          <Card>
            <Text style={styles.stepTitle}>{t('inspect.title')}</Text>
            {active.attempt === 2 && <StatusChip tone="info" label={t('courses.lineage_2e')} />}
            {/* The signature card again at the door — the rider stands at
                the repère, never at a street address. */}
            <LandmarkCard label={t('assignment.landmark_label')} lines={active.locationLines} />
            <PrimaryButton label={t('inspect.accept_action')} onPress={() => walk((w) => acceptInspection(w, active.id))} />
            <GhostButton label={t('problem.action')} onPress={() => walk((w) => reportProblem(w, active.id))} />
          </Card>
        )}

        {screen === 'payment_wait' && active !== null && (
          <Card>
            {/* SE-I11: ONLY the provider signal advances this screen — the
                rider has no action while the payment is unconfirmed. The
                sandbox constant stands in for the live signal at assembly. */}
            {SANDBOX_DOOR_SIGNAL === 'confirmed' ? (
              <>
                <Text style={styles.stepTitle}>{t('pay_ok.status')}</Text>
                <PrimaryButton
                  label={t('pay_ok.continue_action')}
                  onPress={() => walk((w) => applyProviderDoorSignal(w, active.id, SANDBOX_DOOR_SIGNAL))}
                />
              </>
            ) : (
              <>
                <Text style={styles.stepTitle}>{t('pay_wait.status')}</Text>
                <PendingNotice lines={[t('pay_wait.hint')]} />
              </>
            )}
          </Card>
        )}

        {screen === 'drop' && active !== null && (
          <Card style={styles.momentCard}>
            {/* The code moment — centered, strong, calm: the buyer's code is
                the LAST key and the screen holds it like one. */}
            <Text style={styles.momentGlyph} accessibilityElementsHidden>
              🔑
            </Text>
            <Text style={styles.momentTitle}>{t('drop.title')}</Text>
            <Text style={styles.momentHint}>{t('drop.hint')}</Text>
            <PrimaryButton label={t('drop.action')} onPress={() => walk((w) => validateDropCode(w, active.id))} />
            {/* WO-2.2 refusal ladder entry — the problem path is as
                dignified as the purchase path; it whispers, never shouts. */}
            <GhostButton label={t('problem.action')} onPress={() => walk((w) => reportProblem(w, active.id))} />
          </Card>
        )}

        {screen === 'refusal_reason' && active !== null && (
          <Card>
            <Text style={styles.stepTitle}>{t('reason.title')}</Text>
            {FAILURE_REASON_IDS.map((id) => (
              <GhostButton
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
          </Card>
        )}

        {screen === 'retry_window' && active !== null && (
          <Card>
            <Text style={styles.stepTitle}>{t('retry.status')}</Text>
            <StatusChip tone="warn" label={`${t('retry.until')} ${windowUntil}`} />
            {/* The retry re-runs inspection → provider-confirmed payment →
                drop: the drop code stays LAST (safest default, journaled). */}
            <PrimaryButton label={t('retry.retry_action')} onPress={() => walk((w) => retryDelivery(w, active.id))} />
            <GhostButton label={t('retry.expired_action')} onPress={() => walk((w) => expireRetryWindow(w, active.id))} />
          </Card>
        )}

        {screen === 'refused_final' && active !== null && (
          <Card>
            {/* Buyer-fault refusal, register:money — calm, cause and
                what-happens-next stated; no shame, no jargon. */}
            <Text style={styles.stepTitle}>{t('refused_final.status')}</Text>
            <Text style={styles.stepHint}>{t('refused_final.fee')}</Text>
            <Text style={styles.stepHint}>{t('refused_final.next')}</Text>
            <PrimaryButton label={t('refused_final.retour_action')} onPress={() => walk((w) => prepareReturn(w, active.id))} />
          </Card>
        )}

        {screen === 'reschedule_planned' && (
          <Card>
            {/* The non-escalating arm: honest absence / provider failure —
                nothing is lost, the order stays whole; the 2e passage
                appears on the course list with its lineage. */}
            <Text style={styles.stepTitle}>{t('reschedule.status')}</Text>
            <Text style={styles.stepHint}>{t('reschedule.next')}</Text>
            <StatusChip tone="info" label={t('reschedule.lineage')} />
            <SecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
          </Card>
        )}

        {screen === 'retour_colis' && active !== null && (
          <Card>
            {/* SE6.2 two-key return, stated calmly: the seller's code and
                the rider's code, both or neither. */}
            <Text style={styles.stepTitle}>{t('retour.title')}</Text>
            <Text style={styles.stepHint}>{t('retour.two_keys')}</Text>
            <Text style={styles.stepHint}>{t('retour.next')}</Text>
            <PrimaryButton
              label={t('retour.action')}
              onPress={() => {
                completeReturn(world, active.id);
                setWorld({ ...world });
                toCourses();
              }}
            />
          </Card>
        )}

        {screen === 'delivered' && (
          <Card style={styles.momentCard}>
            {/* The arrival is honored statically — the rider's named joy
                moment is a future order; nothing animates here. */}
            <Text style={styles.momentGlyph} accessibilityElementsHidden>
              ✅
            </Text>
            <Text style={styles.momentTitle}>{t('delivered.status')}</Text>
            <Text style={styles.momentHint}>{t('delivered.next')}</Text>
            <SecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
          </Card>
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
        <TabBar
          items={[
            { key: 'service', icon: '🛵', label: t('nav.tab_service'), active: screen === 'service', onPress: () => setStack([START]) },
            { key: 'courses', icon: '📦', label: t('nav.tab_courses'), active: screen === 'courses', onPress: () => toCourses() },
          ]}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.surface },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  stackGap: { gap: theme.spacing.md, paddingTop: theme.spacing.sm },
  listWrap: { flex: 1, gap: theme.spacing.md },
  listContent: { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  checkList: { gap: theme.spacing.sm },
  stepTitle: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.heading.size,
    lineHeight: theme.typeScale.heading.lineHeight,
    fontWeight: theme.typeScale.heading.weight,
  },
  stepHint: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
  },
  momentCard: {
    borderColor: theme.colors.primary,
    borderWidth: theme.spacing.xs / 2,
    gap: theme.spacing.lg,
  },
  momentGlyph: {
    fontSize: theme.typeScale.displayFcfa.size,
    lineHeight: theme.typeScale.displayFcfa.lineHeight,
    textAlign: 'center',
  },
  momentTitle: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.heading.size,
    lineHeight: theme.typeScale.heading.lineHeight,
    fontWeight: theme.typeScale.heading.weight,
    textAlign: 'center',
  },
  momentHint: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    textAlign: 'center',
  },
  photoFrame: {
    minHeight: theme.spacing.xxxl * 2,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  photoGlyph: { fontSize: theme.typeScale.displayFcfa.size, lineHeight: theme.typeScale.displayFcfa.lineHeight },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    minHeight: theme.touch.minTargetPx,
  },
  footerHint: { color: theme.colors.inkFaint, fontSize: theme.typeScale.caption.size },
  resetAction: { minHeight: theme.touch.minTargetPx, justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  resetActionText: { color: theme.colors.inkMuted, fontSize: theme.typeScale.caption.size, fontWeight: theme.typeScale.label.weight },
  previewBanner: {
    backgroundColor: theme.colors.surfaceSunken,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
    paddingVertical: theme.spacing.xs,
    alignItems: 'center',
  },
  previewBannerText: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.caption.size,
    lineHeight: theme.typeScale.caption.lineHeight,
  },
});
