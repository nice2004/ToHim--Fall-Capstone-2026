import React, { useLayoutEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { useOnboarding } from '../onboarding/OnboardingContext';
import { getFloatingTabBarRect } from '../tabBarLayout';

/**
 * Registers `tabBar.all` for coach marks (fallback geometry). The Tabs step prefers
 * a union of `tabBar.slot.*` rects in CoachMarksOverlay for a precise cutout.
 * Per-tab slots come from MeasuredTabBarButton.
 */
export default function CoachableTabBar(props) {
  const { registerTarget } = useOnboarding();
  const { width: winW, height: winH } = useWindowDimensions();

  useLayoutEffect(() => {
    registerTarget('tabBar.all', getFloatingTabBarRect());
  }, [registerTarget, winW, winH]);

  return (
    <View collapsable={false} style={{ backgroundColor: 'transparent' }}>
      <BottomTabBar {...props} />
    </View>
  );
}
