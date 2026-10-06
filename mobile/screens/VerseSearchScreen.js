import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  FlatList,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { bibleAPI, sessionAPI } from '../services/api';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';

// One example per way of searching; tapping one runs it.
const SEARCH_EXAMPLES = [
  { icon: 'pricetag-outline', label: 'Topic', query: 'anxiety' },
  { icon: 'bookmark-outline', label: 'Reference', query: 'Philippians 4:6-7' },
  { icon: 'chatbox-ellipses-outline', label: 'Words you remember', query: 'do not worry about tomorrow' },
];

const MATCH_LABELS = {
  wording: { text: 'Closest match', icon: 'sparkles' },
  keyword: { text: 'Contains your word', icon: 'search' },
  topic: { text: 'Related', icon: 'link' },
};

export default function VerseSearchScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { sessionId, onVerseAdded } = route.params;

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState([]);
  const [translation, setTranslation] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [addingReference, setAddingReference] = useState(null);

  const runSearch = async (overrideQuery) => {
    const trimmed = (typeof overrideQuery === 'string' ? overrideQuery : query).trim();
    if (!trimmed) return;
    if (typeof overrideQuery === 'string') setQuery(overrideQuery);
    Keyboard.dismiss();
    setIsSearching(true);
    setErrorMessage(null);
    setNotice(null);
    setSubmittedQuery(trimmed);
    try {
      const data = await bibleAPI.search(trimmed);
      setResults(data.verses || []);
      setTranslation(data.translation || null);
      setNotice(data.message || null);
      setHasSearched(true);
    } catch (error) {
      setResults([]);
      setHasSearched(true);
      setErrorMessage(
        error.response?.status === 503
          ? 'Bible verse search isn’t configured yet. Add BIBLE_API_KEY and BIBLE_API_BIBLE_ID to the backend .env (see README).'
          : error.message || 'Failed to search verses'
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleAdd = async (verse) => {
    setAddingReference(verse.reference);
    try {
      const result = await sessionAPI.addVerse(sessionId, {
        reference: verse.reference,
        text: verse.text,
        translation: translation || undefined,
      });
      if (onVerseAdded) onVerseAdded(result.verse);
      navigation.goBack();
    } catch (error) {
      setErrorMessage(error.message || 'Failed to add verse');
    } finally {
      setAddingReference(null);
    }
  };

  const showExamples = !hasSearched && !isSearching;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topNavBar}>
        <TouchableOpacity
          style={styles.backNavButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backNavLabel}>Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Add a verse</Text>
      <Text style={styles.subtitle}>
        Search by topic, reference, or any words you remember from the verse.
      </Text>

      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="e.g. peace, John 3:16, or “be still and know”"
            placeholderTextColor={colors.placeholderText}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch()}
            returnKeyType="search"
            autoCorrect={false}
            autoFocus
          />
          {query.length > 0 && !isSearching ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.searchButton, (isSearching || !query.trim()) && styles.searchButtonDisabled]}
          onPress={() => runSearch()}
          disabled={isSearching || !query.trim()}
        >
          {isSearching ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </TouchableOpacity>
      </View>

      {showExamples && (
        <View style={styles.examples}>
          <Text style={styles.examplesTitle}>Try searching by</Text>
          {SEARCH_EXAMPLES.map((example) => (
            <TouchableOpacity
              key={example.label}
              style={styles.exampleRow}
              onPress={() => runSearch(example.query)}
              activeOpacity={0.7}
            >
              <View style={styles.exampleIcon}>
                <Ionicons name={example.icon} size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.exampleLabel}>{example.label}</Text>
                <Text style={styles.exampleQuery}>“{example.query}”</Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isSearching && (
        <Text style={styles.resultsCount}>Searching for “{submittedQuery}”…</Text>
      )}

      {hasSearched && !isSearching && !errorMessage && (
        <Text style={styles.resultsCount}>
          {`${results.length} result${results.length === 1 ? '' : 's'} for “${submittedQuery}”`}
          {translation ? ` · ${translation}` : ''}
        </Text>
      )}

      {errorMessage && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      <FlatList
        data={isSearching ? [] : results}
        keyExtractor={(item, index) => `${item.reference}-${index}`}
        contentContainerStyle={styles.resultsList}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const match = MATCH_LABELS[item.matchType];
          return (
            <GlassSurface style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultReference}>{item.reference}</Text>
                {match ? (
                  <View style={styles.matchBadge}>
                    <Ionicons name={match.icon} size={11} color={colors.textSecondary} />
                    <Text style={styles.matchBadgeText}>{match.text}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.resultText} numberOfLines={5}>
                {item.text}
              </Text>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => handleAdd(item)}
                disabled={addingReference === item.reference}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.reference}`}
              >
                {addingReference === item.reference ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Ionicons name="add" size={16} color="white" />
                    <Text style={styles.addButtonText}>Add to prayer request</Text>
                  </>
                )}
              </TouchableOpacity>
            </GlassSurface>
          );
        }}
        ListEmptyComponent={
          hasSearched && !isSearching && !errorMessage ? (
            <Text style={styles.emptyText}>
              {notice || 'No verses found. Try a different word, a reference, or a phrase you remember.'}
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topNavBar: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
    backNavButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
    backNavLabel: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginLeft: 2 },
    title: { fontSize: 22, fontWeight: 'bold', color: colors.textPrimary, paddingHorizontal: 20, marginBottom: 4 },
    subtitle: { fontSize: 14, color: colors.textSecondary, paddingHorizontal: 20, marginBottom: 14, lineHeight: 20 },
    searchRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 10 },
    searchContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
    },
    searchIcon: { marginRight: 8 },
    searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
    searchButton: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingHorizontal: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    searchButtonDisabled: { opacity: 0.6 },
    searchButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
    examples: { paddingHorizontal: 20, marginTop: 6 },
    examplesTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    exampleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    exampleIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primarySoft,
      justifyContent: 'center',
      alignItems: 'center',
    },
    exampleLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    exampleQuery: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
    resultsCount: { paddingHorizontal: 20, fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 10,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      padding: 12,
    },
    errorBannerText: { flex: 1, color: colors.danger, fontSize: 13 },
    resultsList: { paddingHorizontal: 20, paddingBottom: 30 },
    resultCard: {
      padding: 14,
      borderRadius: RADIUS.card,
      marginBottom: 12,
    },
    resultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 6,
    },
    resultReference: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: colors.primary },
    matchBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: RADIUS.chip,
      backgroundColor: colors.surfaceMuted,
    },
    matchBadgeText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
    resultText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21 },
    addButton: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      alignItems: 'center',
      gap: 4,
      marginTop: 12,
      backgroundColor: colors.primary,
      borderRadius: RADIUS.button,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: 34,
    },
    addButtonText: { color: 'white', fontSize: 13, fontWeight: '700' },
    emptyText: { textAlign: 'center', color: colors.textSecondary, marginTop: 30, fontSize: 14, paddingHorizontal: 10 },
  });
}
