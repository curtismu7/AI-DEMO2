import React from 'react';

/**
 * Higher-order component to wrap components with React.memo
 * Memoizes based on props comparison to prevent unnecessary re-renders
 *
 * @param {React.Component} Component - Component to memoize
 * @param {Function} propsAreEqual - Custom comparison function (optional)
 * @returns {React.MemoExoticComponent} Memoized component
 *
 * @example
 * // Basic usage
 * export default withMemo(MessageBubble);
 *
 * // With custom comparison
 * export default withMemo(TokenChain, (prev, next) => {
 *   return prev.tokens.length === next.tokens.length;
 * });
 */
export function withMemo(Component, propsAreEqual) {
  const Memoized = React.memo(Component, propsAreEqual);
  Memoized.displayName = `withMemo(${Component.displayName || Component.name})`;
  return Memoized;
}

/**
 * Hook to memoize a callback function
 * Prevents callback from changing unless dependencies change
 *
 * @param {Function} callback - Function to memoize
 * @param {Array} deps - Dependency array
 * @returns {Function} Memoized callback
 *
 * @example
 * const handleClick = useCallback(() => {
 *   console.log('Clicked');
 * }, []);
 */
export const useCallback = React.useCallback;

/**
 * Hook to memoize expensive computations
 * Only recalculates when dependencies change
 *
 * @param {Function} compute - Expensive function to memoize
 * @param {Array} deps - Dependency array
 * @returns {*} Memoized result
 *
 * @example
 * const sortedMessages = useMemo(() => {
 *   return messages.sort((a, b) => b.timestamp - a.timestamp);
 * }, [messages]);
 */
export const useMemo = React.useMemo;

export default withMemo;
