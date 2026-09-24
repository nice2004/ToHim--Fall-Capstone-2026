import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { useOnboarding } from './OnboardingContext';
import CoachDimming from './CoachDimming';

const HOLE_BORDER_PAD = 3;
const HOLE_BORDER_PAD_TIGHT = 2;

/** Extra width on each side for per-tab cutouts so labels (e.g. “Ask ToHim”) are not clipped */
const TAB_SLOT_X_OUTSET = 5;

/** Route names — must match Tab.Screen `name` / `tabBar.slot.<name>` */
const TAB_SLOT_ROUTE_NAMES = ['Home', 'People', 'RemindMe', 'Calendar', 'Settings'];

/** Outset around the union of tab slots for `tabBar.all` (glass edge + labels) */
const TAB_ALL_PAD_X = 6;
const TAB_ALL_PAD_Y = 6;

function unionTabBarSlotRects(targets) {
  let minX = Infinity;
  let minY = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  for (const name of TAB_SLOT_ROUTE_NAMES) {
    const r = targets[`tabBar.slot.${name}`];
    if (!r || r.width <= 0 || r.height <= 0) return null;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxR = Math.max(maxR, r.x + r.width);
    maxB = Math.max(maxB, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxR - minX, height: maxB - minY };
}

/** Padded window rect for the full tab bar from measured slots; null if not ready */
function paddedUnionTabBarRect(targets, screenW) {
  const u = unionTabBarSlotRects(targets);
  if (!u) return null;
  let { x, y, width: w, height: h } = u;
  x -= TAB_ALL_PAD_X;
  y -= TAB_ALL_PAD_Y;
  w += 2 * TAB_ALL_PAD_X;
  h += 2 * TAB_ALL_PAD_Y;
  x = Math.max(0, x);
  y = Math.max(0, y);
  w = Math.min(screenW - x, w);
  return { x, y, width: w, height: h };
}

/**
 * Corner radius for the dim cutout so it matches the real control (avoids straight mask vs round UI).
 */
function holeCornerRadiusForTarget(targetKey, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return 12;
  const { width: w, height: h } = rect;
  const cap = Math.min(w, h) / 2;
  const pill = () => cap;

  if (targetKey === 'tabBar.all') {
    return pill();
  }
  if (targetKey.startsWith('tabBar.slot.')) {
    return Math.min(12, w / 2, h / 2);
  }
  if (targetKey === 'home.startSession' || targetKey === 'home.viewPeople') {
    return Math.min(26, cap);
  }
  if (targetKey === 'session.voiceToggle' || targetKey === 'remind.voiceToggle') {
    return Math.min(20, cap);
  }
  if (targetKey === 'session.submit' || targetKey === 'remind.askButton') {
    return pill();
  }
  return Math.min(16, cap);
}

function buildSteps() {
  return [
    {
      id: 'welcome',
      title: '',
      body:
        'Welcome to ToHim! ToHim is a tool to help you remember the things that matter about people that matter. Let me show you a few of ToHim\'s core features',
      targetKeys: [],
      tooltipPosition: 'bottom',
      ensure: (nav) => {
        nav?.navigate?.('Home', { screen: 'HomeMain' });
      },
    },
    {
      id: 'tabs',
      title: 'Tabs',
      body:
        "Use ToHim's bottom tabs to jump between ToHim's various functions.",
      targetKeys: ['tabBar.all'],
      tooltipPosition: 'top',
      arrowToTabBar: true,
      ensure: (nav) => {
        nav?.navigate?.('Home', { screen: 'HomeMain' });
      },
    },
    {
      id: 'homePage',
      title: 'Home page',
      body:
        'From the home page you can create new sessions, or navigate to the people tab to view sessions you have already created!',
      targetKeys: ['tabBar.slot.Home', 'home.startSession', 'home.viewPeople'],
      tooltipPosition: 'top',
      ensure: (nav) => {
        nav?.navigate?.('Home', { screen: 'HomeMain' });
      },
    },
    {
      id: 'recordSession',
      title: 'Record a prayer request',
      body:
        'Tap the "Start New Session" button to capture an interaction, toggle Voice mode to input by voice or by text. Tap the submit button to create a new person entity.',
      targetKeys: ['tabBar.slot.Home', 'session.voiceToggle', 'session.submit'],
      tooltipPosition: 'aboveTabBar',
      ensure: (nav) => {
        nav?.navigate?.('Home', { screen: 'Session' });
      },
    },
    {
      id: 'viewSessions',
      title: 'View prayer request',
      body:
        'Once you have recorded a session, you can view that session in the people tab, where any people that you mentioned in your session will have person entities.',
      targetKeys: ['tabBar.slot.People'],
      tooltipPosition: 'aboveTabBar',
      ensure: (nav) => {
        nav?.navigate?.('People', { screen: 'PeopleList' });
      },
    },
    {
      id: 'askToHim',
      title: 'Ask ToHim',
      body:
        'Once you have recorded sessions, you can ask ToHim questions about those sessions in the Ask ToHim tab. Once again you can toggle Voice Mode to query by voice or by text',
      targetKeys: ['tabBar.slot.RemindMe', 'remind.voiceToggle', 'remind.askButton'],
      tooltipPosition: 'aboveTabBar',
      ensure: (nav) => {
        nav?.navigate?.('RemindMe');
      },
    },
    {
      id: 'calendar',
      title: 'Calendar',
      body:
        'Once you have recorded a session, you will see a blue dot representing that session on the date that it was recorded, if you click on that date you will be able to view a summary of what was recorded. If you record sessions that have dates, literal or implied (like "next week"), those dates will be represented by green dots, and you can view short summaries of what you have inputted for those dates.',
      targetKeys: ['tabBar.slot.Calendar'],
      tooltipPosition: 'aboveTabBar',
      ensure: (nav) => {
        nav?.navigate?.('Calendar');
      },
    },
    {
      id: 'settings',
      title: 'Settings',
      body:
        'Use Settings to adjust preferences—for example, enabling Group View to organize people into groups. Other options may be added here over time.',
      targetKeys: ['tabBar.slot.Settings'],
      tooltipPosition: 'aboveTabBar',
      ensure: (nav) => {
        nav?.navigate?.('Settings');
      },
    },
  ];
}

export default function CoachMarksOverlay({ visible, onDone, navigation }) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => createStyles(colors, shadow), [colors, shadow]);
  const { targets } = useOnboarding();
  const [step, setStep] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);

  const steps = useMemo(() => buildSteps(), []);

  useEffect(() => {
    if (visible) {
      setStep(0);
    }
  }, [visible]);

  const current = steps[step] || steps[0];

  useEffect(() => {
    if (!visible || !navigation) return undefined;
    let cancelled = false;
    const t0 = setTimeout(() => {
      try {
        current?.ensure?.(navigation);
      } catch (e) {
        console.warn('[CoachMarksOverlay] ensure failed:', e);
      }
      if (!cancelled) setLayoutTick((n) => n + 1);
    }, 0);
    const t1 = setTimeout(() => {
      if (!cancelled) setLayoutTick((n) => n + 1);
    }, 150);
    const t2 = setTimeout(() => {
      if (!cancelled) setLayoutTick((n) => n + 1);
    }, 420);
    return () => {
      cancelled = true;
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, step, navigation, current]);

  const holeRects = useMemo(() => {
    const keys = current?.targetKeys || [];
    const screenW = Dimensions.get('window').width;

    if (current?.id === 'tabs' && keys.length === 1 && keys[0] === 'tabBar.all') {
      const padded = paddedUnionTabBarRect(targets, screenW);
      if (padded) {
        const { x, y, width: w, height: h } = padded;
        const rx = Math.min(14, w / 2, h / 2);
        return [{ ...padded, rx, _key: 'tabBar.all' }];
      }
      const fallback = targets['tabBar.all'];
      if (fallback && fallback.width > 0 && fallback.height > 0) {
        const rx = holeCornerRadiusForTarget('tabBar.all', fallback);
        return [{ ...fallback, rx, _key: 'tabBar.all' }];
      }
      return [];
    }

    return keys
      .map((k) => {
        const rect = targets[k];
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        let { x, y, width: w, height: h } = rect;
        if (k.startsWith('tabBar.slot.')) {
          x = Math.max(0, x - TAB_SLOT_X_OUTSET);
          w = Math.min(screenW - x, w + 2 * TAB_SLOT_X_OUTSET);
        }
        const inflated = { x, y, width: w, height: h };
        const rx = holeCornerRadiusForTarget(k, inflated);
        return { ...inflated, rx, _key: k };
      })
      .filter(Boolean);
  }, [current, targets, layoutTick]);

  const tabBarRect = useMemo(() => {
    const screenW = Dimensions.get('window').width;
    return paddedUnionTabBarRect(targets, screenW) ?? targets['tabBar.all'];
  }, [targets, layoutTick]);

  useEffect(() => {
    if (!visible) return;
    setLayoutTick((n) => n + 1);
  }, [visible, tabBarRect?.y, tabBarRect?.height]);

  const tooltipStyle = useMemo(() => {
    const { width: W, height: H } = Dimensions.get('window');
    const maxWidth = Math.min(360, W - 32);
    const horizontal = { left: (W - maxWidth) / 2, width: maxWidth };

    if (current?.tooltipPosition === 'bottom') {
      return { ...horizontal, bottom: 110 };
    }
    if (current?.tooltipPosition === 'aboveTabBar') {
      const screenW = Dimensions.get('window').width;
      const tab = paddedUnionTabBarRect(targets, screenW) ?? targets['tabBar.all'];
      if (tab && tab.y > 40 && Number.isFinite(tab.y)) {
        const gap = 16;
        const bottomOffset = H - (tab.y - gap);
        return { ...horizontal, bottom: Math.max(24, bottomOffset) };
      }
      return { ...horizontal, bottom: 120 };
    }
    return { ...horizontal, top: 52 };
  }, [current?.tooltipPosition, targets, layoutTick]);

  const showArrow =
    Boolean(current?.arrowToTabBar) && tabBarRect && Number.isFinite(tabBarRect.x);

  const goNext = useCallback(() => {
    if (step >= steps.length - 1) {
      onDone?.();
    } else {
      setStep((s) => s + 1);
    }
  }, [step, steps.length, onDone]);

  const skip = useCallback(() => onDone?.(), [onDone]);

  const maskId = useMemo(() => `coachDimMask_${step}`, [step]);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      accessibilityViewIsModal={Platform.OS === 'ios'}
    >
      <View style={styles.root} pointerEvents="box-none">
        <CoachDimming
          holes={holeRects.map(({ _key, ...h }) => h)}
          maskId={maskId}
        />

        {holeRects.map((r, i) => {
          const pad =
            r._key === 'remind.voiceToggle' ? HOLE_BORDER_PAD_TIGHT : HOLE_BORDER_PAD;
          const br = r.rx + pad;
          return (
            <View
              key={r._key || `border-${i}`}
              pointerEvents="none"
              style={[
                styles.holeBorder,
                {
                  left: r.x - pad,
                  top: r.y - pad,
                  width: r.width + pad * 2,
                  height: r.height + pad * 2,
                  borderRadius: br,
                },
              ]}
            />
          );
        })}

        {showArrow && tabBarRect && (
          <View
            style={[
              styles.arrowWrap,
              {
                left: tabBarRect.x + tabBarRect.width / 2 - 16,
                top: Math.max(8, tabBarRect.y - 36),
              },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="arrow-down" size={32} color="#ffffff" />
          </View>
        )}

        <View style={[styles.tooltip, tooltipStyle]} pointerEvents="box-none">
          {current.id === 'welcome' ? null : current.title ? (
            <View style={styles.tooltipHeader}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.primary}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={styles.tooltipTitle} accessibilityRole="header">
                {current.title}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.tooltipBody, current.id === 'welcome' && styles.tooltipBodyWelcome]}>
            {current.body}
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={skip}
              style={[styles.button, styles.secondaryButton]}
              accessibilityRole="button"
              accessibilityLabel="Skip onboarding tour"
            >
              <Text style={styles.secondaryText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goNext}
              style={[styles.button, styles.primaryButton]}
              accessibilityRole="button"
              accessibilityLabel={step === steps.length - 1 ? 'Finish onboarding' : 'Next onboarding step'}
            >
              <Text style={styles.primaryText}>
                {step === steps.length - 1 ? 'Done' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors, shadow) {
  return StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
  },
  holeBorder: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.95)',
    backgroundColor: 'transparent',
  },
  arrowWrap: {
    position: 'absolute',
    zIndex: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
  tooltip: {
    position: 'absolute',
    zIndex: 10,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    padding: 14,
    ...shadow.card,
  },
  tooltipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
  },
  tooltipBody: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  tooltipBodyWelcome: {
    marginTop: 0,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADIUS.button,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceMuted,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '800',
  },
  secondaryText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
});
}
