import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const OnboardingContext = createContext(null);

export function OnboardingProvider({ children }) {
  const [targets, setTargets] = useState({});

  const registerTarget = useCallback((key, rect) => {
    if (!key || !rect) return;
    setTargets((prev) => ({
      ...prev,
      [key]: rect,
    }));
  }, []);

  const value = useMemo(
    () => ({
      targets,
      registerTarget,
    }),
    [targets, registerTarget]
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return ctx;
}

