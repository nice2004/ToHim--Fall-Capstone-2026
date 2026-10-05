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

export default function VerseSearchScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { sessionId, onVerseAdded } = route.params;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [addingReference, setAddingReference] = useState(null);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setIsSearching(true);
    setErrorMessage(null);
    try {
      const data = await bibleAPI.search(trimmed);
      setResults(data.verses || []);
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
        translation: 'KJV',
      });
      if (onVerseAdded) onVerseAdded(result.verse);
      navigation.goBack();
    } catch (error) {
      setErrorMessage(error.message || 'Failed to add verse');
    } finally {
      setAddingReference(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topNavBar}>
        <TouchableOpacity
          style={styles.backNavButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back to request"
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backNavLabel}>Request</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Add a verse</Text>

      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by keyword (e.g. peace) or reference"
            placeholderTextColor={colors.placeholderText}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            autoFocus
          />
        </View>
        <TouchableOpacity
          style={styles.searchButton}
          onPress={runSearch}
          disabled={isSearching || !query.trim()}
        >
          {isSearching ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </TouchableOpacity>
      </View>

      {hasSearched && !isSearching && (
        <Text style={styles.resultsCount}>
          {errorMessage ? ' ' : `${results.length} result${results.length === 1 ? '' : 's'} for “${query.trim()}”`}
        </Text>
      )}

      {errorMessage && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={(item, index) => `${item.reference}-${index}`}
        contentContainerStyle={styles.resultsList}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <GlassSurface style={styles.resultCard}>
            <View style={styles.resultTextWrap}>
              <Text style={styles.resultReference}>{item.reference}</Text>
              <Text style={styles.resultText} numberOfLines={3}>
                {item.text}
              </Text>
            </View>
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
                <Text style={styles.addButtonText}>+ Add</Text>
              )}
            </TouchableOpacity>
          </GlassSurface>
        )}
        ListEmptyComponent={
          hasSearched && !isSearching && !errorMessage ? (
            <Text style={styles.emptyText}>No verses found. Try a different word or reference.</Text>
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
    title: { fontSize: 22, fontWeight: 'bold', color: colors.textPrimary, paddingHorizontal: 20, marginBottom: 12 },
    searchRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 8 },
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
    searchButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
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
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: RADIUS.card,
      marginBottom: 10,
    },
    resultTextWrap: { flex: 1, marginRight: 10 },
    resultReference: { fontSize: 15, fontWeight: '700', color: colors.primary, marginBottom: 4 },
    resultText: { fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
    addButton: {
      backgroundColor: colors.primary,
      borderRadius: RADIUS.button,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minWidth: 64,
      alignItems: 'center',
    },
    addButtonText: { color: 'white', fontSize: 13, fontWeight: '700' },
    emptyText: { textAlign: 'center', color: colors.textSecondary, marginTop: 30, fontSize: 14 },
  });
}
