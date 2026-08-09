import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { alpha, C, DARK, GEO, motionOf, rad, ty } from './faso';
import { displayFace } from './faso-fonts';
import { useReducedMotion } from './reduced-motion';
import { IconSos } from './icons';

/**
 * WO-FP-SERA · R14 SOS restyled to Faso Premium (README dark surfaces; HANDOFF §
 * R14). SKIN ONLY — the state machine, the honesty contract and the props were
 * carried over byte-identical from the Grand Teint SosSheet (retired with
 * src/ui/kit.tsx; this is now the only SOS sheet there is): queued shows NO
 * acknowledgment (offline never lies), raised/escalated show a clearly-marked
 * « (aperçu) » sandbox stand-in for the inbound ack (the rider never self-acks),
 * the chain is raised → ack → enroute → clos. The sheet is the README's dark
 * surface `#14100B` with a 3px red top edge; it rises on fpUp; reduced-motion safe.
 */

export type SosState = 'closed' | 'confirm' | 'queued' | 'raised' | 'escalated' | 'acknowledged' | 'over';

/** The SOS disc — on every screen, one gesture, unmissable yet not accidental
 * (opening only reveals the sheet; firing is a deliberate hold). */
export function SosButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <IconSos size={ty('caps').fontSize} color={C.card} />
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export interface SosStrings {
  title: string; confirmHint: string; hold: string; cancel: string; holdNote: string;
  queued: string; queuedHint: string; raised: string; raisedHint: string;
  escalated: string; escalatedHint: string; transportPending: string;
  acknowledged: string; acknowledgedHint: string; previewAck: string;
  previewAckEscalated: string; safe: string; over: string; overHint: string; close: string;
}

export function SosSheet({
  state, strings, onHoldStart, onHoldEnd, onCancel, onSandboxAck, onSafe, onClose,
}: {
  state: SosState;
  strings: SosStrings;
  onHoldStart: () => void; onHoldEnd: () => void; onCancel: () => void;
  /**
   * ⚠ OPTIONAL, AND ABSENT ON A WIRED BUILD (verifier blocker A2). This is the
   * demo's stand-in for a dispatcher answering. When it is not supplied, no
   * ack button renders at all — because on a build a real rider signs into
   * there is a real dispatcher and a real acknowledgement, and nothing here
   * may stand in for either. A tap that says « Quelqu'un arrive pour vous »
   * when nobody has seen the alert is the worst sentence this app can show.
   */
  onSandboxAck?: (() => void) | undefined;
  onSafe: () => void; onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const slide = useRef(new Animated.Value(state === 'closed' ? 1 : 0)).current;
  useEffect(() => {
    if (state === 'closed') return;
    if (reduced) { slide.setValue(0); return; }
    const m = motionOf('fpUp');
    slide.setValue(1);
    Animated.timing(slide, { toValue: 0, duration: m.durationMs, easing: bez(m.timingFunction), useNativeDriver: true }).start();
  }, [state, reduced, slide]);
  if (state === 'closed') return null;
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 44] });
  return (
    <View style={styles.scrimWrap} pointerEvents="box-none">
      <Pressable style={styles.scrim} onPress={state === 'confirm' ? onCancel : undefined} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        {state === 'confirm' && (
          <>
            <Text style={styles.title}>{strings.title}</Text>
            <Text style={styles.hint}>{strings.confirmHint}</Text>
            <Pressable style={({ pressed }) => [styles.hold, pressed && styles.pressed]} onPressIn={onHoldStart} onPressOut={onHoldEnd} accessibilityRole="button">
              <Text style={styles.holdText}>{strings.hold}</Text>
            </Pressable>
            <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button"><Text style={styles.cancelText}>{strings.cancel}</Text></Pressable>
            <Text style={styles.note}>{strings.holdNote}</Text>
          </>
        )}
        {state === 'queued' && (
          <>
            {/* Offline law: queued = pending. NO acknowledgment is shown or reachable. */}
            <Text style={styles.title}>{strings.queued}</Text>
            <Text style={styles.hint}>{strings.queuedHint}</Text>
            <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button"><Text style={styles.cancelText}>{strings.close}</Text></Pressable>
          </>
        )}
        {state === 'raised' && (
          <>
            <Text style={styles.title}>{strings.raised}</Text>
            <Text style={styles.hint}>{strings.raisedHint}</Text>
            {onSandboxAck !== undefined && <SandboxAck label={strings.previewAck} onPress={onSandboxAck} />}
          </>
        )}
        {state === 'escalated' && (
          <>
            <Text style={styles.titleAmber}>{strings.escalated}</Text>
            <Text style={styles.hint}>{strings.escalatedHint}</Text>
            <Text style={styles.note}>{strings.transportPending}</Text>
            {onSandboxAck !== undefined && <SandboxAck label={strings.previewAckEscalated} onPress={onSandboxAck} />}
          </>
        )}
        {state === 'acknowledged' && (
          <>
            <Text style={styles.titleAmber}>{strings.acknowledged}</Text>
            <Text style={styles.hint}>{strings.acknowledgedHint}</Text>
            <Pressable style={({ pressed }) => [styles.safe, pressed && styles.pressed]} onPress={onSafe} accessibilityRole="button"><Text style={styles.safeText}>{strings.safe}</Text></Pressable>
          </>
        )}
        {state === 'over' && (
          <>
            <Text style={styles.title}>{strings.over}</Text>
            <Text style={styles.hint}>{strings.overHint}</Text>
            <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button"><Text style={styles.cancelText}>{strings.close}</Text></Pressable>
          </>
        )}
      </Animated.View>
    </View>
  );
}

/** The inbound ack STAND-IN — dashed + dimmed « (aperçu) », never the rider's own
 * hand; drives the store's acknowledgeSos which throws on a queued incident. */
function SandboxAck({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.previewAck, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button">
      <Text style={styles.previewAckText}>{label}</Text>
    </Pressable>
  );
}

const bez = (tf: string): ((t: number) => number) => {
  const b = /cubic-bezier\(([^)]+)\)/.exec(tf)?.[1];
  if (b === undefined) return Easing.ease;
  const n = b.split(',').map((x) => Number(x.trim()));
  return Easing.bezier(n[0] ?? 0, n[1] ?? 0, n[2] ?? 1, n[3] ?? 1);
};

const styles = StyleSheet.create({
  button: {
    position: 'absolute', right: 16, bottom: 20, width: 58, height: 58, borderRadius: rad('pill'),
    backgroundColor: DARK.band, borderWidth: 2.5, borderColor: DARK.sosBorder, alignItems: 'center', justifyContent: 'center',
  },
  // « SOS » 13/800 Bricolage (HANDOFF § R14): display face + pixel-source size.
  buttonText: { ...ty('pill'), color: C.card, fontFamily: displayFace(800), fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },

  scrimWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: alpha(C.ink, 0.45) },
  sheet: { backgroundColor: DARK.sosSheet, borderTopWidth: 3, borderTopColor: DARK.sosBorder, borderTopLeftRadius: rad('sheet'), borderTopRightRadius: rad('sheet'), padding: GEO.paddingPx, gap: 8 },
  title: { ...ty('view'), color: DARK.bandText },
  titleAmber: { ...ty('view'), color: C.accent },
  hint: { ...ty('body', 'max'), color: alpha(DARK.bandText, 0.82) },
  note: { ...ty('caps'), color: alpha(DARK.bandText, 0.6) },
  hold: { backgroundColor: DARK.sosBorder, minHeight: 64, borderRadius: rad('button'), alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  holdText: { ...ty('view'), color: C.card, fontSize: 15 },
  cancel: { alignItems: 'center', paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  cancelText: { ...ty('caps'), color: alpha(DARK.bandText, 0.7) },
  safe: { borderWidth: 1.5, borderColor: DARK.bandText, minHeight: 44, borderRadius: rad('button'), alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  safeText: { ...ty('caps'), color: DARK.bandText },
  previewAck: { borderWidth: 1.5, borderColor: DARK.bandText, borderStyle: 'dashed', minHeight: 44, borderRadius: rad('button'), alignItems: 'center', justifyContent: 'center', marginTop: 8, opacity: 0.65 },
  previewAckText: { ...ty('pill'), color: DARK.bandText, textTransform: 'uppercase' },
});
