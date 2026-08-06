/** Mutex síncrono para doble tap antes de que React alcance a re-renderizar. */
export function createInFlightMutex(): { tryEnter(): boolean; leave(): void } {
  let held = false;
  return {
    tryEnter() {
      if (held) return false;
      held = true;
      return true;
    },
    leave() {
      held = false;
    },
  };
}
