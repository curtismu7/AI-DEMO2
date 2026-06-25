import { useEffect, useRef } from "react";

/**
 * Hook to safely manage mounted state and prevent memory leaks
 * Prevents setState calls after component unmount
 *
 * @returns {Object} { isMounted: boolean }
 *
 * @example
 * function MyComponent() {
 *   const { isMounted } = useIsMounted();
 *
 *   useEffect(() => {
 *     fetchData().then(data => {
 *       if (isMounted.current) setData(data);
 *     });
 *   }, []);
 * }
 */
export function useIsMounted() {
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  return { isMounted };
}

/**
 * Hook to safely handle async operations with cleanup
 * Cancels in-flight requests if component unmounts
 *
 * @param {Function} asyncFn - Async function to execute
 * @param {Array} deps - Dependency array
 * @returns {Object} { data, loading, error, retry }
 *
 * @example
 * function MyComponent() {
 *   const { data, loading, error } = useAsync(
 *     async () => {
 *       const res = await fetch('/api/data');
 *       return res.json();
 *     },
 *     []
 *   );
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error />;
 *   return <View data={data} />;
 * }
 */
export function useAsync(asyncFn, deps = []) {
  const [state, setState] = require("react").useState({
    data: null,
    loading: true,
    error: null,
  });

  const { isMounted } = useIsMounted();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await asyncFn();
        if (!cancelled && isMounted.current) {
          setState({ data: result, loading: false, error: null });
        }
      } catch (error) {
        if (!cancelled && isMounted.current) {
          setState({ data: null, loading: false, error });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asyncFn, ...deps]);

  return state;
}

/**
 * Hook to safely manage event listeners with cleanup
 * Removes listeners on unmount
 *
 * @param {string} eventName - Event name (e.g., 'resize', 'scroll')
 * @param {Function} handler - Event handler function
 * @param {HTMLElement} target - Target element (default: window)
 * @param {Object} options - Listener options
 *
 * @example
 * function MyComponent() {
 *   useEventListener('resize', () => {
 *     console.log('Window resized');
 *   });
 * }
 */
export function useEventListener(
  eventName,
  handler,
  target = window,
  options = {},
) {
  // Keep the latest handler in a ref so the stable wrapper never goes stale.
  // Depend on a stable serialization of options rather than the object identity
  // so a caller passing a fresh `{}` literal each render doesn't thrash the
  // listener on every render (add/remove on every render drops in-flight events).
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableOptions = JSON.stringify(options);

  useEffect(() => {
    if (!target) return;

    const resolvedOptions = JSON.parse(stableOptions);
    const eventListener = (event) => handlerRef.current(event);
    target.addEventListener(eventName, eventListener, resolvedOptions);

    return () => {
      target.removeEventListener(eventName, eventListener, resolvedOptions);
    };
  }, [eventName, target, stableOptions]);
}

/**
 * Hook to safely manage timers with cleanup
 * Clears timeout on unmount
 *
 * @param {Function} callback - Function to execute
 * @param {number} delay - Delay in milliseconds
 *
 * @example
 * function MyComponent() {
 *   useTimeout(() => {
 *     console.log('Timeout fired');
 *   }, 5000);
 * }
 */
export function useTimeout(callback, delay) {
  useEffect(() => {
    if (delay === null) return;

    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  }, [callback, delay]);
}

/**
 * Hook to safely manage intervals with cleanup
 * Clears interval on unmount
 *
 * @param {Function} callback - Function to execute repeatedly
 * @param {number} interval - Interval in milliseconds
 * @param {boolean} enabled - Enable/disable the interval
 *
 * @example
 * function MyComponent() {
 *   useInterval(() => {
 *     console.log('Interval tick');
 *   }, 1000, isActive);
 * }
 */
export function useInterval(callback, interval, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(callback, interval);
    return () => clearInterval(timer);
  }, [callback, interval, enabled]);
}

/**
 * Hook to safely manage subscriptions with cleanup
 * Unsubscribes on unmount
 *
 * @param {Function} subscribe - Subscribe function (returns unsubscribe function)
 * @param {Array} deps - Dependency array
 *
 * @example
 * function MyComponent() {
 *   useSubscription(() => {
 *     return eventEmitter.subscribe(handler);
 *   }, [eventEmitter]);
 * }
 */
export function useSubscription(subscribe, deps = []) {
  useEffect(() => {
    const unsubscribe = subscribe();
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, ...deps]);
}

const effectCleanupUtils = {
  useIsMounted,
  useAsync,
  useEventListener,
  useTimeout,
  useInterval,
  useSubscription,
};
export default effectCleanupUtils;
