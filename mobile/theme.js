/** Light palette (default) */
export const lightColors = {
  background: '#F7F8FA',
  /** Common settings / login gray screens */
  screenMuted: '#f5f5f5',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F5F8',
  border: '#E6EAF0',
  textPrimary: '#1F2937',
  textSecondary: '#5B6470',
  /** Deeper, less “baby blue” than pure sky tones */
  primary: '#2F6FB8',
  primarySoft: 'rgba(47, 111, 184, 0.10)',
  danger: '#FF3B30',
  warningSoft: '#FFF7E5',
  warning: '#D97706',
  placeholderText: '#5C6370',
  tabBarInactive: '#8A94A6',
  /** Text / chrome that stays dark-on-light */
  titleGray: '#333333',
  inverseText: '#FFFFFF',
};

/** Dark palette */
export const darkColors = {
  background: '#000000',
  screenMuted: '#000000',
  surface: '#1C1C1E',
  surfaceMuted: '#2C2C2E',
  border: '#38383A',
  textPrimary: '#F2F2F7',
  textSecondary: '#AEAEB2',
  /** Muted steel blue — avoids “neon” light blue on dark backgrounds */
  primary: '#4D6B8F',
  primarySoft: 'rgba(77, 107, 143, 0.28)',
  danger: '#FF453A',
  warningSoft: 'rgba(255, 214, 10, 0.18)',
  warning: '#FFD60A',
  placeholderText: '#8E8E93',
  tabBarInactive: '#8E8E93',
  titleGray: '#F2F2F7',
  inverseText: '#FFFFFF',
};

/** @deprecated Use useTheme().colors — kept for gradual migration */
export const COLORS = lightColors;

export const RADIUS = {
  card: 20,
  button: 999,
  chip: 999,
  modal: 20,
};

export function getShadow(colors, isDark) {
  return {
    card: {
      shadowColor: isDark ? '#000000' : '#0F172A',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.45 : 0.08,
      shadowRadius: 14,
      elevation: isDark ? 6 : 3,
    },
    button: {
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 4,
    },
  };
}

/** @deprecated Use useTheme().shadow */
export const SHADOW = getShadow(lightColors, false);

export const lightGlass = {
  tint: 'light',
  intensity: 38,
  elevatedIntensity: 52,
  backgroundFallback: 'rgba(255, 255, 255, 0.72)',
  backgroundStrongFallback: 'rgba(255, 255, 255, 0.84)',
  borderColor: 'rgba(255, 255, 255, 0.45)',
  borderColorStrong: 'rgba(255, 255, 255, 0.62)',
};

export const darkGlass = {
  tint: 'dark',
  intensity: 48,
  elevatedIntensity: 58,
  backgroundFallback: 'rgba(28, 28, 30, 0.85)',
  backgroundStrongFallback: 'rgba(44, 44, 46, 0.92)',
  borderColor: 'rgba(255, 255, 255, 0.12)',
  borderColorStrong: 'rgba(255, 255, 255, 0.2)',
};

/** @deprecated Use useTheme().glass */
export const GLASS = lightGlass;
