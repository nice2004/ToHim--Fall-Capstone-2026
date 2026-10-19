import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

/**
 * The Prayer Journal's signature card: a solid ToHim-blue panel so the journal stands out from
 * the white cards around it. Used on Home (opens the journal) and at the top of the journal
 * (starts a reflection, with an optional "speak" shortcut).
 */
export default function JournalFeatureCard({
  title,
  prompt,
  ctaLabel,
  onPress,
  onSpeak,
  accessibilityLabel,
  accessibilityHint,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.shadowWrap}>
      <View style={styles.card}>
        {/* Soft light shapes give the panel depth without a gradient dependency. */}
        <View style={styles.glowLarge} pointerEvents="none" />
        <View style={styles.glowSmall} pointerEvents="none" />

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel || title}
          accessibilityHint={accessibilityHint}
        >
          <View style={styles.headerRow}>
            <View style={styles.iconBadge}>
              <Ionicons
                name="book"
                size={22}
                color="white"
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>PRAYER JOURNAL</Text>
              <Text style={styles.title}>{title}</Text>
            </View>
          </View>

          {prompt ? (
            <View style={styles.promptRow}>
              <Ionicons
                name="sparkles"
                size={14}
                color="rgba(255,255,255,0.85)"
                style={styles.promptIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={styles.prompt}>{prompt}</Text>
            </View>
          ) : null}
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cta}
            activeOpacity={0.85}
            onPress={onPress}
            accessibilityElementsHidden={!onSpeak}
            importantForAccessibility={onSpeak ? 'auto' : 'no-hide-descendants'}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
          {onSpeak ? (
            <TouchableOpacity
              style={styles.speakButton}
              activeOpacity={0.85}
              onPress={onSpeak}
              accessibilityRole="button"
              accessibilityLabel="Speak a reflection"
              accessibilityHint="Starts recording your voice"
            >
              <Ionicons name="mic" size={20} color="white" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    shadowWrap: {
      width: '100%',
      borderRadius: 24,
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 14,
      elevation: 6,
    },
    card: {
      borderRadius: 24,
      backgroundColor: colors.primary,
      padding: 20,
      overflow: 'hidden',
    },
    glowLarge: {
      position: 'absolute',
      width: 190,
      height: 190,
      borderRadius: 95,
      top: -80,
      right: -60,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    glowSmall: {
      position: 'absolute',
      width: 110,
      height: 110,
      borderRadius: 55,
      bottom: -50,
      right: 70,
      backgroundColor: 'rgba(255,255,255,0.07)',
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    iconBadge: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { flex: 1 },
    eyebrow: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: 'rgba(255,255,255,0.8)',
    },
    title: { fontSize: 20, fontWeight: 'bold', color: 'white', marginTop: 2 },
    promptRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14 },
    promptIcon: { marginTop: 3, marginRight: 8 },
    prompt: { flex: 1, fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.92)' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      backgroundColor: 'white',
      borderRadius: 999,
      paddingVertical: 11,
      paddingHorizontal: 18,
    },
    ctaText: { fontSize: 16, fontWeight: '600', color: colors.primary },
    speakButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
  });
}
