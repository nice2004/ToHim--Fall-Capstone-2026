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
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
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

function normalizeMarkdownForDisplay(text) {
  if (!text || typeof text !== 'string') return '';
  // Fix common "bullet immediately followed by bold" formatting like "-**Visa:**"
  // CommonMark expects "- **Visa:**"
  return text
    .replace(/^(\s*[-*+])(?=\S)/gm, '$1 ')
    .replace(/^(\s*\d+\.)(?=\S)/gm, '$1 ')
    .trim();
}

export default function PersonDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const markdownStyles = useMemo(() => createMarkdownStyles(colors), [colors]);
  const { personId } = route.params;
  const currentPersonId = String(personId);
  const [personData, setPersonData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferSession, setTransferSession] = useState(null);
  const [transferSearchQuery, setTransferSearchQuery] = useState('');
  const [transferPersons, setTransferPersons] = useState([]);
  const [isTransferring, setIsTransferring] = useState(false);

  const [editingSession, setEditingSession] = useState(null);
  const [editTranscript, setEditTranscript] = useState('');
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const [characterSummary, setCharacterSummary] = useState(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState(null);

  useEffect(() => {
    loadPersonData();
  }, [personId]);

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

  const openTransferModal = async (session) => {
    try {
      // Load all persons so user can choose a new one
      const data = await personAPI.getAll();
      // Exclude the current person from the list
      const others = (data.persons || []).filter((p) => String(p.id) !== currentPersonId);
      setTransferPersons(others);
      setTransferSession(session);
      setTransferSearchQuery('');
      setShowTransferModal(true);
    } catch (error) {
      console.error('Error loading persons for transfer:', error);
      Alert.alert('Error', 'Failed to load people for transfer');
    }
  };

  const openEditSessionModal = (session) => {
    // Show combined notes + transcript so the user edits the full visible content
    const combined = [session.notes, session.transcript]
      .filter((t) => typeof t === 'string' && t.trim().length > 0)
      .join('\n\n');
    setEditTranscript(combined);
    setEditingSession(session);
  };

  const handleSaveSession = async () => {
    if (!editingSession) return;
    setIsSavingSession(true);
    try {
      await sessionAPI.update(editingSession.id, {
        notes: editTranscript,
        transcript: editTranscript,
      });
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

  const handleTransferToPerson = async (targetPersonId) => {
    if (!transferSession || !targetPersonId) return;
    if (String(targetPersonId) === currentPersonId) {
      Alert.alert('Invalid Transfer', 'Please choose a different person.');
      return;
    }
    setIsTransferring(true);
    try {
      const result = await sessionAPI.transfer(transferSession.id, targetPersonId);
      if (result && result.success) {
        // Defensive verification: ensure session now appears under target person.
        const targetSessions = await sessionAPI.getByPerson(targetPersonId);
        const moved = (targetSessions?.sessions || []).some(
          (session) => String(session.id) === String(transferSession.id)
        );
        if (!moved) {
          throw new Error('Transfer completed but session was not found for the selected person.');
        }

        Alert.alert(
          'Prayer Request Transferred',
          `This prayer request was moved to ${result.newPerson?.full_name || 'the selected person'}.`,
          [
            {
              text: 'View Person',
              onPress: () => navigation.replace('PersonDetail', { personId: targetPersonId }),
            },
            { text: 'OK' },
          ]
        );
        setShowTransferModal(false);
        setTransferSession(null);
        setTransferSearchQuery('');
        // Reload this person's data so the session disappears from the list
        await loadPersonData();
      } else {
        Alert.alert('Error', 'Failed to transfer session');
      }
    } catch (error) {
      console.error('Error transferring session:', error);
      Alert.alert('Error', error.message || 'Failed to transfer session');
    } finally {
      setIsTransferring(false);
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

  return (
    <SafeAreaView style={styles.container}>
      {peopleBackBar}
      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scrollContent}>
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
            Added: {parseUtcTimestamp(person.created_at).toLocaleDateString()}
          </Text>
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
          <Ionicons name="add-circle" size={24} color={colors.primary} />
          <Text style={styles.actionButtonText}>Record New Prayer Request</Text>
        </TouchableOpacity>

        {sessions && sessions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Prayer Requests ({sessions.length})</Text>
            {sessions.map((session, index) => (
              <GlassSurface key={session.id} style={styles.sessionCard}>
                <View style={styles.sessionHeader}>
                  <Ionicons name="time" size={16} color="#666" />
                  <Text style={styles.sessionDate}>
                    {parseUtcTimestamp(session.created_at).toLocaleString()}
                  </Text>
                  <View style={styles.sessionActions}>
                    <TouchableOpacity
                      style={styles.transferButton}
                      onPress={() => openEditSessionModal(session)}
                    >
                      <Ionicons name="pencil" size={16} color={colors.primary} />
                      <Text style={styles.transferButtonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.transferButton, { marginLeft: 6 }]}
                      onPress={() => openTransferModal(session)}
                    >
                      <Ionicons name="swap-horizontal" size={18} color={colors.primary} />
                      <Text style={styles.transferButtonText}>Move</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {(() => {
                  const combined = [session.notes, session.transcript]
                    .filter((t) => typeof t === 'string' && t.trim().length > 0)
                    .join('\n\n');
                  if (!combined) return null;
                  return (
                    <Markdown style={markdownStyles}>
                      {normalizeMarkdownForDisplay(combined)}
                    </Markdown>
                  );
                })()}
              </GlassSurface>
            ))}
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

      {/* Transfer Session Modal */}
      <Modal
        visible={showTransferModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!isTransferring) {
            setShowTransferModal(false);
            setTransferSession(null);
            setTransferSearchQuery('');
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface style={styles.modalContent} intensity={52} strong>
            <Text style={styles.modalTitle}>Move Prayer Request to Another Person</Text>
            <Text style={styles.modalMessage}>
              Choose who this prayer request actually belongs to.
            </Text>

            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search people..."
                value={transferSearchQuery}
                onChangeText={setTransferSearchQuery}
                placeholderTextColor="#999"
                editable={!isTransferring}
              />
              {transferSearchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setTransferSearchQuery('')}
                  disabled={isTransferring}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={isTransferring ? '#ccc' : '#666'}
                  />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={{ maxHeight: 260 }}>
              {transferPersons
                .filter((p) => {
                  if (!transferSearchQuery.trim()) return true;
                  const q = transferSearchQuery.toLowerCase();
                  return (
                    p.full_name.toLowerCase().includes(q) ||
                    p.first_name?.toLowerCase().includes(q)
                  );
                })
                .map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.similarPersonCard}
                    onPress={() => handleTransferToPerson(p.id)}
                    disabled={isTransferring}
                  >
                    <Ionicons name="person" size={24} color={colors.primary} style={styles.personIcon} />
                    <View style={styles.personCardContent}>
                      <Text style={styles.similarPersonName}>{p.full_name}</Text>
                      <Text style={styles.similarPersonMatch}>Tap to move prayer request here</Text>
                    </View>
                  </TouchableOpacity>
                ))}

              {transferPersons.length === 0 && (
                <View style={styles.noResultsContainer}>
                  <Ionicons name="people-outline" size={48} color="#ccc" />
                  <Text style={styles.noResultsText}>No other people available</Text>
                  <Text style={styles.noResultsSubtext}>
                    Create another person first, then move the prayer request.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  if (!isTransferring) {
                    setShowTransferModal(false);
                    setTransferSession(null);
                    setTransferSearchQuery('');
                  }
                }}
                disabled={isTransferring}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </GlassSurface>
        </View>
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
                  <Text style={styles.modalTitle}>Edit Session</Text>
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
                    placeholder="Prayer request notes and transcript…"
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
    color: '#333',
    marginBottom: 5,
  },
  date: {
    fontSize: 14,
    color: '#666',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    padding: 15,
    borderRadius: RADIUS.button,
    marginBottom: 25,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  sessionCard: {
    padding: 15,
    borderRadius: RADIUS.card,
    marginBottom: 10,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 5,
  },
  sessionDate: {
    fontSize: 12,
    color: '#666',
  },
  sessionActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transferButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },
  transferButtonText: {
    marginLeft: 4,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  sessionNotes: {
    fontSize: 16,
    color: '#333',
    marginBottom: 10,
    fontWeight: '500',
  },
  sessionTranscript: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
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

// Markdown styles so ## headers, **bold**, lists, etc. render nicely in session transcripts
function createMarkdownStyles(colors) {
  return StyleSheet.create({
  body: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  heading1: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 6,
    lineHeight: 30,
  },
  heading2: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 10,
    marginBottom: 4,
    lineHeight: 26,
  },
  heading3: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 8,
    marginBottom: 2,
    lineHeight: 24,
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
    marginBottom: 6,
  },
  ordered_list: {
    marginBottom: 6,
  },
  bullet_list_icon: {
    marginLeft: 0,
    marginRight: 8,
  },
  bullet_list_content: {
    flex: 1,
  },
  ordered_list_icon: {
    marginLeft: 0,
    marginRight: 8,
  },
  ordered_list_content: {
    flex: 1,
  },
  list_item: {
    marginBottom: 2,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  code_inline: {
    backgroundColor: colors.surfaceMuted,
    fontFamily: undefined,
    fontSize: 14,
    color: colors.textPrimary,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  blockquote: {
    backgroundColor: colors.surfaceMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 10,
    marginVertical: 6,
    marginLeft: 0,
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 10,
  },
});
}

