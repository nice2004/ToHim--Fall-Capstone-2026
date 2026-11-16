import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
  AppState,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaFrame } from 'react-native-safe-area-context';
import { authAPI, profileAPI, calendarAPI, personAPI } from '../services/api';
import { getCachedCalendarEvents } from '../services/localDb';
import { useOnboarding } from '../onboarding/OnboardingContext';
import GlassSurface from '../components/GlassSurface';
import { useTheme } from '../context/ThemeContext';
import JournalFeatureCard from '../components/JournalFeatureCard';
import ReminderEditor from '../components/ReminderEditor';
import { promptsForToday } from '../utils/journal';
import {
  getCachedReminders,
  refreshReminders,
  occursOn,
  formatReminderTime,
  toDateKey,
} from '../services/reminders';
import { REMINDER_COLOR, REMINDER_SOFT } from '../theme';
import { fallbackEventLabel } from '../utils/eventLabel';

/** Rows shown on the card (today first), so it stays small. */
const ITEM_LIMIT = 3;
/**
 * A new request's dates are saved a few seconds after it is recorded, so look again a few times
 * while Home is open (early first, then easing off).
 */
const RECHECK_AFTER_MS = [3000, 8000, 15000, 30000];

const dayKeyOf = (event) => String(event.event_date || '').split('T')[0];

function initialsOf(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function todayAndTomorrowKeys() {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today: toDateKey(today), tomorrow: toDateKey(tomorrow) };
}

export default function HomeScreen({ navigation, onLogout }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const todaysPrompt = useMemo(() => promptsForToday()[0], []);
  const { registerTarget } = useOnboarding();
  const [userName, setUserName] = useState(null);
  const [days, setDays] = useState(todayAndTomorrowKeys);
  const [events, setEvents] = useState([]);
  const [reminders, setReminders] = useState([]);
  // { reminder } to edit; null when the editor is closed
  const [reminderEditor, setReminderEditor] = useState(null);
  const { height: windowHeight } = useWindowDimensions();
  const frame = useSafeAreaFrame();
  /** Breathing room below Logout (the tab scene already ends above the floating bar) */
  const scrollBottomPadding = 32;
  /**
   * ScrollView only scrolls when its viewport is bounded (flex parent with minHeight:0)
   * AND content is taller than that viewport. Use safe-area frame + extra so Logout is reachable.
   */
  const scrollMinHeight = Math.max(frame.height, windowHeight) + 160;
  const lastTapRef = useRef(0);
  const startSessionRef = useRef(null);
  const viewPeopleRef = useRef(null);
  const TAP_GUARD_MS = 650;

  const reportCoachTargets = useCallback(() => {
    const report = (ref, key) => {
      ref.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) {
          registerTarget(key, { x, y, width: w, height: h });
        }
      });
    };
    report(startSessionRef, 'home.startSession');
    report(viewPeopleRef, 'home.viewPeople');
  }, [registerTarget]);

  useLayoutEffect(() => {
    reportCoachTargets();
    const t = setTimeout(reportCoachTargets, 120);
    const t2 = setTimeout(reportCoachTargets, 400);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [reportCoachTargets]);
  const runOncePerTap = (fn) => {
    const now = Date.now();
    if (now - lastTapRef.current < TAP_GUARD_MS) return;
    lastTapRef.current = now;
    fn();
  };

  const loadUserProfile = useCallback(async () => {
    try {
      const profile = await profileAPI.getProfile();
      setUserName(profile.user?.name || profile.user?.username || null);
    } catch (error) {
      console.error('[HomeScreen] Error loading profile:', error);
    }
  }, []);

  /** Prayer requests happening today or tomorrow, plus prayer reminders on those days. */
  const loadComingUp = useCallback(async () => {
    const keys = todayAndTomorrowKeys();
    setDays(keys);
    let list;
    try {
      const response = await calendarAPI.getEvents(keys.today, keys.tomorrow);
      list = response.events || [];
    } catch (error) {
      try {
        list = await getCachedCalendarEvents(keys.today, keys.tomorrow);
      } catch {
        list = [];
      }
    }
    setEvents(list);

    setReminders(await getCachedReminders());
    try {
      const { reminders: fresh } = await refreshReminders();
      setReminders(fresh);
    } catch (err) {
      console.warn('[HomeScreen] Could not refresh reminders:', err?.message || err);
    }
  }, []);

  // Refresh on every visit (name changed in Account, a request just recorded), and look again
  // shortly after, since a new request's dates are filled in just after it is saved.
  useFocusEffect(
    useCallback(() => {
      loadUserProfile();
      loadComingUp();
      const rechecks = RECHECK_AFTER_MS.map((ms) => setTimeout(loadComingUp, ms));
      return () => rechecks.forEach(clearTimeout);
    }, [loadUserProfile, loadComingUp])
  );

  // "Today" moves on overnight: refresh when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadComingUp();
    });
    return () => sub.remove();
  }, [loadComingUp]);

  const comingUp = useMemo(() => {
    const build = (dayKey, dayLabel) => {
      const seen = new Set();
      const requests = events
        // 'session' only marks the day a request was recorded; the others are when it happens.
        .filter((e) => e.event_type !== 'session' && dayKeyOf(e) === dayKey)
        .filter((e) => {
          const key = `${e.session_id || e.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((e) => ({
          key: `event-${e.id}`,
          kind: 'request',
          title: e.person_name || 'Prayer request',
          // Short "what's happening" label ("Exam"); older events get one from their summary.
          detail: e.label || fallbackEventLabel({ summary: e.summary, personName: e.person_name }) || '',
          day: dayLabel,
          event: e,
        }));
      const prayerTimes = reminders
        .filter((r) => occursOn(r, dayKey))
        .map((r) => ({
          key: `reminder-${r.id}`,
          kind: 'reminder',
          title: r.title,
          detail: formatReminderTime(r),
          day: dayLabel,
          reminder: r,
        }));
      return [...requests, ...prayerTimes];
    };
    return [...build(days.today, 'Today'), ...build(days.tomorrow, 'Tomorrow')].slice(0, ITEM_LIMIT);
  }, [events, reminders, days]);

  const initials = initialsOf(userName);

  const openAccount = () =>
    runOncePerTap(() =>
      // Account settings live in the Settings tab; keep Settings underneath so Back works.
      navigation.navigate('Settings', { screen: 'AccountSettings', initial: false })
    );

  // Same destination as tapping the event on the Calendar.
  const openPrayerRequest = (event) =>
    runOncePerTap(async () => {
      if (!event?.person_id || !event?.session_id) return;
      try {
        const data = await personAPI.getById(event.person_id);
        const session = (data?.sessions || []).find((s) => String(s.id) === String(event.session_id));
        if (!session) {
          Alert.alert('Not found', 'This prayer request is no longer available.');
          return;
        }
        navigation.navigate('People', {
          screen: 'PrayerRequestDetail',
          initial: false,
          params: { session, personId: data.person.id, personName: data.person.full_name },
        });
      } catch (error) {
        console.error('[HomeScreen] Error opening prayer request:', error);
        Alert.alert('Error', 'Could not open this prayer request. Please try again.');
      }
    });

  const handleLogout = () => {
    runOncePerTap(() => {
      Alert.alert(
        'Logout',
        'Are you sure you want to logout?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Logout',
            style: 'destructive',
            onPress: async () => {
              await authAPI.logout();
              onLogout && onLogout();
            },
          },
        ]
      );
    });
  };

  // Shown only when something is happening today or tomorrow, so Home stays quiet otherwise.
  const renderComingUp = () =>
    comingUp.length === 0 ? null : (
      <GlassSurface style={styles.comingUpCard}>
        <View style={styles.comingUpHeader}>
          <Ionicons
            name="calendar-outline"
            size={14}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={styles.comingUpTitle} accessibilityRole="header">
            Coming up
          </Text>
        </View>
        {comingUp.map((item) => {
          const isRequest = item.kind === 'request';
          const isToday = item.day === 'Today';
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.itemRow, styles.itemDivider]}
              activeOpacity={0.7}
              onPress={() =>
                isRequest ? openPrayerRequest(item.event) : setReminderEditor({ reminder: item.reminder })
              }
              accessibilityRole="button"
              accessibilityLabel={`${item.day}: ${item.title}${item.detail ? `, ${item.detail}` : ''}`}
              accessibilityHint={isRequest ? 'Opens this prayer request' : 'Opens this prayer reminder'}
            >
              {/* The person's initial (or a bell for a prayer time) makes each row feel personal. */}
              <View
                style={[styles.itemBadge, { backgroundColor: isRequest ? colors.primarySoft : REMINDER_SOFT }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {isRequest ? (
                  <Text style={styles.itemBadgeText}>{initialsOf(item.title).charAt(0) || '•'}</Text>
                ) : (
                  <Ionicons name="notifications-outline" size={16} color={REMINDER_COLOR} />
                )}
              </View>
              <View style={styles.itemText}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.detail ? (
                  <Text style={styles.itemDetail} numberOfLines={1}>
                    {item.detail}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.itemDay, isToday && styles.itemDayToday]}>{item.day}</Text>
            </TouchableOpacity>
          );
        })}
      </GlassSurface>
    );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/*
        minHeight: 0 is required so flex gives ScrollView a bounded height; otherwise
        the ScrollView grows with content and never scrolls on some iOS tab layouts.
      */}
      <View style={styles.scrollViewport}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: scrollBottomPadding,
              minHeight: scrollMinHeight,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces
          scrollEnabled
          nestedScrollEnabled
          {...(Platform.OS === 'ios'
            ? {
                contentInsetAdjustmentBehavior: 'automatic',
                alwaysBounceVertical: true,
              }
            : {})}
        >
        <View style={styles.content}>
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.avatar}
              onPress={openAccount}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={userName ? `Your account, signed in as ${userName}` : 'Your account'}
              accessibilityHint="Opens your account settings"
            >
              {initials ? (
                <Text style={styles.avatarText}>{initials}</Text>
              ) : (
                <Ionicons name="person" size={18} color={colors.primary} />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.header}>
            <Ionicons
              name="people-circle"
              size={80}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={styles.title} accessibilityRole="header">
              ToHim
            </Text>
            <Text style={styles.subtitle}>Keep track of your prayer requests</Text>
          </View>

          <View style={styles.buttonContainer}>
            <View
              ref={startSessionRef}
              collapsable={false}
              style={styles.coachMeasureWrap}
              onLayout={reportCoachTargets}
            >
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => runOncePerTap(() => navigation.navigate('Session'))}
                accessibilityRole="button"
                accessibilityLabel="Start new prayer request"
                accessibilityHint="Record a new prayer request for someone you're praying for"
              >
                <Ionicons
                  name="mic"
                  size={24}
                  color="white"
                  style={styles.buttonIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.primaryButtonText}>Start New Prayer Request</Text>
              </TouchableOpacity>
            </View>

            <View
              ref={viewPeopleRef}
              collapsable={false}
              style={styles.coachMeasureWrap}
              onLayout={reportCoachTargets}
            >
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => runOncePerTap(() => navigation.navigate('People'))}
                accessibilityRole="button"
                accessibilityLabel="View all people"
                accessibilityHint="Open the people list"
              >
                <Ionicons
                  name="people"
                  size={24}
                  color={colors.primary}
                  style={styles.buttonIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.secondaryButtonText}>View All People</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.coachMeasureWrap, styles.sectionGap]}>{renderComingUp()}</View>

          <View style={[styles.coachMeasureWrap, styles.sectionGap]}>
            <JournalFeatureCard
              compact
              title="Reflect on your day"
              prompt={todaysPrompt}
              onPress={() => runOncePerTap(() => navigation.navigate('Journal'))}
              accessibilityLabel="Open your prayer journal"
              accessibilityHint="Reflect on your day in your own words"
            />
          </View>

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            accessibilityRole="button"
            accessibilityLabel="Log out"
            accessibilityHint="Sign out of ToHim on this device"
          >
            <Ionicons
              name="log-out-outline"
              size={20}
              color={colors.textSecondary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
        </ScrollView>
      </View>

      <ReminderEditor
        visible={!!reminderEditor}
        reminder={reminderEditor?.reminder || null}
        onClose={() => setReminderEditor(null)}
        onChanged={loadComingUp}
      />
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.screenMuted,
  },
  scrollViewport: {
    flex: 1,
    minHeight: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
    /** Let content grow from the top so ScrollView can scroll past the tab bar */
    width: '100%',
  },
  topBar: {
    width: '100%',
    maxWidth: 400,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  header: {
    alignItems: 'center',
    marginBottom: 44,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.titleGray,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 10,
    textAlign: 'center',
  },
  coachMeasureWrap: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  buttonContainer: {
    width: '100%',
    gap: 15,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    padding: 18,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    padding: 18,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 10,
  },
  sectionGap: {
    marginTop: 24,
  },
  comingUpCard: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  comingUpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
  },
  comingUpTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  itemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  itemBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBadgeText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  itemText: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  itemDetail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 1,
  },
  itemDay: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  itemDayToday: {
    color: colors.primary,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
    padding: 10,
  },
  logoutButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginLeft: 5,
  },
});
}
