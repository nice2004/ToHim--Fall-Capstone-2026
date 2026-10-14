import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';

const ITEM_HEIGHT = 48;
const VISIBLE_ROWS = 3; // previous · selected · next, like the Set reminder mockup
const STEP_MINUTES = 5;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1 … 12
const MINUTES = Array.from({ length: 60 / STEP_MINUTES }, (_, i) => i * STEP_MINUTES); // 0 … 55
const PERIODS = ['AM', 'PM'];

export function formatWheelTime(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

const clamp = (index, length) => Math.max(0, Math.min(length - 1, index));

// Split minutes since midnight into the index each column should show.
function partsFor(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60) % 24;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return {
    hourIndex: HOURS.indexOf(hour12),
    minuteIndex: clamp(Math.round((totalMinutes % 60) / STEP_MINUTES), MINUTES.length),
    periodIndex: hour >= 12 ? 1 : 0,
  };
}

function minutesFor({ hourIndex, minuteIndex, periodIndex }) {
  const hour = (HOURS[hourIndex] % 12) + periodIndex * 12;
  return hour * 60 + MINUTES[minuteIndex];
}

/**
 * One scrollable column of the wheel. The centered row is selected; the rows just before and
 * after are shown faded and can be tapped to select them.
 */
function WheelColumn({ items, renderItem, selectedIndex, onSelect, label, disabled, styles, flex = 1 }) {
  const listRef = useRef(null);
  const [shownIndex, setShownIndex] = useState(selectedIndex);
  const shownRef = useRef(selectedIndex);

  const scrollToIndex = useCallback((index, animated) => {
    listRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated });
  }, []);

  // Follow outside changes (e.g. the editor resetting when it reopens).
  useEffect(() => {
    if (selectedIndex !== shownRef.current) {
      shownRef.current = selectedIndex;
      setShownIndex(selectedIndex);
      scrollToIndex(selectedIndex, false);
    }
  }, [selectedIndex, scrollToIndex]);

  const select = (index) => {
    if (index === shownRef.current) return;
    shownRef.current = index;
    setShownIndex(index);
    onSelect(index);
  };

  const handleScroll = (e) => {
    select(clamp(Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT), items.length));
  };

  const jumpTo = (index) => {
    const next = clamp(index, items.length);
    select(next);
    scrollToIndex(next, true);
  };

  const spacer = <View style={{ height: ITEM_HEIGHT }} />;

  return (
    <View
      style={[styles.column, { flex }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: renderItem(items[shownIndex]) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => jumpTo(shownRef.current + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
    >
      {/* Plain ScrollView (not FlatList): it lives inside the editor's ScrollView, and each
          column is at most 12 rows. */}
      <ScrollView
        ref={listRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEnabled={!disabled}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onLayout={() => scrollToIndex(shownRef.current, false)}
        nestedScrollEnabled
      >
        {spacer}
        {items.map((item, index) => (
          <Pressable
            key={item}
            style={styles.row}
            onPress={() => jumpTo(index)}
            disabled={disabled || index === shownIndex}
          >
            <Text style={index === shownIndex ? styles.selectedText : styles.fadedText}>{renderItem(item)}</Text>
          </Pressable>
        ))}
        {spacer}
      </ScrollView>
    </View>
  );
}

/**
 * Time picker with three independent wheels — hour, minute (5-minute steps), and AM/PM — so
 * each part can be set on its own instead of scrolling through every time of day.
 *
 * Props: value (minutes since midnight), onChange(minutes), disabled
 */
export default function TimeWheel({ value, onChange, disabled = false }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const parts = partsFor(value);

  const change = (key) => (index) => onChange(minutesFor({ ...parts, [key]: index }));

  return (
    <View style={styles.container} accessibilityLabel={`Time, ${formatWheelTime(minutesFor(parts))}`}>
      <View style={styles.selectionBand} pointerEvents="none" />
      <WheelColumn
        items={HOURS}
        renderItem={String}
        selectedIndex={parts.hourIndex}
        onSelect={change('hourIndex')}
        label="Hour"
        disabled={disabled}
        styles={styles}
      />
      <View style={styles.colonWrap} pointerEvents="none">
        <Text style={styles.colon}>:</Text>
      </View>
      <WheelColumn
        items={MINUTES}
        renderItem={(m) => String(m).padStart(2, '0')}
        selectedIndex={parts.minuteIndex}
        onSelect={change('minuteIndex')}
        label="Minute"
        disabled={disabled}
        styles={styles}
      />
      <WheelColumn
        items={PERIODS}
        renderItem={String}
        selectedIndex={parts.periodIndex}
        onSelect={change('periodIndex')}
        label="AM or PM"
        disabled={disabled}
        styles={styles}
      />
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      height: ITEM_HEIGHT * VISIBLE_ROWS,
      backgroundColor: colors.surface,
      borderRadius: RADIUS.card,
      paddingHorizontal: 16,
      overflow: 'hidden',
    },
    selectionBand: {
      position: 'absolute',
      left: 16,
      right: 16,
      top: ITEM_HEIGHT,
      height: ITEM_HEIGHT,
      borderRadius: 12,
      backgroundColor: colors.primarySoft,
    },
    column: {
      height: ITEM_HEIGHT * VISIBLE_ROWS,
    },
    colonWrap: {
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    colon: {
      fontSize: 26,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    row: {
      height: ITEM_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectedText: {
      fontSize: 26,
      fontWeight: '700',
      color: colors.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    fadedText: {
      fontSize: 18,
      color: colors.textSecondary,
      opacity: 0.55,
      fontVariant: ['tabular-nums'],
    },
  });
}
