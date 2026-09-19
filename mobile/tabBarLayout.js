import { Dimensions } from 'react-native';

/**
 * Floating pill tab bar — keep in sync with App.js `tabBarStyle`.
 * Used for coach-mark `tabBar.all` because the tab bar root is absolutely
 * positioned and does not size its wrapper, so measureInWindow on the
 * wrapper often yields no usable rect.
 */
export const FLOATING_TAB_BAR = {
  bottom: 20,
  left: 20,
  right: 20,
  height: 64,
};

/**
 * Window-space rectangle for the floating tab bar (approximate fallback).
 * `tabBarStyle.bottom` is measured from the navigator’s bottom (same as window
 * bottom here); do **not** subtract safe-area inset again or the cutout shifts
 * up and clips the bar / reveals content above it.
 *
 * @param {{ bottom?: number }} _insets - unused; kept for API stability with callers
 */
export function getFloatingTabBarRect(_insets) {
  const { width: W, height: H } = Dimensions.get('window');
  const { bottom: b, left: l, right: r, height: h } = FLOATING_TAB_BAR;
  return {
    x: l,
    y: H - b - h,
    width: W - l - r,
    height: h,
  };
}
