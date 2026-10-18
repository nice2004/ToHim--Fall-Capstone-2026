import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { journalAPI } from '../services/api';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';
import {
  JOURNAL_FONT,
  formatEntryDay,
  monthLabel,
  promptsForToday,
} from '../utils/journal';

const PAGE_SIZE = 50;

/** Group entries (already newest first) under month headings. */
function groupByMonth(entries) {
  const groups = [];
  for (const entry of entries) {
    const label = monthLabel(entry.entry_date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

export default function JournalScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const todaysPrompt = useMemo(() => promptsForToday()[0], []);

  const load = useCallback(async () => {
    try {
      const data = await journalAPI.getAll({ limit: PAGE_SIZE });
      const list = data.entries || [];
      setEntries(list);
      setHasMore(list.length === PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError('Your journal could not be loaded. Check your connection and pull down to try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await journalAPI.getAll({ limit: PAGE_SIZE, offset: entries.length });
      const more = data.entries || [];
      setEntries((prev) => [...prev, ...more]);
      setHasMore(more.length === PAGE_SIZE);
    } catch {
      setError('Earlier reflections could not be loaded right now.');
    } finally {
      setLoadingMore(false);
    }
  };

  const groups = useMemo(() => groupByMonth(entries), [entries]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topNavBar}>
        <TouchableOpacity
          style={styles.backNavButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backNavLabel}>Home</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="book" size={26} color={colors.primary} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Prayer Journal
          </Text>
          <Text style={styles.subtitle}>
            A quiet place to reflect on your day, in your own words, at your own pace.
          </Text>
        </View>

        <GlassSurface style={styles.composeCard} strong>
          <Text style={styles.composeLabel}>A thought to begin with, if it helps</Text>
          <Text style={styles.composePrompt}>{todaysPrompt}</Text>
          <View style={styles.composeActions}>
            <TouchableOpacity
              style={styles.writeButton}
              onPress={() => navigation.navigate('JournalCompose')}
              accessibilityRole="button"
              accessibilityLabel="Write a reflection"
            >
              <Ionicons name="create-outline" size={20} color="white" />
              <Text style={styles.writeButtonText}>Write a reflection</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.speakButton}
              onPress={() => navigation.navigate('JournalCompose', { startWithVoice: true })}
              accessibilityRole="button"
              accessibilityLabel="Speak a reflection"
              accessibilityHint="Opens the journal and starts recording your voice"
            >
              <Ionicons name="mic" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </GlassSurface>

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
        ) : entries.length === 0 && !error ? (
          <View style={styles.emptyState}>
            <Ionicons name="leaf-outline" size={34} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>Your journal is waiting</Text>
            <Text style={styles.emptyText}>
              There is nothing to keep up with here. Write whenever something is on your heart, and
              ToHim will help you remember the people you mention.
            </Text>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.label} style={styles.monthGroup}>
              <Text style={styles.monthLabel}>{group.label}</Text>
              {group.entries.map((entry) => (
                <TouchableOpacity
                  key={entry.id}
                  activeOpacity={0.75}
                  onPress={() => navigation.navigate('JournalEntry', { entryId: entry.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Reflection from ${formatEntryDay(entry.entry_date)}`}
                >
                  <GlassSurface style={styles.entryCard}>
                    <View style={styles.entryHeader}>
                      <Text style={styles.entryDay}>{formatEntryDay(entry.entry_date)}</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                    </View>
                    {entry.prompt ? (
                      <Text style={styles.entryPrompt} numberOfLines={1}>
                        {entry.prompt}
                      </Text>
                    ) : null}
                    <Text style={styles.entryBody} numberOfLines={4}>
                      {entry.body}
                    </Text>
                    {entry.people?.length > 0 && (
                      <View style={styles.peopleRow}>
                        {entry.people.map((p) => (
                          <View key={p.person_id} style={styles.personChip}>
                            <Ionicons name="person" size={11} color={colors.primary} />
                            <Text style={styles.personChipText}>{p.person_name}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </GlassSurface>
                </TouchableOpacity>
              ))}
            </View>
          ))
        )}

        {hasMore && (
          <TouchableOpacity style={styles.moreButton} onPress={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.moreButtonText}>Show earlier reflections</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topNavBar: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
    backNavButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
    backNavLabel: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginLeft: 2 },
    scrollFlex: { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: 40 },
    header: { alignItems: 'center', marginBottom: 22 },
    headerIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
    subtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 6,
      lineHeight: 21,
      maxWidth: 320,
    },
    composeCard: { padding: 18, borderRadius: RADIUS.card, marginBottom: 24 },
    composeLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    composePrompt: {
      fontFamily: JOURNAL_FONT,
      fontSize: 19,
      lineHeight: 27,
      color: colors.textPrimary,
      fontStyle: 'italic',
      marginTop: 8,
      marginBottom: 16,
    },
    composeActions: { flexDirection: 'row', gap: 10 },
    writeButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: RADIUS.button,
      paddingVertical: 14,
    },
    writeButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
    speakButton: {
      width: 50,
      height: 50,
      borderRadius: 25,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.warningSoft,
      padding: 12,
      borderRadius: 12,
      marginBottom: 16,
    },
    errorText: { flex: 1, fontSize: 13, color: colors.textPrimary },
    emptyState: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 12 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginTop: 10 },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 21,
      marginTop: 6,
    },
    monthGroup: { marginBottom: 8 },
    monthLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 10,
      marginLeft: 4,
    },
    entryCard: { padding: 16, borderRadius: RADIUS.card, marginBottom: 12 },
    entryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    entryDay: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    entryPrompt: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
    entryBody: {
      fontFamily: JOURNAL_FONT,
      fontSize: 16,
      lineHeight: 24,
      color: colors.textPrimary,
      marginTop: 8,
    },
    peopleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
    personChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primarySoft,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: RADIUS.chip,
    },
    personChipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
    moreButton: { alignItems: 'center', padding: 14 },
    moreButtonText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  });
}
