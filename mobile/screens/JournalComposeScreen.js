import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { journalAPI, personAPI } from '../services/api';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { formatLongDate, localDateKey, personPrompt, promptsForToday } from '../utils/journal';

const RECORDING_RED = '#E5484D';

/**
 * Write or speak a daily reflection. Used for new entries and for editing (route.params.entry).
 * Saving keeps the words first; connecting people happens on the next screen.
 */
export default function JournalComposeScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const editing = route.params?.entry || null;
  const startWithVoice = !!route.params?.startWithVoice;

  const todayKey = localDateKey();
  const yesterdayKey = localDateKey(new Date(Date.now() - 86400000));
  const [body, setBody] = useState(editing?.body || '');
  const [prompt, setPrompt] = useState(editing?.prompt || null);
  const [entryDate, setEntryDate] = useState(editing?.entry_date || todayKey);
  const [personForPrompt, setPersonForPrompt] = useState(null);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(false);
  const voice = useVoiceRecognition();

  const prompts = useMemo(() => {
    const list = promptsForToday();
    if (personForPrompt) list.splice(1, 0, personPrompt(personForPrompt));
    return list;
  }, [personForPrompt]);

  // One person-shaped prompt for whoever the user most recently prayed for (if anyone).
  useEffect(() => {
    if (editing) return;
    personAPI
      .getAll()
      .then((data) => {
        const first = Array.isArray(data?.persons) ? data.persons[0] : null;
        if (first?.first_name) setPersonForPrompt(first.first_name);
      })
      .catch(() => {});
  }, [editing]);

  useEffect(() => {
    if (!startWithVoice) return undefined;
    const t = setTimeout(() => voice.startListening(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWithVoice]);

  const isDirty =
    body.trim() !== (editing?.body || '').trim() ||
    (prompt || null) !== (editing?.prompt || null) ||
    entryDate !== (editing?.entry_date || todayKey);

  // Ask before throwing away unsaved words.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (savedRef.current || !isDirty) return;
      e.preventDefault();
      Alert.alert(
        editing ? 'Discard your changes?' : 'Discard this reflection?',
        'What you have written here has not been saved.',
        [
          { text: 'Keep writing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, editing]);

  const toggleRecording = async () => {
    if (voice.isListening) {
      const uri = await voice.stopListening();
      if (!uri) return;
      const text = await voice.transcribeAudio(uri);
      if (text && text.trim()) {
        setBody((prev) => {
          const trimmed = prev.replace(/\s+$/, '');
          if (!trimmed) return text.trim();
          return `${trimmed}${/[.!?…]$/.test(trimmed) ? ' ' : '. '}${text.trim()}`;
        });
      }
    } else {
      await voice.startListening();
    }
  };

  const save = async () => {
    const text = body.trim();
    if (!text) {
      Alert.alert('Nothing to save yet', 'Write or speak a few words first.');
      return;
    }
    if (voice.isListening) await voice.stopListening();
    setSaving(true);
    try {
      const payload = { body: text, entryDate, prompt };
      if (editing) {
        const textChanged = text !== editing.body.trim();
        const result = await journalAPI.update(editing.id, payload);
        savedRef.current = true;
        if (textChanged) {
          navigation.replace('JournalConnect', {
            entryId: editing.id,
            removedConnections: result.removedConnections || [],
          });
        } else {
          navigation.goBack();
        }
      } else {
        const result = await journalAPI.create(payload);
        savedRef.current = true;
        navigation.replace('JournalConnect', { entryId: result.entry.id, isNew: true });
      }
    } catch (err) {
      Alert.alert(
        'Could not save',
        'Your reflection is still here. Check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const recordingBusy = voice.isTranscribing;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>{editing ? 'Edit reflection' : 'New reflection'}</Text>
          <TouchableOpacity
            style={[
              styles.saveButton,
              (!body.trim() || saving || recordingBusy || voice.isListening) && styles.saveButtonDisabled,
            ]}
            onPress={save}
            disabled={!body.trim() || saving || recordingBusy || voice.isListening}
            accessibilityRole="button"
            accessibilityLabel="Save reflection"
          >
            {saving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={styles.saveText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.dateText}>{formatLongDate(entryDate)}</Text>
          {!editing && (
            <View style={styles.dayToggle}>
              {[
                [todayKey, 'Today'],
                [yesterdayKey, 'Yesterday'],
              ].map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.dayOption, entryDate === key && styles.dayOptionActive]}
                  onPress={() => setEntryDate(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: entryDate === key }}
                >
                  <Text style={[styles.dayOptionText, entryDate === key && styles.dayOptionTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {prompt ? (
            <View style={styles.chosenPrompt}>
              <View style={styles.chosenPromptBar} />
              <Text style={styles.chosenPromptText}>{prompt}</Text>
              <TouchableOpacity
                onPress={() => setPrompt(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Remove this prompt"
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.promptSection}>
              <Text style={styles.promptHeading}>Need a starting point? (optional)</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.promptRow}
              >
                {prompts.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={styles.promptChip}
                    onPress={() => setPrompt(p)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.promptChipText}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <TextInput
            style={styles.input}
            value={body}
            onChangeText={setBody}
            multiline
            autoFocus={!startWithVoice && !editing}
            placeholder={
              'Write freely. Your day, your faith, what you are grateful for, who you prayed for…\n\nNothing here has to be polished.'
            }
            placeholderTextColor={colors.placeholderText}
            textAlignVertical="top"
            scrollEnabled={false}
            accessibilityLabel="Your reflection"
          />
        </ScrollView>

        <View style={styles.voiceBar}>
          {voice.error ? <Text style={styles.voiceError}>{voice.error}</Text> : null}
          <TouchableOpacity
            style={[styles.voiceButton, voice.isListening && styles.voiceButtonRecording]}
            onPress={toggleRecording}
            disabled={recordingBusy || saving}
            accessibilityRole="button"
            accessibilityLabel={voice.isListening ? 'Finish speaking' : 'Speak your reflection'}
          >
            {recordingBusy ? (
              <>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.voiceText}>Writing down your words…</Text>
              </>
            ) : voice.isListening ? (
              <>
                <View style={styles.recordingDot} />
                <Text style={[styles.voiceText, { color: RECORDING_RED }]}>Listening… tap to finish</Text>
              </>
            ) : (
              <>
                <Ionicons name="mic" size={20} color={colors.primary} />
                <Text style={styles.voiceText}>{body.trim() ? 'Add by speaking' : 'Speak instead'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 10,
    },
    cancelText: { fontSize: 17, color: colors.primary },
    topTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    saveButton: {
      backgroundColor: colors.primary,
      borderRadius: RADIUS.button,
      paddingHorizontal: 18,
      paddingVertical: 8,
      minWidth: 70,
      alignItems: 'center',
    },
    saveButtonDisabled: { opacity: 0.45 },
    saveText: { color: 'white', fontSize: 15, fontWeight: '700' },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 24 },
    dateText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
    dayToggle: { flexDirection: 'row', gap: 8, marginTop: 10 },
    dayOption: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: RADIUS.chip,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dayOptionActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    dayOptionText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    dayOptionTextActive: { color: colors.primary },
    promptSection: { marginTop: 18 },
    promptHeading: { fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
    promptRow: { gap: 8, paddingRight: 20 },
    promptChip: {
      maxWidth: 240,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    promptChipText: { fontSize: 14, lineHeight: 19, color: colors.textPrimary },
    chosenPrompt: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginTop: 18,
      backgroundColor: colors.primarySoft,
      borderRadius: 14,
      padding: 14,
    },
    chosenPromptBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.primary },
    chosenPromptText: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.textPrimary },
    input: {
      fontSize: 17,
      lineHeight: 25,
      color: colors.textPrimary,
      minHeight: 260,
      marginTop: 18,
      padding: 0,
    },
    voiceBar: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    voiceError: { fontSize: 12, color: colors.danger, textAlign: 'center', marginBottom: 6 },
    voiceButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: RADIUS.button,
      backgroundColor: colors.primarySoft,
    },
    voiceButtonRecording: { backgroundColor: 'rgba(229, 72, 77, 0.12)' },
    voiceText: { fontSize: 15, fontWeight: '600', color: colors.primary },
    recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: RECORDING_RED },
  });
}
