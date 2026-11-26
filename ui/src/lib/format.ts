export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(' ');
}

export function shortHash(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) {
    return '—';
  }
  if (value.length <= head + tail + 2) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatAmount(raw: string | undefined, decimals: number): string {
  if (!raw || !/^\d+$/.test(raw)) {
    return raw ?? '—';
  }

  const value = BigInt(raw);
  const base = 10n ** BigInt(Math.max(0, decimals));
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction
    .toString()
    .padStart(Math.max(0, decimals), '0')
    .replace(/0+$/, '');

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${fractionText ? `.${fractionText}` : ''}`;
}

export function formatDateTime(timestamp: string | undefined): string {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}
