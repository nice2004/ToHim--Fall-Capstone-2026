import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { journalAPI } from '../services/api';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';
import { formatLongDate } from '../utils/journal';

/** One reflection, whole and unedited, with the people it is connected to. */
export default function JournalEntryScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { entryId } = route.params;
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      journalAPI
        .getById(entryId)
        .then((data) => {
          if (!active) return;
          setEntry(data.entry);
          setNotFound(false);
        })
        .catch((err) => {
          if (active && err?.response?.status === 404) setNotFound(true);
        })
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [entryId])
  );

  const openPerson = (personId) => {
    // From a profile the person screen is in this stack; from the journal it lives under People.
    if (navigation.getState()?.routeNames?.includes('PersonDetail')) {
      navigation.push('PersonDetail', { personId });
    } else {
      navigation.navigate('People', { screen: 'PersonDetail', params: { personId }, initial: false });
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete this reflection?',
      entry?.people?.length
        ? 'It will be removed from your journal and from the profiles it is connected to. This cannot be undone.'
        : 'It will be removed from your journal. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await journalAPI.delete(entryId);
              navigation.goBack();
            } catch {
              setDeleting(false);
              Alert.alert('Could not delete', 'Please check your connection and try again.');
            }
          },
        },
      ]
    );
  };

  const backBar = (
    <View style={styles.topNavBar}>
      <TouchableOpacity
        style={styles.backNavButton}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={colors.primary} />
        <Text style={styles.backNavLabel}>Back</Text>
      </TouchableOpacity>
      {entry && (
        <TouchableOpacity
          onPress={() => navigation.navigate('JournalCompose', { entry })}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Edit reflection"
        >
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        {backBar}
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.container}>
        {backBar}
        <Text style={styles.missingText}>
          {notFound ? 'This reflection is no longer in your journal.' : 'This reflection could not be loaded.'}
        </Text>
      </SafeAreaView>
    );
  }

  const edited =
    entry.updated_at && entry.created_at && new Date(entry.updated_at) - new Date(entry.created_at) > 60000;

  return (
    <SafeAreaView style={styles.container}>
      {backBar}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.dateText}>{formatLongDate(entry.entry_date)}</Text>
        {edited ? <Text style={styles.editedText}>Edited</Text> : null}

        {entry.prompt ? (
          <View style={styles.promptBox}>
            <View style={styles.promptBar} />
            <Text style={styles.promptText}>{entry.prompt}</Text>
          </View>
        ) : null}

        <GlassSurface style={styles.bodyCard}>
          <Text style={styles.body} selectable>
            {entry.body}
          </Text>
        </GlassSurface>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Connected to</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('JournalConnect', { entryId: entry.id })}
              accessibilityRole="button"
            >
              <Text style={styles.reviewText}>{entry.people.length ? 'Review' : 'Connect people'}</Text>
            </TouchableOpacity>
          </View>
          {entry.people.length === 0 ? (
            <Text style={styles.noneText}>
              This reflection is just for your journal. You can connect it to someone any time.
            </Text>
          ) : (
            entry.people.map((p) => (
              <TouchableOpacity
                key={p.person_id}
                activeOpacity={0.75}
                onPress={() => openPerson(p.person_id)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${p.person_name}'s profile`}
              >
                <GlassSurface style={styles.personCard}>
                  <View style={styles.personHeader}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{p.person_name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.personName}>{p.person_name}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </View>
                  <Text style={styles.excerpt} numberOfLines={4}>
                    {p.excerpt}
                  </Text>
                </GlassSurface>
              </TouchableOpacity>
            ))
          )}
        </View>

        <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete} disabled={deleting}>
          {deleting ? (
            <ActivityIndicator color={colors.danger} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.deleteText}>Delete reflection</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topNavBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 8,
    },
    backNavButton: { flexDirection: 'row', alignItems: 'center' },
    backNavLabel: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginLeft: 2 },
    editText: { fontSize: 17, color: colors.primary, fontWeight: '600' },
    missingText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginTop: 40, padding: 20 },
    scrollContent: { padding: 20, paddingBottom: 40 },
    dateText: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
    editedText: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    promptBox: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
      backgroundColor: colors.primarySoft,
      borderRadius: 14,
      padding: 14,
    },
    promptBar: { width: 3, borderRadius: 2, backgroundColor: colors.primary },
    promptText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600', color: colors.textPrimary },
    bodyCard: { padding: 18, borderRadius: RADIUS.card, marginTop: 16 },
    body: { fontSize: 16, lineHeight: 24, color: colors.textPrimary },
    section: { marginTop: 30 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    reviewText: { fontSize: 15, fontWeight: '600', color: colors.primary },
    noneText: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    personCard: { padding: 14, borderRadius: RADIUS.card, marginBottom: 10 },
    personHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: 'white', fontWeight: '700' },
    personName: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    excerpt: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 10 },
    deleteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 36,
      padding: 12,
    },
    deleteText: { fontSize: 15, color: colors.danger, fontWeight: '600' },
  });
}
