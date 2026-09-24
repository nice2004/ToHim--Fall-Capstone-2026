import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '../context/ThemeContext';
import { openDevOnboardingPreview } from '../onboarding/devOnboardingBridge';

const GROUP_VIEW_KEY = 'groupViewEnabled';

export default function SettingsScreen({ navigation }) {
  const { colors, isDark, setDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [groupViewEnabled, setGroupViewEnabled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [])
  );

  const loadSettings = async () => {
    try {
      const value = await SecureStore.getItemAsync(GROUP_VIEW_KEY);
      if (value !== null) {
        setGroupViewEnabled(value === 'true');
      }
    } catch (error) {
      console.error('[Settings] Error loading settings:', error);
    }
  };

  const toggleGroupView = async (value) => {
    try {
      await SecureStore.setItemAsync(GROUP_VIEW_KEY, value.toString());
      setGroupViewEnabled(value);
    } catch (error) {
      console.error('[Settings] Error saving settings:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Ionicons
            name="settings"
            size={60}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={styles.title} accessibilityRole="header">
            Settings
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Appearance
          </Text>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons
                name="moon"
                size={24}
                color={colors.primary}
                style={styles.settingIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Dark mode</Text>
                <Text style={styles.settingDescription}>
                  Use a dark background across the app. You can change this anytime.
                </Text>
              </View>
            </View>
            <Switch
              value={isDark}
              onValueChange={setDarkMode}
              trackColor={{ false: '#767577', true: colors.primary }}
              thumbColor={isDark ? '#fff' : '#f4f3f4'}
              accessibilityLabel="Dark mode"
              accessibilityHint="Use dark colors for the app interface"
              accessibilityState={{ checked: isDark }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            People View
          </Text>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons
                name="folder"
                size={24}
                color={colors.primary}
                style={styles.settingIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Group View</Text>
                <Text style={styles.settingDescription}>
                  Organize people into groups (mentors, family, coworkers, etc.)
                </Text>
              </View>
            </View>
            <Switch
              value={groupViewEnabled}
              onValueChange={toggleGroupView}
              trackColor={{ false: '#767577', true: colors.primary }}
              thumbColor={groupViewEnabled ? '#fff' : '#f4f3f4'}
              accessibilityLabel="Group View"
              accessibilityHint="Organize people into custom groups on the People tab"
              accessibilityState={{ checked: groupViewEnabled }}
            />
          </View>

          <View style={styles.infoBox}>
            <Ionicons
              name="information-circle"
              size={20}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={styles.infoText}>
              When Group View is enabled, you can organize people into groups. A person can belong to
              multiple groups. You can also query groups in Ask Thim (for example, which of your mentors
              you are supposed to meet with soon).
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Account
          </Text>
          <TouchableOpacity
            style={styles.accountRow}
            onPress={() => navigation.navigate('AccountSettings')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Edit your account"
            accessibilityHint="Change name, username, or delete account"
          >
            <View style={styles.accountRowTextWrap}>
              <Text style={styles.accountRowTitle}>Edit your account</Text>
              <Text style={styles.accountRowSubtitle}>Name, username, delete account</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={22}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.accountRowSecondary}
            onPress={() => navigation.navigate('Privacy')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Privacy and data"
            accessibilityHint="How Thim handles your information and security"
          >
            <View style={styles.accountRowTextWrap}>
              <Text style={styles.accountRowTitle}>Privacy & data</Text>
              <Text style={styles.accountRowSubtitle}>How we use and protect your information</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={22}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </TouchableOpacity>
        </View>

        {__DEV__ && (
          <View style={styles.devSection}>
            <Text style={styles.devSectionTitle}>Developer</Text>
            <Text style={styles.devSectionHint}>
              Show the new-user onboarding coach marks again. This does not change your account on
              the server (only the real first-time flow updates that).
            </Text>
            <TouchableOpacity
              style={styles.devButton}
              onPress={() => openDevOnboardingPreview()}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Preview onboarding tour"
            >
              <Ionicons name="school-outline" size={22} color="#fff" />
              <Text style={styles.devButtonText}>Preview onboarding tour</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.screenMuted,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    header: {
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 32,
      fontWeight: 'bold',
      color: colors.titleGray,
      marginTop: 15,
    },
    section: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      marginBottom: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: colors.titleGray,
      marginBottom: 15,
    },
    settingItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    settingInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: 15,
    },
    settingIcon: {
      marginRight: 12,
    },
    settingText: {
      flex: 1,
    },
    settingLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.titleGray,
      marginBottom: 4,
    },
    settingDescription: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    infoBox: {
      flexDirection: 'row',
      backgroundColor: colors.primarySoft,
      padding: 15,
      borderRadius: 10,
      alignItems: 'flex-start',
      gap: 10,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
      marginTop: 8,
      marginBottom: 8,
    },
    infoText: {
      flex: 1,
      fontSize: 14,
      color: colors.titleGray,
      lineHeight: 20,
    },
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    accountRowSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      marginTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    accountRowTextWrap: {
      flex: 1,
      marginRight: 12,
    },
    accountRowTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.titleGray,
      marginBottom: 4,
    },
    accountRowSubtitle: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    devSection: {
      backgroundColor: '#1e293b',
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
    },
    devSectionTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: '#94a3b8',
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    devSectionHint: {
      fontSize: 13,
      color: '#cbd5e1',
      lineHeight: 18,
      marginBottom: 14,
    },
    devButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
    },
    devButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
