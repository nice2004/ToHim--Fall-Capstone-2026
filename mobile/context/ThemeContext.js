import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  darkColors,
  darkGlass,
  getShadow,
  lightColors,
  lightGlass,
} from '../theme';

const DARK_MODE_KEY = 'darkModeEnabled';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await SecureStore.getItemAsync(DARK_MODE_KEY);
        if (v === 'true') setIsDark(true);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const setDarkMode = useCallback(async (value) => {
    const next = Boolean(value);
    setIsDark(next);
    try {
      await SecureStore.setItemAsync(DARK_MODE_KEY, next ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => {
    const colors = isDark ? darkColors : lightColors;
    const glass = isDark ? darkGlass : lightGlass;
    const shadow = getShadow(colors, isDark);
    return {
      isDark,
      colors,
      glass,
      shadow,
      setDarkMode,
    };
  }, [isDark, setDarkMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
