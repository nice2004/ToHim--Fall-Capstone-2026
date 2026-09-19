import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { profileAPI, authAPI } from '../services/api';

export default function AccountSettingsScreen({ navigation, onLogout }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [initialName, setInitialName] = useState('');
  const [initialUsername, setInitialUsername] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmUsername, setConfirmUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const data = await profileAPI.getProfile();
      const u = data.user;
      const n = u?.name || '';
      const un = u?.username || '';
      setName(n);
      setUsername(un);
      setInitialName(n);
      setInitialUsername(un);
    } catch (error) {
      console.error('[AccountSettings] Error loading profile:', error);
      const msg = error.response?.data?.error || error.message || 'Could not load profile';
      Alert.alert('Error', msg);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleSaveProfile = async () => {
    const nameTrim = name.trim();
    const userTrim = username.trim();

    if (!nameTrim) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    if (nameTrim.length < 2) {
      Alert.alert('Error', 'Name must be at least 2 characters');
      return;
    }
    if (!userTrim) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }
    if (userTrim.length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters');
      return;
    }

    if (nameTrim === initialName && userTrim === initialUsername) {
      Alert.alert('No changes', 'Update your name or username before saving.');
      return;
    }

    setSaveLoading(true);
    try {
      const tasks = [];
      if (nameTrim !== initialName) {
        tasks.push(profileAPI.updateName(nameTrim));
      }
      if (userTrim !== initialUsername) {
        tasks.push(profileAPI.updateUsername(userTrim));
      }
      await Promise.all(tasks);
      setInitialName(nameTrim);
      setInitialUsername(userTrim);
      Alert.alert('Saved', 'Your profile was updated.');
    } catch (error) {
      const errorMessage =
        error.response?.data?.error || error.message || 'Failed to update profile';
      Alert.alert('Error', errorMessage);
    } finally {
      setSaveLoading(false);
    }
  };

  const openDeleteModal = () => {
    setConfirmUsername(initialUsername);
    setConfirmPassword('');
    setConfirmModalVisible(true);
  };

  const handleRequestDelete = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently removes your Tabbe account and all data on our servers (people, sessions, calendar, and Ask Tabbe memory). This cannot be undone.\n\nAre you sure you want to continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, continue',
          style: 'destructive',
          onPress: openDeleteModal,
        },
      ]
    );
  };

  const closeDeleteModal = () => {
    setConfirmModalVisible(false);
    setConfirmPassword('');
  };

  const runAccountDeletion = async () => {
    const u = confirmUsername.trim();
    const p = confirmPassword;
    if (!u) {
      Alert.alert('Error', 'Enter your username');
      return;
    }
    if (!p) {
      Alert.alert('Error', 'Enter your password');
      return;
    }

    setDeleteLoading(true);
    try {
      await profileAPI.deleteAccount({ username: u, password: p });
      closeDeleteModal();
      await authAPI.logout();
      onLogout?.();
    } catch (error) {
      const errorMessage =
        error.response?.data?.error || error.message || 'Failed to delete account';
      Alert.alert('Error', errorMessage);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {profileLoading ? (
          <View style={styles.profileLoading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.profileLoadingText}>Loading profile…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.placeholderText}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!saveLoading && !deleteLoading}
              accessibilityLabel="Your display name"
            />
            <Text style={styles.fieldLabel}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.placeholderText}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              editable={!saveLoading && !deleteLoading}
              accessibilityLabel="Username for sign-in"
            />
            <Text style={styles.fieldHint}>
              Username is what you use to sign in. It must be unique.
            </Text>
            <TouchableOpacity
              style={[styles.saveButton, saveLoading && styles.buttonDisabled]}
              onPress={handleSaveProfile}
              disabled={saveLoading || deleteLoading}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Save profile"
              accessibilityState={{ disabled: saveLoading || deleteLoading }}
            >
              {saveLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save profile</Text>
              )}
            </TouchableOpacity>

            <View style={styles.dangerSection}>
              <Text style={styles.dangerTitle} accessibilityRole="header">
                Danger zone
              </Text>
              <Text style={styles.dangerHint}>
                Permanently delete your account and all data stored for you on our servers. You will
                need to confirm, then enter your username and password.
              </Text>
              <TouchableOpacity
                style={[styles.deleteButton, deleteLoading && styles.buttonDisabled]}
                onPress={handleRequestDelete}
                disabled={deleteLoading || saveLoading}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Delete account"
                accessibilityHint="Starts account deletion. You will confirm and enter your password."
                accessibilityState={{ disabled: deleteLoading || saveLoading }}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color="#fff"
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.deleteButtonText}>Delete account</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={confirmModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeDeleteModal}
        accessibilityViewIsModal
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCardWrap}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle} accessibilityRole="header">
                Confirm account deletion
              </Text>
              <Text style={styles.modalSubtitle}>
                Enter your Tabbe username and password to permanently delete your account.
              </Text>
              <Text style={styles.fieldLabel}>Username</Text>
              <TextInput
                style={styles.input}
                value={confirmUsername}
                onChangeText={setConfirmUsername}
                placeholder="Username"
                placeholderTextColor={colors.placeholderText}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                editable={!deleteLoading}
                accessibilityLabel="Confirm your username"
              />
              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Password"
                placeholderTextColor={colors.placeholderText}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
                editable={!deleteLoading}
                accessibilityLabel="Confirm your password"
                textContentType="password"
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={closeDeleteModal}
                  disabled={deleteLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel account deletion"
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalDeleteBtn, deleteLoading && styles.buttonDisabled]}
                  onPress={runAccountDeletion}
                  disabled={deleteLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Permanently delete account"
                  accessibilityHint="Requires correct username and password"
                  accessibilityState={{ disabled: deleteLoading }}
                >
                  {deleteLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalDeleteText}>Delete forever</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.screenMuted,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  profileLoading: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  profileLoadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.titleGray,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 14,
  },
  fieldHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 24,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  dangerSection: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  dangerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 8,
  },
  dangerHint: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    paddingVertical: 14,
    borderRadius: 10,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCardWrap: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  modalCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalDeleteBtn: {
    backgroundColor: '#dc2626',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 140,
    alignItems: 'center',
  },
  modalDeleteText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
}
