/**
 * Locale configuration for all formatters. Can be changed globally or via Context in the future.
 */
let currentLocale = 'en-US';

export function setFormatterLocale(locale) {
  if (locale !== currentLocale) {
    currentLocale = locale;
    // Clear caches when locale changes
    currencyFormatters = {};
    dateFormatters = {};
  }
}

export function getFormatterLocale() {
  return currentLocale;
}

/**
 * Cached formatter instances to avoid creating new Intl.NumberFormat on every call
 */
let currencyFormatters = {};
let dateFormatters = {};

export function getCurrencyFormatter(currency = 'USD') {
  if (!currencyFormatters[currency]) {
    currencyFormatters[currency] = new Intl.NumberFormat(currentLocale, {
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

function getDateFormatter(options = {}) {
  const key = JSON.stringify(options);
  if (!dateFormatters[key]) {
    dateFormatters[key] = new Intl.DateTimeFormat(currentLocale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...options,
    });
  }
  return dateFormatters[key];
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return getDateFormatter().format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export function formatDateTime(ts) {
  if (!ts) return '';
  try {
    const dateFormatter = new Intl.DateTimeFormat(currentLocale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return dateFormatter.format(new Date(typeof ts === 'number' ? ts * 1000 : ts));
  } catch {
    return String(ts);
  }
}

export function formatPercent(rate, decimals = 3) {
  if (typeof rate !== 'number') return String(rate ?? '');
  return `${rate.toFixed(decimals)}%`;
}

export function formatValue(value, format, currency = 'USD') {
  if (value === null || value === undefined) return '—';
  switch (format) {
    case 'money':
      return formatCurrency(value, currency);
    case 'date':
      return formatDate(value);
    case 'percent':
      return formatPercent(value, 2);
    case 'count':
      return String(Math.round(Number(value)));
    case 'text':
    default:
      return String(value);
  }
}
