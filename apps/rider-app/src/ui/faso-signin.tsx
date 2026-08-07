import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { C, GEO, rad, ty } from './faso';
import { displayFace, textFace } from './faso-fonts';
import { Body, Card, PrimaryButton, ScreenTitle } from './faso-kit';
import { normalizeRiderCode } from '../net/rider-code';

/**
 * SE-LIVE-4c-ii · THE SIGN-IN SCREEN — the rider's own code, and nothing else
 * on the screen.
 *
 * THE 5-SECOND TEST: one field, one button, one sentence saying where the code
 * came from. There is no password, no email, no account to create — a rider who
 * has a slip of paper from Séra can start working, and a rider who does not
 * cannot. That is the whole model, and it is why this screen is almost empty.
 *
 * THE TRUST TEST: the refusal is as dignified as the success. A refusal here
 * says what happened and what to do next, in that order, and never blames the
 * rider for a network that died. The four refusals are four different
 * sentences (see `signin-model.ts`) precisely because « go and see Séra » and
 * « wait a moment » cost a rider very different mornings.
 *
 * TYPE AND TOUCH: the code renders at display size with wide tracking, because
 * it is read off paper, in the sun, and compared character by character. The
 * field is `characters`-capitalised and autocorrect is OFF — a keyboard that
 * "helpfully" rewrites a credential is worse than no keyboard.
 *
 * SKIN ONLY — tokens for every colour, radius and type role; no custody, no
 * franc, no network. It receives strings and a submit callback; the model and
 * the port live outside it.
 */
export function FasoSignIn({
  strings,
  onSubmit,
  working,
  refusal,
}: {
  readonly strings: {
    readonly title: string;
    readonly hint: string;
    readonly action: string;
    readonly working: string;
    readonly placeholder: string;
  };
  readonly onSubmit: (typed: string) => void;
  readonly working: boolean;
  /** Present only after a refusal: headline + what to do next, already
   *  resolved from the catalog by the caller. */
  readonly refusal?: { readonly title: string; readonly hint: string } | undefined;
}) {
  const [typed, setTyped] = useState('');
  // Derived, never stored: null until what was typed reads as a code.
  const confirmed = normalizeRiderCode(typed);

  return (
    <View style={styles.wrap}>
      <ScreenTitle>{strings.title}</ScreenTitle>
      <Body>{strings.hint}</Body>

      <Card>
        <TextInput
          style={styles.field}
          /**
           * ⚠ VERIFIER BLOCKER A1 — THE FIELD USED TO DESTROY THE CODE. It fed
           * the field a FORMATTED value while storing the raw one: a controlled
           * mask that re-applies its own formatter to its own output. React
           * Native hands back « what is displayed + the new character », so the
           * `SR-` the mask prepends was fed back in as body text on every
           * keystroke. Measured, typing the code exactly as printed on the slip:
           *
           *   types  SR-ABCD-EFGH-JKMN
           *   shows  SR-SRAB-CDEF-GHJK      ← the rider's own S and R, absorbed
           *   sends  SR-SRAB-CDEF-GHJK      ← well-formed, and WRONG
           *   gets   401 → « Ce code ne marche pas. Demandez un nouveau code. »
           *
           * That is precisely the harm this whole slice was written to prevent
           * — a rider riding across Ouaga about a code that was never broken —
           * caused by the screen, not the model. Only body-only entry worked,
           * while the placeholder and the paper slip both teach the broken one.
           *
           * THE FIELD NOW SHOWS EXACTLY WHAT WAS TYPED and never fights the
           * keyboard. Grouping is confirmation BELOW the field (`confirmed`),
           * where it cannot corrupt anything; `autoCapitalize` does the
           * uppercasing, and `normalizeRiderCode` still forgives dashes,
           * spaces, lowercase and a missing prefix at submit.
           */
          value={typed}
          onChangeText={setTyped}
          placeholder={strings.placeholder}
          placeholderTextColor={C.sub}
          autoCapitalize="characters"
          autoCorrect={false}
          // No spell-check, no autocomplete, no password manager: this is a
          // credential read off paper, and every "helpful" rewrite is a
          // refusal the rider cannot explain.
          spellCheck={false}
          autoComplete="off"
          editable={!working}
          accessibilityLabel={strings.title}
          returnKeyType="go"
          onSubmitEditing={() => onSubmit(typed)}
        />
      </Card>

      {/* CONFIRMATION, NOT CORRECTION. Once what was typed reads as a code, the
          canonical form is shown BELOW the field so the rider can compare it
          against the slip character by character. It never edits the field —
          that is what broke it (see the block above). */}
      {confirmed !== null && !working ? (
        <Text style={styles.confirmed} accessibilityLabel={confirmed}>{confirmed}</Text>
      ) : null}

      {/* The refusal sits directly under the field, where the eye already is —
          never a modal, never an alert. Honest states are designed states. */}
      {refusal !== undefined && !working ? (
        <View style={styles.refusal} accessibilityLiveRegion="polite">
          <Text style={styles.refusalTitle}>{refusal.title}</Text>
          <Text style={styles.refusalHint}>{refusal.hint}</Text>
        </View>
      ) : null}

      <PrimaryButton
        label={working ? strings.working : strings.action}
        onPress={() => onSubmit(typed)}
        // Disabled while a sign-in is in flight: on a slow network a second
        // tap must not fire a second request.
        disabled={working}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: GEO.paddingPx, paddingHorizontal: GEO.paddingPx },
  field: {
    // THE HOUSE TREATMENT FOR A CODE, matched to `sealCode` rather than
    // invented: display face at 800, tabular numerals, .1em tracking. This
    // string is compared character by character against a slip of paper, at
    // arm's length, in bright sun — the same job the seal mark does.
    fontFamily: displayFace(800),
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 21 * 0.1,
    fontVariant: ['tabular-nums'],
    color: C.ink,
    paddingVertical: 12,
    textAlign: 'center',
    // ≥44px touch target by construction — the field is the tap target.
    minHeight: 56,
  },
  refusal: {
    gap: 4,
    padding: 12,
    borderRadius: rad('card'),
    backgroundColor: C.paper,
  },
  confirmed: {
    ...ty('body'),
    fontFamily: textFace(700),
    color: C.okFg,
    textAlign: 'center',
    letterSpacing: 1,
  },
  refusalTitle: { ...ty('body'), fontFamily: textFace(700), color: C.ink },
  refusalHint: { ...ty('body', 'min'), fontFamily: textFace(400), color: C.sub },
});
