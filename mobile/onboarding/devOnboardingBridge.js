/**
 * Dev-only hookup so Settings (or other screens) can reopen the coach-mark tour
 * without resetting server onboarding state.
 */
let setPreview = null;

export function registerDevOnboardingPreview(setter) {
  if (!__DEV__) {
    return () => {};
  }
  setPreview = setter;
  return () => {
    setPreview = null;
  };
}

export function openDevOnboardingPreview() {
  if (__DEV__) {
    setPreview?.(true);
  }
}
