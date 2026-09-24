import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { SafeAreaView, useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { authAPI, profileAPI } from '../services/api';
import { useOnboarding } from '../onboarding/OnboardingContext';
import GlassSurface from '../components/GlassSurface';
import { useTheme } from '../context/ThemeContext';

export default function HomeScreen({ navigation, onLogout }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { registerTarget } = useOnboarding();
  const [userName, setUserName] = useState(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const { height: windowHeight } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  /** Space below last item so Logout clears tab bar + home indicator */
  const scrollBottomPadding = tabBarHeight + Math.max(insets.bottom, 12) + 48;
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

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      const profile = await profileAPI.getProfile();
      setUserName(profile.user?.name || profile.user?.username || null);
    } catch (error) {
      console.error('[HomeScreen] Error loading profile:', error);
    } finally {
      setIsLoadingProfile(false);
    }
  };
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
          <View style={styles.header}>
            <Ionicons
              name="people-circle"
              size={80}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={styles.title} accessibilityRole="header">
              Thim
            </Text>
            <Text style={styles.subtitle}>Keep track of your prayer request</Text>
            {userName && (
              <View style={styles.userBadge} accessibilityLabel={`Signed in as ${userName}`}>
                <Ionicons
                  name="person"
                  size={16}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.userName}>{userName}</Text>
              </View>
            )}
          </View>

          <View style={styles.buttonContainer}>
            <View ref={startSessionRef} collapsable={false} style={styles.coachMeasureWrap}>
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

            <View ref={viewPeopleRef} collapsable={false} style={styles.coachMeasureWrap}>
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

          <GlassSurface style={styles.infoBox}>
            <Ionicons
              name="information-circle"
              size={20}
                  color={colors.textSecondary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={styles.infoText}>
              Start a new prayer request to record what's on your heart or a need for you or for others! Thim will automatically create profiles for any people you mention and log
              their information.
            </Text>
          </GlassSurface>

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            accessibilityRole="button"
            accessibilityLabel="Log out"
            accessibilityHint="Sign out of Thim on this device"
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
    paddingTop: 24,
    /** Let content grow from the top so ScrollView can scroll past the tab bar */
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 60,
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
  userBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 12,
  },
  userName: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    marginLeft: 6,
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
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 15,
    borderRadius: 10,
    marginTop: 40,
    alignItems: 'flex-start',
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
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

