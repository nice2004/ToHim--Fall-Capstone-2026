import { useState, useEffect, useRef } from 'react';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from 'expo-audio';
import { transcribeAPI } from '../services/api';

// Voice recognition hook using expo-audio for recording
// (migrated from expo-av, which was removed from Expo Go in SDK 55+)
// Audio is recorded and can be sent to backend for transcription
export function useVoiceRecognition() {
  // expo-audio uses a single persistent recorder instance for the
  // lifetime of the component, rather than creating a new Recording
  // object on every start (as expo-av did). We re-arm it with
  // prepareToRecordAsync() before each recording.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const [recordingUri, setRecordingUri] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const isStartingRef = useRef(false);

  const isListening = recorderState.isRecording;

  const startListening = async (options = {}) => {
    const { stopSpeechBeforeRecording = true } = options;

    if (isStartingRef.current || recorderState.isRecording) {
      console.log('[VoiceRecognition] Already recording or starting, ignoring call');
      return;
    }

    try {
      isStartingRef.current = true;
      setError(null);
      setTranscript('');

      // Usually stop in-progress TTS before recording to avoid transcribing it.
      // For first voice prompt on iOS cold-start we intentionally skip this so we don't cut the prompt.
      if (stopSpeechBeforeRecording) {
        try {
          // Lazy import keeps this hook decoupled when no TTS stop is needed.
          const Speech = require('expo-speech');
          Speech.stop();
        } catch (speechError) {
          console.warn('[VoiceRecognition] Could not stop TTS before recording:', speechError?.message || speechError);
        }
      }

      // Request permissions
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Microphone permission was denied');
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      console.log('[VoiceRecognition] Recording started');
    } catch (err) {
      console.error('[VoiceRecognition] Error starting recognition:', err);
      setError(err.message);
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopListening = async () => {
    try {
      if (!recorderState.isRecording) {
        console.log('[VoiceRecognition] No recording to stop');
        return null;
      }

      console.log('[VoiceRecognition] Stopping recording...');
      await audioRecorder.stop();

      const uri = audioRecorder.uri || null;
      console.log('[VoiceRecognition] Recording stopped, URI:', uri);

      if (uri) {
        setRecordingUri(uri);
      } else {
        console.warn('[VoiceRecognition] No URI available - recording may have been too short or failed');
      }

      return uri;
    } catch (err) {
      console.error('[VoiceRecognition] Error stopping recording:', err);
      setError(err.message);
      return null;
    }
  };

  // Cleanup function to ensure recording is properly stopped
  const cleanup = async () => {
    try {
      if (recorderState.isRecording) {
        await audioRecorder.stop();
      }
    } catch (err) {
      console.log('[VoiceRecognition] Error during cleanup:', err?.message || err);
    }
    setRecordingUri(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRecorder && recorderState.isRecording) {
        audioRecorder.stop().catch(console.error);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transcribeAudio = async (audioUri, appendToTranscript = false) => {
    try {
      setIsTranscribing(true);
      console.log('[VoiceRecognition] Transcribing audio:', audioUri);

      // Send audio to backend for transcription using OpenAI Whisper
      const result = await transcribeAPI.transcribe(audioUri);

      if (result.success && result.transcript) {
        console.log('[VoiceRecognition] Transcription successful:', result.transcript.substring(0, 100) + '...');

        if (appendToTranscript) {
          // Append to existing transcript
          setTranscript(prev => {
            const newText = prev ? prev + ' ' + result.transcript : result.transcript;
            return newText;
          });
        } else {
          // Replace transcript
          setTranscript(result.transcript);
        }

        return result.transcript;
      } else {
        console.warn('[VoiceRecognition] No transcript in response');
        return null;
      }
    } catch (error) {
      console.error('[VoiceRecognition] Error transcribing audio:', error);
      setError(error.message || 'Failed to transcribe audio');
      return null;
    } finally {
      setIsTranscribing(false);
    }
  };

  // Get current recording status for real-time transcription.
  // Kept async to preserve the original call signature; expo-audio's
  // recorder state is actually reactive (via useAudioRecorderState above),
  // so this just returns the latest snapshot.
  const getRecordingStatus = async () => {
    if (!recorderState.isRecording) return null;
    return recorderState;
  };

  const clearTranscript = () => {
    setTranscript('');
    setError(null);
    setRecordingUri(null);
  };

  return {
    isListening,
    transcript,
    error,
    // Truthy while actively recording, mirroring the old expo-av
    // Recording-object-as-truthy-flag pattern that the rest of the
    // app checks against (e.g. `if (voiceRecognition.recording)`).
    recording: recorderState.isRecording ? audioRecorder : null,
    recordingUri,
    isTranscribing,
    startListening,
    stopListening,
    transcribeAudio,
    getRecordingStatus,
    clearTranscript,
    cleanup,
    setTranscript, // Allow manual setting
  };
}
