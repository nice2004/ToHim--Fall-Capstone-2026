import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';

export default function GlassSurface({
  children,
  style,
  intensity: intensityProp,
  tint: tintProp,
  strong = false,
}) {
  const { glass, shadow } = useTheme();
  const intensity = intensityProp ?? glass.intensity;
  const tint = tintProp ?? glass.tint;
  const fallbackBackground = strong ? glass.backgroundStrongFallback : glass.backgroundFallback;
  const borderColor = strong ? glass.borderColorStrong : glass.borderColor;

  return (
    <View
      style={[
        styles.base,
        shadow.card,
        { backgroundColor: fallbackBackground, borderColor },
        style,
      ]}
    >
      <BlurView
        intensity={intensity}
        tint={tint}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    overflow: 'hidden',
  },
});
