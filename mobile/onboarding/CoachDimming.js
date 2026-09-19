import React, { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

const DIM = 'rgba(15, 23, 42, 0.58)';

/**
 * Full-screen dim with rounded-rect holes so underlying UI stays fully visible.
 * Uses **window** size to match `measureInWindow()` (same coordinate space as tab bar / controls).
 * Each hole: { x, y, width, height, rx } — rx matches the underlying control (see CoachMarksOverlay).
 */
export default function CoachDimming({ holes, maskId = 'coachDimMask' }) {
  const { width: W, height: H } = Dimensions.get('window');

  const validHoles = useMemo(
    () =>
      (holes || []).filter(
        (r) => r && r.width > 0 && r.height > 0 && Number.isFinite(r.x) && Number.isFinite(r.y)
      ),
    [holes]
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Defs>
          <Mask id={maskId}>
            <Rect width={W} height={H} fill="#ffffff" />
            {validHoles.map((h, i) => {
              const maxR = Math.min(h.width, h.height) / 2;
              const rx = Math.min(typeof h.rx === 'number' ? h.rx : 16, maxR);
              return (
                <Rect
                  key={`hole-${i}`}
                  x={h.x}
                  y={h.y}
                  width={h.width}
                  height={h.height}
                  rx={rx}
                  ry={rx}
                  fill="#000000"
                />
              );
            })}
          </Mask>
        </Defs>
        <Rect width={W} height={H} fill={DIM} mask={`url(#${maskId})`} />
      </Svg>
    </View>
  );
}
