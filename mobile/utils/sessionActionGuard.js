/**
 * Prevents double-fires from rapid taps before React state updates.
 * Use a ref + this helper at the start of async handlers (submit, modal actions).
 */
export function tryBeginSessionAction(sessionActionInFlightRef) {
  if (sessionActionInFlightRef.current) {
    return false;
  }
  sessionActionInFlightRef.current = true;
  return true;
}

export function endSessionAction(sessionActionInFlightRef) {
  sessionActionInFlightRef.current = false;
}
