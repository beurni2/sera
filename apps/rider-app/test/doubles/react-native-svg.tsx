import React from 'react';

/**
 * RENDU-RÉEL — the react-native-svg double. Icons are DRAWINGS: nothing this
 * harness asserts depends on their geometry, and the icon set has its own
 * source-scan coverage. They render as inert host nodes so the screens that
 * contain them mount, and so an icon paired with text (the ≥44px/icon+text
 * law) is still visible to a `findAllByType('Svg')` if a test ever needs it.
 */
type AnyProps = Record<string, unknown> & { children?: React.ReactNode };
const host = (name: string): React.FC<AnyProps> => {
  const C: React.FC<AnyProps> = (props) => React.createElement(name, props as never);
  C.displayName = name;
  return C;
};
const Svg = host('Svg');
export default Svg;
export { Svg };
export const Circle = host('Circle');
export const Defs = host('Defs');
export const G = host('G');
export const Line = host('Line');
export const LinearGradient = host('LinearGradient');
export const Path = host('Path');
export const Pattern = host('Pattern');
export const Rect = host('Rect');
export const Stop = host('Stop');
