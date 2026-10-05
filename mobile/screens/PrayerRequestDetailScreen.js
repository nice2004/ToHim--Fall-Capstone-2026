import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { sessionAPI } from '../services/api';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';

const ANSWERED_COLOR = '#34C759';

// SQLite/Postgres timestamps are UTC; see PersonDetailScreen.js for the same helper.
function parseUtcTimestamp(str) {
  if (!str) return new Date();
  const s = String(str).trim();
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

function normalizeMarkdownForDisplay(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^(\s*[-*+])(?=\S)/gm, '$1 ')
    .replace(/^(\s*\d+\.)(?=\S)/gm, '$1 ')
    .trim();
}

export default function PrayerRequestDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const markdownStyles = useMemo(() => createMarkdownStyles(colors), [colors]);
  const { personName } = route.params;
  const [session, setSession] = useState(route.params.session);

  const [showAnsweredModal, setShowAnsweredModal] = useState(false);
  const [answeredNoteInput, setAnsweredNoteInput] = useState('');
  const [isSavingAnswered, setIsSavingAnswered] = useState(false);
  const [isDeletingVerseId, setIsDeletingVerseId] = useState(null);

  const combinedText = [session.notes, session.transcript]
    .filter((t) => typeof t === 'string' && t.trim().length > 0)
    .join('\n\n');

  const openAnsweredModal = () => {
    setAnsweredNoteInput('');
    setShowAnsweredModal(true);
  };

  const confirmMarkAnswered = async () => {
    setIsSavingAnswered(true);
    try {
      const result = await sessionAPI.markAnswered(session.id, {
        answered: true,
        answeredNote: answeredNoteInput.trim() || undefined,
      });
      setSession((prev) => ({ ...prev, ...result.session }));
      setShowAnsweredModal(false);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to mark prayer request as answered');
    } finally {
      setIsSavingAnswered(false);
    }
  };

  const confirmMarkUnanswered = () => {
    Alert.alert(
      'Mark as unanswered?',
      'This moves the request back to your active prayers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark unanswered',
          onPress: async () => {
            try {
              const result = await sessionAPI.markAnswered(session.id, { answered: false });
              setSession((prev) => ({ ...prev, ...result.session }));
            } catch (error) {
              Alert.alert('Error', error.message || 'Failed to update prayer request');
            }
          },
        },
      ]
    );
  };

  const handleAddVersePress = () => {
    navigation.navigate('VerseSearch', {
      sessionId: session.id,
      onVerseAdded: (verse) => {
        setSession((prev) => ({ ...prev, verses: [...(prev.verses || []), verse] }));
      },
    });
  };

  const confirmDeleteVerse = (verse) => {
    Alert.alert('Remove verse?', `Remove ${verse.reference} from this prayer request?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setIsDeletingVerseId(verse.id);
          try {
            await sessionAPI.deleteVerse(session.id, verse.id);
            setSession((prev) => ({
              ...prev,
              verses: (prev.verses || []).filter((v) => v.id !== verse.id),
            }));
          } catch (error) {
            Alert.alert('Error', error.message || 'Failed to remove verse');
          } finally {
            setIsDeletingVerseId(null);
          }
        },
      },
    ]);
  };

  const isAnswered = !!session.answered;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topNavBar}>
        <TouchableOpacity
          style={styles.backNavButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${personName}`}
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backNavLabel}>{personName}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scrollContent}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: isAnswered ? ANSWERED_COLOR : colors.primarySoft },
            ]}
          >
            {isAnswered && <Ionicons name="checkmark-circle" size={14} color="white" style={{ marginRight: 4 }} />}
            <Text style={[styles.statusPillText, { color: isAnswered ? 'white' : colors.primary }]}>
              {isAnswered ? 'Answered' : 'Active'}
            </Text>
          </View>
          <Text style={styles.dateText}>
            {parseUtcTimestamp(session.created_at).toLocaleDateString()}
          </Text>
        </View>

        <GlassSurface style={styles.requestCard}>
          {combinedText ? (
            <Markdown style={markdownStyles}>{normalizeMarkdownForDisplay(combinedText)}</Markdown>
          ) : (
            <Text style={styles.emptyText}>No details recorded.</Text>
          )}
        </GlassSurface>

        {isAnswered && session.answered_note ? (
          <GlassSurface style={[styles.requestCard, styles.answeredNoteCard]}>
            <Text style={styles.answeredNoteLabel}>How it was answered</Text>
            <Text style={styles.answeredNoteText}>{session.answered_note}</Text>
          </GlassSurface>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verses</Text>
          {(session.verses || []).length === 0 && (
            <Text style={styles.emptyText}>
              No verses attached yet. Add one to pray and stand on.
            </Text>
          )}
          {(session.verses || []).map((verse) => (
            <GlassSurface key={verse.id} style={styles.verseCard}>
              <View style={styles.verseCardHeader}>
                <Text style={styles.verseReference}>{verse.reference}</Text>
                <TouchableOpacity
                  onPress={() => confirmDeleteVerse(verse)}
                  disabled={isDeletingVerseId === verse.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${verse.reference}`}
                >
                  {isDeletingVerseId === verse.id ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <Ionicons name="close-circle-outline" size={20} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
              <Text style={styles.verseText}>{verse.verse_text}</Text>
            </GlassSurface>
          ))}
          <TouchableOpacity style={styles.addVerseButton} onPress={handleAddVersePress}>
            <Ionicons name="book-outline" size={20} color={colors.primary} />
            <Text style={styles.addVerseButtonText}>Add verse</Text>
          </TouchableOpacity>
        </View>

        {isAnswered ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={confirmMarkUnanswered}>
            <Text style={styles.secondaryButtonText}>Mark unanswered</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryButton} onPress={openAnsweredModal}>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.primaryButtonText}>Answered</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal
        visible={showAnsweredModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!isSavingAnswered) setShowAnsweredModal(false);
        }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <GlassSurface style={styles.modalContent} intensity={52} strong>
                <Text style={styles.modalTitle}>Mark as answered?</Text>
                <Text style={styles.modalLabel}>How was it answered? (optional)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={answeredNoteInput}
                  onChangeText={setAnsweredNoteInput}
                  placeholder="e.g. She got the job!"
                  placeholderTextColor={colors.placeholderText}
                  multiline
                  editable={!isSavingAnswered}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => setShowAnsweredModal(false)}
                    disabled={isSavingAnswered}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={confirmMarkAnswered}
                    disabled={isSavingAnswered}
                  >
                    {isSavingAnswered ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text style={styles.modalButtonTextSave}>Mark answered</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </GlassSurface>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topNavBar: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
    backNavButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
    backNavLabel: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginLeft: 2 },
    scrollFlex: { flex: 1 },
    scrollContent: { padding: 20 },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: RADIUS.chip,
    },
    statusPillText: { fontSize: 13, fontWeight: '700' },
    dateText: { fontSize: 13, color: colors.textSecondary },
    requestCard: { padding: 18, borderRadius: RADIUS.card, marginBottom: 14 },
    emptyText: { fontSize: 14, color: colors.textSecondary, fontStyle: 'italic' },
    answeredNoteCard: { borderLeftWidth: 4, borderLeftColor: ANSWERED_COLOR },
    answeredNoteLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 4,
      textTransform: 'uppercase',
    },
    answeredNoteText: { fontSize: 15, color: colors.textPrimary },
    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 10 },
    verseCard: { padding: 14, borderRadius: RADIUS.card, marginBottom: 10 },
    verseCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    verseReference: { fontSize: 15, fontWeight: '700', color: colors.primary },
    verseText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
    addVerseButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: RADIUS.button,
      borderWidth: 1,
      borderColor: colors.primary,
      marginTop: 4,
    },
    addVerseButtonText: { marginLeft: 8, color: colors.primary, fontSize: 15, fontWeight: '600' },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ANSWERED_COLOR,
      padding: 15,
      borderRadius: RADIUS.button,
      marginBottom: 20,
    },
    primaryButtonText: { color: 'white', fontSize: 17, fontWeight: '700', marginLeft: 8 },
    secondaryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 15,
      borderRadius: RADIUS.button,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 20,
    },
    secondaryButtonText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: { borderRadius: RADIUS.modal, padding: 25, width: '90%', maxWidth: 400 },
    modalTitle: { fontSize: 22, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 16, textAlign: 'center' },
    modalLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
    modalInput: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      padding: 12,
      fontSize: 15,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.textPrimary,
      minHeight: 70,
      textAlignVertical: 'top',
      marginBottom: 16,
    },
    modalButtons: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    modalButton: { flex: 1, padding: 15, borderRadius: 24, alignItems: 'center' },
    modalButtonCancel: { backgroundColor: colors.surfaceMuted },
    modalButtonSave: { backgroundColor: ANSWERED_COLOR },
    modalButtonTextCancel: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
    modalButtonTextSave: { color: 'white', fontSize: 16, fontWeight: '600' },
  });
}

function createMarkdownStyles(colors) {
  return StyleSheet.create({
    body: { fontSize: 16, color: colors.textPrimary, lineHeight: 24 },
    paragraph: { marginTop: 0, marginBottom: 8, fontSize: 16, color: colors.textPrimary, lineHeight: 24 },
    strong: { fontWeight: '700', color: colors.textPrimary },
    em: { fontStyle: 'italic', color: colors.textPrimary },
  });
}
