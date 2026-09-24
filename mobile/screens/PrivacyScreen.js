import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';

export default function PrivacyScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator
      >
        <Text style={styles.lead}>
          This summary describes how ToHim handles your information and security. It is provided for
          transparency and may be updated as the app evolves.
        </Text>

        <Text style={styles.h2} accessibilityRole="header">
          How ToHim uses your information
        </Text>
        <Text style={styles.p}>
          ToHim stores the information you choose to save—such as session notes, people you add,
          groups, and calendar-related details—on our servers so you can use the app and sync your
          data. We use this information only to operate the service (save, sync, search, and
          features like Ask ToHim).
        </Text>

        <Text style={styles.h2} accessibilityRole="header">
          Artificial intelligence (OpenAI)
        </Text>
        <Text style={styles.p}>
          Some features send limited portions of your content to OpenAI through their API (for example
          to understand questions, transcribe audio, or help with answers).
        </Text>
        <Text style={styles.p}>
          OpenAI&apos;s ChatGPT Enterprise and API services are operated under terms that do not use
          your data to train their models for improving their general consumer services. Content you
          send through our integration is not used by OpenAI to train or sell models in that way.
          Retention and processing details may change; see OpenAI&apos;s current documentation for API
          and enterprise customers for the latest terms.
        </Text>
        <Text style={styles.p}>
          We do not sell your personal information to third parties.
        </Text>

        <Text style={styles.h2} accessibilityRole="header">
          What we do not do
        </Text>
        <Text style={styles.bullet}>• We do not sell your data.</Text>
        <Text style={styles.bullet}>• We do not use your data for third-party advertising.</Text>

        <Text style={styles.h2} accessibilityRole="header">
          Security practices
        </Text>
        <Text style={styles.p}>
          Data between the app and our servers is sent over HTTPS (TLS). Passwords are stored using
          hashes (bcrypt), not in plain text. After you sign in, the app uses a secure token for
          requests; on your device that token is stored in the operating system&apos;s secure storage
          (for example Expo SecureStore), not ordinary app files.
        </Text>
        <Text style={styles.p}>
          Your account data is kept in a managed database with access limited to our application.
          ToHim is not an end-to-end encrypted vault for every field—the service needs to read your
          saved content to provide features—but we follow common practices for access control,
          protected connections, and keeping secrets out of source code.
        </Text>

        <Text style={styles.h2} accessibilityRole="header">
          Your choices
        </Text>
        <Text style={styles.p}>
          You can delete your account from Settings → Edit your account → Danger zone. That removes
          your account and associated data from our systems as implemented in the app.
        </Text>

        <Text style={styles.h2} accessibilityRole="header">
          Changes
        </Text>
        <Text style={styles.p}>
          We may update this summary from time to time. Check this screen occasionally for the latest
          information.
        </Text>

        <Text style={styles.footer}>Last updated: April 2026</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.screenMuted,
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  lead: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: 20,
  },
  h2: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.titleGray,
    marginTop: 8,
    marginBottom: 10,
  },
  p: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 14,
  },
  bullet: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 8,
    paddingLeft: 4,
  },
  footer: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 20,
    fontStyle: 'italic',
  },
});
}
