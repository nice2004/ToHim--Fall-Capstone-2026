import React, { useState, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { queryAPI } from '../services/api';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { useOnboarding } from '../onboarding/OnboardingContext';

// Strip markdown syntax for TTS so voice doesn't read "hash hash header" or "star star bold"
function stripMarkdownForSpeech(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^#{1,6}\s*/gm, '')   // ## Header -> Header
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** -> bold
    .replace(/\*(.+?)\*/g, '$1')    // *italic* -> italic
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/^[-*+]\s+/gm, '')     // list bullets
    .replace(/^\d+\.\s+/gm, '')     // numbered list
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export default function RemindMeScreen() {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => createStyles(colors, shadow), [colors, shadow]);
  const markdownStyles = useMemo(() => createMarkdownStyles(colors), [colors]);
  const { registerTarget } = useOnboarding();
  const remindVoiceRef = useRef(null);
  const remindAskRef = useRef(null);

  const reportRemindCoach = useCallback(() => {
    const report = (ref, key) => {
      ref.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) registerTarget(key, { x, y, width: w, height: h });
      });
    };
    report(remindVoiceRef, 'remind.voiceToggle');
    report(remindAskRef, 'remind.askButton');
  }, [registerTarget]);

  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [personName, setPersonName] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceResponseEnabled, setVoiceResponseEnabled] = useState(true);

  useLayoutEffect(() => {
    reportRemindCoach();
    const t = setTimeout(reportRemindCoach, 120);
    const t2 = setTimeout(reportRemindCoach, 400);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [reportRemindCoach, isProcessing]);

  const applyExampleQuery = (text) => {
    setQuery(text);
  };

  const handleAsk = async () => {
    if (!query.trim()) {
      Alert.alert('Error', 'Please enter a question.');
      return;
    }

    setIsProcessing(true);
    setAnswer('');
    
    try {
      const result = await queryAPI.ask(query);
      setAnswer(result.answer);
      setPersonName(result.personName);
      
      // Speak the answer only if voice responses are enabled (strip markdown for TTS)
      if (voiceResponseEnabled) {
        setIsSpeaking(true);
        Speech.speak(stripMarkdownForSpeech(result.answer), { 
          language: 'en',
          onDone: () => setIsSpeaking(false),
          onStopped: () => setIsSpeaking(false),
          onError: () => setIsSpeaking(false),
        });
      }
    } catch (error) {
      console.error('Error processing query:', error);
      const errorMessage = error.response?.data?.error || 'Failed to process query';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setAnswer('');
    setPersonName(null);
    stopSpeech();
  };

  const stopSpeech = () => {
    Speech.stop();
    setIsSpeaking(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Stop Speech Button - appears when speaking */}
      {isSpeaking && (
        <TouchableOpacity
          style={styles.stopSpeechButton}
          onPress={stopSpeech}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Stop speaking"
        >
          <Ionicons
            name="stop-circle"
            size={24}
            color="white"
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={styles.stopSpeechText}>Stop Speaking</Text>
        </TouchableOpacity>
      )}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Ionicons
            name="chatbubbles"
            size={60}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={styles.title} accessibilityRole="header">
            Ask Thim about your Prayers
          </Text>
          
          {/* Voice Response Toggle — ref on control only so coach cutout matches pill size */}
          <TouchableOpacity
            ref={remindVoiceRef}
            collapsable={false}
            style={[styles.voiceToggle, voiceResponseEnabled && styles.voiceToggleActive]}
            onPress={() => {
              setVoiceResponseEnabled(!voiceResponseEnabled);
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={voiceResponseEnabled ? 'Voice responses on' : 'Voice responses off'}
            accessibilityHint="Toggle reading answers aloud"
            accessibilityState={{ selected: voiceResponseEnabled }}
          >
            <Ionicons
              name={voiceResponseEnabled ? 'volume-high' : 'volume-mute'}
              size={24}
              color={voiceResponseEnabled ? 'white' : colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={[styles.voiceToggleText, voiceResponseEnabled && styles.voiceToggleTextActive]}>
              {voiceResponseEnabled ? "Voice Responses On" : "Voice Responses Off"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            multiline
            numberOfLines={4}
            placeholder="e.g. When did I last pray for Lauren's job search?"
            placeholderTextColor={colors.placeholderText}
            value={query}
            onChangeText={setQuery}
            textAlignVertical="top"
            editable={!isProcessing}
            accessibilityLabel="Question for Thim"
            accessibilityHint="Ask about your people and prayer requests in plain language"
          />
        </View>

        <View style={styles.buttonContainer}>
          <View ref={remindAskRef} collapsable={false} style={styles.coachAskWrap}>
          <TouchableOpacity
            style={[styles.askButton, isProcessing && styles.askButtonDisabled]}
            onPress={handleAsk}
            disabled={isProcessing}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Ask Thim"
            accessibilityState={{ disabled: isProcessing }}
          >
            {isProcessing ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons
                  name="send"
                  size={24}
                  color="white"
                  style={styles.buttonIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.askButtonText}>Ask</Text>
              </>
            )}
          </TouchableOpacity>
          </View>

          {answer && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClear}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Clear question and answer"
            >
              <Ionicons
                name="close-circle"
                size={24}
                color={colors.textSecondary}
                style={styles.buttonIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {isProcessing && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.processingText}>Thim is thinking...</Text>
          </View>
        )}

        {answer && (
          <View style={styles.answerContainer}>
            {personName && (
              <View style={styles.personTag} accessibilityLabel={`Answer about ${personName}`}>
                <Ionicons
                  name="person"
                  size={16}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.personTagText}>{personName}</Text>
              </View>
            )}
            <View style={styles.answerBox}>
              <Ionicons
                name="chatbubble"
                size={24}
                color={colors.primary}
                style={styles.answerIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Markdown style={markdownStyles}>{answer}</Markdown>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors, shadow) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginTop: 15,
  },
  inputContainer: {
    marginBottom: 20,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    padding: 15,
    fontSize: 16,
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
  },
  buttonContainer: {
    gap: 10,
    marginBottom: 20,
  },
  coachAskWrap: {
    alignSelf: 'stretch',
  },
  askButton: {
    backgroundColor: colors.primary,
    padding: 18,
    borderRadius: RADIUS.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.button,
  },
  askButtonDisabled: {
    opacity: 0.6,
  },
  askButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  clearButton: {
    backgroundColor: colors.surface,
    padding: 15,
    borderRadius: RADIUS.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearButtonText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 10,
  },
  processingContainer: {
    alignItems: 'center',
    padding: 30,
  },
  processingText: {
    marginTop: 15,
    fontSize: 16,
    color: colors.textSecondary,
  },
  answerContainer: {
    marginBottom: 20,
  },
  personTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'flex-start',
    gap: 5,
  },
  personTagText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  answerBox: {
    backgroundColor: colors.surface,
    padding: 20,
    borderRadius: RADIUS.card,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    ...shadow.card,
  },
  answerIcon: {
    marginBottom: 10,
  },
  answerText: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  examplesContainer: {
    marginTop: 20,
  },
  examplesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  exampleButton: {
    backgroundColor: colors.surface,
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exampleText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  stopSpeechButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  stopSpeechText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  voiceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 15,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  voiceToggleActive: {
    backgroundColor: colors.primary,
  },
  voiceToggleText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  voiceToggleTextActive: {
    color: 'white',
  },
});
}

// Markdown styles so ## headers, **bold**, lists, etc. render correctly (not raw ## header)
function createMarkdownStyles(colors) {
  return StyleSheet.create({
  body: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  heading1: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
    lineHeight: 32,
  },
  heading2: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 14,
    marginBottom: 6,
    lineHeight: 28,
  },
  heading3: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 4,
    lineHeight: 26,
  },
  strong: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  em: {
    fontStyle: 'italic',
    color: colors.textPrimary,
  },
  link: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  bullet_list: {
    marginBottom: 8,
  },
  ordered_list: {
    marginBottom: 8,
  },
  list_item: {
    marginBottom: 4,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  code_inline: {
    backgroundColor: colors.surfaceMuted,
    fontFamily: undefined,
    fontSize: 15,
    color: colors.textPrimary,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  blockquote: {
    backgroundColor: colors.surfaceMuted,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    paddingLeft: 12,
    marginVertical: 8,
    marginLeft: 0,
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 16,
  },
});
}

