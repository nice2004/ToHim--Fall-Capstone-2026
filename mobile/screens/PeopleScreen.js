import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { personAPI, groupsAPI } from '../services/api';
import { cachePersons, getCachedPersons } from '../services/localDb';
import { getLastSyncAt } from '../services/syncService';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';

const GROUP_VIEW_KEY = 'groupViewEnabled';

function personMatchesSearch(person, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return true;
  const parts = [person.full_name, person.first_name, person.last_name]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return parts.some((p) => p.includes(q));
}

export default function PeopleScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [persons, setPersons] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [groupViewEnabled, setGroupViewEnabled] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showGroupManageModal, setShowGroupManageModal] = useState(false);
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef(null);

  const dismissSearchKeyboard = () => {
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    setSearchFocused(false);
  };

  const filteredPersons = useMemo(() => {
    if (!searchQuery.trim()) return persons;
    return persons.filter((p) => personMatchesSearch(p, searchQuery));
  }, [persons, searchQuery]);

  const filteredGroups = useMemo(() => {
    if (!groupViewEnabled) return groups;
    const q = searchQuery.trim();
    if (!q) return groups;
    return groups.filter((g) =>
      persons.some(
        (p) => p.groups?.some((gr) => gr.id === g.id) && personMatchesSearch(p, searchQuery)
      )
    );
  }, [groups, groupViewEnabled, persons, searchQuery]);

  const hasActiveSearch = searchQuery.trim().length > 0;

  const loadPersons = async () => {
    let shouldLoadWithGroups = false;
    try {
      console.log('[PeopleScreen] Loading persons...');
      // Check setting directly to avoid race condition
      try {
        const setting = await SecureStore.getItemAsync(GROUP_VIEW_KEY);
        shouldLoadWithGroups = setting === 'true';
      } catch (error) {
        console.warn('[PeopleScreen] Error checking group view setting:', error);
      }
      
      // Load persons with groups if group view is enabled
      const data = shouldLoadWithGroups 
        ? await personAPI.getAllWithGroups()
        : await personAPI.getAll();
      
      // Check if response is valid JSON (not HTML)
      if (typeof data === 'string' && (data.includes('<!DOCTYPE') || data.includes('<html'))) {
        throw new Error('Received HTML response instead of JSON. ngrok tunnel may be offline.');
      }
      
      console.log('[PeopleScreen] API response type:', typeof data);
      console.log('[PeopleScreen] API response:', typeof data === 'object' ? JSON.stringify(data, null, 2) : data.substring(0, 200));
      
      // Ensure we have a valid array
      let personsList = [];
      if (data && typeof data === 'object') {
        personsList = Array.isArray(data.persons) ? data.persons : (Array.isArray(data) ? data : []);
      }
      
      console.log('[PeopleScreen] Setting persons:', personsList.length, 'items');
      if (personsList.length > 0) {
        console.log('[PeopleScreen] First person:', personsList[0]);
      }
      setPersons(personsList);
      setOfflineNotice(null);
      await cachePersons(personsList, shouldLoadWithGroups);
    } catch (error) {
      console.error('[PeopleScreen] Error loading persons:', error);
      console.error('[PeopleScreen] Error details:', {
        message: error.message,
        response: error.response?.data ? (typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : error.response.data) : 'No response',
        status: error.response?.status
      });
      
      // Show error alert for ngrok issues
      if (error.message && error.message.includes('ngrok')) {
        Alert.alert(
          'Connection Error',
          'Cannot connect to backend server. Please ensure:\n\n1. Backend server is running (npm start)\n2. ngrok is running and forwarding to port 3000\n3. Update the ngrok URL in mobile/services/api.js if it changed',
          [{ text: 'OK' }]
        );
      }
      
      const cached = await getCachedPersons(shouldLoadWithGroups);
      setPersons(cached);
      const lastSyncAt = await getLastSyncAt();
      if (cached.length > 0) {
        setOfflineNotice(
          lastSyncAt
            ? `Offline data shown (last synced ${new Date(lastSyncAt).toLocaleString()})`
            : 'Offline data shown'
        );
      } else {
        setOfflineNotice('No cached people available offline yet');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadGroupViewSetting = async () => {
    try {
      const value = await SecureStore.getItemAsync(GROUP_VIEW_KEY);
      setGroupViewEnabled(value === 'true');
    } catch (error) {
      console.error('[PeopleScreen] Error loading group view setting:', error);
    }
  };

  const loadGroups = async () => {
    try {
      const data = await groupsAPI.getAll();
      setGroups(data.groups || []);
    } catch (error) {
      console.error('[PeopleScreen] Error loading groups:', error);
      setGroups([]);
    }
  };

  useEffect(() => {
    // Load settings first, then data
    const initialize = async () => {
      await loadGroupViewSetting();
      // Wait a bit for state to update, then load data
      setTimeout(() => {
        loadPersons();
        if (groupViewEnabled) {
          loadGroups();
        }
      }, 100);
    };
    initialize();
    
    // Also reload when screen comes into focus
    const unsubscribe = navigation.addListener('focus', async () => {
      console.log('[PeopleScreen] Screen focused, reloading...');
      await loadGroupViewSetting();
      setTimeout(() => {
        loadPersons();
        if (groupViewEnabled) {
          loadGroups();
        }
      }, 100);
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    // Reload data when group view setting changes
    if (!loading) {
      loadPersons();
      if (groupViewEnabled) {
        loadGroups();
      }
    }
  }, [groupViewEnabled]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPersons();
    if (groupViewEnabled) {
      loadGroups();
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

    try {
      await groupsAPI.create(newGroupName.trim());
      setNewGroupName('');
      setShowCreateGroupModal(false);
      loadGroups();
      Alert.alert('Success', 'Group created successfully');
    } catch (error) {
      console.error('[PeopleScreen] Error creating group:', error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to create group');
    }
  };

  const handleAddPersonToGroup = async (personId, groupId) => {
    try {
      await groupsAPI.addPerson(groupId, personId);
      loadGroups();
      loadPersons();
    } catch (error) {
      console.error('[PeopleScreen] Error adding person to group:', error);
      Alert.alert('Error', 'Failed to add person to group');
    }
  };

  const handleRemovePersonFromGroup = async (personId, groupId) => {
    try {
      await groupsAPI.removePerson(groupId, personId);
      loadGroups();
      loadPersons();
    } catch (error) {
      console.error('[PeopleScreen] Error removing person from group:', error);
      Alert.alert('Error', 'Failed to remove person from group');
    }
  };

  const renderGroupItem = ({ item: group }) => {
    const groupPersons = filteredPersons.filter(p => 
      p.groups && p.groups.some(g => g.id === group.id)
    );

    return (
      <GlassSurface style={styles.groupCard}>
        <TouchableOpacity
          style={styles.groupHeader}
          onPress={() => {
            setSelectedGroup(group);
            setShowGroupManageModal(true);
          }}
          activeOpacity={0.9}
        >
          <View style={styles.groupInfo}>
            <Ionicons name="folder" size={24} color={colors.primary} />
            <View style={styles.groupText}>
              <Text style={styles.groupName}>{group.name}</Text>
              <Text style={styles.groupCount}>
                {groupPersons.length} {groupPersons.length === 1 ? 'person' : 'people'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
        
        {groupPersons.length > 0 && (
          <View style={styles.groupPersonsList}>
            {groupPersons.slice(0, 3).map((person) => (
              <TouchableOpacity
                key={person.id}
                style={styles.groupPersonItem}
                onPress={() => {
                  navigation.navigate('PersonDetail', { personId: person.id });
                }}
                activeOpacity={0.9}
              >
                <View style={styles.groupPersonAvatar}>
                  <Text style={styles.groupPersonAvatarText}>
                    {person.first_name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.groupPersonName}>{person.full_name}</Text>
              </TouchableOpacity>
            ))}
            {groupPersons.length > 3 && (
              <Text style={styles.morePersonsText}>
                +{groupPersons.length - 3} more
              </Text>
            )}
          </View>
        )}
      </GlassSurface>
    );
  };

  const renderPersonItem = ({ item }) => {
    // Safety check - ensure item is valid
    if (!item || !item.id || !item.first_name || !item.full_name) {
      console.warn('[PeopleScreen] Invalid person item:', item);
      return null;
    }
    
    return (
      <TouchableOpacity
        style={styles.personCardTouchable}
        onPress={() => {
          navigation.navigate('PersonDetail', { personId: item.id });
        }}
        activeOpacity={0.9}
      >
        <GlassSurface style={styles.personCard}>
          <View style={styles.personAvatar}>
            <Text style={styles.avatarText}>
              {item.first_name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.personInfo}>
            <Text style={styles.personName}>{item.full_name}</Text>
            <Text style={styles.personDate}>
              Updated: {new Date(item.updated_at).toLocaleDateString()}
            </Text>
          </View>
        </GlassSurface>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>People</Text>
        <View style={styles.headerButtons}>
          {groupViewEnabled ? (
            <>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => {
                  setShowGroupInfoModal(true);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="help-circle-outline" size={28} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => {
                  setShowCreateGroupModal(true);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle" size={28} color={colors.primary} />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => {
                navigation.navigate('NewSession');
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle" size={28} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {offlineNotice && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="#665200" />
          <Text style={styles.offlineBannerText}>{offlineNotice}</Text>
        </View>
      )}

      {persons.length > 0 && (
        <View style={styles.searchWrap}>
          <GlassSurface style={styles.searchSurface} intensity={38}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search by name…"
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              blurOnSubmit
              onSubmitEditing={dismissSearchKeyboard}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
            {searchFocused ? (
              <TouchableOpacity
                onPress={dismissSearchKeyboard}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Dismiss keyboard"
                accessibilityHint="Closes the keyboard"
              >
                <Text style={styles.searchDoneButton}>Done</Text>
              </TouchableOpacity>
            ) : null}
          </GlassSurface>
        </View>
      )}

      {groupViewEnabled ? (
        // Group View
        groups.length === 0 && persons.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="folder-outline" size={80} color="#ccc" />
            <Text style={styles.emptyText}>No groups yet</Text>
            <Text style={styles.emptySubtext}>
              Create a group to organize your people
            </Text>
            <TouchableOpacity
              style={styles.createGroupButton}
              onPress={() => {
                setShowCreateGroupModal(true);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.createGroupButtonText}>Create Your First Group</Text>
            </TouchableOpacity>
          </View>
        ) : hasActiveSearch && filteredGroups.length === 0 && groups.length > 0 ? (
          <View style={styles.searchEmptyContainer}>
            <Ionicons name="search-outline" size={56} color="#ccc" />
            <Text style={styles.emptyText}>No matching people</Text>
            <Text style={styles.emptySubtext}>
              Try a different name or clear the search.
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredGroups}
            renderItem={renderGroupItem}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="folder-outline" size={80} color="#ccc" />
                <Text style={styles.emptyText}>No groups yet</Text>
                <TouchableOpacity
                  style={styles.createGroupButton}
                  onPress={() => {
                    setShowCreateGroupModal(true);
                  }}
                  activeOpacity={0.9}
                >
                  <Text style={styles.createGroupButtonText}>Create Your First Group</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )
      ) : (
        // Classic View
        persons.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={80} color="#ccc" />
            <Text style={styles.emptyText}>No people yet</Text>
            <Text style={styles.emptySubtext}>
              Start a prayer request to add your first person
            </Text>
          </View>
        ) : hasActiveSearch && filteredPersons.length === 0 ? (
          <View style={styles.searchEmptyContainer}>
            <Ionicons name="search-outline" size={56} color="#ccc" />
            <Text style={styles.emptyText}>No matching people</Text>
            <Text style={styles.emptySubtext}>
              Try another spelling or clear the search.
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredPersons}
            renderItem={renderPersonItem}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          />
        )
      )}

      {/* Create Group Modal */}
      <Modal
        visible={showCreateGroupModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCreateGroupModal(false)}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface style={styles.modalContent} intensity={52} strong>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Group</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateGroupModal(false);
                  setNewGroupName('');
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Group name (e.g., Mentors, Family, Coworkers)"
              value={newGroupName}
              onChangeText={setNewGroupName}
              autoCapitalize="words"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowCreateGroupModal(false);
                  setNewGroupName('');
                }}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleCreateGroup}
              >
                <Text style={styles.modalButtonTextPrimary}>Create</Text>
              </TouchableOpacity>
            </View>
          </GlassSurface>
        </View>
      </Modal>

      {/* Manage Group Modal */}
      <Modal
        visible={showGroupManageModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowGroupManageModal(false);
          setSelectedGroup(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface style={styles.modalContentLarge} intensity={52} strong>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedGroup?.name || 'Manage Group'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowGroupManageModal(false);
                  setSelectedGroup(null);
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScrollView}>
              <Text style={styles.modalSectionTitle}>People in this group:</Text>
              {persons
                .filter(p => p.groups && p.groups.some(g => g.id === selectedGroup?.id))
                .map((person) => (
                  <View key={person.id} style={styles.groupPersonRow}>
                    <View style={styles.groupPersonInfo}>
                      <View style={styles.groupPersonAvatar}>
                        <Text style={styles.groupPersonAvatarText}>
                          {person.first_name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.groupPersonName}>{person.full_name}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemovePersonFromGroup(person.id, selectedGroup.id)}
                    >
                      <Ionicons name="close-circle" size={24} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                ))}
              
              <Text style={[styles.modalSectionTitle, { marginTop: 20 }]}>
                Add people to group:
              </Text>
              {persons
                .filter(p => !p.groups || !p.groups.some(g => g.id === selectedGroup?.id))
                .map((person) => (
                  <TouchableOpacity
                    key={person.id}
                    style={styles.groupPersonRow}
                    onPress={() => handleAddPersonToGroup(person.id, selectedGroup.id)}
                  >
                    <View style={styles.groupPersonInfo}>
                      <View style={styles.groupPersonAvatar}>
                        <Text style={styles.groupPersonAvatarText}>
                          {person.first_name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.groupPersonName}>{person.full_name}</Text>
                    </View>
                    <Ionicons name="add-circle" size={24} color={colors.primary} />
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </GlassSurface>
        </View>
      </Modal>

      {/* Group Info Modal */}
      <Modal
        visible={showGroupInfoModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowGroupInfoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface style={styles.modalContent} intensity={52} strong>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>About Groups</Text>
              <TouchableOpacity
                onPress={() => setShowGroupInfoModal(false)}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.infoModalScrollView}>
              <View style={styles.infoSection}>
                <Ionicons name="folder" size={32} color={colors.primary} style={styles.infoIcon} />
                <Text style={styles.infoTitle}>What are Groups?</Text>
                <Text style={styles.infoText}>
                  Groups help you organize your people into categories like Mentors, Family, Coworkers, etc. 
                  Think of them as folders for your contacts.
                </Text>
              </View>

              <View style={styles.infoSection}>
                <Ionicons name="people" size={32} color={colors.primary} style={styles.infoIcon} />
                <Text style={styles.infoTitle}>Multiple Groups</Text>
                <Text style={styles.infoText}>
                  A person can belong to multiple groups. For example, someone can be both a "Mentor" 
                  and a "Friend" at the same time.
                </Text>
              </View>

              <View style={styles.infoSection}>
                <Ionicons name="search" size={32} color={colors.primary} style={styles.infoIcon} />
                <Text style={styles.infoTitle}>Query Groups</Text>
                <Text style={styles.infoText}>
                  You can ask Thim questions about groups in Ask Thim. For example: 
                  "Which of my mentors am I supposed pray for?"
                </Text>
              </View>

              <View style={styles.infoSection}>
                <Ionicons name="settings" size={32} color={colors.primary} style={styles.infoIcon} />
                <Text style={styles.infoTitle}>Toggle View</Text>
                <Text style={styles.infoText}>
                  You can switch between Group View and Classic View in Settings. 
                  Classic View shows all people in a simple list.
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonPrimary]}
              onPress={() => setShowGroupInfoModal(false)}
            >
              <Text style={styles.modalButtonTextPrimary}>Got it</Text>
            </TouchableOpacity>
          </GlassSurface>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  addButton: {
    padding: 5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 15,
  },
  personCardTouchable: {
    marginBottom: 10,
  },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: RADIUS.card,
  },
  personAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatarText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  personDate: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 20,
  },
  emptySubtext: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 10,
    textAlign: 'center',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
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
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  searchSurface: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.card,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchDoneButton: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  searchEmptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  groupCard: {
    borderRadius: RADIUS.card,
    marginBottom: 15,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  groupText: {
    marginLeft: 12,
    flex: 1,
  },
  groupName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  groupCount: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  groupPersonsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 15,
    gap: 10,
  },
  groupPersonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    padding: 8,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  groupPersonAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  groupPersonAvatarText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  groupPersonName: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  morePersonsText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
    alignSelf: 'center',
    marginTop: 8,
  },
  createGroupButton: {
    backgroundColor: colors.primary,
    padding: 15,
    borderRadius: 24,
    marginTop: 20,
  },
  createGroupButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: RADIUS.modal,
    padding: 20,
    width: '85%',
    maxWidth: 400,
  },
  modalContentLarge: {
    borderRadius: RADIUS.modal,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  modalInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 24,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: colors.surfaceMuted,
  },
  modalButtonPrimary: {
    backgroundColor: colors.primary,
  },
  modalButtonTextCancel: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextPrimary: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalScrollView: {
    maxHeight: 400,
  },
  modalSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  groupPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    marginBottom: 10,
  },
  infoModalScrollView: {
    maxHeight: 400,
    marginBottom: 20,
  },
  infoSection: {
    marginBottom: 25,
  },
  infoIcon: {
    marginBottom: 10,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
}

