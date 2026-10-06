import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { personAPI, sessionAPI } from '../services/api';
import {
  cachePersonDetail,
  cachePersonSummary,
  getCachedPersonDetail,
  getCachedPersonSummary,
} from '../services/localDb';
import { getLastSyncAt } from '../services/syncService';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';
import { getRequestNote } from '../utils/prayerText';

const ANSWERED_COLOR = '#34C759';

// SQLite stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC with no timezone marker.
// Without explicit 'Z', JS (V8 / Hermes) parses space-separated strings as LOCAL time,
// showing the raw UTC digits as if they were local — wrong for any non-UTC device.
// Appending 'Z' forces correct UTC interpretation; toLocaleString then converts to local time.
function parseUtcTimestamp(str) {
  if (!str) return new Date();
  const s = String(str).trim();
  // Already has timezone info — let JS handle it
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  // Convert SQLite format "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ"
  return new Date(s.replace(' ', 'T') + 'Z');
}

// Plain-text preview for the note cards: the full markdown lives on the detail screen,
// so here we just flatten headings/emphasis and turn list markers into bullets.
function toPlainPreview(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/^(\s*)[-*+]\s*/gm, '$1• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatShortDate(str) {
  return parseUtcTimestamp(str).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatNoteDate(str) {
  const d = parseUtcTimestamp(str);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${formatShortDate(str)} · ${time}`;
}

export default function PersonDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { personId } = route.params;
  const [personData, setPersonData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [answeringSession, setAnsweringSession] = useState(null);
  const [answeredNoteInput, setAnsweredNoteInput] = useState('');
  const [isSavingAnswered, setIsSavingAnswered] = useState(false);

  const [editingSession, setEditingSession] = useState(null);
  const [editTranscript, setEditTranscript] = useState('');
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const [characterSummary, setCharacterSummary] = useState(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState(null);

  // Runs on initial mount and again whenever this screen regains focus
  // (e.g. returning from the prayer request detail screen), so
  // answered-status and verse changes made there show up here.
  useFocusEffect(
    React.useCallback(() => {
      loadPersonData();
    }, [personId])
  );

  const peopleBackBar = (
    <View style={styles.topNavBar}>
      <TouchableOpacity
        style={styles.backNavButton}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Back to People"
      >
        <Ionicons name="chevron-back" size={24} color={colors.primary} />
        <Text style={styles.backNavLabel}>People</Text>
      </TouchableOpacity>
    </View>
  );

  const loadPersonData = async () => {
    try {
      const data = await personAPI.getById(personId);
      setPersonData(data);
      await cachePersonDetail(personId, data);
      setOfflineNotice(null);
      // Initialize edit fields
      if (data && data.person) {
        const nameParts = data.person.full_name.split(' ');
        setEditFirstName(nameParts[0] || '');
        setEditLastName(nameParts.slice(1).join(' ') || '');
        setEditFullName(data.person.full_name);
      }
    } catch (error) {
      console.error('Error loading person data:', error);
      const cached = await getCachedPersonDetail(personId);
      if (cached?.person) {
        setPersonData(cached);
        const lastSyncAt = await getLastSyncAt();
        setOfflineNotice(
          lastSyncAt
            ? `Offline data shown (last synced ${new Date(lastSyncAt).toLocaleString()})`
            : 'Offline data shown'
        );
      } else {
        Alert.alert('Error', 'Failed to load person data');
      }
    } finally {
      setLoading(false);
    }
    // Fetch character summary independently so it doesn't block the rest of the UI
    loadCharacterSummary();
  };

  const loadCharacterSummary = async () => {
    setIsSummaryLoading(true);
    try {
      const result = await personAPI.getSummary(personId);
      setCharacterSummary(result.summary || null);
      await cachePersonSummary(personId, result.summary || null);
    } catch (error) {
      console.warn('Could not load character summary:', error.message);
      const cachedSummary = await getCachedPersonSummary(personId);
      setCharacterSummary(cachedSummary);
    } finally {
      setIsSummaryLoading(false);
    }
  };
  
  const handleEdit = () => {
    if (personData && personData.person) {
      const nameParts = personData.person.full_name.split(' ');
      setEditFirstName(nameParts[0] || '');
      setEditLastName(nameParts.slice(1).join(' ') || '');
      setEditFullName(personData.person.full_name);
      setIsEditing(true);
    }
  };
  
  const handleSave = async () => {
    if (!editFullName.trim() && !editFirstName.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }
    
    setIsSaving(true);
    try {
      const fullName = editFullName.trim() || `${editFirstName.trim()} ${editLastName.trim()}`.trim();
      const firstName = editFirstName.trim() || fullName.split(' ')[0];
      const lastName = editLastName.trim() || (fullName.split(' ').length > 1 ? fullName.split(' ').slice(1).join(' ') : '');
      
      const result = await personAPI.update(personId, firstName, lastName, fullName);
      
      if (result.success && result.person) {
        // Update local state
        setPersonData(prev => ({
          ...prev,
          person: result.person
        }));
        setIsEditing(false);
        Keyboard.dismiss();
        Alert.alert('Success', 'Name updated successfully');
      } else {
        throw new Error('Failed to update person');
      }
    } catch (error) {
      console.error('Error updating person:', error);
      Alert.alert('Error', error.message || 'Failed to update person name');
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleCancel = () => {
    setIsEditing(false);
    Keyboard.dismiss();
    // Reset to original values
    if (personData && personData.person) {
      const nameParts = personData.person.full_name.split(' ');
      setEditFirstName(nameParts[0] || '');
      setEditLastName(nameParts.slice(1).join(' ') || '');
      setEditFullName(personData.person.full_name);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await personAPI.delete(personId);
      Alert.alert('Success', 'Person deleted successfully', [
        {
          text: 'OK',
          onPress: () => {
            // Navigate back to people list
            navigation.goBack();
          }
        }
      ]);
    } catch (error) {
      console.error('Error deleting person:', error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to delete person');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const applySessionUpdate = (updated) => {
    setPersonData((prev) => {
      if (!prev?.sessions) return prev;
      return {
        ...prev,
        sessions: prev.sessions.map((s) =>
          String(s.id) === String(updated.id) ? { ...s, ...updated } : s
        ),
      };
    });
  };

  const openAnsweredModal = (session) => {
    setAnsweredNoteInput('');
    setAnsweringSession(session);
  };

  const confirmMarkAnswered = async () => {
    if (!answeringSession) return;
    setIsSavingAnswered(true);
    try {
      const result = await sessionAPI.markAnswered(answeringSession.id, {
        answered: true,
        answeredNote: answeredNoteInput.trim() || undefined,
      });
      applySessionUpdate({ id: answeringSession.id, answered: true, ...result?.session });
      setAnsweringSession(null);
      Keyboard.dismiss();
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to mark prayer request as answered');
    } finally {
      setIsSavingAnswered(false);
    }
  };

  const confirmMarkUnanswered = (session) => {
    Alert.alert('Mark as unanswered?', 'This moves the request back to your active prayers.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark unanswered',
        onPress: async () => {
          try {
            const result = await sessionAPI.markAnswered(session.id, { answered: false });
            applySessionUpdate({ id: session.id, answered: false, ...result?.session });
          } catch (error) {
            Alert.alert('Error', error.message || 'Failed to update prayer request');
          }
        },
      },
    ]);
  };

  // VerseSearch saves the verse itself; this screen reloads on focus when it returns.
  const openAddVerse = (session) => {
    navigation.navigate('VerseSearch', { sessionId: session.id });
  };

  const openEditSessionModal = (session) => {
    // Edit the note shown on the card. The original transcript is left as recorded —
    // writing the combined text into both fields is what made content appear twice.
    setEditTranscript(getRequestNote(session));
    setEditingSession(session);
  };

  const handleSaveSession = async () => {
    if (!editingSession) return;
    setIsSavingSession(true);
    try {
      await sessionAPI.update(editingSession.id, { notes: editTranscript });
      setEditingSession(null);
      setEditTranscript('');
      // Don't block UI on a refresh request; if this hangs/fails it can trap the user in the modal.
      // Refresh in the background so navigation remains responsive.
      Promise.resolve()
        .then(() => loadPersonData())
        .catch((refreshErr) => {
          console.warn('[PersonDetail] Post-save refresh failed:', refreshErr?.message || refreshErr);
        });
    } catch (error) {
      console.error('Error saving session:', error);
      Alert.alert('Error', error.message || 'Failed to save prayer request');
    } finally {
      setIsSavingSession(false);
    }
  };

  const confirmDeleteSession = () => {
    if (!editingSession) return;
    Alert.alert(
      'Delete prayer request',
      'Remove this prayer request and any calendar events tied to it? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void handleDeleteSession();
          },
        },
      ]
    );
  };

  const handleDeleteSession = async () => {
    if (!editingSession) return;
    setIsDeletingSession(true);
    try {
      await sessionAPI.delete(editingSession.id);
      setEditingSession(null);
      setEditTranscript('');
      // Same rationale as save: refresh in background so UI can't get stuck.
      Promise.resolve()
        .then(() => loadPersonData())
        .catch((refreshErr) => {
          console.warn('[PersonDetail] Post-delete refresh failed:', refreshErr?.message || refreshErr);
        });
    } catch (error) {
      const msg =
        error.response?.data?.details ||
        error.response?.data?.error ||
        error.message ||
        'Failed to delete prayer request';
      Alert.alert('Error', msg);
    } finally {
      setIsDeletingSession(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete Person',
      `Are you sure you want to delete ${personData?.person?.full_name}? This will also delete all their prayer requests and stored information. This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => setShowDeleteConfirm(false)
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: handleDelete
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        {peopleBackBar}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!personData || !personData.person) {
    return (
      <SafeAreaView style={styles.container}>
        {peopleBackBar}
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Person not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { person, sessions, metadata } = personData;
  const answeredCount = (sessions || []).filter((s) => s.answered).length;
  const activeCount = (sessions || []).length - answeredCount;

  return (
    <SafeAreaView style={styles.container}>
      {peopleBackBar}
      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
      >
        <GlassSurface style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {person.first_name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.nameContainer}>
            <Text style={styles.name}>{person.full_name}</Text>
            <TouchableOpacity 
              style={styles.editButton}
              onPress={handleEdit}
            >
              <Ionicons name="pencil" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.date}>
            Added {formatShortDate(person.created_at)}
          </Text>
          {sessions && sessions.length > 0 && (
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{sessions.length}</Text>
                <Text style={styles.statLabel}>Requests</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{activeCount}</Text>
                <Text style={styles.statLabel}>Active</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: ANSWERED_COLOR }]}>{answeredCount}</Text>
                <Text style={styles.statLabel}>Answered</Text>
              </View>
            </View>
          )}
        </GlassSurface>
        {offlineNotice && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#665200" />
            <Text style={styles.offlineBannerText}>{offlineNotice}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('NewSession', { 
            personId: person.id, 
            personName: person.full_name 
          })}
        >
          <Ionicons name="mic" size={22} color="white" />
          <Text style={styles.actionButtonText}>Record New Prayer Request</Text>
        </TouchableOpacity>

        {sessions && sessions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Prayer Requests</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{sessions.length}</Text>
              </View>
            </View>
            {sessions.map((session) => {
              const isAnswered = !!session.answered;
              const accentColor = isAnswered ? ANSWERED_COLOR : colors.primary;
              const preview = toPlainPreview(getRequestNote(session));
              const verses = session.verses || [];
              const openDetail = () =>
                navigation.navigate('PrayerRequestDetail', {
                  session,
                  personId: person.id,
                  personName: person.full_name,
                });

              return (
                <GlassSurface key={session.id} style={styles.noteCard}>
                  <View style={[styles.noteAccent, { backgroundColor: accentColor }]} />
                  <View style={styles.noteInner}>
                    <View style={styles.noteHeader}>
                      <View style={styles.statusLabel}>
                        <Ionicons
                          name={isAnswered ? 'checkmark-circle' : 'ellipse'}
                          size={isAnswered ? 15 : 9}
                          color={accentColor}
                        />
                        <Text style={[styles.statusLabelText, { color: accentColor }]}>
                          {isAnswered ? 'ANSWERED' : 'ACTIVE'}
                        </Text>
                      </View>
                      <Text style={styles.noteDate} numberOfLines={1}>
                        {formatNoteDate(session.created_at)}
                      </Text>
                      <TouchableOpacity
                        style={styles.noteIconButton}
                        onPress={() => openEditSessionModal(session)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Edit prayer request"
                      >
                        <Ionicons name="create-outline" size={19} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity activeOpacity={0.6} onPress={openDetail}>
                      {preview ? (
                        <Text style={styles.noteBody} numberOfLines={6}>
                          {preview}
                        </Text>
                      ) : (
                        <Text style={styles.noteEmpty}>No details recorded.</Text>
                      )}
                      <View style={styles.readMoreRow}>
                        <Text style={styles.readMoreText}>View full request</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                      </View>
                    </TouchableOpacity>

                    {isAnswered && session.answered_note ? (
                      <View style={styles.answeredNoteBox}>
                        <Text style={styles.answeredNoteLabel}>How it was answered</Text>
                        <Text style={styles.answeredNoteText} numberOfLines={3}>
                          {session.answered_note}
                        </Text>
                      </View>
                    ) : null}

                    {verses.length > 0 && (
                      <View style={styles.verseChips}>
                        {verses.map((verse) => (
                          <View key={verse.id} style={styles.verseChip}>
                            <Ionicons name="book" size={12} color={colors.primary} />
                            <Text style={styles.verseChipText}>{verse.reference}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={styles.noteDivider} />

                    <View style={styles.noteActions}>
                      <TouchableOpacity
                        style={[
                          styles.noteActionButton,
                          isAnswered ? styles.unanswerActionButton : styles.answerActionButton,
                        ]}
                        onPress={() =>
                          isAnswered ? confirmMarkUnanswered(session) : openAnsweredModal(session)
                        }
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={isAnswered ? 'Mark as unanswered' : 'Mark as answered'}
                      >
                        <Ionicons
                          name={isAnswered ? 'arrow-undo' : 'checkmark-circle'}
                          size={18}
                          color={isAnswered ? colors.textSecondary : 'white'}
                        />
                        <Text
                          style={[
                            styles.noteActionText,
                            { color: isAnswered ? colors.textSecondary : 'white' },
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.8}
                        >
                          {isAnswered ? 'Undo Answered' : 'Mark Answered'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.noteActionButton, styles.verseActionButton]}
                        onPress={() => openAddVerse(session)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Add a Bible verse"
                      >
                        <Ionicons name="book" size={17} color={colors.primary} />
                        <Text
                          style={[styles.noteActionText, { color: colors.primary }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.8}
                        >
                          Add Verse
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </GlassSurface>
              );
            })}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.summaryHeader}>
            <Text style={styles.sectionTitle}>Character Summary</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={loadCharacterSummary}
              disabled={isSummaryLoading}
            >
              <Ionicons
                name="refresh"
                size={18}
                color={isSummaryLoading ? '#ccc' : colors.primary}
              />
            </TouchableOpacity>
          </View>
          <GlassSurface style={styles.summaryCard}>
            {isSummaryLoading ? (
              <View style={styles.summaryLoadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.summaryLoadingText}>Generating summary…</Text>
              </View>
            ) : characterSummary ? (
              <Text style={styles.summaryText}>{characterSummary}</Text>
            ) : (
              <Text style={styles.summaryEmptyText}>
                No summary available yet. Record some prayer requests to get started.
              </Text>
            )}
          </GlassSurface>
        </View>

        {(!sessions || sessions.length === 0) && (!metadata || metadata.length === 0) && (
          <View style={styles.emptySection}>
            <Ionicons name="document-outline" size={50} color="#ccc" />
            <Text style={styles.emptyText}>No prayer request recorded yet</Text>
            <Text style={styles.emptySubtext}>
              Tap "Record New Prayer Request" to add information about this person
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={confirmDelete}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator color="#FF3B30" />
          ) : (
            <>
              <Ionicons name="trash" size={24} color="#FF3B30" />
              <Text style={styles.deleteButtonText}>Delete Person</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
      
      {/* Edit Name Modal */}
      <Modal
        visible={isEditing}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface style={styles.modalContent} intensity={52} strong>
            <Text style={styles.modalTitle}>Edit Name</Text>
            
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={editFullName}
                onChangeText={setEditFullName}
                placeholder="Enter full name"
                autoFocus={true}
              />
            </View>
            
            <View style={styles.inputRow}>
              <View style={[styles.inputContainer, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.inputLabel}>First Name</Text>
                <TextInput
                  style={styles.input}
                  value={editFirstName}
                  onChangeText={setEditFirstName}
                  placeholder="First name"
                />
              </View>
              <View style={[styles.inputContainer, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Last Name</Text>
                <TextInput
                  style={styles.input}
                  value={editLastName}
                  onChangeText={setEditLastName}
                  placeholder="Last name"
                />
              </View>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={handleCancel}
                disabled={isSaving}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.modalButtonTextSave}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </GlassSurface>
        </View>
      </Modal>

      {/* Mark Answered Modal */}
      <Modal
        visible={!!answeringSession}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!isSavingAnswered) setAnsweringSession(null);
        }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <GlassSurface style={styles.modalContent} intensity={52} strong>
                <View style={styles.answeredModalIcon}>
                  <Ionicons name="checkmark-circle" size={44} color={ANSWERED_COLOR} />
                </View>
                <Text style={styles.modalTitle}>Mark as answered?</Text>
                <Text style={styles.inputLabel}>How was it answered? (optional)</Text>
                <TextInput
                  style={[styles.input, styles.answeredInput]}
                  value={answeredNoteInput}
                  onChangeText={setAnsweredNoteInput}
                  placeholder="e.g. She got the job!"
                  placeholderTextColor={colors.placeholderText}
                  multiline
                  textAlignVertical="top"
                  editable={!isSavingAnswered}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => setAnsweringSession(null)}
                    disabled={isSavingAnswered}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: ANSWERED_COLOR }]}
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

      {/* Edit Prayer Request Modal */}
      <Modal
        visible={!!editingSession}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!isSavingSession && !isDeletingSession) {
            Keyboard.dismiss();
            setEditingSession(null);
            setEditTranscript('');
          }
        }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <GlassSurface style={[styles.modalContent, { maxHeight: '85%' }]} intensity={52} strong>
                {/* Header row with title and Done button to dismiss keyboard */}
                <View style={styles.editModalHeader}>
                  <Text style={styles.modalTitle}>Edit Prayer Request</Text>
                  <View style={styles.editHeaderActions}>
                    <TouchableOpacity
                      onPress={Keyboard.dismiss}
                      style={styles.keyboardDoneButton}
                      accessibilityRole="button"
                      accessibilityLabel="Done"
                      accessibilityHint="Dismiss the keyboard"
                      disabled={isSavingSession || isDeletingSession}
                      accessibilityState={{ disabled: isSavingSession || isDeletingSession }}
                    >
                      <Text style={styles.keyboardDoneText}>Done</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSaveSession}
                      style={[
                        styles.headerSaveButton,
                        (isSavingSession || isDeletingSession) && styles.headerSaveButtonDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Save"
                      accessibilityHint="Save your edits"
                      disabled={isSavingSession || isDeletingSession}
                      accessibilityState={{ disabled: isSavingSession || isDeletingSession }}
                    >
                      {isSavingSession ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.headerSaveButtonText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
                {editingSession && (
                  <Text style={styles.modalMessage}>
                    {parseUtcTimestamp(editingSession.created_at).toLocaleString()}
                  </Text>
                )}
                <ScrollView
                  style={styles.editSessionScroll}
                  contentContainerStyle={styles.editSessionScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  <TextInput
                    style={styles.editSessionInput}
                    multiline
                    value={editTranscript}
                    onChangeText={setEditTranscript}
                    placeholder="What are you praying for?"
                    textAlignVertical="top"
                    editable={!isSavingSession && !isDeletingSession}
                    scrollEnabled={false}
                  />
                  <TouchableOpacity
                    style={styles.editSessionDeleteRow}
                    onPress={confirmDeleteSession}
                    disabled={isSavingSession || isDeletingSession}
                    activeOpacity={0.7}
                  >
                    {isDeletingSession ? (
                      <ActivityIndicator color="#FF3B30" />
                    ) : (
                      <>
                        <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                        <Text style={styles.editSessionDeleteText}>Delete prayer request</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonCancel]}
                      onPress={() => {
                        if (!isSavingSession && !isDeletingSession) {
                          Keyboard.dismiss();
                          setEditingSession(null);
                          setEditTranscript('');
                        }
                      }}
                      disabled={isSavingSession || isDeletingSession}
                    >
                      <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonSave]}
                      onPress={handleSaveSession}
                      disabled={isSavingSession || isDeletingSession}
                    >
                      {isSavingSession ? (
                        <ActivityIndicator color="white" />
                      ) : (
                        <Text style={styles.modalButtonTextSave}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </ScrollView>
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topNavBar: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  backNavLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginLeft: 2,
  },
  scrollFlex: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#666',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 25,
    padding: 25,
    borderRadius: RADIUS.card,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    backgroundColor: '#FFF4CC',
    borderColor: '#E6D48A',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  offlineBannerText: {
    flex: 1,
    color: '#665200',
    fontSize: 12,
    fontWeight: '500',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  avatarText: {
    color: 'white',
    fontSize: 36,
    fontWeight: 'bold',
  },
  name: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 5,
  },
  date: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: colors.border,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    padding: 15,
    borderRadius: RADIUS.button,
    marginBottom: 28,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 8,
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  countBadge: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.chip,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  // Each prayer request reads like a separate note: colored edge on the left,
  // a small header line, the text, then its actions along the bottom.
  noteCard: {
    flexDirection: 'row',
    borderRadius: 16,
    marginBottom: 16,
  },
  noteAccent: {
    width: 5,
  },
  noteInner: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusLabelText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  noteDate: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 10,
  },
  noteIconButton: {
    padding: 4,
    marginLeft: 6,
  },
  noteBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  noteEmpty: {
    fontSize: 14,
    fontStyle: 'italic',
    color: colors.textSecondary,
  },
  readMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  readMoreText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginRight: 2,
  },
  answeredNoteBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(52, 199, 89, 0.12)',
  },
  answeredNoteLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: ANSWERED_COLOR,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  answeredNoteText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  verseChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  verseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.chip,
    backgroundColor: colors.primarySoft,
  },
  verseChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  noteDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: 14,
    marginBottom: 12,
  },
  noteActions: {
    flexDirection: 'row',
    gap: 10,
  },
  noteActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: RADIUS.button,
  },
  answerActionButton: {
    backgroundColor: ANSWERED_COLOR,
  },
  unanswerActionButton: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  verseActionButton: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  noteActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  answeredModalIcon: {
    alignItems: 'center',
    marginBottom: 6,
  },
  answeredInput: {
    minHeight: 80,
    marginBottom: 16,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  refreshButton: {
    padding: 4,
  },
  summaryCard: {
    padding: 18,
    borderRadius: RADIUS.card,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  summaryText: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
  },
  summaryLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryLoadingText: {
    fontSize: 14,
    color: '#999',
  },
  summaryEmptyText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  emptySection: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 15,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 10,
    textAlign: 'center',
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
  },
  editButton: {
    marginLeft: 10,
    padding: 5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: RADIUS.modal,
    padding: 25,
    width: '90%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  inputContainer: {
    marginBottom: 15,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    color: '#333',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 24,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f5f5f5',
  },
  editSessionDeleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 10,
  },
  editSessionDeleteText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
  editSessionInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#333',
    backgroundColor: colors.surfaceMuted,
    minHeight: 200,
    marginVertical: 12,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  editHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  keyboardDoneButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  keyboardDoneText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  headerSaveButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSaveButtonDisabled: {
    opacity: 0.6,
  },
  headerSaveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  editSessionScroll: {
    flexGrow: 0,
  },
  editSessionScrollContent: {
    paddingBottom: 4,
  },
  modalButtonSave: {
    backgroundColor: colors.primary,
  },
  modalButtonTextCancel: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextSave: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 12,
    marginBottom: 25,
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  deleteButtonText: {
    color: '#FF3B30',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
});
}
