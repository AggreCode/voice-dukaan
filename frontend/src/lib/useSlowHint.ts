import { useEffect, useRef, useState } from 'react';

/**
 * True once something has been running longer than it ought to.
 *
 * A free instance sleeps after fifteen idle minutes and takes the best part of a minute to wake, so
 * the first sign-in of the day is genuinely slow. Saying that beats a spinner that looks broken, and
 * it stops a shopkeeper reloading the page in the middle of it, which only starts the wait again.
 */
export function useSlowHint(active: boolean, afterMs = 2500): boolean {
  const [slow, setSlow] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!active) {
      setSlow(false);
      return;
    }
    timer.current = window.setTimeout(() => setSlow(true), afterMs);
    return () => window.clearTimeout(timer.current);
  }, [active, afterMs]);
  return slow;
}
