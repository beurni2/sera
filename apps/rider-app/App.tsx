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
import { JOURNEY, SEALED_BACK_STEPS, START, type Screen } from './src/journey';
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
  type CourseStep,
  type DemoCourse,
  type DemoWorld,
} from './src/demo/store';

/**
 * WO-4.1 — LE MONDE NAVIGABLE. The WO-1.2/1.3/2.2/2.4 rider flows become a
 * walkable journey over src/journey.ts: prise de service → l'affectation
 * arrive (ack queued = PENDING, honest) → the FULL custody walk routed
 * through custody-flow.ts (verification checklist → refuse OR accept → seal
 * → evidence → door inspection → the Option-B provider-confirmed payment
 * wait → drop code LAST → validé), plus the seeded reschedule (2e passage,
 * lineage visible) and return (two-key) walks from the « Courses d'essai »
 * list. No new business capability: every custody move goes through the
 * demo store, which calls the custody-flow rule functions and throws on any
 * out-of-order move. Offline law unchanged: queued = pending, never done.
 * « Recommencer la démo » resets world + stack.
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
  const back = useCallback(() => {
    // WO-4.1 choice (journaled): once the seal is posed, popping the stack
    // would re-show a pre-seal or pre-payment screen — a lie about custody.
    // Mid-custody « Retour » goes to the course list instead; the course
    // keeps its exact step and reopens where custody truly stands.
    if (SEALED_BACK_STEPS.includes(stack[stack.length - 1] ?? START)) {
      setStack([START, 'courses']);
      return;
    }
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
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

  return (
    <SafeAreaView style={styles.screen}>
      {/* SDK 54: backgroundColor restored per the WO-4.0d-prep founder
          ruling ③ — pre-edge-to-edge Android draws a default bar; the
          surface token is the correct fill. */}
      <StatusBar style="dark" backgroundColor={theme.colors.surface} />
      {IS_PREVIEW && (
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerText}>{t('preview.banner')}</Text>
        </View>
      )}

      <View style={styles.header}>
        {stack.length > 1 ? (
          <Pressable style={styles.backAction} onPress={back}>
            <Text style={styles.backActionText}>← {t('nav.retour')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.brand}>{t('app.title')}</Text>
        )}
      </View>

      <View style={styles.content}>
        {screen === 'service' && (
          <View style={styles.stackGap}>
            <Text style={styles.tab}>{t('shell.work_tab')}</Text>
            <Text style={styles.message}>{t('service.tagline')}</Text>
            <View style={styles.card}>
              <Text style={styles.statusLine}>{shiftStatus}</Text>
              <Pressable
                style={styles.primaryAction}
                onPress={() => {
                  // No server in the sandbox: a start stays queued = PENDING —
                  // never a fake « En service ». confirmQueuedShiftStart
                  // arrives with the live service at assembly.
                  setShift(shift === 'off' ? 'pending' : 'off');
                }}
              >
                <Text style={styles.primaryActionText}>{shiftAction}</Text>
              </Pressable>
            </View>
            {shift !== 'off' && arriving !== null && (
              <Pressable style={styles.secondaryCard} onPress={() => openCourse(arriving)}>
                <Text style={styles.secondaryCardText}>{t('assignment.title')}</Text>
              </Pressable>
            )}
            <Pressable style={styles.quietAction} onPress={() => go('courses')}>
              <Text style={styles.quietActionText}>{t('courses.title')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'courses' && (
          <View style={styles.listWrap}>
            <Text style={styles.heading}>{t('courses.title')}</Text>
            <FlatList
              data={world.courses}
              keyExtractor={(c) => c.id}
              initialNumToRender={6}
              windowSize={5}
              ListEmptyComponent={<Text style={styles.emptyState}>{t('shell.no_task')}</Text>}
              renderItem={({ item }) => (
                <Pressable style={styles.listRow} disabled={item.closed} onPress={() => openCourse(item)}>
                  <Text style={styles.listName}>{item.name}</Text>
                  <Text style={styles.listMeta}>
                    {t('assignment.landmark_label')} : {item.locationLines[0]}, {item.locationLines[2]}
                  </Text>
                  {item.attempt === 2 && <Text style={styles.lineage}>{t('courses.lineage_2e')}</Text>}
                  <Text style={item.closed ? styles.badgeDone : styles.badgeOpen}>{t(statusKeyFor(item))}</Text>
                </Pressable>
              )}
            />
          </View>
        )}

        {screen === 'affectation' && (
          <View style={styles.card}>
            {active === null ? (
              <Text style={styles.emptyState}>{t('shell.no_task')}</Text>
            ) : (
              <>
                <Text style={styles.assignmentTitle}>{t('assignment.title')}</Text>
                {/* « Repère » heads the landmark-first location block (SE0.3,
                    D18 label class). */}
                <Text style={styles.fieldLabel}>{t('assignment.landmark_label')}</Text>
                {active.locationLines.map((line) => (
                  <Text key={line} style={styles.locationLine}>
                    {line}
                  </Text>
                ))}
                {active.ack === 'ack_pending' ? (
                  <>
                    {/* The ack is queued = PENDING and confers nothing —
                        AssignmentBook.acknowledge('server_confirmed') closes
                        it at assembly; the ack deadline still bites a pending
                        ack (assignment.expired.v1 → back to queue). Walking
                        to the pickup is navigation, not finality. */}
                    <Text style={styles.statusLine}>{t('assignment.ack_pending')}</Text>
                    <Pressable style={styles.primaryAction} onPress={() => walk((w) => beginPickup(w, active.id))}>
                      <Text style={styles.primaryActionText}>{t('assignment.pickup_action')}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    style={styles.primaryAction}
                    onPress={() => {
                      acknowledgeCourse(world, active.id);
                      setWorld({ ...world });
                    }}
                  >
                    <Text style={styles.primaryActionText}>{t('assignment.ack_action')}</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}

        {/* The custody walk — every transition below goes through the demo
            store, which calls custody-flow.ts (the rule source) and throws
            on any out-of-order move. */}
        {screen === 'verify' && active !== null && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('verify.title')}</Text>
            {POLICY_CHECK_IDS.map((id) => (
              <Pressable key={id} style={styles.checkRow} onPress={() => setChecks({ ...checks, [id]: !checks[id] })}>
                <Text style={checks[id] ? styles.checkOn : styles.checkOff}>{t(`check.${id}`)}</Text>
              </Pressable>
            ))}
            <Pressable
              style={allChecked ? styles.primaryAction : styles.primaryActionDisabled}
              disabled={!allChecked}
              onPress={() => walk((w) => passVerification(w, active.id, checks))}
            >
              <Text style={styles.primaryActionText}>{t('verify.accept_action')}</Text>
            </Pressable>
            {/* The refusal arm is as dignified as acceptance — it whispers,
                never shames. */}
            <Pressable style={styles.quietAction} onPress={() => walk((w) => refusePickup(w, active.id))}>
              <Text style={styles.quietActionText}>{t('verify.refuse_action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'refused' && (
          <View style={styles.card}>
            {/* The refusal path, money-register calm — what happened, what
                happens next; the course closes with dignity. */}
            <Text style={styles.assignmentTitle}>{t('refuse.status')}</Text>
            <Text style={styles.statusLine}>{t('refuse.next')}</Text>
            <Pressable style={styles.secondaryCard} onPress={() => go('courses')}>
              <Text style={styles.secondaryCardText}>{t('nav.retour_courses')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'seal' && active !== null && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('seal.title')}</Text>
            <Pressable style={styles.primaryAction} onPress={() => walk((w) => registerSeal(w, active.id))}>
              <Text style={styles.primaryActionText}>{t('seal.action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'evidence' && active !== null && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('evidence.title')}</Text>
            <Pressable
              style={styles.primaryAction}
              onPress={() => {
                // WO-2.4: the door inspection precedes the drop in BOTH
                // modes; offline evidence still locks everything downstream
                // (queued = pending — the store walks the honest branch).
                walk((w) => captureEvidence(w, active.id));
              }}
            >
              <Text style={styles.primaryActionText}>{t('evidence.action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'evidence_pending' && (
          <View style={styles.card}>
            {/* Offline law: the photo is queued = pending; the drop step is
                LOCKED — finality never happens offline. */}
            <Text style={styles.statusLine}>{t('evidence.pending')}</Text>
            <Pressable style={styles.secondaryCard} onPress={() => go('courses')}>
              <Text style={styles.secondaryCardText}>{t('nav.retour_courses')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'door_inspection' && active !== null && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('inspect.title')}</Text>
            {active.attempt === 2 && <Text style={styles.lineage}>{t('courses.lineage_2e')}</Text>}
            <Pressable style={styles.primaryAction} onPress={() => walk((w) => acceptInspection(w, active.id))}>
              <Text style={styles.primaryActionText}>{t('inspect.accept_action')}</Text>
            </Pressable>
            <Pressable style={styles.quietAction} onPress={() => walk((w) => reportProblem(w, active.id))}>
              <Text style={styles.quietActionText}>{t('problem.action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'payment_wait' && active !== null && (
          <View style={styles.card}>
            {/* SE-I11: ONLY the provider signal advances this screen — the
                rider has no action while the payment is unconfirmed. The
                sandbox constant stands in for the live signal at assembly. */}
            {SANDBOX_DOOR_SIGNAL === 'confirmed' ? (
              <>
                <Text style={styles.assignmentTitle}>{t('pay_ok.status')}</Text>
                <Pressable
                  style={styles.primaryAction}
                  onPress={() => walk((w) => applyProviderDoorSignal(w, active.id, SANDBOX_DOOR_SIGNAL))}
                >
                  <Text style={styles.primaryActionText}>{t('pay_ok.continue_action')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.assignmentTitle}>{t('pay_wait.status')}</Text>
                <Text style={styles.statusLine}>{t('pay_wait.hint')}</Text>
              </>
            )}
          </View>
        )}

        {screen === 'drop' && active !== null && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('drop.title')}</Text>
            <Text style={styles.statusLine}>{t('drop.hint')}</Text>
            <Pressable style={styles.primaryAction} onPress={() => walk((w) => validateDropCode(w, active.id))}>
              <Text style={styles.primaryActionText}>{t('drop.action')}</Text>
            </Pressable>
            {/* WO-2.2 refusal ladder entry — the problem path is as
                dignified as the purchase path; it whispers, never shouts. */}
            <Pressable style={styles.quietAction} onPress={() => walk((w) => reportProblem(w, active.id))}>
              <Text style={styles.quietActionText}>{t('problem.action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'refusal_reason' && active !== null && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('reason.title')}</Text>
            {FAILURE_REASON_IDS.map((id) => (
              <Pressable
                key={id}
                style={styles.checkRow}
                onPress={() => {
                  // The ONE retry window (~15 min policy default; the live
                  // windowExpiresAt arrives with the service outcome at
                  // assembly — the display is honest either way).
                  const until = new Date(Date.now() + 15 * 60_000);
                  setWindowUntil(`${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`);
                  walk((w) => chooseFailureReason(w, active.id, id));
                }}
              >
                <Text style={styles.checkOff}>{t(`reason.${id}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {screen === 'retry_window' && active !== null && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('retry.status')}</Text>
            <Text style={styles.statusLine}>
              {t('retry.until')} {windowUntil}
            </Text>
            {/* The retry re-runs inspection → provider-confirmed payment →
                drop: the drop code stays LAST (safest default, journaled). */}
            <Pressable style={styles.primaryAction} onPress={() => walk((w) => retryDelivery(w, active.id))}>
              <Text style={styles.primaryActionText}>{t('retry.retry_action')}</Text>
            </Pressable>
            <Pressable style={styles.quietAction} onPress={() => walk((w) => expireRetryWindow(w, active.id))}>
              <Text style={styles.quietActionText}>{t('retry.expired_action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'refused_final' && active !== null && (
          <View style={styles.card}>
            {/* Buyer-fault refusal, register:money — calm, cause and
                what-happens-next stated; no shame, no jargon. */}
            <Text style={styles.assignmentTitle}>{t('refused_final.status')}</Text>
            <Text style={styles.statusLine}>{t('refused_final.fee')}</Text>
            <Text style={styles.statusLine}>{t('refused_final.next')}</Text>
            <Pressable style={styles.primaryAction} onPress={() => walk((w) => prepareReturn(w, active.id))}>
              <Text style={styles.primaryActionText}>{t('refused_final.retour_action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'reschedule_planned' && (
          <View style={styles.card}>
            {/* The non-escalating arm: honest absence / provider failure —
                nothing is lost, the order stays whole; the 2e passage
                appears on the course list with its lineage. */}
            <Text style={styles.assignmentTitle}>{t('reschedule.status')}</Text>
            <Text style={styles.statusLine}>{t('reschedule.next')}</Text>
            <Text style={styles.lineage}>{t('reschedule.lineage')}</Text>
            <Pressable style={styles.secondaryCard} onPress={() => go('courses')}>
              <Text style={styles.secondaryCardText}>{t('nav.retour_courses')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'retour_colis' && active !== null && (
          <View style={styles.card}>
            {/* SE6.2 two-key return, stated calmly: the seller's code and
                the rider's code, both or neither. */}
            <Text style={styles.assignmentTitle}>{t('retour.title')}</Text>
            <Text style={styles.statusLine}>{t('retour.two_keys')}</Text>
            <Text style={styles.statusLine}>{t('retour.next')}</Text>
            <Pressable
              style={styles.primaryAction}
              onPress={() => {
                completeReturn(world, active.id);
                setWorld({ ...world });
                go('courses');
              }}
            >
              <Text style={styles.primaryActionText}>{t('retour.action')}</Text>
            </Pressable>
          </View>
        )}

        {screen === 'delivered' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('delivered.status')}</Text>
            <Text style={styles.statusLine}>{t('delivered.next')}</Text>
            <Pressable style={styles.secondaryCard} onPress={() => go('courses')}>
              <Text style={styles.secondaryCardText}>{t('nav.retour_courses')}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerHint}>{t('demo.donnees')}</Text>
        <Pressable style={styles.resetAction} onPress={reset}>
          <Text style={styles.resetActionText}>{t('nav.recommencer')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  stackGap: {
    gap: theme.spacing.lg,
  },
  brand: {
    color: theme.colors.primary,
    fontSize: theme.typeScale.title.size,
    lineHeight: theme.typeScale.title.lineHeight,
    fontWeight: theme.typeScale.title.weight,
    textAlign: 'center',
  },
  tab: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
    fontWeight: theme.typeScale.label.weight,
    textAlign: 'center',
  },
  card: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  listWrap: {
    flex: 1,
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  listRow: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.xs,
    minHeight: 44,
  },
  listName: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    fontWeight: theme.typeScale.heading.weight,
  },
  listMeta: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
  },
  lineage: {
    color: theme.colors.info,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
    fontWeight: theme.typeScale.heading.weight,
    textAlign: 'center',
  },
  badgeOpen: {
    color: theme.colors.primary,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
    fontWeight: theme.typeScale.heading.weight,
  },
  badgeDone: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
  },
  heading: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.heading.size,
    lineHeight: theme.typeScale.heading.lineHeight,
    fontWeight: theme.typeScale.heading.weight,
    textAlign: 'center',
  },
  message: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    textAlign: 'center',
  },
  statusLine: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    textAlign: 'center',
  },
  assignmentTitle: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.heading.size,
    lineHeight: theme.typeScale.heading.lineHeight,
    fontWeight: theme.typeScale.heading.weight,
    textAlign: 'center',
  },
  locationLine: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    textAlign: 'center',
  },
  fieldLabel: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
    fontWeight: theme.typeScale.label.weight,
    textAlign: 'center',
  },
  emptyState: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    textAlign: 'center',
  },
  primaryAction: {
    minHeight: 44,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  primaryActionText: {
    color: theme.colors.surface,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
  },
  primaryActionDisabled: {
    minHeight: 44,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.inkMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    opacity: 0.5,
  },
  secondaryCard: {
    minHeight: 44,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  secondaryCardText: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
  },
  quietAction: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quietActionText: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
  },
  checkRow: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomColor: theme.colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkOn: {
    color: theme.colors.primary,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    fontWeight: '600',
  },
  checkOff: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
  },
  backAction: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.md,
  },
  backActionText: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
    minHeight: 44,
  },
  footerHint: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
  },
  resetAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  resetActionText: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
  },
  previewBanner: {
    backgroundColor: theme.colors.ink,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  previewBannerText: {
    color: theme.colors.surface,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
  },
});
