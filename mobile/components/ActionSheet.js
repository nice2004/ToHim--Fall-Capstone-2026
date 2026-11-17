import React, { useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from './GlassSurface';

/**
 * A small bottom sheet of actions, so screens can tuck secondary actions behind one "⋯" button.
 * (Android's Alert only shows three buttons, so this is used on both platforms for consistency.)
 *
 * Props:
 *  - visible, onClose()
 *  - title: optional short heading
 *  - options: [{ label, icon, onPress, destructive }]
 */
export default function ActionSheet({ visible, onClose, title, options = [] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const choose = (option) => {
    onClose();
    // Let the sheet close before the action opens another modal or screen.
    setTimeout(() => option.onPress?.(), 350);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Close">
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <GlassSurface style={[styles.sheet, { paddingBottom: 12 + insets.bottom }]} strong>
              {title ? (
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
              {options.map((option, index) => {
                const tint = option.destructive ? colors.danger : colors.textPrimary;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[styles.row, index > 0 && styles.rowDivider]}
                    onPress={() => choose(option)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                  >
                    {option.icon ? (
                      <Ionicons
                        name={option.icon}
                        size={20}
                        color={option.destructive ? colors.danger : colors.primary}
                        style={styles.icon}
                      />
                    ) : null}
                    <Text style={[styles.label, { color: tint }]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={styles.cancel}
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </GlassSurface>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    },
    sheet: {
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 20,
      paddingTop: 14,
    },
    title: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 15,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    icon: {
      width: 28,
    },
    label: {
      fontSize: 17,
    },
    cancel: {
      marginTop: 8,
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    cancelText: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.textPrimary,
    },
  });
}
