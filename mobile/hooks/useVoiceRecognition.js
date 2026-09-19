import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { transcribeAPI } from '../services/api';

// Voice recognition hook using expo-av for recording
// Audio is recorded and can be sent to backend for transcription
export function useVoiceRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(null);
  const [recordingUri, setRecordingUri] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  
  // Use a ref to track the actual recording object for reliable cleanup
  const recordingRef = useRef(null);
  const isCleaningUpRef = useRef(false);

  // Helper function to properly clean up a recording object
  const cleanupRecording = async (recordingToCleanup) => {
    if (!recordingToCleanup) return;
    
    try {
      const status = await recordingToCleanup.getStatusAsync();
      if (status.isRecording) {
        await recordingToCleanup.stopAndUnloadAsync();
      } else {
        // If not recording, try to unload
        try {
          await recordingToCleanup.unloadAsync();
        } catch (unloadError) {
          // If unload fails, try stopAndUnload anyway
          try {
            await recordingToCleanup.stopAndUnloadAsync();
          } catch (stopError) {
            console.log('[VoiceRecognition] Could not clean up recording:', stopError.message);
          }
        }
      }
    } catch (cleanupError) {
      console.log('[VoiceRecognition] Error during cleanup:', cleanupError.message);
      // Try one more time with stopAndUnloadAsync
      try {
        await recordingToCleanup.stopAndUnloadAsync();
      } catch (finalError) {
        console.log('[VoiceRecognition] Final cleanup attempt failed:', finalError.message);
      }
    }
  };

  const startListening = async (options = {}) => {
    const { stopSpeechBeforeRecording = true } = options;
    // Prevent concurrent calls
    if (isCleaningUpRef.current) {
      console.log('[VoiceRecognition] Cleanup in progress, waiting...');
      // Wait for cleanup to complete
      let waitCount = 0;
      while (isCleaningUpRef.current && waitCount < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
    }
    
    try {
      setError(null);
      isCleaningUpRef.current = true;
      
      // IMPORTANT: Stop and clean up any existing recording first
      // Check both state and ref to be sure
      const existingRecording = recordingRef.current || recording;
      if (existingRecording) {
        console.log('[VoiceRecognition] Cleaning up existing recording before starting new one');
        await cleanupRecording(existingRecording);
        
        // Wait a bit to ensure the Recording object is fully released
        // expo-av needs time to release the internal "prepared" state
        await new Promise(resolve => setTimeout(resolve, 200));
        
        recordingRef.current = null;
        setRecording(null);
        setRecordingUri(null);
      }
      
      isCleaningUpRef.current = false;
      setIsListening(true);
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
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Start recording with a known-good high quality preset.
      // This uses .m4a with AAC on both iOS and Android and is battle-tested in expo-av.
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      recordingRef.current = newRecording;
      setRecording(newRecording);
      console.log('[VoiceRecognition] Recording started');
      
    } catch (err) {
      isCleaningUpRef.current = false;
      console.error('[VoiceRecognition] Error starting recognition:', err);
      setError(err.message);
      setIsListening(false);
      
      // If error is about "only one Recording", try to clean up and retry once
      if (err.message && err.message.includes('Only one Recording')) {
        console.log('[VoiceRecognition] Detected Recording conflict, attempting cleanup and retry...');
        try {
          const existingRecording = recordingRef.current || recording;
          if (existingRecording) {
            await cleanupRecording(existingRecording);
            await new Promise(resolve => setTimeout(resolve, 500));
            recordingRef.current = null;
            setRecording(null);
          }
          
          // Retry once after cleanup
          await new Promise(resolve => setTimeout(resolve, 300));
          const { recording: retryRecording } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          recordingRef.current = retryRecording;
          setRecording(retryRecording);
          setIsListening(true);
          console.log('[VoiceRecognition] Recording started after retry');
        } catch (retryError) {
          console.error('[VoiceRecognition] Retry also failed:', retryError);
          setError('Failed to start recording. Please try again.');
        }
      }
    }
  };

  const stopListening = async () => {
    try {
      const recordingToStop = recordingRef.current || recording;
      if (!recordingToStop) {
        console.log('[VoiceRecognition] No recording to stop');
        setIsListening(false);
        return null;
      }
      
      setIsListening(false);
      
      let uri = null;

      try {
        console.log('[VoiceRecognition] Stopping and unloading recording...');
        await recordingToStop.stopAndUnloadAsync();
        console.log('[VoiceRecognition] Recording stopped & unloaded');

        try {
          uri = recordingToStop.getURI();
          console.log('[VoiceRecognition] Got recording URI after stopAndUnloadAsync:', uri);
        } catch (uriError) {
          console.error('[VoiceRecognition] Error getting URI after stopAndUnloadAsync:', uriError);
          // Try alternative properties just in case
          try {
            // @ts-ignore - internal/exposed on some SDK versions
            uri = recordingToStop._uri || recordingToStop.uri;
            console.log('[VoiceRecognition] Got URI via alternative method:', uri);
          } catch (altError) {
            console.error('[VoiceRecognition] Alternative URI method also failed:', altError);
          }
        }
      } catch (stopError) {
        console.error('[VoiceRecognition] Error in stopAndUnloadAsync:', stopError);
        // As a last resort, try to get whatever URI is available
        try {
          uri = recordingToStop.getURI();
          console.log('[VoiceRecognition] Got URI after stop error:', uri);
        } catch (uriError) {
          console.error('[VoiceRecognition] Could not get URI after stop error:', uriError);
        }
      }
      
      // Set URI and clear recording reference
      if (uri) {
        setRecordingUri(uri);
        console.log('[VoiceRecognition] Recording URI stored:', uri);
      } else {
        console.warn('[VoiceRecognition] No URI available - recording may have been too short or failed');
      }
      
      // Clear both state and ref
      recordingRef.current = null;
      setRecording(null);
      
      return uri;
      
    } catch (err) {
      console.error('[VoiceRecognition] Error stopping recording:', err);
      setError(err.message);
      setIsListening(false);
      recordingRef.current = null;
      setRecording(null);
      return null;
    }
  };
  
  // Cleanup function to ensure recording is properly stopped
  const cleanup = async () => {
    const recordingToCleanup = recordingRef.current || recording;
    if (recordingToCleanup) {
      await cleanupRecording(recordingToCleanup);
      recordingRef.current = null;
      setRecording(null);
      setRecordingUri(null);
    }
    setIsListening(false);
    isCleaningUpRef.current = false;
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Only use ref in cleanup to avoid stale closure issues
      if (recordingRef.current) {
        cleanupRecording(recordingRef.current).catch(console.error);
      }
    };
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
  
  // Get current recording status for real-time transcription
  const getRecordingStatus = async () => {
    const currentRecording = recordingRef.current || recording;
    if (!currentRecording) return null;
    try {
      return await currentRecording.getStatusAsync();
    } catch (error) {
      console.error('[VoiceRecognition] Error getting recording status:', error);
      return null;
    }
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
    recording,
    recordingUri,
    isTranscribing,
    startListening,
    stopListening,
    transcribeAudio,
    getRecordingStatus,
    clearTranscript,
    cleanup, // Export cleanup function
    setTranscript, // Allow manual setting
  };
}
