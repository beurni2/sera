import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { C, GEO, rad, ty } from './faso';
import { displayFace, textFace } from './faso-fonts';
import { Body, Card, PrimaryButton, ScreenTitle } from './faso-kit';

/**
 * ═══ SE-LIVE-4c-vi · TYPING A CUSTODY SECRET ═══
 *
 * One screen shape, two uses, both settled by the founder (2026-08-07):
 *   · the PICKUP CODE — « the dispatcher will give it to the rider », so the
 *     rider hears it on the phone and types it at the stall;
 *   · the SEAL ID — « the seal id is typed », read off the physical seal the
 *     rider has just applied.
 *
 * ⚠ IT DOES NOT MASK, AND THAT IS THE WHOLE LESSON OF BLOCKER A1. The sign-in
 * field once formatted the code as it was typed, re-applying its formatter to
 * its own output, and turned the code a rider read off a slip into a
 * DIFFERENT, well-formed, wrong one — which was then sent, and answered « this
 * code does not work ». These two fields carry values with no known shape at
 * all (the dispatcher speaks the pickup code aloud; the seal is whatever is
 * printed on it), so masking would be even more dangerous here. The field
 * shows exactly what was typed. The only normalisation is `trim()`, applied at
 * SUBMIT, because a trailing space from a phone keyboard would burn a
 * single-use secret against a mismatch the rider cannot see.
 *
 * ⚠ AND IT NEVER SHOWS THE VALUE BACK AS « CONFIRMED ». The sign-in screen
 * can echo a canonical form because it knows the shape; here there is nothing
 * to check against, and a green confirmation would assert something the app
 * cannot know. The rider's own reading is the only check, so the field is
 * large and tracked for exactly that.
 *
 * SKIN ONLY — every colour, radius and type role from tokens; no custody
 * logic, no network, no franc. It takes strings and a submit callback.
 */
export function FasoActCode({
  strings,
  onSubmit,
  working,
  outcome,
  canSend,
  photo,
}: {
  readonly strings: {
    readonly title: string;
    readonly hint: string;
    readonly placeholder: string;
    readonly action: string;
    readonly working: string;
  };
  readonly onSubmit: (value: string) => void;
  readonly working: boolean;
  /** The server's answer, already resolved from the catalog by the caller.
   *  `tone` decides only whether it reads as a settled fact or a refusal —
   *  a refused package is not an error, it is a custody fact. */
  readonly outcome?: { readonly title: string; readonly hint?: string | undefined; readonly tone: 'ok' | 'refused' | 'waiting' } | undefined;
  /**
   * ⚠ AN EXTERNAL GATE THE CALLER OWNS (verifier blocker A4). On the
   * verification screen this is « every one of the nine checks has an answer »
   * — because sending an unfinished list BURNS the single-use pickup code and
   * leaves the order unverifiable for ever. Defaults to true for the seal,
   * which has no checklist.
   */
  readonly canSend?: boolean | undefined;
  /**
   * ⚠ THE PROOF PHOTO, WHICH IS A PREREQUISITE AND NOT A SECOND PRIMARY ACTION
   * (verifier blocker A1, second round). The capture machinery existed, was
   * tested, and was wired to NOTHING — so the send returned on its first line
   * and the rider tapped an enabled button that did nothing, for ever.
   *
   * It renders as a quiet step ABOVE the send: one line saying what to
   * photograph, one secondary button, and — once the bucket has the bytes — a
   * settled « Photo enregistrée. » The send stays the one primary action and is
   * DISABLED until the photo is held, because without a ref the act cannot go
   * and a live button would be the same lie again.
   *
   * Omitted entirely (undefined) ⇒ no photo step and no gate.
   */
  readonly photo?:
    | {
        readonly hint: string;
        readonly takeLabel: string;
        readonly retakeLabel: string;
        readonly takenLabel: string;
        readonly neededLabel: string;
        /** The bucket has the bytes and named them. Never « the camera opened ». */
        readonly taken: boolean;
        readonly busy: boolean;
        /** Already resolved from the catalog by the caller; absent = nothing wrong. */
        readonly issue?: string | undefined;
        readonly onPress: () => void;
      }
    | undefined;
}) {
  const [typed, setTyped] = useState('');
  const photoReady = photo === undefined || photo.taken;
  const ready = typed.trim() !== '' && !working && canSend !== false && photoReady && photo?.busy !== true;

  return (
    <View style={styles.wrap}>
      <ScreenTitle>{strings.title}</ScreenTitle>
      <Body>{strings.hint}</Body>

      {photo !== undefined ? (
        <Card>
          <Text style={styles.photoHint}>{photo.hint}</Text>
          {photo.taken ? <Text style={styles.photoDone}>{photo.takenLabel}</Text> : null}
          {photo.issue !== undefined ? (
            <Text style={styles.photoIssue} accessibilityLiveRegion="polite">
              {photo.issue}
            </Text>
          ) : null}
          <Text
            accessibilityRole="button"
            accessibilityState={{ disabled: photo.busy }}
            onPress={() => !photo.busy && photo.onPress()}
            style={styles.photoAction}
          >
            {photo.taken ? photo.retakeLabel : photo.takeLabel}
          </Text>
        </Card>
      ) : null}

      <Card>
        <TextInput
          style={styles.field}
          // Exactly what was typed — never a formatter's idea of it (A1).
          value={typed}
          onChangeText={setTyped}
          placeholder={strings.placeholder}
          placeholderTextColor={C.sub}
          autoCapitalize="characters"
          // A keyboard that rewrites a single-use custody secret burns it, and
          // the rider cannot see why.
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          editable={!working}
          accessibilityLabel={strings.title}
          returnKeyType="go"
          onSubmitEditing={() => ready && onSubmit(typed.trim())}
        />
      </Card>

      {outcome !== undefined && !working ? (
        <View
          style={[styles.outcome, outcome.tone === 'ok' ? styles.outcomeOk : styles.outcomePlain]}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.outcomeTitle}>{outcome.title}</Text>
          {outcome.hint !== undefined ? <Text style={styles.outcomeHint}>{outcome.hint}</Text> : null}
        </View>
      ) : null}

      {/* A disabled button must always say what is missing — « one primary
          action per screen » is not « one silent action ». */}
      {photo !== undefined && !photo.taken ? <Body>{photo.neededLabel}</Body> : null}
      <PrimaryButton
        label={working ? strings.working : strings.action}
        onPress={() => onSubmit(typed.trim())}
        // Locked while in flight: a second tap on a slow network must not send
        // a second act, and an empty field must not send at all. Locked too
        // until the bucket holds the photo — no ref, no act.
        disabled={!ready}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: GEO.paddingPx, paddingHorizontal: GEO.paddingPx },
  field: {
    // The house treatment for a code (`sealCode`): read at arm's length, in
    // sun, and compared character by character against a seal or a voice.
    fontFamily: displayFace(800),
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 21 * 0.1,
    fontVariant: ['tabular-nums'],
    color: C.ink,
    paddingVertical: 12,
    textAlign: 'center',
    minHeight: 56,
  },
  photoHint: { ...ty('body'), fontFamily: textFace(400), color: C.ink },
  photoDone: { ...ty('body'), fontFamily: textFace(700), color: C.okFg },
  photoIssue: { ...ty('body', 'min'), fontFamily: textFace(400), color: C.warnFg },
  photoAction: {
    ...ty('body'),
    fontFamily: textFace(700),
    color: C.ink,
    // Secondary to the send, but still a real target for a thumb in the sun.
    minHeight: 44,
    lineHeight: 44,
    textAlign: 'center',
    borderRadius: rad('card'),
    backgroundColor: C.paper,
    overflow: 'hidden',
  },
  outcome: { gap: 4, padding: 12, borderRadius: rad('card') },
  outcomeOk: { backgroundColor: C.okBg },
  outcomePlain: { backgroundColor: C.paper },
  outcomeTitle: { ...ty('body'), fontFamily: textFace(700), color: C.ink },
  outcomeHint: { ...ty('body', 'min'), fontFamily: textFace(400), color: C.sub },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  checkLabel: { ...ty('body'), color: C.ink, flex: 1 },
  checkAnswers: { flexDirection: 'row', gap: 8 },
  checkChoice: {
    ...ty('body'),
    fontFamily: textFace(700),
    color: C.sub,
    // ≥44px target on both answers — a mis-tap here costs a supplier a
    // fault record, so neither is a small one.
    minWidth: 60,
    minHeight: 44,
    lineHeight: 44,
    textAlign: 'center',
    borderRadius: rad('card'),
    backgroundColor: C.paper,
    overflow: 'hidden',
  },
  checkYes: { backgroundColor: C.okBg, color: C.okFg },
  checkNo: { backgroundColor: C.warnBg, color: C.warnFg },
});

/**
 * ═══ SE-LIVE-4c-viii · A CHECK IS ANSWERED, NEVER MERELY LEFT ═══
 *
 * ⚠ VERIFIER BLOCKERS A4 + A8, WHICH ARE THE SAME MISTAKE SEEN TWICE. The
 * checklist was a row of binary boxes: ticked meant « conforme », and
 * UNTICKED meant two incompatible things at once — « I have not looked yet »
 * and « this one fails ». Both of the resulting harms were measured on the
 * shipped Worker:
 *
 *   · A4 — an unfinished list SENDS. `verifyPickup` CONSUMES the single-use
 *     pickup code before the policy runs, so a partial submit answers
 *     `policy_checks_missing` having already BURNED the code; the correct
 *     submit then answers `secret_already_used`, and `openNewVerificationCycle`
 *     only re-arms after a *refused* verification — this outcome is `invalid`.
 *     The order becomes unverifiable, permanently, with no route to recover it.
 *   · A8 — a forgotten tick becomes a REFUSAL, and a refusal emits
 *     `protection.claim_opened.v1` with `faultClass: 'seller'`. A supplier is
 *     recorded at fault, for ever, because a rider's thumb missed a box.
 *
 * FOUNDER RULING (2026-08-07): keep ONE send button — no separate refuse
 * action. That is only safe if the ambiguity is removed, so every check is now
 * explicitly ANSWERED: « Oui » or « Non », nothing implied by absence. The
 * send button stays disabled until all nine carry an answer, so an unfinished
 * list can no longer reach the code at all, and a « Non » is a thing the rider
 * deliberately said rather than a box they missed.
 *
 * SE-I12 holds: these are objective, observable checks, and the SERVICE judges
 * them. This row only collects an answer.
 */
export function FasoCheckAnswer({
  label,
  answer,
  onAnswer,
  labels,
}: {
  readonly label: string;
  /** `undefined` = not yet answered. It never means « no ». */
  readonly answer: boolean | undefined;
  readonly onAnswer: (value: boolean) => void;
  /** From the catalog — this component never spells a word. */
  readonly labels: { readonly yes: string; readonly no: string };
}) {
  return (
    <View style={styles.checkRow}>
      <Text style={styles.checkLabel}>{label}</Text>
      <View style={styles.checkAnswers}>
        {[true, false].map((value) => (
          <Text
            key={String(value)}
            accessibilityRole="button"
            accessibilityState={{ selected: answer === value }}
            onPress={() => onAnswer(value)}
            style={[styles.checkChoice, answer === value && (value ? styles.checkYes : styles.checkNo)]}
          >
            {value ? labels.yes : labels.no}
          </Text>
        ))}
      </View>
    </View>
  );
}
