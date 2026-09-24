import React, { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
  KeyboardAvoidingView,
  Modal,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { sessionAPI, personAPI } from '../services/api';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { tryBeginSessionAction, endSessionAction } from '../utils/sessionActionGuard';
import GlassSurface from '../components/GlassSurface';
import { useOnboarding } from '../onboarding/OnboardingContext';

const SESSION_FIRST_USE_PLACEHOLDER_KEY = 'session_screen_first_use_placeholder_seen';
const FIRST_SESSION_PLACEHOLDER =
  'Lauren is coming over in 3 weeks, She said she will reach out next friday with more details';

export default function SessionScreen({ route, navigation }) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => createStyles(colors, shadow), [colors, shadow]);
  const { registerTarget } = useOnboarding();
  const voiceCoachRef = useRef(null);
  const submitCoachRef = useRef(null);

  const personId = route?.params?.personId;
  const personName = route?.params?.personName;
  
  const [transcript, setTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [disambiguationData, setDisambiguationData] = useState(null);
  const [entityDisambiguationData, setEntityDisambiguationData] = useState(null);
  const [needsClarification, setNeedsClarification] = useState(false);
  const [clarificationPersonName, setClarificationPersonName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [allPersons, setAllPersons] = useState([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(null);
  const [sound, setSound] = useState(null);
  const [realTimeTranscript, setRealTimeTranscript] = useState('');
  const transcriptionIntervalRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');
  const scrollViewRef = useRef(null);
  const textInputRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  /** null = loading; true = show long example once; false = subsequent visits */
  const [showFirstUsePlaceholder, setShowFirstUsePlaceholder] = useState(null);
  const [lastSelection, setLastSelection] = useState({ start: 0, end: 0 });
  /** Blocks double-taps before React re-renders isSubmitting */
  const sessionActionInFlightRef = useRef(false);
  /** First cold TTS on iOS can report onDone too early; enforce min wait before opening mic */
  const voicePromptMinMsRef = useRef(4000); // first session only; then null (iOS TTS timing)
  /** Cold-start TTS can be silent on first utterance; prime once per screen mount */
  const ttsPrimedRef = useRef(false);
  const ttsPrimingInFlightRef = useRef(false);
  const speechVoiceRef = useRef(null);
  /** Guards first-use voice prompt callback flakiness on cold start */
  const promptFallbackTimerRef = useRef(null);
  const isStartingVoiceRef = useRef(false);
  
  const voiceRecognition = useVoiceRecognition();

  const reportSessionCoachTargets = useCallback(() => {
    const m = (ref, key) => {
      ref.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) registerTarget(key, { x, y, width: w, height: h });
      });
    };
    m(voiceCoachRef, 'session.voiceToggle');
    m(submitCoachRef, 'session.submit');
  }, [registerTarget]);

  useLayoutEffect(() => {
    reportSessionCoachTargets();
    const t = setTimeout(reportSessionCoachTargets, 100);
    const t2 = setTimeout(reportSessionCoachTargets, 350);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [reportSessionCoachTargets, voiceMode, isSubmitting]);
  
  // Debug: Log when needsClarification changes
  useEffect(() => {
    console.log('[SessionScreen] needsClarification state changed to:', needsClarification);
  }, [needsClarification]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const seen = await SecureStore.getItemAsync(SESSION_FIRST_USE_PLACEHOLDER_KEY);
          if (!cancelled) setShowFirstUsePlaceholder(seen !== 'true');
        } catch {
          if (!cancelled) setShowFirstUsePlaceholder(true);
        }
      })();
      return () => {
        cancelled = true;
        SecureStore.setItemAsync(SESSION_FIRST_USE_PLACEHOLDER_KEY, 'true').catch(() => {});
      };
    }, [])
  );

  const markSessionPlaceholderConsumed = useCallback(async () => {
    try {
      await SecureStore.setItemAsync(SESSION_FIRST_USE_PLACEHOLDER_KEY, 'true');
    } catch {}
    setShowFirstUsePlaceholder(false);
  }, []);

  // Only auto-scroll if user is typing at the end of the text
  const shouldAutoScroll = (selectionStart, textLength) => {
    // Auto-scroll if cursor is within last 50 characters or at the end
    return selectionStart >= textLength - 50 || selectionStart === textLength;
  };
  
  // Helper function to speak with tracking
  const speakWithTracking = async (text, options = {}) => {
    const { onDone, onStopped, onError, minPlaybackMsBeforeDone, ...restOptions } = options;
    const speakStartTime = Date.now();
    setIsSpeaking(true);

    Speech.stop();

    // Ensure TTS owns the audio session (first iOS utterance is often silent if session is ambiguous).
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });
    } catch (modeError) {
      console.warn('[SessionScreen] Could not switch to playback audio mode for TTS:', modeError);
    }

    if (Platform.OS === 'ios') {
      await new Promise((r) => setTimeout(r, 120));
    }

    await new Promise((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });

    const scheduleDone = (cb) => {
      if (minPlaybackMsBeforeDone != null) {
        const elapsed = Date.now() - speakStartTime;
        const wait = Math.max(0, minPlaybackMsBeforeDone - elapsed);
        setTimeout(cb, wait + 80);
      } else {
        cb();
      }
    };

    Speech.speak(text, {
      language: 'en-US',
      voice: speechVoiceRef.current || undefined,
      volume: 1,
      onDone: () => {
        scheduleDone(() => {
          setIsSpeaking(false);
          if (typeof onDone === 'function') onDone();
        });
      },
      onStopped: () => {
        setIsSpeaking(false);
        if (typeof onStopped === 'function') onStopped();
      },
      onError: (err) => {
        setIsSpeaking(false);
        if (typeof onError === 'function') onError(err);
      },
      ...restOptions,
    });
  };
  
  // Stop speech function
  const stopSpeech = () => {
    Speech.stop();
    setIsSpeaking(false);
  };

  const primeTtsIfNeeded = async () => {
    if (ttsPrimedRef.current || ttsPrimingInFlightRef.current) return;
    ttsPrimingInFlightRef.current = true;
    try {
      // Prime TTS with a near-silent short utterance so the first user-facing prompt is audible.
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        Speech.speak('ready', {
          language: 'en',
          volume: 0.01,
          rate: 1.0,
          onDone: finish,
          onStopped: finish,
          onError: finish,
        });
        setTimeout(finish, 1200);
      });
      ttsPrimedRef.current = true;
    } catch (err) {
      console.warn('[SessionScreen] TTS priming skipped due to error:', err);
    } finally {
      ttsPrimingInFlightRef.current = false;
    }
  };

  const initializeSpeechVoice = async () => {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      if (!Array.isArray(voices) || voices.length === 0) return;
      // Prefer iOS enhanced/en-US voices when available.
      const preferred =
        voices.find((v) => v.language === 'en-US' && v.quality === 'Enhanced') ||
        voices.find((v) => v.language === 'en-US') ||
        voices.find((v) => typeof v.language === 'string' && v.language.startsWith('en'));
      speechVoiceRef.current = preferred?.identifier || null;
      if (speechVoiceRef.current) {
        console.log('[SessionScreen] Using speech voice:', speechVoiceRef.current);
      }
    } catch (err) {
      console.warn('[SessionScreen] Could not load speech voices:', err?.message || err);
    }
  };
  
  // Initialize audio permissions
  useEffect(() => {
    (async () => {
      try {
        await AudioModule.requestRecordingPermissionsAsync();
        // Start in playback mode so the very first TTS prompt is clearly audible.
        // Recording mode will be enabled later by the voice recognition hook when actually listening.
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
        });
        await initializeSpeechVoice();
        await primeTtsIfNeeded();
      } catch (err) {
        console.error('[SessionScreen] Error requesting audio permissions:', err);
      }
    })();
    
    return () => {
      if (promptFallbackTimerRef.current) {
        clearTimeout(promptFallbackTimerRef.current);
        promptFallbackTimerRef.current = null;
      }
      // Cleanup on unmount
      if (sound) {
        sound.unloadAsync().catch(console.error);
      }
      if (recording) {
        recording.stopAndUnloadAsync().catch(console.error);
      }
      // Cleanup voice recognition
      voiceRecognition.cleanup().catch(console.error);
      // Stop real-time transcription
      stopRealTimeTranscription();
    };
  }, []);
  
  // Handle voice mode transcript updates
  useEffect(() => {
    if (voiceRecognition.transcript && voiceMode) {
      setTranscript(voiceRecognition.transcript);
    }
  }, [voiceRecognition.transcript, voiceMode]);
  
  // Update transcript with real-time transcription
  useEffect(() => {
    if (realTimeTranscript) {
      setTranscript(realTimeTranscript);
    }
  }, [realTimeTranscript]);
  
  // Cleanup transcription interval on unmount
  useEffect(() => {
    return () => {
      if (transcriptionIntervalRef.current) {
        clearInterval(transcriptionIntervalRef.current);
      }
    };
  }, []);
  
  // Real-time transcription function
  // Simplified: Just show a visual indicator, don't interrupt recording
  // We'll transcribe the full recording when user stops
  const startRealTimeTranscription = () => {
    // Just set a flag - we'll show "recording" indicator
    // Actual transcription happens when user stops recording
    console.log('[SessionScreen] Real-time transcription indicator started');
  };
  
  // Stop real-time transcription
  const stopRealTimeTranscription = () => {
    if (transcriptionIntervalRef.current) {
      clearInterval(transcriptionIntervalRef.current);
      transcriptionIntervalRef.current = null;
    }
  };
  
  // Voice recording handlers
  const startVoiceRecording = async () => {
    if (isStartingVoiceRef.current || isRecording) return;
    isStartingVoiceRef.current = true;
    try {
      // Clean up any existing recording first
      if (voiceRecognition.recording || voiceRecognition.isListening) {
        console.log('[SessionScreen] Cleaning up existing recording before starting new one');
        await voiceRecognition.stopListening();
        // Wait a bit to ensure cleanup completes
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      setVoiceMode(true);
      await primeTtsIfNeeded();
      const beginListeningOnce = async () => {
        if (isRecording || voiceRecognition.isListening) return;
        try {
          await voiceRecognition.startListening({ stopSpeechBeforeRecording: false });
          setIsRecording(true);
          startRealTimeTranscription();
          voicePromptMinMsRef.current = null;
        } finally {
          if (promptFallbackTimerRef.current) {
            clearTimeout(promptFallbackTimerRef.current);
            promptFallbackTimerRef.current = null;
          }
        }
      };

      const promptText = 'I\'m listening. Please share your prayer request.';
      const isFirstVoicePrompt = voicePromptMinMsRef.current != null;

      // Safety net: on some cold starts TTS callbacks can be delayed/missed.
      promptFallbackTimerRef.current = setTimeout(() => {
        beginListeningOnce().catch((err) => {
          console.error('[SessionScreen] Prompt fallback start failed:', err);
        });
      }, (voicePromptMinMsRef.current ?? 2500) + 2500);

      // iOS cold start can silently drop the first utterance after app restart.
      // For the first voice prompt only, do a brief warmup utterance first, then the real prompt.
      if (isFirstVoicePrompt) {
        speakWithTracking('Voice mode ready.', {
          minPlaybackMsBeforeDone: 1200,
          onDone: () => {
            speakWithTracking(promptText, {
              minPlaybackMsBeforeDone: voicePromptMinMsRef.current ?? undefined,
              onDone: beginListeningOnce,
              onStopped: beginListeningOnce,
              onError: () => {
                // Keep fallback timer alive; it will attempt listening.
              },
            });
          },
          onStopped: () => {
            speakWithTracking(promptText, {
              minPlaybackMsBeforeDone: voicePromptMinMsRef.current ?? undefined,
              onDone: beginListeningOnce,
              onStopped: beginListeningOnce,
              onError: () => {
                // Keep fallback timer alive; it will attempt listening.
              },
            });
          },
          onError: () => {
            // Fall back directly to the main prompt if warmup fails.
            speakWithTracking(promptText, {
              minPlaybackMsBeforeDone: voicePromptMinMsRef.current ?? undefined,
              onDone: beginListeningOnce,
              onStopped: beginListeningOnce,
              onError: () => {
                // Keep fallback timer alive; it will attempt listening.
              },
            });
          },
        });
      } else {
        speakWithTracking(promptText, {
          minPlaybackMsBeforeDone: voicePromptMinMsRef.current ?? undefined,
          onDone: beginListeningOnce,
          onStopped: beginListeningOnce,
          onError: () => {
            // Keep fallback timer alive; it will attempt listening.
          },
        });
      }
    } catch (error) {
      console.error('[SessionScreen] Error starting voice recording:', error);
      Alert.alert('Error', error.message || 'Failed to start voice recording. Please check microphone permissions.');
      setVoiceMode(false);
      setIsRecording(false);
      // Try to clean up on error
      try {
        await voiceRecognition.cleanup();
      } catch (cleanupError) {
        console.error('[SessionScreen] Error during cleanup:', cleanupError);
      }
    } finally {
      isStartingVoiceRef.current = false;
    }
  };
  
  const stopVoiceRecording = async () => {
    try {
      // Stop real-time transcription indicator
      stopRealTimeTranscription();
      
      // Ensure we have a recording before trying to stop
      if (!voiceRecognition.recording && !voiceRecognition.isListening) {
        console.log('[SessionScreen] No active recording to stop');
        setIsRecording(false);
        Alert.alert('No Recording', 'There was no active recording to stop.');
        return;
      }
      
      setIsRecording(false);
      
      // Stop the recording and get the URI (stopListening returns the URI)
      const recordingUri = await voiceRecognition.stopListening();
      
      // Wait a moment to ensure state is updated
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Also check the state in case stopListening didn't return it
      const uriFromState = voiceRecognition.recordingUri || recordingUri;
      
      if (!uriFromState) {
        console.error('[SessionScreen] No recording URI available after stopping');
        console.error('[SessionScreen] Recording state:', {
          hasRecording: !!voiceRecognition.recording,
          isListening: voiceRecognition.isListening,
          recordingUri: voiceRecognition.recordingUri,
          returnedUri: recordingUri
        });
        Alert.alert(
          'Recording Error', 
          'No audio was captured. This might happen if:\n• The recording was too short\n• There was an error during recording\n\nPlease try recording again and speak for at least a few seconds.'
        );
        return;
      }
      
      // Transcribe the complete recording
      setIsSubmitting(true); // Show loading state
      try {
        console.log('[SessionScreen] Starting transcription of recording:', uriFromState);
        const transcription = await voiceRecognition.transcribeAudio(uriFromState);
        
        if (transcription && transcription.trim()) {
          // Use the transcription
          setTranscript(transcription);
          setRealTimeTranscript(transcription);
          console.log('[SessionScreen] Transcription successful:', transcription.substring(0, 100) + '...');
          speakWithTracking('I heard: ' + transcription.substring(0, 100) + (transcription.length > 100 ? '...' : ''));
        } else {
          console.error('[SessionScreen] Transcription returned empty result');
          Speech.speak('Transcription failed. Please type what you said, or try recording again.', { language: 'en' });
          Alert.alert('...type your prayer request manually...');
        }
      } catch (error) {
        console.error('[SessionScreen] Error during transcription:', error);
        Speech.speak('Error transcribing audio. Please type what you said.', { language: 'en' });
        Alert.alert('Transcription Error', error.message || '...type your prayer request manually..');
      } finally {
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error('[SessionScreen] Error stopping voice recording:', error);
      setIsRecording(false);
      setIsSubmitting(false);
      Alert.alert('Error', error.message || 'Failed to stop voice recording.');
    }
  };
  
  const handleSubmit = async () => {
    // Dismiss keyboard
    Keyboard.dismiss();
    
    if (!transcript.trim()) {Please 
      Alert.alert('Error', 'Please enter your prayer request.');
      return;
    }

    if (!tryBeginSessionAction(sessionActionInFlightRef)) {
      return;
    }

    // Reset clarification state before submitting
    setNeedsClarification(false);
    setIsSubmitting(true);
    try {
      console.log('[SessionScreen] Submitting session...');
      const result = await sessionAPI.create(transcript, personName, disambiguationData?.selectedPersonId);
      console.log('[SessionScreen] Session API response:', JSON.stringify(result, null, 2));
      
      // Check if disambiguation is needed
      if (result.needsDisambiguation) {
        console.log('[SessionScreen] Disambiguation needed');
        // Load all persons for search
        try {
          const personsData = await personAPI.getAll();
          setAllPersons(personsData.persons || []);
        } catch (error) {
          console.error('[SessionScreen] Error loading persons for search:', error);
        }
        
        const disambiguationInfo = {
          extractedName: result.extractedName,
          similarPersons: result.similarPersons,
          message: result.message,
          transcript: transcript // Store transcript for resubmission
        };
        
        setDisambiguationData(disambiguationInfo);
        
        // Keep ambiguous-name confirmation in modal-only flow.
        if (voiceMode) {
          speakWithTracking('I found more than one matching person. Please select the correct person from the popup.');
        }
        return;
      }

      if (result.needsEntityDisambiguation) {
        const allEntities = result.entities || [];
        const resolvedEntities = allEntities
          .filter((e) => e.resolution !== 'ambiguous')
          .map((e) => ({
            ...e,
            selectedPersonId: e.personId || null,
            selectedName: e.resolution === 'create' ? e.personName : null,
          }));
        const ambiguousEntities = allEntities.filter((e) => e.resolution === 'ambiguous');
        setEntityDisambiguationData({
          transcript,
          entities: ambiguousEntities,
          resolvedEntities,
          index: 0,
        });
        return;
      }
      
      // The backend returns: { success: true, session, person, extractedInfo }
      // Check if we got a valid response (either success flag or person object)
      if (result && (result.success === true || result.person)) {
        await markSessionPlaceholderConsumed();
        const recordedPersonName = result.person?.full_name || personName || 'the person';
        const isBackgroundProcessing = result.processing === true;
        const isMultiEntity = result.multiEntity === true;
        
        console.log('[SessionScreen] Session created successfully for:', recordedPersonName);
        
        // Speak confirmation
        Speech.speak(
          isMultiEntity
            ? `Recorded ${result.createdCount || result.persons?.length || 2} entities successfully.`
            : 'Prayer request recorded successfully!',
          { language: 'en' }
        );
        
        // Clear the form and disambiguation data
        setTranscript('');
        setDisambiguationData(null);
        
        // Navigate back to previous screen
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          // If we can't go back, navigate to People tab
          navigation.navigate('People');
        }
        
        // Avoid blocking modal alerts when backend is still processing in background.
        if (!isBackgroundProcessing) {
          setTimeout(() => {
            Alert.alert(
              'Success! ✅',
              isMultiEntity
                ? `Session details were split across ${result.createdCount || result.persons?.length || 2} entities.`
                : `Prayer Request recorded for ${recordedPersonName}`,
              [{ text: 'OK' }]
            );
          }, 500);
        }
      } else {
        // Response doesn't have expected structure - but might still be successful
        console.warn('[SessionScreen] Unexpected response structure:', result);
        console.warn('[SessionScreen] Response keys:', result ? Object.keys(result) : 'null');
        
        // Even if structure is unexpected, try to navigate back
        await markSessionPlaceholderConsumed();
        setTranscript('');
        navigation.goBack();
        
        Alert.alert(
          'Prayer Request Submitted',
          'Your prayer request has been submitted. Please check the People tab to verify it was recorded.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('[SessionScreen] Error submitting session:', error);
      console.error('[SessionScreen] Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        fullError: JSON.stringify(error.response?.data, null, 2)
      });
      
      const errorMessage = error.message || error.response?.data?.error || error.response?.data?.details || 'Failed to record prayer request';
      const errorData = error.response?.data || {};
      
      // Check for needsClarification flag - check ALL possible locations
      // 1. Directly on error object (preserved by axios interceptor)
      // 2. In error.response.data
      // 3. In errorData
      const needsClarificationFromError = error.needsClarification === true;
      const needsClarificationFromResponse = error.response?.data?.needsClarification === true;
      const needsClarificationFromData = errorData.needsClarification === true;
      
      const hasNeedsClarificationFlag = needsClarificationFromError || needsClarificationFromResponse || needsClarificationFromData;
      const is400Error = error.response?.status === 400;
      const errorText = (errorMessage || '').toLowerCase();
      const errorDataString = JSON.stringify(errorData || {}).toLowerCase();
      const mentionsPersonIdentification = errorText.includes('could not identify') || 
                                           errorText.includes('specify the person') ||
                                           (errorText.includes('person') && (errorText.includes('name') || errorText.includes('identify'))) ||
                                           errorDataString.includes('could not identify') ||
                                           errorDataString.includes('specify the person');
      
      // Fallback: If it's a 400 error from session creation, always show clarification
      // This ensures we catch cases where the flag might not be set correctly
      const isSessionCreationError = error.config?.url?.includes('/sessions') || 
                                     error.config?.url?.includes('/session');
      const shouldShowClarification = hasNeedsClarificationFlag || 
                                     (is400Error && mentionsPersonIdentification) ||
                                     (is400Error && isSessionCreationError);
      
      console.log('[SessionScreen] Clarification check:', {
        needsClarificationFromError,
        needsClarificationFromResponse,
        needsClarificationFromData,
        hasNeedsClarificationFlag,
        is400Error,
        mentionsPersonIdentification,
        needsClarification,
        errorStatus: error.response?.status,
        errorMessage: errorMessage.substring(0, 100),
        errorData: JSON.stringify(errorData, null, 2),
        fullErrorResponse: JSON.stringify(error.response?.data, null, 2),
        isSessionCreationError,
        shouldShowClarification
      });
      
      if (shouldShowClarification) {
        console.log('[SessionScreen] Showing clarification modal');
        // Load all persons for selection
        try {
          const personsData = await personAPI.getAll();
          setAllPersons(personsData.persons || []);
          console.log('[SessionScreen] Loaded', personsData.persons?.length || 0, 'persons for clarification');
        } catch (loadError) {
          console.error('[SessionScreen] Error loading persons for clarification:', loadError);
          setAllPersons([]);
        }
        
        // Show clarification UI instead of alert
        // Transcript is already set, so we can use it when user selects/creates person
        console.log('[SessionScreen] Setting needsClarification to true');
        setNeedsClarification(true);
        console.log('[SessionScreen] needsClarification state set to true');
        
        // If in voice mode, speak the prompt
        if (voiceMode) {
          speakWithTracking('I was not able to identify a person from your entry. Please enter their name or select from existing people.');
        }
      } else {
        console.log('[SessionScreen] Not showing clarification, showing error alert instead');
        Alert.alert('Error', errorMessage);
      }
    } finally {
      setIsSubmitting(false);
      endSessionAction(sessionActionInFlightRef);
    }
  };
  
  const handleClarificationSubmit = async (selectedPersonId = null, newPersonName = null) => {
    if (!tryBeginSessionAction(sessionActionInFlightRef)) {
      return;
    }
    setIsSubmitting(true);
    try {
      let result;
      
      if (selectedPersonId) {
        // Use existing person
        result = await sessionAPI.create(transcript, null, selectedPersonId);
      } else if (newPersonName) {
        // Create new person with provided name
        result = await sessionAPI.create(transcript, newPersonName, null, true);
      } else {
        Alert.alert('Error', 'Please select a person or enter a name');
        setIsSubmitting(false);
        endSessionAction(sessionActionInFlightRef);
        return;
      }
      
      if (result && (result.success === true || result.person)) {
        await markSessionPlaceholderConsumed();
        const recordedPersonName = result.person?.full_name || newPersonName || 'the person';
        const isBackgroundProcessing = result.processing === true;
        const isMultiEntity = result.multiEntity === true;
        
        Speech.speak(
          isMultiEntity
            ? `Recorded ${result.createdCount || result.persons?.length || 2} entities successfully.`
            : 'Prayer request recorded successfully!',
          { language: 'en' }
        );
        
        // Clear everything
        setTranscript('');
        setDisambiguationData(null);
        setNeedsClarification(false);
        setClarificationPersonName('');
        setSearchQuery('');
        
        // Navigate back
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('People');
        }
        
        if (!isBackgroundProcessing) {
          setTimeout(() => {
            Alert.alert(
              'Success! ✅',
              isMultiEntity
                ? `Prayer request details were split across ${result.createdCount || result.persons?.length || 2} entities.`
                : `Prayer request recorded for ${recordedPersonName}`,
              [{ text: 'OK' }]
            );
          }, 500);
        }
      }
    } catch (error) {
      console.error('[SessionScreen] Error in clarification submit:', error);
      Alert.alert('Error', error.message || 'Failed to record prayer request');
    } finally {
      setIsSubmitting(false);
      endSessionAction(sessionActionInFlightRef);
    }
  };

  /**
   * Close disambiguation modal immediately, then run API (avoids duplicate taps while modal lingers).
   */
  const runDisambiguationChoice = async (runner) => {
    if (!tryBeginSessionAction(sessionActionInFlightRef)) {
      return;
    }
    const snap = disambiguationData;
    if (!snap) {
      endSessionAction(sessionActionInFlightRef);
      return;
    }
    setDisambiguationData(null);
    setSearchQuery('');
    setIsSubmitting(true);
    try {
      // Let the modal unmount paint before heavy work (reduces perceived lag / double taps).
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      await runner(snap);
    } catch (error) {
      console.error('[SessionScreen] Disambiguation choice error:', error);
      Alert.alert('Error', error.message || error.response?.data?.error || 'Failed to record prayer request');
    } finally {
      setIsSubmitting(false);
      endSessionAction(sessionActionInFlightRef);
    }
  };

  const resolveCurrentEntity = (updater) => {
    setEntityDisambiguationData((prev) => {
      if (!prev) return prev;
      const entities = [...prev.entities];
      const idx = prev.index;
      entities[idx] = updater(entities[idx]);
      return { ...prev, entities };
    });
  };

  const goToNextEntityOrSubmit = async () => {
    if (!entityDisambiguationData) return;
    const { index, entities, resolvedEntities = [] } = entityDisambiguationData;
    if (index < entities.length - 1) {
      setEntityDisambiguationData((prev) => ({ ...prev, index: prev.index + 1 }));
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = [...resolvedEntities, ...entities].map((e) => ({
        personName: e.personName,
        firstName: e.firstName,
        lastName: e.lastName,
        segment: e.segment,
        facts: e.facts || [],
        dates: e.dates || [],
        summary: e.summary || '',
        selectedPersonId: e.selectedPersonId || null,
        selectedName: e.selectedName || null,
      }));
      const result = await sessionAPI.resolveMulti(transcript, payload);
      if (result.success) {
        await markSessionPlaceholderConsumed();
        setEntityDisambiguationData(null);
        setTranscript('');
        Speech.speak(
          `Recorded ${result.createdCount || result.persons?.length || 2} entities successfully.`,
          { language: 'en' }
        );
        navigation.goBack();
      }
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to resolve entities');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentEntityStep = entityDisambiguationData
    ? entityDisambiguationData.entities[entityDisambiguationData.index]
    : null;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <ScrollView 
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={true}
            onScrollBeginDrag={() => setIsUserScrolling(true)}
            onScrollEndDrag={() => {
              setTimeout(() => setIsUserScrolling(false), 500);
            }}
            onMomentumScrollEnd={() => {
              setTimeout(() => setIsUserScrolling(false), 500);
            }}
          >
          <View style={styles.header}>
            <Ionicons
              name="mic-circle"
              size={60}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={styles.title} accessibilityRole="header">
              Record Prayer Request
            </Text>
            {personName && (
              <Text style={styles.personName}>For: {personName}</Text>
            )}
            
            {/* Voice Mode Toggle */}
            <View ref={voiceCoachRef} collapsable={false}>
            <TouchableOpacity
              style={[styles.voiceToggle, voiceMode && styles.voiceToggleActive]}
              accessibilityRole="button"
              accessibilityLabel={voiceMode ? 'Voice mode on' : 'Voice mode off'}
              accessibilityHint="Toggle voice recording and dictation for this prayer request"
              accessibilityState={{ selected: voiceMode }}
              onPress={async () => {
                // If turning voice mode OFF, make sure we fully exit any voice flows
                if (voiceMode) {
                  try {
                    // Stop any speech and listening so we don't stay stuck awaiting a voice response
                    stopSpeech();
                    if (promptFallbackTimerRef.current) {
                      clearTimeout(promptFallbackTimerRef.current);
                      promptFallbackTimerRef.current = null;
                    }
                    if (voiceRecognition.isListening || voiceRecognition.recording) {
                      await voiceRecognition.stopListening();
                    }
                  } catch (err) {
                    console.error('[SessionScreen] Error stopping voice on toggle:', err);
                  } finally {
                    setIsRecording(false);
                    voiceRecognition.clearTranscript();
                  }
                  setVoiceMode(false);
                } else {
                  // Turning voice mode ON
                  setVoiceMode(true);
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons
                name={voiceMode ? 'mic' : 'mic-outline'}
                size={24}
                color={voiceMode ? 'white' : colors.primary}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={[styles.voiceToggleText, voiceMode && styles.voiceToggleTextActive]}>
                {voiceMode ? "Voice Mode On" : "Voice Mode Off"}
              </Text>
            </TouchableOpacity>
            </View>
          </View>
          
          {/* Voice Recording Controls */}
          {voiceMode && (
            <View style={styles.voiceControls}>
              {!isRecording ? (
                <TouchableOpacity
                  style={styles.voiceRecordButton}
                  onPress={startVoiceRecording}
                  activeOpacity={0.9}
                  accessibilityRole="button"
                  accessibilityLabel="Start voice recording"
                >
                  <Ionicons
                    name="mic-circle"
                    size={40}
                    color="white"
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                  <Text style={styles.voiceRecordButtonText}>Start Recording</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.voiceRecordButton, styles.voiceRecordButtonStop]}
                  onPress={stopVoiceRecording}
                  activeOpacity={0.9}
                  accessibilityRole="button"
                  accessibilityLabel="Stop voice recording"
                >
                  <Ionicons
                    name="stop-circle"
                    size={40}
                    color="white"
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                  <Text style={styles.voiceRecordButtonText}>Stop Recording</Text>
                </TouchableOpacity>
              )}
              {isRecording && (
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingText}>Recording...</Text>
                </View>
              )}
            </View>
          )}
          
          <View style={styles.inputContainer}>
            <View style={styles.inputHeader}>
              <Text style={styles.label}>
                {voiceMode ? "Voice transcript will appear here in real-time, or type manually:" : "Describe your prayer request here"}
              </Text>
              <TouchableOpacity
                style={styles.dismissKeyboardButton}
                onPress={() => Keyboard.dismiss()}
                accessibilityRole="button"
                accessibilityLabel="Done editing"
                accessibilityHint="Dismiss the keyboard"
              >
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.textSecondary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.dismissKeyboardText}>Done</Text>
              </TouchableOpacity>
            </View>
            {isRecording && voiceMode && (
              <View style={styles.realTimeIndicator}>
                <View style={styles.realTimeDot} />
                <Text style={styles.realTimeText}>Recording... Speak now</Text>
              </View>
            )}
            {isSubmitting && voiceMode && (
              <View style={styles.realTimeIndicator}>
                <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.realTimeText}>Transcribing your recording...</Text>
              </View>
            )}
            <TextInput
              ref={textInputRef}
              style={styles.textInput}
              multiline
              placeholder={voiceMode 
                ? isRecording 
                  ? "Speaking... transcript will appear here as you talk..." 
                  : "Speak or type your interaction here..." 
                : showFirstUsePlaceholder === true
                  ? FIRST_SESSION_PLACEHOLDER
                  : ''}
              placeholderTextColor={colors.placeholderText}
              accessibilityLabel="Prayer request notes and transcript"
              accessibilityHint="Describe your prayer request. Include names, dates, and details you want to remember."
              value={transcript}
              onChangeText={(text) => {
                setTranscript(text);
                // Only auto-scroll if user is typing at the end
                if (shouldAutoScroll(lastSelection.start, text.length) && !isUserScrolling) {
                  setTimeout(() => {
                    if (scrollViewRef.current) {
                      scrollViewRef.current.scrollToEnd({ animated: true });
                    }
                  }, 100);
                }
              }}
              onSelectionChange={(event) => {
                const { start, end } = event.nativeEvent.selection;
                setLastSelection({ start, end });
                // Only auto-scroll if cursor is at the end
                if (shouldAutoScroll(start, transcript.length) && !isUserScrolling) {
                  setTimeout(() => {
                    if (scrollViewRef.current) {
                      scrollViewRef.current.scrollToEnd({ animated: true });
                    }
                  }, 100);
                }
              }}
              textAlignVertical="top"
              editable={!isSubmitting && !isRecording}
              returnKeyType="default"
              blurOnSubmit={false}
            />
          </View>

        <View style={styles.buttonContainer}>
          <View ref={submitCoachRef} collapsable={false} style={styles.coachSubmitWrap}>
          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Submit prayer request to Thim"
            accessibilityHint="Save this prayer request to Thim"
            accessibilityState={{ disabled: isSubmitting }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle"
                  size={24}
                  color="white"
                  style={styles.buttonIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.submitButtonText}>Submit</Text>
              </>
            )}
          </TouchableOpacity>
          </View>
        </View>

        <GlassSurface style={styles.infoBox}>
          <Ionicons
            name="bulb"
            size={20}
            color="#FFA500"
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={styles.infoText}>
            Include details like names, locations, dates, feelings, and any other
            important information you want to remember.
          </Text>
        </GlassSurface>
          </ScrollView>
        </KeyboardAvoidingView>
        
        {/* Clarification Modal - When person cannot be identified */}
        <Modal
          visible={needsClarification}
          transparent={true}
          animationType="fade"
          accessibilityViewIsModal={Platform.OS === 'ios'}
          onRequestClose={() => {
            if (!isSubmitting) {
              setNeedsClarification(false);
              setClarificationPersonName('');
              setSearchQuery('');
              setIsSubmitting(false);
            }
          }}
        >
          <View style={styles.modalOverlay}>
            <GlassSurface style={styles.modalContentClarification} intensity={52} strong>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle} accessibilityRole="header">
                  Person Not Identified
                </Text>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => {
                    if (!isSubmitting) {
                      setNeedsClarification(false);
                      setClarificationPersonName('');
                      setSearchQuery('');
                      setIsSubmitting(false);
                    }
                  }}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  accessibilityState={{ disabled: isSubmitting }}
                >
                  <Ionicons
                    name="close"
                    size={24}
                    color={isSubmitting ? '#ccc' : colors.textSecondary}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </TouchableOpacity>
              </View>
              
              <ScrollView 
                style={styles.modalScrollView}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={true}
              >
                <Text style={styles.modalMessage}>
                  I was not able to identify a person from your entry.
                </Text>
                <Text style={styles.modalSubtext}>
                  Enter their name to create a new person, or search and select from existing people.
                </Text>
                {/* Input for new person name */}
                <View style={styles.newPersonContainer}>
                  <Text style={styles.newPersonLabel}>Create New Person</Text>
                  <TextInput
                    style={styles.newPersonInput}
                    placeholder="e.g., John Smith"
                    placeholderTextColor={colors.placeholderText}
                    value={clarificationPersonName}
                    onChangeText={setClarificationPersonName}
                    autoCapitalize="words"
                    returnKeyType="done"
                    editable={!isSubmitting}
                    accessibilityLabel="New person full name"
                  />
                  <TouchableOpacity
                    style={[
                      styles.createPersonButton,
                      (!clarificationPersonName.trim() || isSubmitting) && styles.createPersonButtonDisabled
                    ]}
                    onPress={() => {
                      if (clarificationPersonName.trim()) {
                        handleClarificationSubmit(null, clarificationPersonName.trim());
                      }
                    }}
                    disabled={!clarificationPersonName.trim() || isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Create new person"
                    accessibilityState={{
                      disabled: !clarificationPersonName.trim() || isSubmitting,
                    }}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text style={styles.createPersonButtonText}>Create New Person</Text>
                    )}
                  </TouchableOpacity>
                </View>
                
                {/* Divider */}
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>OR</Text>
                  <View style={styles.dividerLine} />
                </View>
                
                {/* Search and select existing people */}
                <View style={styles.existingPeopleSection}>
                  <Text style={styles.existingPeopleTitle}>Select Existing Person</Text>
                  
                  {/* Search bar */}
                  <View style={styles.searchContainer}>
                    <Ionicons
                      name="search"
                      size={20}
                      color={colors.textSecondary}
                      style={styles.searchIcon}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search for existing person..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholderTextColor={colors.placeholderText}
                    returnKeyType="search"
                    editable={!isSubmitting}
                    accessibilityLabel="Search people"
                  />
                    {searchQuery.length > 0 && (
                      <TouchableOpacity 
                        onPress={() => setSearchQuery('')}
                        disabled={isSubmitting}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        accessibilityState={{ disabled: isSubmitting }}
                      >
                        <Ionicons
                          name="close-circle"
                          size={20}
                          color={isSubmitting ? '#ccc' : colors.textSecondary}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                  
                  {/* People list */}
                  <View style={styles.peopleListContainer}>
                    {searchQuery.length > 0 ? (
                      allPersons
                        .filter(person => 
                          person.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          person.first_name?.toLowerCase().includes(searchQuery.toLowerCase())
                        )
                        .length > 0 ? (
                          allPersons
                            .filter(person => 
                              person.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              person.first_name?.toLowerCase().includes(searchQuery.toLowerCase())
                            )
                            .map((person) => (
                              <TouchableOpacity
                                key={person.id}
                                style={styles.similarPersonCard}
                                onPress={() => handleClarificationSubmit(person.id, null)}
                                disabled={isSubmitting}
                                accessibilityRole="button"
                                accessibilityLabel={`Select ${person.full_name}`}
                                accessibilityHint="Use this person for the prayer request"
                              >
                                <Ionicons
                                  name="person"
                                  size={24}
                                  color={colors.primary}
                                  style={styles.personIcon}
                                  accessibilityElementsHidden
                                  importantForAccessibility="no"
                                />
                                <View style={styles.personCardContent}>
                                  <Text style={styles.similarPersonName}>{person.full_name}</Text>
                                  <Text style={styles.similarPersonMatch}>Tap to select</Text>
                                </View>
                              </TouchableOpacity>
                            ))
                        ) : (
                          <View style={styles.noResultsContainer}>
                            <Ionicons name="search-outline" size={48} color="#ccc" />
                            <Text style={styles.noResultsText}>No people found matching "{searchQuery}"</Text>
                            <Text style={styles.noResultsSubtext}>Try a different search term</Text>
                          </View>
                        )
                    ) : (
                      allPersons.length > 0 ? (
                        <>
                          <Text style={styles.listHeaderText}>
                            {allPersons.length} {allPersons.length === 1 ? 'person' : 'people'} found
                          </Text>
                          {allPersons.map((person) => (
                            <TouchableOpacity
                              key={person.id}
                              style={styles.similarPersonCard}
                              onPress={() => handleClarificationSubmit(person.id, null)}
                              disabled={isSubmitting}
                              accessibilityRole="button"
                              accessibilityLabel={`Select ${person.full_name}`}
                              accessibilityHint="Use this person for the prayer request"
                            >
                              <Ionicons
                                name="person"
                                size={24}
                                color={colors.primary}
                                style={styles.personIcon}
                                accessibilityElementsHidden
                                importantForAccessibility="no"
                              />
                              <View style={styles.personCardContent}>
                                <Text style={styles.similarPersonName}>{person.full_name}</Text>
                                <Text style={styles.similarPersonMatch}>Tap to select</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </>
                      ) : (
                        <View style={styles.noResultsContainer}>
                          <Ionicons name="people-outline" size={48} color="#ccc" />
                          <Text style={styles.noResultsText}>No existing people found</Text>
                          <Text style={styles.noResultsSubtext}>Create a new person above</Text>
                        </View>
                      )
                    )}
                  </View>
                </View>
              </ScrollView>
            </GlassSurface>
          </View>
        </Modal>
        
        {/* Multi-Entity Disambiguation Modal */}
        <Modal
          visible={!!entityDisambiguationData && !!currentEntityStep}
          transparent={true}
          animationType="none"
          presentationStyle="overFullScreen"
          accessibilityViewIsModal={Platform.OS === 'ios'}
          onRequestClose={() => {
            if (!isSubmitting) setEntityDisambiguationData(null);
          }}
        >
          {entityDisambiguationData && currentEntityStep && (
            <View style={styles.modalOverlay}>
              <GlassSurface style={styles.modalContent} intensity={52} strong>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle} accessibilityRole="header">
                    Resolve entity {entityDisambiguationData.index + 1} of {entityDisambiguationData.entities.length}
                  </Text>
                  <TouchableOpacity
                    style={styles.modalCloseButton}
                    onPress={() => {
                      if (!isSubmitting) setEntityDisambiguationData(null);
                    }}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    accessibilityState={{ disabled: isSubmitting }}
                  >
                    <Ionicons
                      name="close"
                      size={24}
                      color={isSubmitting ? '#ccc' : colors.textSecondary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalScrollView}>
                  <View style={styles.modalScrollContent}>
                    <Text style={styles.modalMessage}>
                      Found similar matches for: "{currentEntityStep.personName}"
                    </Text>
                    <Text style={styles.modalSubtext}>
                      Pick the correct person, or create a new one for this entity segment.
                    </Text>

                    <ScrollView style={styles.similarPersonsList}>
                      {(currentEntityStep.similarPersons || []).map((person) => (
                        <TouchableOpacity
                          key={person.id}
                          style={styles.similarPersonCard}
                          disabled={isSubmitting}
                          onPress={() => {
                            resolveCurrentEntity((entity) => ({
                              ...entity,
                              selectedPersonId: person.id,
                              selectedName: null,
                            }));
                            goToNextEntityOrSubmit();
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Match ${person.full_name}`}
                          accessibilityState={{ disabled: isSubmitting }}
                        >
                          <Text style={styles.similarPersonName}>{person.full_name}</Text>
                          <Text style={styles.similarPersonMatch}>
                            {Math.round(person.similarity * 100)}% match
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </ScrollView>
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSecondary]}
                    disabled={isSubmitting}
                    onPress={() => {
                      resolveCurrentEntity((entity) => ({
                        ...entity,
                        selectedPersonId: null,
                        selectedName: entity.personName,
                      }));
                      goToNextEntityOrSubmit();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Create new person for this entity"
                    accessibilityState={{ disabled: isSubmitting }}
                  >
                    <Text style={styles.modalButtonTextSecondary}>Create New Person</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => {
                      if (!isSubmitting) setEntityDisambiguationData(null);
                    }}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel entity resolution"
                    accessibilityState={{ disabled: isSubmitting }}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </GlassSurface>
            </View>
          )}
        </Modal>

        {/* Disambiguation Modal */}
        <Modal
          visible={!!disambiguationData}
          transparent={true}
          animationType="none"
          presentationStyle="overFullScreen"
          accessibilityViewIsModal={Platform.OS === 'ios'}
          onRequestClose={() => {
            if (!isSubmitting) {
              setDisambiguationData(null);
              setSearchQuery('');
            }
          }}
        >
          {disambiguationData && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle} accessibilityRole="header">
                    Is this the same person?
                  </Text>
                  <TouchableOpacity
                    style={styles.modalCloseButton}
                    onPress={() => {
                      if (!isSubmitting) {
                        setDisambiguationData(null);
                        setSearchQuery('');
                      }
                    }}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    accessibilityState={{ disabled: isSubmitting }}
                  >
                    <Ionicons
                      name="close"
                      size={24}
                      color={isSubmitting ? '#ccc' : colors.textSecondary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalScrollView}>
                  <View style={styles.modalScrollContent}>
                    <Text style={styles.modalMessage}>
                      Found similar name: "{disambiguationData.extractedName}"
                    </Text>
                    <Text style={styles.modalSubtext}>
                      {disambiguationData.message}
                    </Text>
                    
                    {/* Search bar for finding other people */}
                    <View style={styles.searchContainer}>
                      <Ionicons
                        name="search"
                        size={20}
                        color={colors.textSecondary}
                        style={styles.searchIcon}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search for a different person..."
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholderTextColor={colors.placeholderText}
                        accessibilityLabel="Search for a different person"
                      />
                      {searchQuery.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setSearchQuery('')}
                          accessibilityRole="button"
                          accessibilityLabel="Clear search"
                        >
                          <Ionicons
                            name="close-circle"
                            size={20}
                            color={colors.textSecondary}
                            accessibilityElementsHidden
                            importantForAccessibility="no"
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                    
                    <ScrollView style={styles.similarPersonsList}>
                      {/* Show search results if searching */}
                      {searchQuery.length > 0 ? (
                        allPersons
                          .filter(person => 
                            person.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            person.first_name?.toLowerCase().includes(searchQuery.toLowerCase())
                          )
                          .map((person) => (
                            <TouchableOpacity
                              key={person.id}
                              style={styles.similarPersonCard}
                              disabled={isSubmitting}
                              onPress={() =>
                                runDisambiguationChoice(async (snap) => {
                                  const result = await sessionAPI.create(
                                    snap.transcript,
                                    personName,
                                    person.id
                                  );
                                  if (result.success === true || result.person) {
                                    await markSessionPlaceholderConsumed();
                                    Speech.speak('Prayer request recorded successfully!', { language: 'en' });
                                    setTranscript('');
                                    navigation.goBack();
                                    setTimeout(() => {
                                      Alert.alert('Success! ✅', `Prayer request recorded for ${person.full_name}`, [
                                        { text: 'OK' },
                                      ]);
                                    }, 300);
                                  }
                                })
                              }
                              accessibilityRole="button"
                              accessibilityLabel={`Select ${person.full_name}`}
                              accessibilityHint="Use this person for the prayer request"
                              accessibilityState={{ disabled: isSubmitting }}
                            >
                              <Text style={styles.similarPersonName}>{person.full_name}</Text>
                              <Text style={styles.similarPersonMatch}>Existing person</Text>
                            </TouchableOpacity>
                          ))
                      ) : (
                        // Show similar persons if not searching
                        disambiguationData.similarPersons.map((person) => (
                          <TouchableOpacity
                            key={person.id}
                            style={styles.similarPersonCard}
                            disabled={isSubmitting}
                            onPress={() =>
                              runDisambiguationChoice(async (snap) => {
                                const result = await sessionAPI.create(
                                  snap.transcript,
                                  personName,
                                  person.id
                                );
                                if (result.success === true || result.person) {
                                  await markSessionPlaceholderConsumed();
                                  Speech.speak('Prayer request recorded successfully!', { language: 'en' });
                                  setTranscript('');
                                  navigation.goBack();
                                  setTimeout(() => {
                                    Alert.alert('Success! ✅', `Prayer request recorded for ${person.full_name}`, [
                                      { text: 'OK' },
                                    ]);
                                  }, 300);
                                }
                              })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`${person.full_name}, ${Math.round(person.similarity * 100)} percent similarity`}
                            accessibilityHint="Choose this person as the match"
                            accessibilityState={{ disabled: isSubmitting }}
                          >
                            <Text style={styles.similarPersonName}>{person.full_name}</Text>
                            <Text style={styles.similarPersonMatch}>
                              {Math.round(person.similarity * 100)}% match
                            </Text>
                          </TouchableOpacity>
                        ))
                      )}
                      {searchQuery.length > 0 && allPersons.filter(person => 
                        person.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        person.first_name?.toLowerCase().includes(searchQuery.toLowerCase())
                      ).length === 0 && (
                        <View style={styles.noResultsContainer}>
                          <Text style={styles.noResultsText}>No people found matching "{searchQuery}"</Text>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                </ScrollView>
                
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSecondary]}
                    disabled={isSubmitting}
                    onPress={() =>
                      runDisambiguationChoice(async (snap) => {
                        const result = await sessionAPI.create(
                          snap.transcript,
                          snap.extractedName,
                          null,
                          true
                        );
                        if (result.success === true || result.person) {
                          await markSessionPlaceholderConsumed();
                          Speech.speak('Prayer request recorded successfully!', { language: 'en' });
                          setTranscript('');
                          navigation.goBack();
                          setTimeout(() => {
                            Alert.alert(
                              'Success! ✅',
                              `Prayer request recorded for ${result.person?.full_name || snap.extractedName}`,
                              [{ text: 'OK' }]
                            );
                          }, 300);
                        }
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Create new person"
                    accessibilityState={{ disabled: isSubmitting }}
                  >
                    <Text style={styles.modalButtonTextSecondary}>Create New Person</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => {
                      if (!isSubmitting) {
                        setDisambiguationData(null);
                        setSearchQuery('');
                      }
                    }}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    accessibilityState={{ disabled: isSubmitting }}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </Modal>
      </SafeAreaView>
    </TouchableWithoutFeedback>
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
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.titleGray,
    marginTop: 15,
  },
  personName: {
    fontSize: 16,
    color: colors.primary,
    marginTop: 5,
    fontWeight: '500',
  },
  inputContainer: {
    marginBottom: 20,
    alignSelf: 'stretch',
  },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  dismissKeyboardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  dismissKeyboardText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    padding: 15,
    fontSize: 16,
    minHeight: 200,
    maxHeight: 400, // Limit max height so it can scroll internally
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    marginBottom: 20,
  },
  coachSubmitWrap: {
    alignSelf: 'stretch',
  },
  submitButton: {
    backgroundColor: colors.primary,
    padding: 18,
    borderRadius: RADIUS.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.button,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 10,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 15,
    borderRadius: 10,
    alignItems: 'flex-start',
    gap: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: RADIUS.modal,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
    ...shadow.card,
  },
  modalContentClarification: {
    borderRadius: RADIUS.modal,
    width: '90%',
    maxHeight: '85%',
    ...shadow.card,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalCloseButton: {
    padding: 5,
  },
  modalScrollView: {
    flexGrow: 0,
  },
  modalScrollContent: {
    padding: 20,
    paddingTop: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  modalMessage: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 5,
  },
  modalSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  similarPersonsList: {
    maxHeight: 200,
    marginBottom: 20,
  },
  similarPersonCard: {
    backgroundColor: colors.surfaceMuted,
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  personIcon: {
    marginRight: 12,
  },
  personCardContent: {
    flex: 1,
  },
  similarPersonName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  similarPersonMatch: {
    fontSize: 14,
    color: colors.primary,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonSecondary: {
    backgroundColor: colors.primary,
  },
  modalButtonCancel: {
    backgroundColor: '#f5f5f5',
  },
  modalButtonTextSecondary: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextCancel: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  noResultsContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResultsText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
  },
  noResultsSubtext: {
    fontSize: 14,
    color: '#ccc',
    marginTop: 8,
    textAlign: 'center',
  },
  existingPeopleSection: {
    marginTop: 10,
  },
  existingPeopleTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  peopleListContainer: {
    marginTop: 10,
  },
  listHeaderText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    fontWeight: '500',
  },
  voiceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
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
  voiceControls: {
    alignItems: 'center',
    marginBottom: 20,
  },
  voiceRecordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 30,
    ...shadow.button,
  },
  voiceRecordButtonStop: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
  },
  voiceRecordButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 16,
    color: '#FF3B30',
    fontWeight: '600',
  },
  realTimeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  realTimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginRight: 8,
  },
  realTimeText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  newPersonContainer: {
    marginBottom: 20,
  },
  newPersonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  newPersonInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    color: '#333',
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
  },
  createPersonButton: {
    backgroundColor: '#28a745',
    padding: 15,
    borderRadius: 24,
    alignItems: 'center',
  },
  createPersonButtonDisabled: {
    opacity: 0.5,
  },
  createPersonButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 15,
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  stopSpeechButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: '#FF3B30',
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
});
}

