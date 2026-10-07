/**
 * Extends app.json (which stays the source of truth for builds).
 *
 * Expo Go can only open EAS Updates whose runtime version is "exposdk:<SDK>", which the
 * `sdkVersion` policy produces. Our TestFlight/EAS builds use the `appVersion` policy, so we
 * switch policies ONLY while publishing the always-on Expo Go update (`npm run publish:expo-go`
 * sets EXPO_GO_UPDATE=1). Those updates go to their own `expo-go` channel and their runtime
 * version can never match a store build, so they can't reach TestFlight users.
 */
module.exports = ({ config }) => {
  if (process.env.EXPO_GO_UPDATE !== '1') return config;
  return {
    ...config,
    runtimeVersion: { policy: 'sdkVersion' },
  };
};
