import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The reduced-motion flag — the doctrine's one accessibility switch, honoured
 * everywhere motion runs (the signature module's fp* entries, the SOS sheet's
 * rise). Lifted verbatim out of the retired Grand Teint kit (src/ui/kit.tsx),
 * which App.tsx imported for twenty components it never rendered; this hook was
 * the only live thing inside it, so it now stands on its own and costs the
 * startup bundle nothing but itself.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
