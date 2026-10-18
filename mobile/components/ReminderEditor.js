import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { reminderAPI } from '../services/api';
import {
  REPEAT_LABELS,
  toDateKey,
  toTimeKey,
  describeSchedule,
  ensureNotificationPermission,
  refreshReminders,
  addReminderToGoogleCalendar,
} from '../services/reminders';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from './GlassSurface';
import TimeWheel from './TimeWheel';

const DEFAULT_TIME_MINUTES = 8 * 60; // 8:00 AM
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parseDateKey(key) {
  const [y, m, d] = String(key).split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Create or edit a prayer reminder (laid out like the "Set reminder" screen in the user flow):
 * date row, time wheel, Once/Daily/Weekly, and a Notify me switch.
 *
 * Props:
 *  - visible, onClose()
 *  - reminder: an existing reminder to edit (omit to create)
 *  - defaults: { title, personId, sessionId, personName, date, repeat } for a new reminder
 *  - onChanged(): called after a save or delete so the parent can refresh its list
 */
export default function ReminderEditor({ visible, onClose, reminder = null, defaults = {}, onChanged }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // A percentage maxHeight doesn't resolve here (the wrapper has no fixed height), so the sheet
  // grew past the screen and clipped its bottom. Cap it in points and clear the home indicator.
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetMaxHeight = windowHeight - insets.top - 12;
  const sheetBottomPadding = 24 + insets.bottom;
  const isEditing = !!reminder;

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(startOfToday());
  const [timeMinutes, setTimeMinutes] = useState(DEFAULT_TIME_MINUTES);
  const [repeat, setRepeat] = useState('once');
  const [notify, setNotify] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(startOfToday());
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(null); // { reminder, phoneAlerts: 'on' | 'off' | 'blocked' }

  const personName = reminder?.person_name || defaults.personName || null;

  // Reset the form each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setSaved(null);
    setIsSaving(false);
    setShowDatePicker(false);
    let startDate;
    if (reminder) {
      setTitle(reminder.title || '');
      startDate = parseDateKey(reminder.remind_date);
      const [h, m] = String(reminder.remind_time || '08:00').split(':').map(Number);
      setTimeMinutes((h || 0) * 60 + (m || 0));
      setRepeat(reminder.repeat || 'once');
      setNotify(reminder.notify !== false);
    } else {
      setTitle(defaults.title || (defaults.personName ? `Pray for ${defaults.personName}` : 'Prayer time'));
      const suggested = defaults.date ? parseDateKey(defaults.date) : startOfToday();
      startDate = suggested < startOfToday() ? startOfToday() : suggested;
      setTimeMinutes(DEFAULT_TIME_MINUTES);
      setRepeat(defaults.repeat || 'once');
      setNotify(true);
    }
    setDate(startDate);
    setPickerMonth(new Date(startDate.getFullYear(), startDate.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reminder?.id]);

  const hour = Math.floor(timeMinutes / 60);
  const minute = timeMinutes % 60;
  const dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const weekdayName = date.toLocaleDateString('en-US', { weekday: 'long' });

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert('Add a title', 'Give this reminder a short title, like "Pray for Katie".');
      return;
    }
    const when = new Date(date);
    when.setHours(hour, minute, 0, 0);
    if (repeat === 'once' && when <= new Date()) {
      Alert.alert('Pick a later time', 'That time has already passed today.');
      return;
    }

    const payload = {
      title: trimmed,
      remindDate: toDateKey(date),
      remindTime: toTimeKey(hour, minute),
      repeat,
      notify,
    };
    setIsSaving(true);
    try {
      const result = isEditing
        ? await reminderAPI.update(reminder.id, payload)
        : await reminderAPI.create({
            ...payload,
            personId: defaults.personId || undefined,
            sessionId: defaults.sessionId || undefined,
          });
      let phoneAlerts = 'off';
      if (notify) {
        try {
          phoneAlerts = (await ensureNotificationPermission()) ? 'on' : 'blocked';
        } catch (err) {
          console.warn('[ReminderEditor] Notification permission check failed:', err?.message || err);
          phoneAlerts = 'blocked';
        }
      }
      await refreshReminders();
      setSaved({ reminder: result.reminder, phoneAlerts });
      onChanged?.();
    } catch (error) {
      console.error('[ReminderEditor] Error saving reminder:', error);
      Alert.alert('Error', error.response?.data?.error || 'Could not save this reminder. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete reminder?', 'It will be removed from your Calendar and stop alerting this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try {
            await reminderAPI.delete(reminder.id);
            await refreshReminders();
            onChanged?.();
            onClose();
          } catch (error) {
            Alert.alert('Error', 'Could not delete this reminder. Please try again.');
          } finally {
            setIsSaving(false);
          }
        },
      },
    ]);
  };

  const openGoogleCalendar = async (target) => {
    try {
      await addReminderToGoogleCalendar(target);
    } catch (error) {
      Alert.alert('Could not open Google Calendar', 'Please try again in a moment.');
    }
  };

  const renderDatePicker = () => {
    const year = pickerMonth.getFullYear();
    const month = pickerMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    const today = startOfToday();
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

    return (
      <View style={styles.pickerWrap}>
        <View style={styles.pickerHeader}>
          <TouchableOpacity
            onPress={() => setPickerMonth(new Date(year, month - 1, 1))}
            disabled={isCurrentMonth}
            style={isCurrentMonth && styles.disabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={18} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.pickerMonth}>
            {pickerMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
          <TouchableOpacity
            onPress={() => setPickerMonth(new Date(year, month + 1, 1))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.pickerRow}>
          {WEEKDAY_INITIALS.map((d, i) => (
            <Text key={`${d}-${i}`} style={styles.pickerWeekday}>
              {d}
            </Text>
          ))}
        </View>
        <View style={styles.pickerGrid}>
          {cells.map((day, i) => {
            if (!day) return <View key={`blank-${i}`} style={styles.pickerCell} />;
            const cellDate = new Date(year, month, day);
            const isPast = cellDate < today;
            const isSelected = toDateKey(cellDate) === toDateKey(date);
            return (
              <TouchableOpacity
                key={day}
                style={styles.pickerCell}
                disabled={isPast}
                onPress={() => {
                  setDate(cellDate);
                  setShowDatePicker(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled: isPast }}
                accessibilityLabel={cellDate.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              >
                <View style={[styles.pickerDay, isSelected && styles.pickerDaySelected]}>
                  <Text
                    style={[
                      styles.pickerDayText,
                      isPast && styles.pickerDayPast,
                      isSelected && styles.pickerDayTextSelected,
                    ]}
                  >
                    {day}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderSaved = () => (
    <View style={styles.savedWrap}>
      <Ionicons name="notifications" size={40} color={colors.primary} />
      <Text style={styles.savedTitle}>Reminder set</Text>
      <Text style={styles.savedSubtitle}>{saved.reminder.title}</Text>
      <Text style={styles.savedSchedule}>{describeSchedule(saved.reminder)}</Text>
      {saved.phoneAlerts === 'blocked' && (
        <Text style={styles.savedNote}>
          Notifications are off for ToHim, so this phone won't alert you. You can turn them on in your
          phone's Settings, or add the reminder to Google Calendar.
        </Text>
      )}
      {saved.phoneAlerts === 'off' && (
        <Text style={styles.savedNote}>It's on your Calendar. Phone alerts are off for this reminder.</Text>
      )}
      <TouchableOpacity
        style={[styles.googleButton, styles.savedGoogle]}
        onPress={() => openGoogleCalendar(saved.reminder)}
        accessibilityRole="button"
        accessibilityLabel="Add to Google Calendar"
      >
        <Ionicons name="logo-google" size={18} color={colors.primary} />
        <Text style={styles.googleButtonText}>Add to Google Calendar</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.saveButton, styles.doneButton]} onPress={onClose} accessibilityRole="button">
        <Text style={styles.saveText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  const renderForm = () => (
    <>
      <View style={styles.headerRow}>
        <Text style={styles.title} accessibilityRole="header">
          {isEditing ? 'Edit reminder' : 'Set reminder'}
        </Text>
        <TouchableOpacity onPress={onClose} disabled={isSaving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
      {personName ? (
        <View style={styles.forChip}>
          <Ionicons name="person" size={13} color={colors.primary} />
          <Text style={styles.forChipText}>For {personName}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Title</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          editable={!isSaving}
          maxLength={200}
          placeholder="e.g. Morning prayer time"
          placeholderTextColor={colors.placeholderText}
          accessibilityLabel="Reminder title"
        />
      </View>

      <View style={styles.card}>
        <TouchableOpacity
          style={styles.dateRow}
          onPress={() => setShowDatePicker((v) => !v)}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel={`${repeat === 'once' ? 'Date' : 'Starting'}, ${dateLabel}. Change date`}
          accessibilityState={{ expanded: showDatePicker }}
        >
          <Text style={styles.dateLabel}>{repeat === 'once' ? 'Date' : 'Starting'}</Text>
          <Text style={styles.dateValue}>{dateLabel}</Text>
        </TouchableOpacity>
        {showDatePicker && renderDatePicker()}
      </View>

      <TimeWheel value={timeMinutes} onChange={setTimeMinutes} disabled={isSaving} />

      <Text style={styles.sectionLabel}>Repeat</Text>
      <View style={styles.segmentTrack}>
        {Object.entries(REPEAT_LABELS).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.segment, repeat === key && styles.segmentActive]}
            onPress={() => setRepeat(key)}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityState={{ selected: repeat === key }}
          >
            <Text style={[styles.segmentText, repeat === key && styles.segmentTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {repeat !== 'once' && (
        <Text style={styles.repeatHint}>{repeat === 'daily' ? 'Every day' : `Every ${weekdayName}`}</Text>
      )}

      <View style={[styles.card, styles.notifyRow]}>
        <Ionicons name="notifications-outline" size={22} color={colors.primary} />
        <Text style={styles.notifyText}>Notify me</Text>
        <Switch
          value={notify}
          onValueChange={setNotify}
          disabled={isSaving}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor="#fff"
          ios_backgroundColor={colors.border}
          accessibilityLabel="Notify me"
        />
      </View>
      <Text style={styles.caption}>
        {notify
          ? 'Only you get this reminder, as a notification on this phone.'
          : "It will show on your Calendar, but your phone won't alert you."}
      </Text>

      {isEditing && (
        <View style={styles.editExtras}>
          <TouchableOpacity
            style={styles.googleButton}
            onPress={() => openGoogleCalendar(reminder)}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Add to Google Calendar"
          >
            <Ionicons name="logo-google" size={18} color={colors.primary} />
            <Text style={styles.googleButtonText}>Add to Google Calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            disabled={isSaving}
            style={styles.deleteLink}
            accessibilityRole="button"
            accessibilityLabel="Delete reminder"
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.deleteText}>Delete reminder</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={styles.saveButton}
        onPress={handleSave}
        disabled={isSaving}
        accessibilityRole="button"
        accessibilityLabel="Save reminder"
      >
        {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save reminder</Text>}
      </TouchableOpacity>
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      accessibilityViewIsModal={Platform.OS === 'ios'}
      onRequestClose={() => {
        if (!isSaving) onClose();
      }}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardWrap}>
          <GlassSurface style={[styles.sheet, { maxHeight: sheetMaxHeight }]} intensity={52} strong>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.sheetContent, { paddingBottom: sheetBottomPadding }]}
            >
              {saved ? renderSaved() : renderForm()}
            </ScrollView>
          </GlassSurface>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    keyboardWrap: { width: '100%' },
    sheet: {
      borderTopLeftRadius: RADIUS.modal,
      borderTopRightRadius: RADIUS.modal,
    },
    sheetContent: { padding: 20, gap: 12 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: { fontSize: 28, fontWeight: 'bold', color: colors.textPrimary },
    cancelText: { fontSize: 16, fontWeight: '600', color: colors.primary },
    forChip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      backgroundColor: colors.primarySoft,
      borderRadius: RADIUS.chip,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    forChipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
    card: {
      backgroundColor: colors.surface,
      borderRadius: RADIUS.card,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    cardLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
    titleInput: { fontSize: 16, color: colors.textPrimary, paddingVertical: 2 },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    dateLabel: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    dateValue: { fontSize: 16, fontWeight: '700', color: colors.primary },
    pickerWrap: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    pickerMonth: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    disabled: { opacity: 0.3 },
    pickerRow: { flexDirection: 'row' },
    pickerWeekday: {
      width: '14.28%',
      textAlign: 'center',
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 4,
    },
    pickerGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    pickerCell: { width: '14.28%', height: 38, alignItems: 'center', justifyContent: 'center' },
    pickerDay: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    pickerDaySelected: { backgroundColor: colors.primary },
    pickerDayText: { fontSize: 14, color: colors.textPrimary },
    pickerDayPast: { color: colors.textSecondary, opacity: 0.4 },
    pickerDayTextSelected: { color: '#fff', fontWeight: '700' },
    sectionLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: -4 },
    segmentTrack: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 999,
      padding: 4,
    },
    segment: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
    segmentTextActive: { color: '#fff' },
    repeatHint: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: -4 },
    notifyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    notifyText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    caption: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: -4 },
    editExtras: { gap: 6 },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    googleButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
    deleteLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    deleteText: { color: colors.danger, fontWeight: '600', fontSize: 14 },
    saveButton: {
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 4,
    },
    saveText: { color: '#fff', fontWeight: '700', fontSize: 17 },
    savedWrap: { alignItems: 'center', paddingTop: 8 },
    savedTitle: { marginTop: 8, fontSize: 20, fontWeight: '700', color: colors.textPrimary },
    savedSubtitle: { marginTop: 6, fontSize: 16, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
    savedSchedule: { marginTop: 4, fontSize: 14, color: colors.primary, fontWeight: '600' },
    savedNote: {
      marginTop: 12,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    savedGoogle: { alignSelf: 'stretch', marginTop: 18 },
    doneButton: { alignSelf: 'stretch', marginTop: 10 },
  });
}
