import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../services/api';
import { useTheme } from '../context/ThemeContext';

export default function LoginScreen({ navigation, onLogin }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isEmailUpgrade, setIsEmailUpgrade] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradeCode, setUpgradeCode] = useState('');
  const [awaitingUpgradeCode, setAwaitingUpgradeCode] = useState(false);
  const [pendingLoginOptions, setPendingLoginOptions] = useState(null);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const privacyUrl = 'https://davidoyebade.github.io/thim-support/privacy.html';

  const handleSubmit = async () => {
    console.log('[LoginScreen] Submit clicked, isSignUp:', isSignUp);
    console.log('[LoginScreen] Username:', username);
    
    setIsLoading(true);
    try {
      if (isEmailUpgrade) {
        if (!awaitingUpgradeCode) {
          if (!upgradeEmail.trim()) {
            Alert.alert('Error', 'Please enter an email');
            return;
          }
          await authAPI.requestEmailUpgradeCode(upgradeEmail.trim());
          setAwaitingUpgradeCode(true);
          Alert.alert('Code Sent', 'A verification code was sent to your email.');
        } else {
          if (!upgradeCode.trim()) {
            Alert.alert('Error', 'Please enter the verification code');
            return;
          }
          await authAPI.verifyEmailUpgradeCode(upgradeCode.trim());
          const options = pendingLoginOptions || {};
          setPendingLoginOptions(null);
          setIsEmailUpgrade(false);
          setUpgradeEmail('');
          setUpgradeCode('');
          setAwaitingUpgradeCode(false);
          onLogin && onLogin(options);
        }
      } else if (isForgotPassword) {
        if (!resetIdentifier.trim()) {
          Alert.alert('Error', 'Please enter your email or username');
          return;
        }
        if (!resetCode.trim()) {
          await authAPI.requestPasswordReset(resetIdentifier.trim());
          Alert.alert('Reset Code Sent', 'If the account exists, a reset code was sent to the email on file.');
        } else {
          if (newPassword.length < 8) {
            Alert.alert('Error', 'New password must be at least 8 characters long');
            return;
          }
          await authAPI.confirmPasswordReset(resetIdentifier.trim(), resetCode.trim(), newPassword);
          Alert.alert('Success', 'Password reset successful. Please sign in.');
          setIsForgotPassword(false);
          setResetIdentifier('');
          setResetCode('');
          setNewPassword('');
        }
      } else if (isSignUp) {
        if (!awaitingVerification) {
          if (!username.trim() || !email.trim() || !password.trim()) {
            Alert.alert('Error', 'Please enter username, email, and password');
            return;
          }
          if (username.length < 3) {
            Alert.alert('Error', 'Username must be at least 3 characters long');
            return;
          }
          if (password.length < 8) {
            Alert.alert('Error', 'Password must be at least 8 characters long');
            return;
          }
          if (!agreedToPrivacy) {
            Alert.alert('Privacy policy required', 'You must agree to Thim privacy policy before creating an account.');
            return;
          }
          await authAPI.register(username.trim(), email.trim(), password, agreedToPrivacy);
          setAwaitingVerification(true);
          Alert.alert('Verification Required', 'A verification code was sent to your email.');
        } else {
          if (!verificationCode.trim()) {
            Alert.alert('Error', 'Please enter the verification code from your email');
            return;
          }
          const result = await authAPI.verifyEmailCode(email.trim(), verificationCode.trim());
          if (result.needsProfileSetup) {
            onLogin && onLogin({
              needsProfileSetup: true,
              needsOnboarding: result.user?.onboarding_completed === false,
            });
          } else {
            onLogin && onLogin({
              needsOnboarding: result.user?.onboarding_completed === false,
            });
          }
        }
      } else {
        if (!username.trim() || !password.trim()) {
          Alert.alert('Error', 'Please enter username/email and password');
          return;
        }
        console.log('[LoginScreen] Calling login API');
        const result = await authAPI.login(username.trim(), password);
        if (result.user?.privacy_consent_given !== true) {
          Alert.alert(
            'Consent required for AI features',
            'Thim sends the content you choose to submit (for example notes, questions, and optional voice audio/transcripts) to OpenAI to provide transcription and Ask Thim responses. Do you agree to this data sharing?',
            [
              {
                text: 'Decline',
                style: 'cancel',
                onPress: async () => {
                  await authAPI.logout();
                  Alert.alert(
                    'Consent required',
                    'You must provide consent before Thim can use features that process data with OpenAI.'
                  );
                },
              },
              {
                text: 'Agree',
                onPress: async () => {
                  try {
                    await authAPI.acceptPrivacyConsent();
                    const loginOptions = {
                      needsOnboarding: result.user?.onboarding_completed === false,
                    };
                    if (result.user?.needs_email_setup) {
                      Alert.alert(
                        'Legacy Account',
                        'This account does not have an email yet. Would you like to add one now for verification and password recovery?',
                        [
                          {
                            text: 'Maybe Later',
                            onPress: () => onLogin && onLogin(loginOptions),
                            style: 'cancel',
                          },
                          {
                            text: 'Add Email',
                            onPress: () => {
                              setPendingLoginOptions(loginOptions);
                              setIsEmailUpgrade(true);
                              setIsForgotPassword(false);
                              setIsSignUp(false);
                            },
                          },
                        ]
                      );
                    } else {
                      onLogin && onLogin(loginOptions);
                    }
                  } catch (consentError) {
                    Alert.alert(
                      'Error',
                      consentError?.response?.data?.error || consentError?.message || 'Failed to save consent'
                    );
                  }
                },
              },
            ]
          );
          return;
        }
        console.log('[LoginScreen] Login result:', result);
        const loginOptions = {
          needsOnboarding: result.user?.onboarding_completed === false,
        };
        if (result.user?.needs_email_setup) {
          Alert.alert(
            'Legacy Account',
            'This account does not have an email yet. Would you like to add one now for verification and password recovery?',
            [
              {
                text: 'Maybe Later',
                onPress: () => onLogin && onLogin(loginOptions),
                style: 'cancel',
              },
              {
                text: 'Add Email',
                onPress: () => {
                  setPendingLoginOptions(loginOptions);
                  setIsEmailUpgrade(true);
                  setIsForgotPassword(false);
                  setIsSignUp(false);
                },
              },
            ]
          );
        } else {
          onLogin && onLogin(loginOptions);
        }
      }
    } catch (error) {
      console.error('[LoginScreen] Auth error caught:', error);
      console.error('[LoginScreen] Error response status:', error.response?.status);
      console.error('[LoginScreen] Error response data:', error.response?.data);
      
      // Show proper error message
      let errorMessage = 'Authentication failed';
      if (error.response?.status === 401) {
        errorMessage = 'Invalid username or password. Please try again or sign up for a new account.';
      } else if (error.response?.status === 409) {
        errorMessage = 'Username already exists. Please sign in or choose a different username.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      console.log('[LoginScreen] Showing error alert:', errorMessage);
      Alert.alert('Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
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
            <Text style={styles.subtitle}>
              {isEmailUpgrade
                ? 'Add and verify your email'
                : isSignUp
                ? 'Create your account'
                : 'Sign in to continue'}
            </Text>
          </View>

          <View style={styles.form}>
            {!isForgotPassword && !isEmailUpgrade && (
            <View style={styles.inputContainer}>
              <Ionicons
                name="person-outline"
                size={20}
                color={colors.textSecondary}
                style={styles.inputIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <TextInput
                style={styles.input}
                placeholder={isSignUp ? 'Username' : 'Username or Email'}
                placeholderTextColor={colors.placeholderText}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                accessibilityLabel={isSignUp ? 'Username' : 'Username or email'}
              />
            </View>
            )}

            {isSignUp && (
              <View style={styles.inputContainer}>
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={colors.textSecondary}
                  style={styles.inputIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={colors.placeholderText}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!isLoading && !awaitingVerification}
                  accessibilityLabel="Email"
                />
              </View>
            )}

            {isForgotPassword && (
              <View style={styles.inputContainer}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={colors.textSecondary}
                  style={styles.inputIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Username or Email"
                  placeholderTextColor={colors.placeholderText}
                  value={resetIdentifier}
                  onChangeText={setResetIdentifier}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  accessibilityLabel="Username or email for password reset"
                />
              </View>
            )}

            {isEmailUpgrade && (
              <>
                <View style={styles.inputContainer}>
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={colors.textSecondary}
                    style={styles.inputIcon}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor={colors.placeholderText}
                    value={upgradeEmail}
                    onChangeText={setUpgradeEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    editable={!isLoading && !awaitingUpgradeCode}
                    accessibilityLabel="Email for verification"
                  />
                </View>
                {awaitingUpgradeCode && (
                  <View style={styles.inputContainer}>
                    <Ionicons
                      name="key-outline"
                      size={20}
                      color={colors.textSecondary}
                      style={styles.inputIcon}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Verification code"
                      placeholderTextColor={colors.placeholderText}
                      value={upgradeCode}
                      onChangeText={setUpgradeCode}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="number-pad"
                      editable={!isLoading}
                      accessibilityLabel="Email verification code"
                    />
                  </View>
                )}
              </>
            )}

            {!isForgotPassword && !isEmailUpgrade && !awaitingVerification && (
            <View style={styles.inputContainer}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={colors.textSecondary}
                style={styles.inputIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.placeholderText}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                accessibilityLabel="Password"
                textContentType="password"
              />
            </View>
            )}

            {isSignUp && awaitingVerification && (
              <View style={styles.inputContainer}>
                <Ionicons
                  name="key-outline"
                  size={20}
                  color={colors.textSecondary}
                  style={styles.inputIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email verification code"
                  placeholderTextColor={colors.placeholderText}
                  value={verificationCode}
                  onChangeText={setVerificationCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="number-pad"
                  editable={!isLoading}
                  accessibilityLabel="Email verification code"
                />
              </View>
            )}

            {isSignUp && !isForgotPassword && !isEmailUpgrade && !awaitingVerification && (
              <>
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() => setAgreedToPrivacy((prev) => !prev)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreedToPrivacy }}
                >
                  <View style={[styles.checkbox, agreedToPrivacy && styles.checkboxChecked]}>
                    {agreedToPrivacy ? (
                      <Ionicons name="checkmark" size={14} color="white" />
                    ) : null}
                  </View>
                  <Text style={styles.checkboxLabel}>
                    I agree that Thim may send content I submit (such as notes, questions, and optional
                    voice audio/transcripts) to OpenAI for AI features, as described in the Privacy Policy.
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.policyLinkButton}
                  onPress={() => Linking.openURL(privacyUrl)}
                  accessibilityRole="button"
                  accessibilityLabel="Open privacy policy"
                >
                  <Text style={styles.policyLinkText}>Open Privacy Policy</Text>
                </TouchableOpacity>
              </>
            )}

            {isForgotPassword && (
              <>
                <View style={styles.inputContainer}>
                  <Ionicons
                    name="key-outline"
                    size={20}
                    color={colors.textSecondary}
                    style={styles.inputIcon}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Reset code (after requesting)"
                    placeholderTextColor={colors.placeholderText}
                    value={resetCode}
                    onChangeText={setResetCode}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="number-pad"
                    editable={!isLoading}
                    accessibilityLabel="Password reset code"
                  />
                </View>
                <View style={styles.inputContainer}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={colors.textSecondary}
                    style={styles.inputIcon}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="New password"
                    placeholderTextColor={colors.placeholderText}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    accessibilityLabel="New password"
                    textContentType="newPassword"
                  />
                </View>
              </>
            )}

            <TouchableOpacity
              style={[
                styles.submitButton, 
                isLoading && styles.submitButtonDisabled,
                isSignUp && styles.submitButtonSignUp
              ]}
              onPress={handleSubmit}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={
                isForgotPassword
                  ? resetCode
                    ? 'Reset password'
                    : 'Send password reset code'
                  : isEmailUpgrade
                  ? awaitingUpgradeCode
                    ? 'Verify email'
                    : 'Send email verification code'
                  : isSignUp
                  ? awaitingVerification
                    ? 'Verify email'
                    : 'Sign up'
                  : 'Sign in'
              }
              accessibilityState={{ disabled: isLoading }}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {isForgotPassword
                    ? (resetCode ? 'Reset Password' : 'Send Reset Code')
                    : isEmailUpgrade
                    ? (awaitingUpgradeCode ? 'Verify Email' : 'Send Verification Code')
                    : isSignUp
                    ? (awaitingVerification ? 'Verify Email' : 'Sign Up')
                    : 'Sign In'}
                </Text>
              )}
            </TouchableOpacity>

            {isSignUp && awaitingVerification && (
              <TouchableOpacity
                style={styles.switchButton}
                accessibilityRole="button"
                accessibilityLabel="Resend verification code"
                onPress={async () => {
                  try {
                    setIsLoading(true);
                    await authAPI.resendVerificationCode(email.trim());
                    Alert.alert('Code Sent', 'A new verification code was sent.');
                  } catch (error) {
                    Alert.alert('Error', error.response?.data?.error || error.message || 'Failed to resend code');
                  } finally {
                    setIsLoading(false);
                  }
                }}
                disabled={isLoading}
              >
                <Text style={styles.switchButtonText}>Resend verification code</Text>
              </TouchableOpacity>
            )}

            {!isEmailUpgrade && (
            <TouchableOpacity
              style={styles.switchButton}
              accessibilityRole="button"
              accessibilityLabel={
                isSignUp ? 'Switch to sign in' : 'Switch to sign up'
              }
              onPress={() => {
                console.log('[LoginScreen] Switching mode, current isSignUp:', isSignUp);
                setIsSignUp(!isSignUp);
                // Clear fields when switching
                setUsername('');
                setEmail('');
                setPassword('');
                setVerificationCode('');
                setAwaitingVerification(false);
                setAgreedToPrivacy(false);
              }}
              disabled={isLoading}
            >
              <Text style={styles.switchButtonText}>
                {isSignUp
                  ? 'Already have an account? Sign In'
                  : "Don't have an account? Sign Up"}
              </Text>
            </TouchableOpacity>
            )}

            {!isEmailUpgrade && (
            <TouchableOpacity
              style={styles.switchButton}
              accessibilityRole="button"
              accessibilityLabel={
                isForgotPassword ? 'Back to sign in' : 'Forgot password'
              }
              onPress={() => {
                setIsForgotPassword(!isForgotPassword);
                setIsSignUp(false);
                setAwaitingVerification(false);
                setUsername('');
                setPassword('');
                setVerificationCode('');
                setResetIdentifier('');
                setResetCode('');
                setNewPassword('');
              }}
              disabled={isLoading}
            >
              <Text style={styles.switchButtonText}>
                {isForgotPassword ? 'Back to Sign In' : 'Forgot password?'}
              </Text>
            </TouchableOpacity>
            )}

            {isEmailUpgrade && (
              <TouchableOpacity
                style={styles.switchButton}
                accessibilityRole="button"
                accessibilityLabel="Skip adding email for now"
                onPress={() => {
                  const options = pendingLoginOptions || {};
                  setPendingLoginOptions(null);
                  setIsEmailUpgrade(false);
                  setUpgradeEmail('');
                  setUpgradeCode('');
                  setAwaitingUpgradeCode(false);
                  onLogin && onLogin(options);
                }}
                disabled={isLoading}
              >
                <Text style={styles.switchButtonText}>Skip for now</Text>
              </TouchableOpacity>
            )}
            
            {isSignUp && (
              <View style={styles.modeIndicator}>
                <Ionicons
                  name="information-circle"
                  size={16}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.modeIndicatorText}>
                  You are creating a new account
                </Text>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.primary,
    marginTop: 10,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 8,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    marginBottom: 15,
    paddingHorizontal: 15,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 25,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  switchButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchButtonText: {
    color: colors.primary,
    fontSize: 14,
  },
  submitButtonSignUp: {
    backgroundColor: '#28a745',
  },
  modeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
    padding: 10,
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
  },
  modeIndicatorText: {
    color: colors.primary,
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '500',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 1,
    backgroundColor: colors.surface,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  policyLinkButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  policyLinkText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
});
}
