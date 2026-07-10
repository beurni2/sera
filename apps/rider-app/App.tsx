import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { seraTheme as theme } from '@platform/ui-tokens';
import { SANDBOX_ASSIGNMENT, type AssignmentView } from './src/sandbox-assignment';
import { CONNECTIVITY, POLICY_CHECK_IDS, nextAfterEvidence, type CustodyStep, type PolicyCheckId } from './src/custody-flow';
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
  const allChecked = POLICY_CHECK_IDS.every((id) => checks[id] === true);

  const shiftStatus = shift === 'on' ? t('shift.on') : shift === 'pending' ? t('shift.pending') : t('shift.off');
  const shiftAction = shift === 'off' ? t('shift.start_action') : t('shift.end_action');

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" backgroundColor={theme.colors.surface} />
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
            <Pressable style={styles.primaryAction} onPress={() => setStep(nextAfterEvidence(CONNECTIVITY))}>
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

        {step === 'drop' && (
          <View style={styles.card}>
            <Text style={styles.assignmentTitle}>{t('drop.title')}</Text>
            <Text style={styles.statusLine}>{t('drop.hint')}</Text>
            <Pressable style={styles.primaryAction} onPress={() => setStep('delivered')}>
              <Text style={styles.primaryActionText}>{t('drop.action')}</Text>
            </Pressable>
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
});
