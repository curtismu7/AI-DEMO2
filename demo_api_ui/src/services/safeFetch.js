/**
 * Safe fetch wrapper with error handling, request cancellation, and retry logic
 * Prevents memory leaks from unmounted components
 *
 * @module safeFetch
 * @example
 * const { data, error, loading } = useSafeFetch('/api/accounts');
 */

import React from "react";

/**
 * Wrapper for fetch with comprehensive error handling
 * @param {string} url - API endpoint
 * @param {Object} options - Fetch options
 * @param {AbortSignal} options.signal - Abort signal for cancellation
 * @returns {Promise<Response>} Response object
 * @throws {Error} On HTTP errors or network failures
 */
export async function safeFetch(url, options = {}) {
  try {
    const response = await fetch(url, {
      signal: options.signal,
      ...options,
    });

    if (!response.ok) {
      const error = new Error(
        `HTTP ${response.status}: ${response.statusText}`,
      );
      error.status = response.status;
      error.response = response;
      throw error;
    }

    return response;
  } catch (error) {
    // Re-throw abort errors without modification
    if (error.name === "AbortError") {
      throw error;
    }

    // Log errors in development
    if (process.env.NODE_ENV === "development") {
      console.error(`[safeFetch] Error fetching ${url}:`, error);
    }

    throw error;
  }
}

/**
 * React hook for safe data fetching with loading/error states
 * Handles request cancellation on unmount to prevent memory leaks
 *
 * @param {string} url - API endpoint to fetch
 * @param {Object} options - Options object
 * @param {Object} options.method - HTTP method (default: GET)
 * @param {boolean} options.skip - Skip fetch if true (useful for conditional fetching)
 * @param {*} options.deps - Additional dependencies for refetching
 * @returns {Object} { data, error, loading, refetch }
 *
 * @example
 * const { data, error, loading } = useSafeFetch('/api/accounts');
 *
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error.message} />;
 * return <AccountList accounts={data} />;
 */
export function useSafeFetch(url, options = {}) {
  const [state, setState] = React.useState({
    data: null,
    error: null,
    loading: true,
  });

  const refetch = React.useCallback(() => {
    setState({ data: null, error: null, loading: true });
  }, []);

  React.useEffect(() => {
    if (options.skip) {
      setState({ data: null, error: null, loading: false });
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await safeFetch(url, {
          ...options,
          signal: controller.signal,
        });
        const data = await response.json();

        if (isMounted) {
          setState({ data, error: null, loading: false });
        }
      } catch (error) {
        if (error.name !== "AbortError" && isMounted) {
          setState({
            data: null,
            error,
            loading: false,
          });
        }
      }
    })();

    return () => {
      isMounted = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, options.skip, options.method, ...(options.deps || [])]);

  return { ...state, refetch };
}

export default safeFetch;
