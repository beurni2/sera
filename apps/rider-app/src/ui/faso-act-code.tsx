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
}) {
  const [typed, setTyped] = useState('');
  const ready = typed.trim() !== '' && !working;

  return (
    <View style={styles.wrap}>
      <ScreenTitle>{strings.title}</ScreenTitle>
      <Body>{strings.hint}</Body>

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

      <PrimaryButton
        label={working ? strings.working : strings.action}
        onPress={() => onSubmit(typed.trim())}
        // Locked while in flight: a second tap on a slow network must not send
        // a second act, and an empty field must not send at all.
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
  outcome: { gap: 4, padding: 12, borderRadius: rad('card') },
  outcomeOk: { backgroundColor: C.okBg },
  outcomePlain: { backgroundColor: C.paper },
  outcomeTitle: { ...ty('body'), fontFamily: textFace(700), color: C.ink },
  outcomeHint: { ...ty('body', 'min'), fontFamily: textFace(400), color: C.sub },
});
