/**
 * Cached formatter instances to avoid creating new Intl.NumberFormat on every call
 */
const currencyFormatters = {};

export function getCurrencyFormatter(currency = 'USD') {
  if (!currencyFormatters[currency]) {
    currencyFormatters[currency] = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    });
  }
  return currencyFormatters[currency];
}

export function formatCurrency(amount, currency = 'USD') {
  if (typeof amount !== 'number') return String(amount ?? '');
  return getCurrencyFormatter(currency).format(amount);
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(iso);
  }
}

export function formatDateTime(ts) {
  if (!ts) return '';
  try {
    return new Date(typeof ts === 'number' ? ts * 1000 : ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function formatPercent(rate, decimals = 3) {
  if (typeof rate !== 'number') return String(rate ?? '');
  return `${rate.toFixed(decimals)}%`;
}
