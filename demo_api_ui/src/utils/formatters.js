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
