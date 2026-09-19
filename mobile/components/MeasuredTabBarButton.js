import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { View, Pressable, Platform, StyleSheet } from 'react-native';
import { Link } from '@react-navigation/native';
import { useOnboarding } from '../onboarding/OnboardingContext';

const slotCache = new Map();

/**
 * Returns a stable tabBarButton implementation that measures the real tab hit area
 * (same layout React Navigation uses) and registers `tabBar.slot.<routeName>` for coach marks.
 * Equal-width math on the bar container is inaccurate; this matches the actual tab buttons.
 */
export function makeMeasuredTabBarButton(routeName) {
  if (slotCache.has(routeName)) {
    return slotCache.get(routeName);
  }

  function MeasuredTabBarButton(props) {
    const wrapRef = useRef(null);
    const { registerTarget } = useOnboarding();
    const {
      to,
      onPress,
      onLongPress,
      testID,
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
      style,
      children,
    } = props;

    const report = useCallback(() => {
      wrapRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) {
          registerTarget(`tabBar.slot.${routeName}`, { x, y, width: w, height: h });
        }
      });
    }, [registerTarget, routeName]);

    useLayoutEffect(() => {
      report();
      const id = requestAnimationFrame(report);
      const t = setTimeout(report, 80);
      const t2 = setTimeout(report, 350);
      const t3 = setTimeout(report, 600);
      return () => {
        cancelAnimationFrame(id);
        clearTimeout(t);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }, [report]);

    const inner =
      Platform.OS === 'web' && to ? (
        <Link
          to={to}
          style={style}
          onPress={(e) => {
            if (
              !(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) &&
              (e.button == null || e.button === 0)
            ) {
              e.preventDefault();
              onPress?.(e);
            }
          }}
        >
          {children}
        </Link>
      ) : (
        <Pressable
          accessibilityRole={accessibilityRole}
          accessibilityState={accessibilityState}
          onPress={onPress}
          onLongPress={onLongPress}
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          style={style}
        >
          {children}
        </Pressable>
      );

    return (
      <View
        ref={wrapRef}
        collapsable={false}
        onLayout={report}
        style={styles.slotWrap}
      >
        {inner}
      </View>
    );
  }

  MeasuredTabBarButton.displayName = `MeasuredTabBarButton(${routeName})`;
  slotCache.set(routeName, MeasuredTabBarButton);
  return MeasuredTabBarButton;
}

const styles = StyleSheet.create({
  slotWrap: {
    flex: 1,
  },
});
