import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { journalAPI } from '../services/api';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';
import { excerptFromSentences } from '../utils/journal';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sentences that name this person — a starting selection when the user connects someone by hand. */
function sentencesNaming(sentences, name) {
  const first = String(name || '').trim().split(/\s+/)[0];
  if (!first) return [];
  const re = new RegExp(`(^|[^A-Za-z\\u00C0-\\u024F])${escapeRegExp(first)}([^A-Za-z\\u00C0-\\u024F]|$)`);
  return sentences.map((s, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0);
}

/**
 * Review the people ToHim noticed in a reflection before anything is linked to their profiles.
 * Every connection can be removed, moved to a different person, or narrowed to the exact
 * sentences that are about them. Excerpts are always the user's own sentences.
 */
export default function JournalConnectScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { entryId, isNew = false, removedConnections = [] } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sentences, setSentences] = useState([]);
  const [people, setPeople] = useState([]);
  const [connections, setConnections] = useState([]);
  const [expandedKey, setExpandedKey] = useState(null);
  const [picker, setPicker] = useState(null); // { mode: 'add' } | { mode: 'change', key }
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await journalAPI.suggestConnections(entryId);
      setSentences(data.sentences || []);
      setPeople(data.people || []);
      setConnections(
        (data.suggestions || []).map((s) => ({
          key: `p${s.personId}`,
          personId: s.personId,
          personName: s.personName,
          sentenceIndices: s.sentenceIndices || [],
          excerpt: s.excerpt,
          alternatives: s.alternatives || [],
          alreadyLinked: !!s.alreadyLinked,
        }))
      );
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    load();
  }, [load]);

  // Return to the reflection: go back if it is right underneath (Review / Edit), otherwise show it.
  const finish = () => {
    const state = navigation.getState();
    const prev = state?.routes?.[state.index - 1];
    if (prev?.name === 'JournalEntry' && prev.params?.entryId === entryId) navigation.goBack();
    else navigation.replace('JournalEntry', { entryId });
  };

  const removeConnection = (key) => setConnections((prev) => prev.filter((c) => c.key !== key));

  const swapPerson = (key, person) =>
    setConnections((prev) =>
      prev.map((c) =>
        c.key === key
          ? {
              ...c,
              personId: person.id,
              personName: person.name,
              alternatives: c.alternatives
                .filter((a) => a.id !== person.id)
                .concat(c.alternatives.some((a) => a.id === c.personId) ? [] : [{ id: c.personId, name: c.personName }]),
            }
          : c
      )
    );

  const toggleSentence = (key, index) =>
    setConnections((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;
        const has = c.sentenceIndices.includes(index);
        const sentenceIndices = has
          ? c.sentenceIndices.filter((i) => i !== index)
          : [...c.sentenceIndices, index].sort((a, b) => a - b);
        return { ...c, sentenceIndices, excerpt: excerptFromSentences(sentences, sentenceIndices) };
      })
    );

  const pickPerson = (person) => {
    if (picker?.mode === 'change') {
      swapPerson(picker.key, person);
    } else {
      const preselected = sentencesNaming(sentences, person.name);
      const key = `p${person.id}`;
      setConnections((prev) => [
        ...prev,
        {
          key,
          personId: person.id,
          personName: person.name,
          sentenceIndices: preselected,
          excerpt: excerptFromSentences(sentences, preselected),
          alternatives: [],
          alreadyLinked: false,
        },
      ]);
      if (preselected.length === 0) setExpandedKey(key);
    }
    setPicker(null);
    setSearch('');
  };

  const incomplete = connections.some((c) => !c.excerpt?.trim());
  const duplicate = new Set(connections.map((c) => c.personId)).size !== connections.length;

  const save = async () => {
    if (incomplete) {
      Alert.alert('Choose some words', 'Pick at least one sentence for each person, or remove them.');
      return;
    }
    if (duplicate) {
      Alert.alert('Same person twice', 'Each person can only be connected once. Remove one of them.');
      return;
    }
    setSaving(true);
    try {
      await journalAPI.saveConnections(
        entryId,
        connections.map((c) => ({ personId: c.personId, excerpt: c.excerpt }))
      );
      finish();
    } catch {
      Alert.alert('Could not save', 'Your reflection is saved, but these connections were not. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const connectedIds = new Set(connections.map((c) => c.personId));
  const pickerPeople = people
    .filter((p) => !connectedIds.has(p.id))
    .filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  const removedNames = removedConnections.map((r) => r.personName).filter(Boolean);
  const hasPeople = people.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>{isNew ? 'Reflection saved' : 'Connections'}</Text>
        <TouchableOpacity
          onPress={finish}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Skip connecting people"
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>People in this reflection</Text>
        <Text style={styles.subheading}>
          Check each one before it is added to their profile. Your full reflection always stays in your
          journal just as you wrote it.
        </Text>

        {removedNames.length > 0 && (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.noticeText}>
              Your edit changed the words connected to {removedNames.join(' and ')}, so{' '}
              {removedNames.length > 1 ? 'those connections were' : 'that connection was'} removed. Reconnect
              below if it still fits.
            </Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Looking for people you mentioned…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.loadingBox}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
            <Text style={styles.loadingText}>
              ToHim could not look for people right now. Your reflection is saved.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={load}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {connections.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>
                  {hasPeople
                    ? 'No one from your People list stood out in this reflection. You can still connect someone below.'
                    : 'When you have people in ToHim, your reflections can be connected to them here.'}
                </Text>
              </View>
            )}

            {connections.map((c) => {
              const expanded = expandedKey === c.key;
              return (
                <GlassSurface key={c.key} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{c.personName.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personName}>{c.personName}</Text>
                      <Text style={styles.personMeta}>
                        {c.alreadyLinked ? 'Already connected' : 'Suggested by ToHim'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => setPicker({ mode: 'change', key: c.key })}
                      accessibilityRole="button"
                      accessibilityLabel={`Connect to someone other than ${c.personName}`}
                    >
                      <Ionicons name="swap-horizontal" size={19} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => removeConnection(c.key)}
                      accessibilityRole="button"
                      accessibilityLabel={`Don't connect to ${c.personName}`}
                    >
                      <Ionicons name="close" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  {c.alternatives.length > 0 && (
                    <View style={styles.altRow}>
                      <Text style={styles.altLabel}>Or did you mean</Text>
                      {c.alternatives.map((a) => (
                        <TouchableOpacity
                          key={a.id}
                          style={styles.altChip}
                          onPress={() => swapPerson(c.key, a)}
                          accessibilityRole="button"
                        >
                          <Text style={styles.altChipText}>{a.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {c.excerpt ? (
                    <View style={styles.excerptBox}>
                      <View style={styles.excerptBar} />
                      <Text style={styles.excerptText}>{c.excerpt}</Text>
                    </View>
                  ) : (
                    <Text style={styles.needsWords}>Choose the sentences that are about {c.personName}.</Text>
                  )}

                  <TouchableOpacity
                    style={styles.chooseRow}
                    onPress={() => setExpandedKey(expanded ? null : c.key)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chooseText}>{expanded ? 'Done choosing' : 'Choose which words'}</Text>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
                  </TouchableOpacity>

                  {expanded && (
                    <View style={styles.sentenceList}>
                      {sentences.map((s, i) => {
                        const on = c.sentenceIndices.includes(i);
                        return (
                          <TouchableOpacity
                            key={i}
                            style={styles.sentenceRow}
                            onPress={() => toggleSentence(c.key, i)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on }}
                          >
                            <Ionicons
                              name={on ? 'checkmark-circle' : 'ellipse-outline'}
                              size={20}
                              color={on ? colors.primary : colors.textSecondary}
                            />
                            <Text style={[styles.sentenceText, !on && styles.sentenceTextOff]}>{s}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </GlassSurface>
              );
            })}

            {hasPeople && people.length > connections.length && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setPicker({ mode: 'add' })}
                accessibilityRole="button"
              >
                <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                <Text style={styles.addButtonText}>Connect someone else</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      {!loading && !loadError && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveButton, (saving || incomplete) && { opacity: 0.5 }]}
            onPress={connections.length === 0 && isNew ? finish : save}
            disabled={saving}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.saveText}>
                {connections.length === 0
                  ? isNew
                    ? 'Done'
                    : 'Save without connections'
                  : `Connect ${connections.length === 1 ? connections[0].personName : `${connections.length} people`}`}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={!!picker} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {picker?.mode === 'change' ? 'Who is this about?' : 'Connect someone'}
              </Text>
              <TouchableOpacity onPress={() => setPicker(null)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search your people"
              placeholderTextColor={colors.placeholderText}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
              {pickerPeople.length === 0 ? (
                <Text style={styles.emptyText}>No one else to choose.</Text>
              ) : (
                pickerPeople.map((p) => (
                  <TouchableOpacity key={p.id} style={styles.pickerRow} onPress={() => pickPerson(p)}>
                    <View style={styles.avatarSmall}>
                      <Text style={styles.avatarSmallText}>{p.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.pickerName}>{p.name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
      paddingBottom: 8,
    },
    topTitle: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
    skipText: { fontSize: 17, color: colors.primary },
    scrollContent: { padding: 20, paddingBottom: 32 },
    heading: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
    subheading: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 6, marginBottom: 18 },
    notice: {
      flexDirection: 'row',
      gap: 8,
      backgroundColor: colors.primarySoft,
      padding: 12,
      borderRadius: 12,
      marginBottom: 16,
    },
    noticeText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textPrimary },
    loadingBox: { alignItems: 'center', paddingVertical: 36, gap: 12 },
    loadingText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
    retryButton: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: RADIUS.button,
      backgroundColor: colors.primarySoft,
    },
    retryText: { color: colors.primary, fontWeight: '600' },
    emptyBox: { paddingVertical: 12, marginBottom: 8 },
    emptyText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center', padding: 8 },
    card: { padding: 16, borderRadius: RADIUS.card, marginBottom: 14 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: 'white', fontSize: 16, fontWeight: '700' },
    personName: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    personMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    iconButton: { padding: 6 },
    altRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
    altLabel: { fontSize: 13, color: colors.textSecondary },
    altChip: {
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: RADIUS.chip,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    altChipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
    excerptBox: { flexDirection: 'row', gap: 10, marginTop: 14 },
    excerptBar: { width: 3, borderRadius: 2, backgroundColor: colors.primary },
    excerptText: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.textPrimary },
    needsWords: { fontSize: 14, color: colors.warning, marginTop: 14 },
    chooseRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start' },
    chooseText: { fontSize: 14, fontWeight: '600', color: colors.primary },
    sentenceList: {
      marginTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 6,
    },
    sentenceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
    sentenceText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.textPrimary },
    sentenceTextOff: { color: colors.textSecondary },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: RADIUS.button,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.primary,
    },
    addButtonText: { fontSize: 15, fontWeight: '600', color: colors.primary },
    footer: {
      padding: 16,
      paddingHorizontal: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    saveButton: {
      backgroundColor: colors.primary,
      borderRadius: RADIUS.button,
      paddingVertical: 15,
      alignItems: 'center',
    },
    saveText: { color: 'white', fontSize: 16, fontWeight: '700' },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
    modalSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: RADIUS.modal,
      borderTopRightRadius: RADIUS.modal,
      padding: 20,
      paddingBottom: 36,
    },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    modalTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    searchInput: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    avatarSmall: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarSmallText: { color: colors.primary, fontWeight: '700' },
    pickerName: { fontSize: 16, color: colors.textPrimary },
  });
}
