import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  SafeAreaView,
  Modal,
  Alert,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { calendarAPI } from '../services/api';
import { cacheCalendarEvents, getCachedCalendarEvents } from '../services/localDb';
import { getLastSyncAt } from '../services/syncService';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';

const VIEW_MODES = {
  MONTH: 'month',
  WEEK: 'week',
  DAY: 'day',
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function CalendarScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState(VIEW_MODES.MONTH);
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedDateEvents, setSelectedDateEvents] = useState([]);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState(null);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [editEventDate, setEditEventDate] = useState('');
  const [editEventSummary, setEditEventSummary] = useState('');
  const [isSavingEventEdit, setIsSavingEventEdit] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editYear, setEditYear] = useState(new Date().getFullYear());
  const [editMonth, setEditMonth] = useState(new Date().getMonth() + 1);
  const [editDay, setEditDay] = useState(new Date().getDate());

  const loadEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      let startDate, endDate;
      
      // Helper to format date as YYYY-MM-DD in local timezone
      const formatDateForAPI = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      if (viewMode === VIEW_MODES.DAY) {
        startDate = formatDateForAPI(currentDate);
        endDate = startDate;
      } else if (viewMode === VIEW_MODES.WEEK) {
        const weekStart = getWeekStart(currentDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        startDate = formatDateForAPI(weekStart);
        endDate = formatDateForAPI(weekEnd);
      } else {
        // Month view
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        startDate = formatDateForAPI(new Date(year, month, 1));
        endDate = formatDateForAPI(new Date(year, month + 1, 0));
      }
      
      const response = await calendarAPI.getEvents(startDate, endDate);
      const eventList = response.events || [];
      setEvents(eventList);
      await cacheCalendarEvents(eventList);
      setOfflineNotice(null);
    } catch (error) {
      console.error('[CalendarScreen] Error loading events:', error);
      const cached = await getCachedCalendarEvents(startDate, endDate);
      setEvents(cached);
      const lastSyncAt = await getLastSyncAt();
      if (cached.length > 0) {
        setOfflineNotice(
          lastSyncAt
            ? `Offline data shown (last synced ${new Date(lastSyncAt).toLocaleString()})`
            : 'Offline data shown'
        );
      } else {
        Alert.alert('Error', 'Failed to load calendar events');
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentDate, viewMode]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Refetch events when the Calendar tab gains focus so the just-recorded session
  // (and its dates) show up immediately instead of only after changing month/week.
  useEffect(() => {
    if (!navigation) return undefined;
    const unsubscribe = navigation.addListener('focus', () => {
      loadEvents();
    });
    return unsubscribe;
  }, [navigation, loadEvents]);

  const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }
    return days;
  };

  const getWeekDays = (date) => {
    const weekStart = getWeekStart(date);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      days.push(day);
    }
    return days;
  };

  // Helper to format date as YYYY-MM-DD in local timezone (not UTC)
  const formatDateString = (date) => {
    if (typeof date === 'string') {
      return date.split('T')[0];
    }
    if (date instanceof Date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    // If it's a day number, use currentDate's year and month
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(date).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getEventsForDate = (date) => {
    const dateStr = formatDateString(date);
    
    return events.filter(event => {
      // Extract date part from event_date (which is stored as YYYY-MM-DD)
      const eventDate = event.event_date.split('T')[0];
      return eventDate === dateStr;
    }).sort((a, b) => {
      // Sort by time for session events, then by type
      if (a.session_created_at && b.session_created_at) {
        return new Date(a.session_created_at) - new Date(b.session_created_at);
      }
      return a.event_type.localeCompare(b.event_type);
    });
  };

  const handleDatePress = (date) => {
    const dateEvents = getEventsForDate(date);
    if (dateEvents.length > 0) {
      setSelectedDate(date);
      setSelectedDateEvents(dateEvents);
      setCurrentEventIndex(0);
    }
  };

  const navigateDate = (direction) => {
    const newDate = new Date(currentDate);
    if (viewMode === VIEW_MODES.DAY) {
      newDate.setDate(newDate.getDate() + direction);
    } else if (viewMode === VIEW_MODES.WEEK) {
      newDate.setDate(newDate.getDate() + (direction * 7));
    } else {
      newDate.setMonth(newDate.getMonth() + direction);
    }
    setCurrentDate(newDate);
  };

  // Parse a date-only string (YYYY-MM-DD) as LOCAL midnight so it lands on the right calendar day.
  // new Date("YYYY-MM-DD") would be UTC midnight → previous day in UTC- timezones.
  const parseDateLocal = (dateStr) => {
    if (!dateStr) return new Date();
    const bare = String(dateStr).split('T')[0];
    return new Date(`${bare}T00:00:00`); // local midnight
  };

  // Parse a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") correctly as UTC.
  // Without explicit 'Z', JS/Hermes parses the space-separated format as LOCAL time,
  // displaying the raw UTC digits — wrong for any device not in UTC.
  const parseUtcTimestamp = (str) => {
    if (!str) return new Date();
    const s = String(str).trim();
    if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
    return new Date(s.replace(' ', 'T') + 'Z');
  };

  const formatDate = (dateStr) => {
    const date = parseDateLocal(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (dateStr) => {
    // session_created_at is a SQLite UTC timestamp — parse as UTC then display in local time
    const date = parseUtcTimestamp(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getEventColor = (eventType) => {
    return eventType === 'session' ? colors.primary : '#22C55E';
  };

  const getEventIcon = (eventType) => {
    return eventType === 'session' ? 'chatbubble' : 'calendar';
  };

  const navigateEvent = (direction) => {
    if (selectedDateEvents.length === 0) return;
    const newIndex = currentEventIndex + direction;
    if (newIndex >= 0 && newIndex < selectedDateEvents.length) {
      setCurrentEventIndex(newIndex);
    }
  };

  const renderMonthView = () => {
    const days = getDaysInMonth(currentDate);
    const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <>
        <View style={styles.weekDaysContainer}>
          {weekDays.map(day => (
            <View key={day} style={styles.weekDay}>
              <Text style={styles.weekDayText}>{day}</Text>
            </View>
          ))}
        </View>
        <ScrollView
          style={[styles.calendarContainer, { backgroundColor: colors.background }]}
          contentContainerStyle={{ backgroundColor: colors.background }}
        >
          <View style={[styles.calendarGrid, { backgroundColor: colors.background }]}>
            {days.map((day, index) => {
              const dateEvents = day ? getEventsForDate(day) : [];
              const isToday = day && 
                new Date().getDate() === day &&
                new Date().getMonth() === currentDate.getMonth() &&
                new Date().getFullYear() === currentDate.getFullYear();

              return (
                <Pressable
                  key={index}
                  disabled={!day}
                  android_ripple={
                    isDark ? { color: 'rgba(255,255,255,0.1)' } : { color: 'rgba(0,0,0,0.06)' }
                  }
                  style={({ pressed }) => [
                    styles.dayCell,
                    isToday && styles.todayCell,
                    pressed && day && styles.dayCellPressed,
                  ]}
                  onPress={() => handleDatePress(day)}
                >
                  {day && (
                    <>
                      <Text style={[styles.dayText, isToday && styles.todayText]}>
                        {day}
                      </Text>
                      {dateEvents.length > 0 && (
                        <View style={styles.eventsIndicator}>
                          {dateEvents.slice(0, 3).map((event, eventIdx) => (
                            <View
                              key={eventIdx}
                              style={[
                                styles.eventDot,
                                { backgroundColor: getEventColor(event.event_type) }
                              ]}
                            />
                          ))}
                          {dateEvents.length > 3 && (
                            <Text style={styles.moreEventsText}>+{dateEvents.length - 3}</Text>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </>
    );
  };

  const renderWeekView = () => {
    const weekDays = getWeekDays(currentDate);

    return (
      <ScrollView style={styles.weekContainer}>
        {weekDays.map((day, index) => {
          const dayEvents = getEventsForDate(day);
          const today = new Date();
          const isToday =
            day.getDate() === today.getDate() &&
            day.getMonth() === today.getMonth() &&
            day.getFullYear() === today.getFullYear();
          const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
          const dayNumber = day.getDate();

          return (
            <View key={index} style={styles.weekDayColumn}>
              <View style={[styles.weekDayHeader, isToday && styles.todayWeekHeader]}>
                <Text style={[styles.weekDayName, isToday && styles.todayWeekDayName]}>
                  {dayName}
                </Text>
                <Text style={[styles.weekDayNumber, isToday && styles.todayWeekDayNumber]}>
                  {dayNumber}
                </Text>
              </View>
              <View style={styles.weekDayEvents}>
                {dayEvents.length === 0 ? (
                  <Text style={styles.noWeekEventsText}>No events</Text>
                ) : (
                  dayEvents.map((event, eventIdx) => (
                    <TouchableOpacity
                      key={eventIdx}
                      style={[
                        styles.weekEventItem,
                        { borderLeftColor: getEventColor(event.event_type) },
                      ]}
                      onPress={() => {
                        setSelectedDate(day);
                        setSelectedDateEvents(dayEvents);
                        setCurrentEventIndex(eventIdx);
                      }}
                      activeOpacity={0.9}
                    >
                      <Text style={styles.weekEventPerson} numberOfLines={1}>
                        {event.person_name || 'Unknown'}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderDayView = () => {
    const dayEvents = getEventsForDate(currentDate);
    const dayStr = currentDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return (
      <ScrollView style={styles.dayContainer}>
        <View style={styles.dayHeader}>
          <Text style={styles.dayHeaderText}>{dayStr}</Text>
          <Text style={styles.dayEventCount}>
            {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
          </Text>
        </View>
        {dayEvents.length === 0 ? (
          <View style={styles.noEventsContainer}>
            <Text style={styles.noEventsText}>No events on this day</Text>
          </View>
        ) : (
          dayEvents.map((event, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.dayEventItem,
                { borderLeftColor: getEventColor(event.event_type) }
              ]}
              onPress={() => {
                setSelectedDate(currentDate);
                setSelectedDateEvents(dayEvents);
                setCurrentEventIndex(index);
              }}
              activeOpacity={0.9}
            >
              <View style={styles.dayEventHeader}>
                {event.event_type === 'session' && event.session_created_at && (
                  <Text style={styles.dayEventTime}>
                    {formatTime(event.session_created_at)}
                  </Text>
                )}
                <View
                  style={[
                    styles.dayEventTypeBadge,
                    { backgroundColor: getEventColor(event.event_type) }
                  ]}
                >
                  <Ionicons
                    name={getEventIcon(event.event_type)}
                    size={14}
                    color="#fff"
                  />
                  <Text style={styles.dayEventTypeText}>
                    {event.event_type === 'session' ? 'Session' : 'Referenced'}
                  </Text>
                </View>
              </View>
              <Text style={styles.dayEventPerson}>{event.person_name || 'Unknown'}</Text>
              {event.summary && (
                <Text style={styles.dayEventSummary}>{event.summary}</Text>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    );
  };

  const currentEvent = selectedDateEvents[currentEventIndex];
  const hasMultipleEvents = selectedDateEvents.length > 1;

  const openEditEventModal = () => {
    if (!currentEvent) return;
    const eventSnapshot = { ...currentEvent };
    setEditingEvent(eventSnapshot);
    const [y, m, d] = String(eventSnapshot.event_date || '').split('T')[0].split('-').map((v) => Number(v));
    if (y && m && d) {
      setEditYear(y);
      setEditMonth(m);
      setEditDay(d);
      setEditEventDate(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    setEditEventSummary(eventSnapshot.summary || '');
    // Close detail modal first; iOS can get stuck when stacking modals.
    setSelectedDate(null);
    setSelectedDateEvents([]);
    setCurrentEventIndex(0);
    setShowEditEventModal(true);
  };

  const handleSaveEventEdit = async () => {
    if (!editingEvent) return;
    const formattedDate = `${String(editYear).padStart(4, '0')}-${String(editMonth).padStart(2, '0')}-${String(editDay).padStart(2, '0')}`;
    setIsSavingEventEdit(true);
    try {
      await calendarAPI.updateEvent(editingEvent.id, {
        eventDate: formattedDate,
        summary: editEventSummary.trim(),
      });
      setShowEditEventModal(false);
      setEditingEvent(null);
      await loadEvents();
      const refreshed = await calendarAPI.getEventsByDate(formattedDate);
      setSelectedDateEvents(refreshed.events || []);
      setCurrentEventIndex(0);
      setSelectedDate(formattedDate);
    } catch (error) {
      console.error('[CalendarScreen] Error saving event edit:', error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to update event');
    } finally {
      setIsSavingEventEdit(false);
    }
  };

  const daysInCurrentMonth = new Date(editYear, editMonth, 0).getDate();
  const clampDay = (day) => Math.max(1, Math.min(day, daysInCurrentMonth));
  const changeYear = (delta) => {
    const next = Math.max(2000, Math.min(2100, editYear + delta));
    setEditYear(next);
    setEditDay((prev) => clampDay(prev));
  };
  const changeMonth = (delta) => {
    const next = editMonth + delta;
    if (next < 1 || next > 12) return;
    setEditMonth(next);
    setEditDay((prev) => clampDay(prev));
  };
  const changeDay = (delta) => {
    setEditDay((prev) => clampDay(prev + delta));
  };

  return (
    <SafeAreaView style={styles.container}>
      <GlassSurface style={styles.header}>
        <TouchableOpacity
          onPress={() => navigateDate(-1)}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel="Previous period"
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">
          {viewMode === VIEW_MODES.DAY
            ? currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : viewMode === VIEW_MODES.WEEK
            ? getWeekDays(currentDate)[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' - ' + getWeekDays(currentDate)[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <TouchableOpacity
          onPress={() => navigateDate(1)}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel="Next period"
        >
          <Ionicons
            name="chevron-forward"
            size={24}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </TouchableOpacity>
      </GlassSurface>

      <GlassSurface style={styles.viewModeSelector}>
        <TouchableOpacity
          style={[styles.viewModeButton, viewMode === VIEW_MODES.MONTH && styles.viewModeButtonActive]}
          onPress={() => {
            setViewMode(VIEW_MODES.MONTH);
          }}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Month view"
          accessibilityState={{ selected: viewMode === VIEW_MODES.MONTH }}
        >
          <Text style={[styles.viewModeText, viewMode === VIEW_MODES.MONTH && styles.viewModeTextActive]}>
            Month
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewModeButton, viewMode === VIEW_MODES.WEEK && styles.viewModeButtonActive]}
          onPress={() => {
            setViewMode(VIEW_MODES.WEEK);
          }}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Week view"
          accessibilityState={{ selected: viewMode === VIEW_MODES.WEEK }}
        >
          <Text style={[styles.viewModeText, viewMode === VIEW_MODES.WEEK && styles.viewModeTextActive]}>
            Week
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewModeButton, viewMode === VIEW_MODES.DAY && styles.viewModeButtonActive]}
          onPress={() => {
            setViewMode(VIEW_MODES.DAY);
          }}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Day view"
          accessibilityState={{ selected: viewMode === VIEW_MODES.DAY }}
        >
          <Text style={[styles.viewModeText, viewMode === VIEW_MODES.DAY && styles.viewModeTextActive]}>
            Day
          </Text>
        </TouchableOpacity>
      </GlassSurface>
      {offlineNotice && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="#665200" />
          <Text style={styles.offlineBannerText}>{offlineNotice}</Text>
        </View>
      )}

      {viewMode === VIEW_MODES.MONTH && renderMonthView()}
      {viewMode === VIEW_MODES.WEEK && renderWeekView()}
      {viewMode === VIEW_MODES.DAY && renderDayView()}

      {/* Event Detail Modal */}
      <Modal
        visible={currentEvent !== null && currentEvent !== undefined}
        transparent={true}
        animationType="slide"
        accessibilityViewIsModal={Platform.OS === 'ios'}
        onRequestClose={() => {
          setSelectedDate(null);
          setSelectedDateEvents([]);
          setCurrentEventIndex(0);
        }}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface style={styles.modalContent} intensity={52} strong>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                {hasMultipleEvents && (
                  <TouchableOpacity
                    onPress={() => navigateEvent(-1)}
                    disabled={currentEventIndex === 0}
                    style={[styles.modalNavButton, currentEventIndex === 0 && styles.modalNavButtonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Previous event"
                    accessibilityState={{ disabled: currentEventIndex === 0 }}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={20}
                      color={currentEventIndex === 0 ? '#ccc' : colors.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </TouchableOpacity>
                )}
                <Text style={styles.modalTitle} accessibilityRole="header">
                  {hasMultipleEvents ? `Event ${currentEventIndex + 1} of ${selectedDateEvents.length}` : 'Event Details'}
                </Text>
                {hasMultipleEvents && (
                  <TouchableOpacity
                    onPress={() => navigateEvent(1)}
                    disabled={currentEventIndex === selectedDateEvents.length - 1}
                    style={[styles.modalNavButton, currentEventIndex === selectedDateEvents.length - 1 && styles.modalNavButtonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Next event"
                    accessibilityState={{
                      disabled: currentEventIndex === selectedDateEvents.length - 1,
                    }}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={currentEventIndex === selectedDateEvents.length - 1 ? '#ccc' : colors.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                onPress={() => {
                  setSelectedDate(null);
                  setSelectedDateEvents([]);
                  setCurrentEventIndex(0);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Close event details"
              >
                <Ionicons
                  name="close"
                  size={24}
                  color="#000"
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </TouchableOpacity>
            </View>
            
            {currentEvent && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.modalEventType}>
                  <View
                    style={[
                      styles.modalEventTypeDot,
                      { backgroundColor: getEventColor(currentEvent.event_type) }
                    ]}
                  />
                  <Text style={styles.modalEventTypeText}>
                    {currentEvent.event_type === 'session' ? 'Session Date' : 'Referenced Date'}
                  </Text>
                </View>
                
                <Text style={styles.modalPersonName}>{currentEvent.person_name || 'Unknown'}</Text>
                <Text style={styles.modalDate}>
                  {formatDate(currentEvent.event_date)}
                  {currentEvent.event_type === 'session' && currentEvent.session_created_at && (
                    <Text style={styles.modalTime}>
                      {' '}at {formatTime(currentEvent.session_created_at)}
                    </Text>
                  )}
                </Text>
                
                {currentEvent.summary && (
                  <View style={styles.modalSummaryContainer}>
                    <Text style={styles.modalSummaryLabel}>Summary:</Text>
                    <Text style={styles.modalSummaryText}>{currentEvent.summary}</Text>
                  </View>
                )}

                {currentEvent.event_type === 'referenced' && (
                  <TouchableOpacity
                    style={styles.editEventButton}
                    onPress={openEditEventModal}
                    accessibilityRole="button"
                    accessibilityLabel="Edit referenced event"
                  >
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color="#fff"
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <Text style={styles.editEventButtonText}>Edit Referenced Event</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </GlassSurface>
        </View>
      </Modal>

      <Modal
        visible={showEditEventModal}
        transparent={true}
        animationType="slide"
        accessibilityViewIsModal={Platform.OS === 'ios'}
        onRequestClose={() => {
          if (!isSavingEventEdit) {
            setShowEditEventModal(false);
            setEditingEvent(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.editModalKeyboardWrap}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
          >
            <GlassSurface style={styles.editModalContent} intensity={52} strong>
              <Text style={styles.modalTitle} accessibilityRole="header">
                Edit Referenced Event
              </Text>
              <Text style={styles.editLabel}>Event Date</Text>
              <View style={styles.datePickerRow}>
                <View style={styles.datePickerCol}>
                  <Text style={styles.datePickerColLabel}>Year</Text>
                  <View style={styles.dateStepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeYear(-1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease year"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="remove"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                    <Text style={styles.stepValue}>{editYear}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeYear(1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Increase year"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.datePickerCol}>
                  <Text style={styles.datePickerColLabel}>Month</Text>
                  <View style={styles.dateStepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeMonth(-1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease month"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="remove"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                    <Text style={styles.stepValue}>{String(editMonth).padStart(2, '0')}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeMonth(1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Increase month"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.datePickerCol}>
                  <Text style={styles.datePickerColLabel}>Day</Text>
                  <View style={styles.dateStepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeDay(-1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease day"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="remove"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                    <Text style={styles.stepValue}>{String(editDay).padStart(2, '0')}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeDay(1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Increase day"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              <Text style={styles.selectedDatePreview}>
                Selected: {`${String(editYear).padStart(4, '0')}-${String(editMonth).padStart(2, '0')}-${String(editDay).padStart(2, '0')}`}
              </Text>
              <Text style={styles.editLabel}>Summary</Text>
              <TextInput
                style={[styles.editInput, styles.editInputMultiline]}
                value={editEventSummary}
                onChangeText={setEditEventSummary}
                editable={!isSavingEventEdit}
                multiline
                textAlignVertical="top"
                placeholderTextColor={colors.placeholderText}
                accessibilityLabel="Event summary"
              />
              <View style={styles.editButtonsRow}>
                <TouchableOpacity
                  style={[styles.editActionButton, styles.editCancelButton]}
                  disabled={isSavingEventEdit}
                  onPress={() => {
                    setShowEditEventModal(false);
                    setEditingEvent(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing"
                  accessibilityState={{ disabled: isSavingEventEdit }}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editActionButton, styles.editSaveButton]}
                  disabled={isSavingEventEdit}
                  onPress={handleSaveEventEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Save event"
                  accessibilityState={{ disabled: isSavingEventEdit }}
                >
                  <Text style={styles.editSaveText}>{isSavingEventEdit ? 'Saving...' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </GlassSurface>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors, isDark) {
  /** Opaque tile fill — same for all days; events are shown only via dots (no alternate tile color). */
  const dayTileBg = isDark ? '#2C2C2E' : colors.surfaceMuted;
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navButton: {
    padding: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  viewModeSelector: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
    marginHorizontal: 8,
    marginTop: 6,
    borderRadius: RADIUS.card,
  },
  viewModeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: RADIUS.button,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  viewModeButtonActive: {
    backgroundColor: colors.primary,
  },
  viewModeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  viewModeTextActive: {
    color: '#fff',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
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
  weekDaysContainer: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
  },
  weekDayText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  calendarContainer: {
    height: SCREEN_HEIGHT * 0.66,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: dayTileBg,
    overflow: 'hidden',
  },
  dayCellPressed: {
    opacity: 0.88,
  },
  todayCell: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderWidth: 2,
  },
  dayText: {
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  todayText: {
    fontWeight: 'bold',
    color: colors.primary,
  },
  eventsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
    backgroundColor: 'transparent',
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 1,
    marginVertical: 1,
  },
  moreEventsText: {
    fontSize: 8,
    color: colors.textSecondary,
    marginLeft: 2,
  },
  weekContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  weekDayColumn: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  weekDayHeader: {
    padding: 8,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  todayWeekHeader: {
    backgroundColor: colors.primarySoft,
  },
  weekDayName: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  todayWeekDayName: {
    color: colors.primary,
  },
  weekDayNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  todayWeekDayNumber: {
    color: colors.primary,
  },
  weekDayEvents: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.background,
  },
  weekEventItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginVertical: 4,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    borderLeftWidth: 3,
  },
  weekEventTime: {
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  weekEventPerson: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  weekEventSummary: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  noWeekEventsText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  dayContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  dayHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  dayHeaderText: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  dayEventCount: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  noEventsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  noEventsText: {
    fontSize: 14,
    color: '#999',
  },
  dayEventItem: {
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: RADIUS.card,
    borderLeftWidth: 4,
  },
  dayEventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dayEventTime: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  dayEventTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  dayEventTypeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  dayEventPerson: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  dayEventSummary: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: RADIUS.modal,
    borderTopRightRadius: RADIUS.modal,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  modalNavButton: {
    padding: 4,
  },
  modalNavButtonDisabled: {
    opacity: 0.3,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  modalBody: {
    padding: 16,
  },
  modalEventType: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalEventTypeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  modalEventTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  modalPersonName: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  modalDate: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  modalTime: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  modalSummaryContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: RADIUS.card,
  },
  modalSummaryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  modalSummaryText: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  editEventButton: {
    marginTop: 18,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  editEventButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  editModalContent: {
    width: '90%',
    maxWidth: 520,
    borderRadius: RADIUS.modal,
    padding: 16,
  },
  editModalKeyboardWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editLabel: {
    marginTop: 10,
    marginBottom: 6,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  editInputMultiline: {
    minHeight: 100,
  },
  datePickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  datePickerCol: {
    flex: 1,
  },
  datePickerColLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
    fontWeight: '600',
  },
  dateStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  selectedDatePreview: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  editButtonsRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  editActionButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: 'center',
  },
  editCancelButton: {
    backgroundColor: colors.surfaceMuted,
  },
  editSaveButton: {
    backgroundColor: colors.primary,
  },
  editCancelText: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  editSaveText: {
    color: '#fff',
    fontWeight: '700',
  },
});
}
