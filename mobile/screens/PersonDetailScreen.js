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
  Platform,
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
import ActionSheet from '../components/ActionSheet';
import { getRequestNote } from '../utils/prayerText';
import { formatShortDay } from '../utils/journal';

const ANSWERED_COLOR = '#34C759';
// Scripture and answered-prayer words are set in a serif to feel quoted, not typed.
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: undefined });

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

/** "Nov 12" this year, "Nov 12, 2025" otherwise. */
function formatCardDate(str) {
  const d = parseUtcTimestamp(str);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "7 October" this year, "7 October 2025" otherwise. */
function formatLongDay(str) {
  const d = parseUtcTimestamp(str);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** One flowing paragraph for a short card preview. */
function toOneParagraph(text) {
  return toPlainPreview(text).replace(/\s*\n+\s*/g, ' ').trim();
}

/**
 * A preview of about `max` characters that never stops mid-thought: it ends at the last whole
 * sentence that fits, or — when the first sentence alone is longer — at a word, followed by "…".
 * @returns {{ text: string, truncated: boolean }}
 */
function previewOf(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return { text: t, truncated: false };
  const head = t.slice(0, max + 1);
  let lastEnd = -1;
  for (const m of head.matchAll(/[.!?]["”’)]*(?=\s)/g)) lastEnd = m.index + m[0].length;
  if (lastEnd >= max * 0.45) return { text: t.slice(0, lastEnd), truncated: true };
  const space = head.lastIndexOf(' ', max);
  const cut = t.slice(0, space > 0 ? space : max).replace(/[\s,;:—–-]+$/, '');
  return { text: `${cut}…`, truncated: true };
}

// Preview lengths (characters) that keep a card to a few lines.
const PREVIEW = { request: 150, answer: 140, asked: 90, verse: 110, reflection: 160, about: 220 };

const byNewest = (field) => (a, b) =>
  parseUtcTimestamp(b[field] || b.created_at) - parseUtcTimestamp(a[field] || a.created_at);

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

  const [personMenuOpen, setPersonMenuOpen] = useState(false);
  const [sessionMenu, setSessionMenu] = useState(null); // the request whose "⋯" menu is open
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // cards opened with "Read more"

  // Runs on initial mount and again whenever this screen regains focus
  // (e.g. returning from the prayer request detail screen), so
  // answered-status and verse changes made there show up here.
  useFocusEffect(
    React.useCallback(() => {
      loadPersonData();
    }, [personId])
  );

  const renderBackBar = (withMenu = false) => (
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
      {withMenu ? (
        // Editing the name and deleting the person are rare, so they live here instead of on the page.
        <TouchableOpacity
          style={styles.navMenuButton}
          onPress={() => setPersonMenuOpen(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          disabled={isDeleting}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${personData?.person?.full_name || 'this person'}`}
        >
          {isDeleting ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Ionicons name="ellipsis-horizontal-circle-outline" size={26} color={colors.primary} />
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
  const peopleBackBar = renderBackBar(false);

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

  const { person, sessions, reflections } = personData;
  const allSessions = sessions || [];
  // Active prayers first (newest first), then answered ones (most recently answered first).
  // Derived on every render, so marking answered/unanswered moves a request right away.
  const activeSessions = allSessions.filter((s) => !s.answered).sort(byNewest('created_at'));
  const answeredSessions = allSessions.filter((s) => !!s.answered).sort(byNewest('answered_at'));
  const firstName = person.first_name || person.full_name.split(' ')[0];

  const openDetail = (session) =>
    navigation.navigate('PrayerRequestDetail', {
      session,
      personId: person.id,
      personName: person.full_name,
    });

  const toggleExpanded = (id) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Verses quoted under the prayer, so scripture reads as part of it rather than a link.
   * Collapsed: the first verse, previewed. Expanded: every verse in full.
   */
  const verseBlock = (verses, answered, expanded) => {
    if (!verses.length) return { node: null, truncated: false };
    const shown = expanded ? verses : verses.slice(0, 1);
    let truncated = !expanded && verses.length > 1;
    const node = shown.map((verse, i) => {
      const full = (verse.verse_text || '').trim();
      const preview = expanded ? { text: full, truncated: false } : previewOf(full, PREVIEW.verse);
      truncated = truncated || preview.truncated;
      const more = !expanded && verses.length > 1 ? `  ·  +${verses.length - 1} more` : '';
      return (
        <View key={verse.id || i} style={[styles.verse, answered && styles.verseAnswered]}>
          {preview.text ? <Text style={styles.verseText}>{preview.text}</Text> : null}
          <Text style={[styles.verseReference, answered && { color: ANSWERED_COLOR }]}>
            {verse.reference}
            {more}
          </Text>
        </View>
      );
    });
    return { node, truncated };
  };

  const renderReadMore = (session, expanded, answered) => (
    <TouchableOpacity
      style={styles.readMore}
      onPress={() => toggleExpanded(session.id)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Show less' : 'Read more'}
    >
      <Text style={[styles.readMoreText, answered && { color: ANSWERED_COLOR }]}>
        {expanded ? 'Show less' : 'Read more'}
      </Text>
      <Ionicons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={14}
        color={answered ? ANSWERED_COLOR : colors.primary}
      />
    </TouchableOpacity>
  );

  const renderMoreButton = (session) => (
    <TouchableOpacity
      style={styles.requestMore}
      onPress={() => setSessionMenu(session)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="More actions for this prayer request"
    >
      <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  // Active prayer: what you're asking for, with its verse beneath. Quiet and readable.
  // Previews end on a whole sentence; "Read more" opens the rest in place, and tapping the card
  // still opens the full request.
  const renderActiveCard = (session) => {
    const expanded = expandedIds.has(session.id);
    const full = toOneParagraph(getRequestNote(session));
    const body = expanded ? { text: full, truncated: false } : previewOf(full, PREVIEW.request);
    const verses = verseBlock(session.verses || [], false, expanded);
    const canExpand = expanded || body.truncated || verses.truncated;
    const since = formatCardDate(session.created_at);
    return (
      <GlassSurface key={session.id} style={styles.requestCard}>
        {/* ToHim blue edge and a soft glow (the Prayer Journal card's touch) give active prayers
            their own identity, the way green marks answered ones. */}
        <View style={styles.activeAccent} pointerEvents="none" />
        <View style={styles.activeGlow} pointerEvents="none" />
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => openDetail(session)}
          accessibilityRole="button"
          accessibilityLabel={`Prayer request, ${since}. ${full}`}
          accessibilityHint="Opens the full prayer request"
        >
          <View style={styles.requestHeader}>
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>{since}</Text>
            </View>
          </View>
          <Text style={styles.requestBody}>{body.text || 'No details recorded.'}</Text>
          {verses.node}
        </TouchableOpacity>
        {canExpand ? renderReadMore(session, expanded, false) : null}
        {renderMoreButton(session)}
      </GlassSurface>
    );
  };

  // Answered prayer: the answer is the headline and the original request becomes "what you
  // asked" — a moment to look back on, not a status change.
  const renderAnsweredCard = (session) => {
    const expanded = expandedIds.has(session.id);
    const request = toOneParagraph(getRequestNote(session));
    const answer = (session.answered_note || '').trim();
    const answeredOn = formatCardDate(session.answered_at || session.created_at);
    const pick = (text, max) => (expanded ? { text, truncated: false } : previewOf(text, max));
    const answerPart = answer ? pick(answer, PREVIEW.answer) : null;
    const requestPart = pick(request, answer ? PREVIEW.asked : PREVIEW.request);
    const verses = verseBlock(session.verses || [], true, expanded);
    const canExpand = expanded || answerPart?.truncated || requestPart.truncated || verses.truncated;
    return (
      <View key={session.id} style={styles.answeredCard}>
        <View style={styles.answeredGlow} pointerEvents="none" />
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => openDetail(session)}
          accessibilityRole="button"
          accessibilityLabel={`Answered ${answeredOn}. ${answer || request}`}
          accessibilityHint="Opens the full prayer request"
        >
          <View style={styles.requestHeader}>
            <Ionicons name="sparkles" size={14} color={ANSWERED_COLOR} style={styles.answeredIcon} />
            <Text style={[styles.requestEyebrow, { color: ANSWERED_COLOR }]}>Answered {answeredOn}</Text>
          </View>
          {answerPart ? (
            <>
              <Text style={styles.answerText}>“{answerPart.text}”</Text>
              <Text style={styles.askedText}>
                <Text style={styles.askedLabel}>You asked  </Text>
                {requestPart.text || 'No details recorded.'}
              </Text>
            </>
          ) : (
            <Text style={styles.requestBody}>{requestPart.text || 'No details recorded.'}</Text>
          )}
          {verses.node}
        </TouchableOpacity>
        {canExpand ? renderReadMore(session, expanded, true) : null}
        {renderMoreButton(session)}
      </View>
    );
  };

  const renderRequestCard = (session) =>
    session.answered ? renderAnsweredCard(session) : renderActiveCard(session);

  const sessionMenuOptions = sessionMenu
    ? [
        { label: 'View full request', icon: 'document-text-outline', onPress: () => openDetail(sessionMenu) },
        sessionMenu.answered
          ? { label: 'Mark as unanswered', icon: 'arrow-undo-outline', onPress: () => confirmMarkUnanswered(sessionMenu) }
          : { label: 'Mark as answered', icon: 'checkmark-circle-outline', onPress: () => openAnsweredModal(sessionMenu) },
        { label: 'Add a verse', icon: 'book-outline', onPress: () => openAddVerse(sessionMenu) },
        { label: 'Edit', icon: 'create-outline', onPress: () => openEditSessionModal(sessionMenu) },
      ]
    : [];

  return (
    <SafeAreaView style={styles.container}>
      {renderBackBar(true)}
      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
      >
        {offlineNotice && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#665200" />
            <Text style={styles.offlineBannerText}>{offlineNotice}</Text>
          </View>
        )}

        {/* Who you're praying for: a small initial beside their name. The prayers come right after. */}
        <View style={styles.profile}>
          <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.avatarText}>{person.first_name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.name} accessibilityRole="header" numberOfLines={2}>
              {person.full_name}
            </Text>
            <Text style={styles.since}>{formatLongDay(person.created_at)}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.recordButton}
          onPress={() => navigation.navigate('NewSession', {
            personId: person.id,
            personName: person.full_name,
          })}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Record a new prayer request for ${person.full_name}`}
        >
          <Ionicons name="mic" size={20} color="white" />
          <Text style={styles.recordButtonText}>Record a prayer request</Text>
        </TouchableOpacity>

        {allSessions.length === 0 ? (
          <Text style={styles.emptyText}>
            What you're praying for {firstName} will appear here.
          </Text>
        ) : null}

        {activeSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Praying for
            </Text>
            {activeSessions.map(renderRequestCard)}
          </View>
        )}

        {answeredSessions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="checkmark-circle" size={18} color={ANSWERED_COLOR} />
              <Text style={[styles.sectionTitle, styles.sectionTitleInRow]} accessibilityRole="header">
                Answered prayers
              </Text>
            </View>
            {answeredSessions.map(renderRequestCard)}
          </View>
        )}

        {reflections && reflections.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Reflections
            </Text>
            {/* Each reflection is a small page from the journal: its blue spine, the day, and
                the user's own words set like handwriting-in-print. */}
            {reflections.map((r) => (
              <TouchableOpacity
                key={`${r.entry_id}`}
                style={styles.reflectionCard}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('JournalEntry', { entryId: r.entry_id })}
                accessibilityRole="button"
                accessibilityLabel={`Reflection from ${formatShortDay(r.entry_date)}. ${r.excerpt}`}
                accessibilityHint="Opens the full journal entry"
              >
                <View style={styles.reflectionSpine} />
                <View style={styles.reflectionHeader}>
                  <Ionicons name="book-outline" size={13} color={colors.primary} />
                  <Text style={styles.reflectionDate}>{formatShortDay(r.entry_date)}</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={15}
                    color={colors.textSecondary}
                    style={styles.reflectionChevron}
                  />
                </View>
                <Text style={styles.reflectionText}>{previewOf(r.excerpt, PREVIEW.reflection).text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* What you've learned about them, built from their prayer requests. Last, so the
            prayers stay the focus. */}
        {characterSummary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              About {firstName}
            </Text>
            {(() => {
              const about = summaryExpanded
                ? { text: characterSummary.trim(), truncated: false }
                : previewOf(characterSummary, PREVIEW.about);
              return (
                <>
                  <Text style={styles.summary}>{about.text}</Text>
                  {about.truncated || summaryExpanded ? (
                    <TouchableOpacity
                      style={styles.readMore}
                      onPress={() => setSummaryExpanded((v) => !v)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={summaryExpanded ? 'Show less' : `Read more about ${firstName}`}
                    >
                      <Text style={styles.readMoreText}>{summaryExpanded ? 'Show less' : 'Read more'}</Text>
                      <Ionicons
                        name={summaryExpanded ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.primary}
                      />
                    </TouchableOpacity>
                  ) : null}
                </>
              );
            })()}
          </View>
        ) : isSummaryLoading && allSessions.length > 0 ? (
          <ActivityIndicator size="small" color={colors.textSecondary} style={styles.summaryLoading} />
        ) : null}
      </ScrollView>

      <ActionSheet
        visible={personMenuOpen}
        onClose={() => setPersonMenuOpen(false)}
        title={person.full_name}
        options={[
          { label: 'Edit name', icon: 'pencil-outline', onPress: handleEdit },
          { label: 'Delete person', icon: 'trash-outline', destructive: true, onPress: confirmDelete },
        ]}
      />

      <ActionSheet
        visible={!!sessionMenu}
        onClose={() => setSessionMenu(null)}
        options={sessionMenuOptions}
      />

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
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
  navMenuButton: {
    padding: 2,
  },
  // Profile: no card, just the person — avatar beside their name, like a contact.
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: 'white',
    fontSize: 19,
    fontWeight: 'bold',
  },
  profileText: {
    flex: 1,
  },
  name: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  since: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 1,
  },
  summary: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.textPrimary,
  },
  summaryLoading: {
    marginTop: 24,
    alignSelf: 'flex-start',
  },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: RADIUS.button,
    marginTop: 18,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  recordButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 26,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitleInRow: {
    marginBottom: 0,
  },
  // Prayer cards. Active: glass card with a blue edge and glow. Answered: a soft green-lit card
  // where the answer leads.
  requestCard: {
    borderRadius: 20,
    marginBottom: 10,
    paddingVertical: 16,
    paddingLeft: 22,
    paddingRight: 18,
  },
  activeAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: colors.primary,
  },
  activeGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    top: -80,
    right: -50,
    backgroundColor: colors.primarySoft,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingRight: 32, // room for the ⋯ button
  },
  datePill: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  datePillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  requestEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  requestBody: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  // Scripture sits inside the card as a quotation, set in a serif so it reads differently from notes.
  verse: {
    marginTop: 14,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
  },
  verseAnswered: {
    borderLeftColor: ANSWERED_COLOR,
  },
  verseText: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    opacity: 0.85,
  },
  verseReference: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.primary,
    marginTop: 4,
  },
  requestMore: {
    position: 'absolute',
    top: 10,
    right: 8,
    padding: 6,
  },
  answeredCard: {
    borderRadius: 20,
    marginBottom: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.28)',
    overflow: 'hidden',
  },
  answeredGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(52, 199, 89, 0.08)',
  },
  answeredIcon: {
    marginRight: 6,
  },
  answerText: {
    fontFamily: SERIF,
    fontSize: 19,
    lineHeight: 27,
    color: colors.textPrimary,
  },
  askedText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: 10,
  },
  askedLabel: {
    fontWeight: '700',
    color: colors.textSecondary,
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 10,
  },
  readMoreText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  // Reflections: small journal pages — soft blue paper, the journal's solid blue spine,
  // and the user's words in a serif so they read as their own writing.
  reflectionCard: {
    borderRadius: 16,
    marginBottom: 10,
    paddingVertical: 14,
    paddingLeft: 20,
    paddingRight: 16,
    backgroundColor: colors.primarySoft,
    overflow: 'hidden',
  },
  reflectionSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.primary,
  },
  reflectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  reflectionDate: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  reflectionChevron: {
    marginLeft: 'auto',
  },
  reflectionText: {
    fontFamily: SERIF,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textPrimary,
  },
  answeredModalIcon: {
    alignItems: 'center',
    marginBottom: 6,
  },
  answeredInput: {
    minHeight: 80,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 15,
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
});
}
