import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
// Note: React Native has built-in FormData, no need to import

// API Configuration
// Change this to your backend server URL
// For local development:
// - iOS simulator: http://localhost:3000/api
// - Android emulator: http://10.0.2.2:3000/api
// - Physical device: http://YOUR_IP_ADDRESS:3000/api
// 
// IMPORTANT: If using Expo Go on a physical device, you MUST change localhost to your computer's IP!
// Find your IP: ifconfig | grep "inet " | grep -v 127.0.0.1 (Mac/Linux)
//              ipconfig (Windows)
// Example: 'http://192.168.1.100:3000/api'

// IMPORTANT: Configure this based on how you're testing:
// - iOS Simulator: http://localhost:3000/api
// - Android Emulator: http://10.0.2.2:3000/api  
// - Physical Device: http://10.90.128.21:3000/api
//   Find your IP: ifconfig | grep "inet " | grep -v 127.0.0.1 (Mac/Linux)
//                 ipconfig (Windows)
// - ngrok tunnel: https://unvamped-anita-preintellectually.ngrok-free.dev

// TODO: Update dev URL when your ngrok tunnel changes (ngrok http 3000).
// Production JSON API is on Render. mytabbe.com is only used for outbound email (Resend), not the REST API.
const PRODUCTION_API_URL =
  Constants.expoConfig?.extra?.apiBaseUrl || 'https://tabbi.onrender.com/api';

// TODO (Nice): David's old ngrok URL was hardcoded here and is almost
// certainly dead now. Replace this with EITHER:
//   - your local server's LAN IP, e.g. 'http://192.168.1.100:3000/api'
//     (find it with `ipconfig` on Windows), or
//   - a fresh ngrok/tunnel URL if testing on a physical device off your LAN
const DEV_API_URL = 'https://designed-bonehead-unfiled.ngrok-free.dev/api';

const API_BASE_URL = __DEV__
  ? DEV_API_URL
  : PRODUCTION_API_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 90000, // Increased to 90 seconds for OpenAI API calls
  headers: {
    'Content-Type': 'application/json',
    // ngrok free tier requires this header to skip browser warning
    'ngrok-skip-browser-warning': 'true',
    'User-Agent': 'ToHim-Mobile-App',
  },
  // Allow self-signed certificates (for ngrok)
  // IMPORTANT: Only accept 2xx status codes as success
  // 401, 403, etc. should be treated as errors
  validateStatus: function (status) {
    return status >= 200 && status < 300; // Only accept 2xx as success
  },
  // For React Native, we might need to handle redirects
  maxRedirects: 5,
});

// Token management
const TOKEN_KEY = 'auth_token';

export const tokenStorage = {
  async saveToken(token) {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      console.log('[Auth] Token saved');
    } catch (error) {
      console.error('[Auth] Error saving token:', error);
    }
  },
  
  async getToken() {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      return token;
    } catch (error) {
      console.error('[Auth] Error getting token:', error);
      return null;
    }
  },
  
  async removeToken() {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      console.log('[Auth] Token removed');
    } catch (error) {
      console.error('[Auth] Error removing token:', error);
    }
  }
};

// Add request interceptor to include auth token
api.interceptors.request.use(
  async (config) => {
    const fullUrl = `${config.baseURL}${config.url}`;
    console.log(`[API] ${config.method?.toUpperCase()} ${fullUrl}`);
    
    // Add auth token if available
    // Skip token for register/login, but include for verify and all other routes
    const isPublicAuthRoute = config.url === '/auth/register' || config.url === '/auth/login';
    if (!isPublicAuthRoute) {
      const token = await tokenStorage.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    
    return config;
  },
  (error) => {
    console.error('[API] Request error:', error);
    return Promise.reject(error);
  }
);

// Helper function to check if response is HTML (ngrok error page)
function isHtmlResponse(data) {
  if (typeof data === 'string') {
    return data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html');
  }
  return false;
}

// Add response interceptor for better error handling
api.interceptors.response.use(
  (response) => {
    // Check if response is HTML (ngrok error page) - ngrok sometimes returns 200 with HTML
    if (response.data && isHtmlResponse(response.data)) {
      console.error('[API] Received HTML instead of JSON - ngrok tunnel may be offline');
      console.error('[API] Response status:', response.status);
      console.error('[API] Response data preview:', typeof response.data === 'string' ? response.data.substring(0, 300) : 'Not a string');
      const error = new Error('ngrok tunnel is offline. The backend server may not be running or ngrok needs to be restarted.');
      error.isHtmlResponse = true;
      error.originalData = typeof response.data === 'string' ? response.data.substring(0, 200) : response.data;
      error.response = response; // Include the response so we can check status
      return Promise.reject(error);
    }
    return response;
  },
  (error) => {
    if (error.code === 'ECONNABORTED') {
      console.error('[API] Request timeout');
      error.message = 'Request timed out. The server may be slow or unavailable. Please check if the backend is running.';
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message === 'Network Error' || !error.response) {
      console.error('[API] Connection error:', error.message);
      console.error('[API] Error code:', error.code);
      console.error('[API] Error details:', {
        message: error.message,
        code: error.code,
        config: error.config ? {
          url: error.config.url,
          baseURL: error.config.baseURL,
          method: error.config.method
        } : 'no config'
      });
      const currentUrl = error.config?.baseURL || API_BASE_URL;

      if (error.message === 'Network Error' || !error.response) {
        error.message = __DEV__
          ? `Network Error: Cannot reach ${currentUrl}. This might be:\n1. ngrok tunnel is down (restart ngrok)\n2. SSL/certificate issue with ngrok\n3. Backend server not running on port 3000\n4. Try testing the URL in your phone's browser first`
          : `Network Error: Cannot reach ${currentUrl}. Check your internet connection and try again. If it continues, the service may be temporarily unavailable. (Rebuild the app if this still shows an old URL.)`;
      } else {
        error.message = __DEV__
          ? `Cannot connect to server at ${currentUrl}. Please check:\n1. Backend server is running (npm start)\n2. API URL is correct in mobile/services/api.js\n3. If using physical device, use your computer's IP address instead of localhost`
          : `Cannot connect to server at ${currentUrl}. Please try again later.`;
      }
    } else if (error.response) {
      // Server responded with error status
      console.error('[API] Server error:', error.response.status);
      console.error('[API] Response data:', typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : error.response.data);
      console.error('[API] Full response data:', JSON.stringify(error.response.data, null, 2));
      console.error('[API] Request URL was:', error.config?.baseURL + error.config?.url);
      
      // IMPORTANT: Preserve the full error.response.data object, especially needsClarification flag
      // Don't modify error.response.data, only modify error.message
      
      // Check if it's the ngrok HTML error page
      if (typeof error.response.data === 'string' && error.response.data.includes('ngrok')) {
        error.message = 'ngrok tunnel is not connected to backend. Make sure backend is running on port 3000 and ngrok is forwarding to it.';
      } else {
        error.message = error.response.data?.error || error.response.data?.details || `Server error: ${error.response.status}`;
        // Preserve needsClarification flag on error object for easy access
        if (error.response.data?.needsClarification !== undefined) {
          error.needsClarification = error.response.data.needsClarification;
          console.log('[API] Preserved needsClarification flag:', error.needsClarification);
        }
      }
    } else {
      console.error('[API] Unknown error:', error.message);
      error.message = error.message || 'An unknown error occurred';
    }
    return Promise.reject(error);
  }
);

// Test connection function
export const testConnection = async () => {
  try {
    const response = await api.get('/health');
    console.log('[API] Connection test successful:', response.data);
    return response.data;
  } catch (error) {
    console.error('[API] Connection test failed:', error);
    throw error;
  }
};

export const sessionAPI = {
  create: async (transcript, personName = null, useExistingPersonId = null, forceCreateNew = false) => {
    try {
      const clientContext = {
        clientLocalNow: new Date().toISOString(),
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      };
      const response = await api.post('/sessions', { 
        transcript, 
        personName,
        useExistingPersonId,
        forceCreateNew,
        ...clientContext,
      });
      return response.data;
    } catch (error) {
      console.error('Error creating session:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        response: error.response ? {
          status: error.response.status,
          data: typeof error.response.data === 'string' ? error.response.data.substring(0, 100) : error.response.data
        } : 'No response',
        request: error.config ? {
          url: error.config.url,
          baseURL: error.config.baseURL,
          method: error.config.method
        } : 'No config'
      });
      throw error;
    }
  },
  
  getByPerson: async (personId) => {
    try {
      const response = await api.get(`/sessions/person/${personId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching sessions:', error);
      throw error;
    }
  },

  transfer: async (sessionId, targetPersonId) => {
    try {
      const response = await api.post(`/sessions/${sessionId}/transfer`, {
        targetPersonId,
      });
      return response.data;
    } catch (error) {
      console.error('[sessionAPI] Error transferring session:', error);
      throw error;
    }
  },

  update: async (sessionId, { notes, transcript }) => {
    try {
      const response = await api.put(`/sessions/${sessionId}`, { notes, transcript });
      return response.data;
    } catch (error) {
      console.error('[sessionAPI] Error updating session:', error);
      throw error;
    }
  },

  delete: async (sessionId) => {
    try {
      const response = await api.delete(`/sessions/${sessionId}`);
      return response.data;
    } catch (error) {
      console.error('[sessionAPI] Error deleting session:', error);
      throw error;
    }
  },

  resolveMulti: async (transcript, entities) => {
    try {
      const response = await api.post('/sessions/multi-resolve', {
        transcript,
        entities,
        clientLocalNow: new Date().toISOString(),
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      });
      return response.data;
    } catch (error) {
      console.error('[sessionAPI] Error resolving multi-entity session:', error);
      throw error;
    }
  },
};

export const personAPI = {
  getAll: async () => {
    try {
      const response = await api.get('/persons');
      // Double-check for HTML response
      if (isHtmlResponse(response.data)) {
        throw new Error('ngrok tunnel is offline. Please restart ngrok and ensure the backend server is running.');
      }
      return response.data;
    } catch (error) {
      console.error('[personAPI] Error fetching persons:', error);
      if (error.isHtmlResponse || isHtmlResponse(error.originalData)) {
        error.message = 'ngrok tunnel is offline. Please restart ngrok and ensure the backend server is running on port 3000.';
      }
      throw error;
    }
  },
  
  getAllWithGroups: async () => {
    try {
      const response = await api.get('/persons?includeGroups=true');
      // Double-check for HTML response
      if (isHtmlResponse(response.data)) {
        throw new Error('ngrok tunnel is offline. Please restart ngrok and ensure the backend server is running.');
      }
      return response.data;
    } catch (error) {
      console.error('[personAPI] Error fetching persons with groups:', error);
      if (error.isHtmlResponse || isHtmlResponse(error.originalData)) {
        error.message = 'ngrok tunnel is offline. Please restart ngrok and ensure the backend server is running on port 3000.';
      }
      throw error;
    }
  },
  
  getById: async (id) => {
    try {
      const response = await api.get(`/persons/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching person:', error);
      throw error;
    }
  },
  
  create: async (firstName, lastName, fullName) => {
    try {
      const response = await api.post('/persons', { firstName, lastName, fullName });
      return response.data;
    } catch (error) {
      console.error('Error creating person:', error);
      throw error;
    }
  },
  
  update: async (id, firstName, lastName, fullName) => {
    try {
      const response = await api.put(`/persons/${id}`, { firstName, lastName, fullName });
      return response.data;
    } catch (error) {
      console.error('Error updating person:', error);
      throw error;
    }
  },
  
  delete: async (id) => {
    try {
      const response = await api.delete(`/persons/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting person:', error);
      throw error;
    }
  },

  getSummary: async (id) => {
    try {
      const response = await api.get(`/persons/${id}/summary`);
      return response.data;
    } catch (error) {
      console.error('Error fetching character summary:', error);
      throw error;
    }
  },
};

export const queryAPI = {
  ask: async (query, personId = null) => {
    try {
      const response = await api.post('/queries', { query, personId });
      return response.data;
    } catch (error) {
      console.error('Error processing query:', error);
      throw error;
    }
  },
};

export const authAPI = {
  register: async (username, email, password, privacyConsentAccepted = false) => {
    try {
      const response = await api.post('/auth/register', {
        username,
        email,
        password,
        privacyConsentAccepted,
      });
      return response.data;
    } catch (error) {
      console.error('[Auth] Error registering:', error);
      throw error;
    }
  },

  verifyEmailCode: async (email, code) => {
    try {
      const response = await api.post('/auth/register/verify-code', { email, code });
      if (response.data.token) {
        await tokenStorage.saveToken(response.data.token);
      }
      return response.data;
    } catch (error) {
      console.error('[Auth] Error verifying email code:', error);
      throw error;
    }
  },

  resendVerificationCode: async (email) => {
    try {
      const response = await api.post('/auth/register/resend-code', { email });
      return response.data;
    } catch (error) {
      console.error('[Auth] Error resending verification code:', error);
      throw error;
    }
  },
  
  login: async (username, password) => {
    try {
      console.log('[Auth] Attempting login for username:', username);
      const response = await api.post('/auth/login', { username, password });
      console.log('[Auth] Login response:', response.status, response.data);
      if (response.data.token) {
        await tokenStorage.saveToken(response.data.token);
        console.log('[Auth] Token saved successfully');
      }
      return response.data;
    } catch (error) {
      console.error('[Auth] Error logging in:', error);
      console.error('[Auth] Error response:', error.response?.status, error.response?.data);
      // Make sure we show proper error message
      if (error.response?.status === 401) {
        error.message = error.response.data?.error || 'Invalid username or password';
        // Make sure error is thrown
        throw error;
      }
      // Re-throw the error
      throw error;
    }
  },
  
  logout: async () => {
    await tokenStorage.removeToken();
  },
  
  verify: async () => {
    try {
      // Check if token exists before making the request
      const token = await tokenStorage.getToken();
      if (!token) {
        throw new Error('No token available');
      }
      
      const response = await api.get('/auth/verify');
      return response.data;
    } catch (error) {
      console.error('[Auth] Error verifying token:', error);
      // Only remove token if it's an authentication error, not if token is missing
      if (error.response?.status === 401 || error.response?.status === 403) {
        await tokenStorage.removeToken();
      }
      throw error;
    }
  },
  
  isAuthenticated: async () => {
    const token = await tokenStorage.getToken();
    return !!token;
  },

  requestPasswordReset: async (identifier) => {
    try {
      const response = await api.post('/auth/password-reset/request', { identifier });
      return response.data;
    } catch (error) {
      console.error('[Auth] Error requesting password reset:', error);
      throw error;
    }
  },

  confirmPasswordReset: async (identifier, code, newPassword) => {
    try {
      const response = await api.post('/auth/password-reset/confirm', {
        identifier,
        code,
        newPassword,
      });
      return response.data;
    } catch (error) {
      console.error('[Auth] Error confirming password reset:', error);
      throw error;
    }
  },

  completeOnboarding: async () => {
    try {
      const response = await api.post('/auth/onboarding/complete');
      return response.data;
    } catch (error) {
      console.error('[Auth] Error completing onboarding:', error);
      throw error;
    }
  },

  requestEmailUpgradeCode: async (email) => {
    try {
      const response = await api.post('/auth/email-upgrade/request-code', { email });
      return response.data;
    } catch (error) {
      console.error('[Auth] Error requesting email upgrade code:', error);
      throw error;
    }
  },

  verifyEmailUpgradeCode: async (code) => {
    try {
      const response = await api.post('/auth/email-upgrade/verify-code', { code });
      return response.data;
    } catch (error) {
      console.error('[Auth] Error verifying email upgrade code:', error);
      throw error;
    }
  },

  acceptPrivacyConsent: async () => {
    try {
      const response = await api.post('/auth/privacy-consent');
      return response.data;
    } catch (error) {
      console.error('[Auth] Error accepting privacy consent:', error);
      throw error;
    }
  },
};

export const profileAPI = {
  updateName: async (name) => {
    try {
      const response = await api.put('/profile/name', { name });
      return response.data;
    } catch (error) {
      console.error('[Profile] Error updating name:', error);
      throw error;
    }
  },

  updateUsername: async (username) => {
    try {
      const response = await api.put('/profile/username', { username });
      return response.data;
    } catch (error) {
      console.error('[Profile] Error updating username:', error);
      throw error;
    }
  },

  deleteAccount: async ({ username, password }) => {
    try {
      const response = await api.delete('/profile/account', {
        data: { username, password },
      });
      return response.data;
    } catch (error) {
      console.error('[Profile] Error deleting account:', error);
      throw error;
    }
  },
  
  getProfile: async () => {
    try {
      const response = await api.get('/profile');
      return response.data;
    } catch (error) {
      console.error('[Profile] Error fetching profile:', error);
      throw error;
    }
  }
};

export const groupsAPI = {
  getAll: async () => {
    try {
      const response = await api.get('/groups');
      return response.data;
    } catch (error) {
      console.error('[Groups] Error fetching groups:', error);
      throw error;
    }
  },
  
  getById: async (id) => {
    try {
      const response = await api.get(`/groups/${id}`);
      return response.data;
    } catch (error) {
      console.error('[Groups] Error fetching group:', error);
      throw error;
    }
  },
  
  create: async (name) => {
    try {
      const response = await api.post('/groups', { name });
      return response.data;
    } catch (error) {
      console.error('[Groups] Error creating group:', error);
      throw error;
    }
  },
  
  update: async (id, name) => {
    try {
      const response = await api.put(`/groups/${id}`, { name });
      return response.data;
    } catch (error) {
      console.error('[Groups] Error updating group:', error);
      throw error;
    }
  },
  
  delete: async (id) => {
    try {
      const response = await api.delete(`/groups/${id}`);
      return response.data;
    } catch (error) {
      console.error('[Groups] Error deleting group:', error);
      throw error;
    }
  },
  
  addPerson: async (groupId, personId) => {
    try {
      const response = await api.post(`/groups/${groupId}/persons/${personId}`);
      return response.data;
    } catch (error) {
      console.error('[Groups] Error adding person to group:', error);
      throw error;
    }
  },
  
  removePerson: async (groupId, personId) => {
    try {
      const response = await api.delete(`/groups/${groupId}/persons/${personId}`);
      return response.data;
    } catch (error) {
      console.error('[Groups] Error removing person from group:', error);
      throw error;
    }
  }
};

export const calendarAPI = {
  getEvents: async (startDate = null, endDate = null) => {
    try {
      const params = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      
      const response = await api.get('/calendar', { params });
      return response.data;
    } catch (error) {
      console.error('[Calendar] Error fetching calendar events:', error);
      throw error;
    }
  },
  
  getEventsByDate: async (date) => {
    try {
      const response = await api.get(`/calendar/date/${date}`);
      return response.data;
    } catch (error) {
      console.error('[Calendar] Error fetching calendar events for date:', error);
      throw error;
    }
  },
  
  deleteEvent: async (eventId) => {
    try {
      const response = await api.delete(`/calendar/${eventId}`);
      return response.data;
    } catch (error) {
      console.error('[Calendar] Error deleting calendar event:', error);
      throw error;
    }
  },

  updateEvent: async (eventId, { eventDate, summary }) => {
    try {
      const response = await api.put(`/calendar/${eventId}`, { eventDate, summary });
      return response.data;
    } catch (error) {
      console.error('[Calendar] Error updating calendar event:', error);
      throw error;
    }
  },
};

export const transcribeAPI = {
  transcribe: async (audioUri) => {
    try {
      console.log('[transcribeAPI] Transcribing audio:', audioUri);
      
      // Verify URI is valid
      if (!audioUri) {
        throw new Error('No audio URI provided');
      }
      
      // Get auth token
      const token = await tokenStorage.getToken();
      
      // For React Native, we need to use a different approach
      // React Native FormData works differently than Node.js FormData
      const formData = new FormData();
      
      // Get file name from URI and ensure it has .m4a extension
      // expo-av on iOS records as .m4a but the URI might not include extension
      let filename = audioUri.split('/').pop() || 'recording.m4a';
      
      // Remove any query parameters from filename
      filename = filename.split('?')[0];
      
      // Ensure filename has .m4a extension (Whisper-compatible)
      if (!filename.match(/\.(m4a|mp3|wav|webm|ogg|flac|mp4)$/i)) {
        filename = filename.replace(/\.[^/.]+$/, '') + '.m4a';
      }
      
      // Use correct MIME type for m4a
      const fileType = 'audio/x-m4a'; // Changed from 'audio/m4a' to 'audio/x-m4a'
      
      console.log('[transcribeAPI] Uploading file:', filename, 'Type:', fileType, 'URI:', audioUri);
      
      // Append file to FormData (React Native style)
      // Important: React Native FormData requires specific format
      formData.append('audio', {
        uri: audioUri,
        type: fileType,
        name: filename,
      });
      
      // Build headers
      const headers = {
        'Content-Type': 'multipart/form-data',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'ToHim-Mobile-App',
      };
      
      // Add auth token if available
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      
      // Send to backend using axios directly (not the api instance) to avoid Content-Type override
      const response = await axios.post(`${API_BASE_URL}/transcribe`, formData, {
        headers,
        timeout: 120000, // 2 minutes for transcription
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      
      console.log('[transcribeAPI] Transcription successful');
      return response.data;
    } catch (error) {
      console.error('[transcribeAPI] Error transcribing audio:', error);
      console.error('[transcribeAPI] Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        uri: audioUri
      });
      throw error;
    }
  },
};

export default api;

