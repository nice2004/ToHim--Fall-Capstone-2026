import 'react-native-gesture-handler';
import React, { useMemo, useState, useEffect } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './screens/HomeScreen';
import PeopleScreen from './screens/PeopleScreen';
import PersonDetailScreen from './screens/PersonDetailScreen';
import RemindMeScreen from './screens/RemindMeScreen';
import SessionScreen from './screens/SessionScreen';
import LoginScreen from './screens/LoginScreen';
import ProfileSetupScreen from './screens/ProfileSetupScreen';
import SettingsScreen from './screens/SettingsScreen';
import AccountSettingsScreen from './screens/AccountSettingsScreen';
import PrivacyScreen from './screens/PrivacyScreen';
import CalendarScreen from './screens/CalendarScreen';
import { authAPI } from './services/api';
import { initLocalDb } from './services/localDb';
import { runNightlyBackupOnOpenIfNeeded } from './services/syncService';
import { OnboardingProvider } from './onboarding/OnboardingContext';
import CoachMarksOverlay from './onboarding/CoachMarksOverlay';
import { registerDevOnboardingPreview } from './onboarding/devOnboardingBridge';
import GlassSurface from './components/GlassSurface';
import CoachableTabBar from './components/CoachableTabBar';
import { makeMeasuredTabBarButton } from './components/MeasuredTabBarButton';
import { FLOATING_TAB_BAR } from './tabBarLayout';
import { ThemeProvider, useTheme } from './context/ThemeContext';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function PeopleStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        cardStyle: { flex: 1 },
        headerShown: false,
      }}
    >
      <Stack.Screen name="PeopleList" component={PeopleScreen} options={{ title: 'People' }} />
      <Stack.Screen name="PersonDetail" component={PersonDetailScreen} options={{ title: 'Person Details' }} />
      <Stack.Screen name="NewSession" component={SessionScreen} options={{ title: 'Record Prayer Request' }} />
    </Stack.Navigator>
  );
}

function HomeStack({ onLogout }) {
  return (
    <Stack.Navigator
      screenOptions={{
        cardStyle: { flex: 1 },
        headerShown: false,
      }}
    >
      <Stack.Screen name="HomeMain" options={{ title: 'Thim' }}>
        {(props) => <HomeScreen {...props} onLogout={onLogout} />}
      </Stack.Screen>
      <Stack.Screen name="Session" component={SessionScreen} options={{ title: 'New Prayer Request' }} />
    </Stack.Navigator>
  );
}

function SettingsStack({ onLogout }) {
  const { colors } = useTheme();
  const headerMuted = {
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.screenMuted },
  };
  return (
    <Stack.Navigator
      screenOptions={{
        cardStyle: { flex: 1 },
        headerShown: false,
      }}
    >
      <Stack.Screen name="SettingsMain" options={{ headerShown: false }}>
        {(props) => <SettingsScreen {...props} />}
      </Stack.Screen>
      <Stack.Screen
        name="AccountSettings"
        options={{
          headerShown: true,
          title: 'Your account',
          headerBackTitle: 'Settings',
          ...headerMuted,
        }}
      >
        {(props) => <AccountSettingsScreen {...props} onLogout={onLogout} />}
      </Stack.Screen>
      <Stack.Screen
        name="Privacy"
        component={PrivacyScreen}
        options={{
          headerShown: true,
          title: 'Privacy & data',
          headerBackTitle: 'Settings',
          ...headerMuted,
        }}
      />
    </Stack.Navigator>
  );
}

function AppInner() {
  const navRef = useNavigationContainerRef();
  const { colors, isDark, glass, shadow } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [devPreviewOnboarding, setDevPreviewOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const navigationTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.textPrimary,
        border: colors.border,
        notification: colors.primary,
      },
    }),
    [isDark, colors]
  );

  useEffect(() => {
    (async () => {
      try {
        await initLocalDb();
      } catch (err) {
        console.warn('[App] Local DB initialization failed:', err?.message || err);
      }
      await checkAuth();
    })();
  }, []);

  useEffect(() => {
    if (!__DEV__) return undefined;
    return registerDevOnboardingPreview(setDevPreviewOnboarding);
  }, []);

  const checkAuth = async () => {
    try {
      const authenticated = await authAPI.isAuthenticated();
      if (authenticated) {
        try {
          const verifyResult = await authAPI.verify();
          setIsAuthenticated(true);
          runNightlyBackupOnOpenIfNeeded().catch((syncErr) => {
            console.warn('[App] Nightly backup sync did not complete:', syncErr?.message || syncErr);
          });
          if (!verifyResult.user?.name) {
            setNeedsProfileSetup(true);
          } else {
            setNeedsProfileSetup(false);
          }
          setNeedsOnboarding(verifyResult.user?.onboarding_completed === false);
        } catch (error) {
          console.log('[App] Token verification failed, user needs to login');
          setIsAuthenticated(false);
          setNeedsProfileSetup(false);
          setNeedsOnboarding(false);
        }
      } else {
        setIsAuthenticated(false);
        setNeedsProfileSetup(false);
        setNeedsOnboarding(false);
      }
    } catch (error) {
      console.error('[App] Error checking auth:', error);
      setIsAuthenticated(false);
      setNeedsProfileSetup(false);
      setNeedsOnboarding(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await authAPI.logout();
    setIsAuthenticated(false);
    setNeedsProfileSetup(false);
    setNeedsOnboarding(false);
    if (__DEV__) setDevPreviewOnboarding(false);
  };

  const handleLogin = async (options = {}) => {
    if (options.needsProfileSetup) {
      setNeedsProfileSetup(true);
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(true);
      setNeedsProfileSetup(false);
    }
    setNeedsOnboarding(options.needsOnboarding === true);
  };

  const handleProfileSetupComplete = () => {
    setNeedsProfileSetup(false);
  };

  const handleOnboardingComplete = async () => {
    try {
      if (needsOnboarding) {
        await authAPI.completeOnboarding();
      }
    } catch (error) {
      console.warn('[App] Failed to persist onboarding completion:', error?.message || error);
    } finally {
      setNeedsOnboarding(false);
      if (__DEV__) setDevPreviewOnboarding(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <OnboardingProvider>
      <NavigationContainer ref={navRef} theme={navigationTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {isAuthenticated ? (
          needsProfileSetup ? (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="ProfileSetup">
                {(props) => (
                  <ProfileSetupScreen {...props} onComplete={handleProfileSetupComplete} />
                )}
              </Stack.Screen>
            </Stack.Navigator>
          ) : (
            <Tab.Navigator
              tabBar={(props) => <CoachableTabBar {...props} />}
              sceneContainerStyle={{ flex: 1 }}
              screenOptions={({ route }) => ({
                tabBarIcon: ({ focused, color, size }) => {
                  let iconName;
                  if (route.name === 'Home') {
                    iconName = focused ? 'home' : 'home-outline';
                  } else if (route.name === 'People') {
                    iconName = focused ? 'people' : 'people-outline';
                  } else if (route.name === 'RemindMe') {
                    iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
                  } else if (route.name === 'Calendar') {
                    iconName = focused ? 'calendar' : 'calendar-outline';
                  } else if (route.name === 'Settings') {
                    iconName = focused ? 'settings' : 'settings-outline';
                  }
                  return <Ionicons name={iconName} size={size} color={color} />;
                },
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.tabBarInactive,
                tabBarStyle: {
                  position: 'absolute',
                  bottom: FLOATING_TAB_BAR.bottom,
                  left: FLOATING_TAB_BAR.left,
                  right: FLOATING_TAB_BAR.right,
                  height: FLOATING_TAB_BAR.height,
                  borderRadius: 999,
                  backgroundColor: 'transparent',
                  borderTopWidth: 0,
                  ...shadow.card,
                  paddingBottom: 8,
                  paddingTop: 6,
                },
                tabBarBackground: () => (
                  <GlassSurface style={styles.tabBarGlass} intensity={glass.elevatedIntensity} strong />
                ),
                tabBarLabelStyle: {
                  fontSize: 12,
                  fontWeight: '600',
                },
                tabBarHideOnKeyboard: true,
                headerShown: false,
              })}
            >
              <Tab.Screen name="Home" options={{ tabBarButton: makeMeasuredTabBarButton('Home') }}>
                {(props) => <HomeStack {...props} onLogout={handleLogout} />}
              </Tab.Screen>
              <Tab.Screen
                name="People"
                component={PeopleStack}
                options={{ tabBarButton: makeMeasuredTabBarButton('People') }}
              />
              <Tab.Screen
                name="RemindMe"
                component={RemindMeScreen}
                options={{
                  title: 'Ask Thim',
                  tabBarButton: makeMeasuredTabBarButton('RemindMe'),
                }}
              />
              <Tab.Screen
                name="Calendar"
                component={CalendarScreen}
                options={{ tabBarButton: makeMeasuredTabBarButton('Calendar') }}
              />
              <Tab.Screen name="Settings" options={{ tabBarButton: makeMeasuredTabBarButton('Settings') }}>
                {(props) => <SettingsStack {...props} onLogout={handleLogout} />}
              </Tab.Screen>
            </Tab.Navigator>
          )
        ) : (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login">
              {(props) => <LoginScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
          </Stack.Navigator>
        )}
        <CoachMarksOverlay
          visible={
            isAuthenticated &&
            !needsProfileSetup &&
            (needsOnboarding || (__DEV__ && devPreviewOnboarding))
          }
          navigation={navRef}
          onDone={handleOnboardingComplete}
        />
      </NavigationContainer>
    </OnboardingProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBarGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
});
