import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { seraTheme as theme } from '@platform/ui-tokens';
import { SANDBOX_ASSIGNMENT, type AssignmentView } from './src/sandbox-assignment';
import { CONNECTIVITY, FAILURE_REASON_IDS, POLICY_CHECK_IDS, SANDBOX_DOOR_SIGNAL, SANDBOX_PAYMENT_MODE, nextAfterEvidence, stepAfterDoorSignal, stepAfterInspection, stepAfterWindowExpiry, type CustodyStep, type FailureReasonId, type PolicyCheckId } from './src/custody-flow';
import { IS_PREVIEW } from './src/preview';
import { t } from './src/i18n';

/**
 * WO-1.2 rider shell: shift start/end + assignment card, sera theme, catalog
 * strings. Offline law on every action: queued = PENDING, never done — a
 * shift start or an ack sent without the network shows « En attente du
 * réseau » and confers nothing until the server confirms (SE0.2; kernel
 * offline semantics). The E1 sandbox has no server, so pending stays
 * honestly pending; live confirmation wiring (RiderRegistry) lands at E1
 * assembly. Locations render landmark-first (SE0.3). Metro-safe: the bundle
 * imports only pure token data; canon barrels stay out of the runtime graph.
 * The canonical « Commencer service » label remains absent — reading-level
 * collision instance #2, with the founder.
 */

type ShiftView = 'off' | 'pending' | 'on';

export default function App() {
  const [shift, setShift] = useState<ShiftView>('off');
  const [assignment, setAssignment] = useState<AssignmentView | null>(SANDBOX_ASSIGNMENT);
  const [step, setStep] = useState<CustodyStep>('verify');
  const [checks, setChecks] = useState<Partial<Record<PolicyCheckId, boolean>>>({});
  const [failureReason, setFailureReason] = useState<FailureReasonId | null>(null);
  const [windowUntil, setWindowUntil] = useState('');
  const allChecked = POLICY_CHECK_IDS.every((id) => checks[id] === true);

  const shiftStatus = shift === 'on' ? t('shift.on') : shift === 'pending' ? t('shift.pending') : t('shift.off');
  const shiftAction = shift === 'off' ? t('shift.start_action') : t('shift.end_action');

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" backgroundColor={theme.colors.surface} />
      {IS_PREVIEW && (
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerText}>{t('preview.banner')}</Text>
        </View>
      )}
      <View style={styles.content}>
        <Text style={styles.brand}>{t('app.title')}</Text>
        <Text style={styles.tab}>{t('shell.work_tab')}</Text>

        <View style={styles.card}>
          <Text style={styles.statusLine}>{shiftStatus}</Text>
          <Pressable
            style={styles.primaryAction}
            onPress={() => {
              // No server in the E1 sandbox: a start stays queued = PENDING —
              // never a fake « En service ». confirmQueuedShiftStart arrives
              // with the live service at assembly.
              setShift(shift === 'off' ? 'pending' : 'off');
            }}
          >
            <Text style={styles.primaryActionText}>{shiftAction}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          {assignment === null ? (
            <Text style={styles.emptyState}>{t('shell.no_task')}</Text>
          ) : (
            <>
              <Text style={styles.assignmentTitle}>{t('assignment.title')}</Text>
              {/* « Repère » returns under the D18 label class (reading-budget
                  exempt) — it heads the landmark-first location block. */}
              <Text style={styles.fieldLabel}>{t('assignment.landmark_label')}</Text>
              {assignment.locationLines.map((line) => (
                <Text key={line} style={styles.locationLine}>
                  {line}
                </Text>
              ))}
              {assignment.ackState === 'ack_pending' ? (
                <Text style={styles.statusLine}>{t('assignment.ack_pending')}</Text>
              ) : (
                <Pressable
                  style={styles.primaryAction}
                  onPress={() => {
                    // The rider's ack, from THIS shell. No server in the E1
                    // sandbox: the command is queued = PENDING (« Accord
                    // envoyé. En attente du réseau. ») and confers no
                    // finality — AssignmentBook.acknowledge('server_confirmed')
                    // closes it at assembly; the ack deadline still bites a
                    // pending ack (assignment.expired.v1 → back to queue).
                    setAssignment({ ...assignment, ackState: 'ack_pending' });
                  }}
                >
                  <Text style={styles.primaryActionText}>{t('assignment.ack_action')}</Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        {/* WO-1.3 custody flow — verification checklist (policy-driven) →
            refuse/accept → seal → evidence → drop code (LAST). */}
        {step === 'verify' && (
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
              onPress={() => setStep('seal')}
            >
              <Text style={styles.primaryActionText}>{t('verify.accept_action')}</Text>
            </Pressable>
            <Pressable style={styles.quietAction} onPress={() => setStep('refused')}>
              <Text style={styles.quietActionText}>{t('verify.refuse_action')}</Text>
            </Pressable>
          </View>
        )}

        {step === 'refused' && (
          <View style={styles.card}>
            {/* The refusal path is as dignified as the purchase path: calm
                money-register — what happened, what happens next. */}
            <Text style={styles.assignmentTitle}>{t('refuse.status')}</Text>
            <Text style={styles.statusLine}>{t('refuse.next')}</Text>
          </View>
        )}

        {step === 'seal' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('seal.title')}</Text>
            <Pressable style={styles.primaryAction} onPress={() => setStep('evidence')}>
              <Text style={styles.primaryActionText}>{t('seal.action')}</Text>
            </Pressable>
          </View>
        )}

        {step === 'evidence' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('evidence.title')}</Text>
            <Pressable
              style={styles.primaryAction}
              onPress={() => {
                // WO-2.4: the door inspection precedes the drop in BOTH
                // modes; offline evidence still locks everything downstream.
                const next = nextAfterEvidence(CONNECTIVITY);
                setStep(next === 'drop' ? 'door_inspection' : next);
              }}
            >
              <Text style={styles.primaryActionText}>{t('evidence.action')}</Text>
            </Pressable>
          </View>
        )}

        {step === 'evidence_pending' && (
          <View style={styles.card}>
            {/* Offline law: the photo is queued = pending; the drop step is
                LOCKED — finality never happens offline. */}
            <Text style={styles.statusLine}>{t('evidence.pending')}</Text>
          </View>
        )}

        {step === 'door_inspection' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('inspect.title')}</Text>
            <Pressable style={styles.primaryAction} onPress={() => setStep(stepAfterInspection(SANDBOX_PAYMENT_MODE))}>
              <Text style={styles.primaryActionText}>{t('inspect.accept_action')}</Text>
            </Pressable>
            <Pressable style={styles.quietAction} onPress={() => setStep('refusal_reason')}>
              <Text style={styles.quietActionText}>{t('problem.action')}</Text>
            </Pressable>
          </View>
        )}

        {step === 'payment_wait' && (
          <View style={styles.card}>
            {/* SE-I11: ONLY the provider signal advances this screen — the
                rider has no action while the payment is unconfirmed. The
                sandbox constant stands in for the live signal at assembly. */}
            {SANDBOX_DOOR_SIGNAL === 'confirmed' ? (
              <>
                <Text style={styles.assignmentTitle}>{t('pay_ok.status')}</Text>
                <Pressable style={styles.primaryAction} onPress={() => setStep(stepAfterDoorSignal(SANDBOX_DOOR_SIGNAL))}>
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

        {step === 'drop' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('drop.title')}</Text>
            <Text style={styles.statusLine}>{t('drop.hint')}</Text>
            <Pressable style={styles.primaryAction} onPress={() => setStep('delivered')}>
              <Text style={styles.primaryActionText}>{t('drop.action')}</Text>
            </Pressable>
            {/* WO-2.2 refusal ladder entry — the problem path is as
                dignified as the purchase path; it whispers, never shouts. */}
            <Pressable style={styles.quietAction} onPress={() => setStep('refusal_reason')}>
              <Text style={styles.quietActionText}>{t('problem.action')}</Text>
            </Pressable>
          </View>
        )}

        {step === 'refusal_reason' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('reason.title')}</Text>
            {FAILURE_REASON_IDS.map((id) => (
              <Pressable
                key={id}
                style={styles.checkRow}
                onPress={() => {
                  setFailureReason(id);
                  // The ONE retry window (~15 min policy default; the live
                  // windowExpiresAt arrives with the service outcome at
                  // assembly — the display is honest either way).
                  const until = new Date(Date.now() + 15 * 60_000);
                  setWindowUntil(`${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`);
                  setStep('retry_window');
                }}
              >
                <Text style={styles.checkOff}>{t(`reason.${id}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {step === 'retry_window' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('retry.status')}</Text>
            <Text style={styles.statusLine}>
              {t('retry.until')} {windowUntil}
            </Text>
            <Pressable style={styles.primaryAction} onPress={() => setStep('drop')}>
              <Text style={styles.primaryActionText}>{t('retry.retry_action')}</Text>
            </Pressable>
            <Pressable
              style={styles.quietAction}
              onPress={() => setStep(failureReason === null ? 'drop' : stepAfterWindowExpiry(failureReason))}
            >
              <Text style={styles.quietActionText}>{t('retry.expired_action')}</Text>
            </Pressable>
          </View>
        )}

        {step === 'refused_final' && (
          <View style={styles.card}>
            {/* Buyer-fault refusal, register:money — calm, cause and
                what-happens-next stated; no shame, no jargon. */}
            <Text style={styles.assignmentTitle}>{t('refused_final.status')}</Text>
            <Text style={styles.statusLine}>{t('refused_final.fee')}</Text>
            <Text style={styles.statusLine}>{t('refused_final.next')}</Text>
          </View>
        )}

        {step === 'reschedule_planned' && (
          <View style={styles.card}>
            {/* The non-escalating arm: honest absence / provider failure —
                nothing is lost, the order stays whole. */}
            <Text style={styles.assignmentTitle}>{t('reschedule.status')}</Text>
            <Text style={styles.statusLine}>{t('reschedule.next')}</Text>
          </View>
        )}

        {step === 'delivered' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('delivered.status')}</Text>
            <Text style={styles.statusLine}>{t('delivered.next')}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
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
    marginTop: theme.spacing.lg,
    gap: theme.spacing.md,
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
