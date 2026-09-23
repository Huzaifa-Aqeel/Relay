import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { colors, radii } from '@/theme/tokens';

const WAVE_HEIGHTS = [24, 38, 52, 38, 24];
const IDLE_LEVELS = [0.42, 0.68, 1, 0.68, 0.42];

export function durationLabel(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function VoiceWaveButton({
  disabled,
  isRecording,
  onPress,
}: {
  disabled: boolean;
  isRecording: boolean;
  onPress: () => void;
}) {
  const levels = useRef(WAVE_HEIGHTS.map((_, index) => new Animated.Value(IDLE_LEVELS[index]))).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isRecording) {
      levels.forEach((level, index) => level.setValue(IDLE_LEVELS[index]));
      pulse.setValue(0);
      return;
    }

    const waveform = levels.map((level, index) => Animated.loop(Animated.sequence([
      Animated.timing(level, {
        duration: 260 + index * 45,
        easing: Easing.inOut(Easing.ease),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(level, {
        duration: 320 + index * 35,
        easing: Easing.inOut(Easing.ease),
        toValue: 0.22,
        useNativeDriver: true,
      }),
    ])));
    const halo = Animated.loop(Animated.sequence([
      Animated.timing(pulse, {
        duration: 850,
        easing: Easing.out(Easing.ease),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        duration: 850,
        easing: Easing.in(Easing.ease),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]));
    const animation = Animated.parallel([...waveform, halo], { stopTogether: false });
    animation.start();
    return () => {
      animation.stop();
      levels.forEach((level, index) => level.setValue(IDLE_LEVELS[index]));
      pulse.setValue(0);
    };
  }, [isRecording, levels, pulse]);

  return (
    <View style={styles.frame}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.42] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] }) }],
          },
        ]}
      />
      <Pressable
        accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          isRecording && styles.recording,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}>
        {isRecording ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.waveform}>
            {levels.map((level, index) => (
              <Animated.View
                key={`wave-${index}`}
                style={[styles.bar, { height: WAVE_HEIGHTS[index], transform: [{ scaleY: level }] }]}
              />
            ))}
          </View>
        ) : <MaterialCommunityIcons color={colors.white} name="microphone-outline" size={38} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 116, height: 116, borderRadius: 58, backgroundColor: '#F2B9B0' },
  button: {
    width: 104,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 52,
    backgroundColor: colors.moss,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  recording: { backgroundColor: colors.emergency },
  disabled: { opacity: 0.58 },
  waveform: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 5 },
  bar: { width: 5, borderRadius: radii.pill, backgroundColor: colors.white },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
});
