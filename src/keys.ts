/** Helpers for working with dot-separated translation key paths. */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Split a dot-separated key path into segments. */
export function splitKey(key: string): string[] {
  return key.split('.').filter((segment) => segment.length > 0);
}

/** Join key segments back into a dot-separated path. */
export function joinKey(segments: string[]): string {
  return segments.join('.');
}

/**
 * Flatten a nested locale tree into a map of dot-separated key paths to leaf
 * values. Anything that is not a plain object (strings, numbers, booleans,
 * arrays, null) counts as a leaf.
 */
export function flatten(node: unknown, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (isPlainObject(node)) {
    const entries = Object.entries(node);
    if (entries.length === 0 && prefix.length > 0) {
      out.set(prefix, node);
    }
    for (const [key, value] of entries) {
      flatten(value, prefix.length > 0 ? `${prefix}.${key}` : key, out);
    }
  } else if (prefix.length > 0) {
    out.set(prefix, node);
  }
  return out;
}

/** Extract `%{placeholder}` names from a translation value. */
export function extractPlaceholders(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const names = new Set<string>();
  const pattern = /%\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names];
}

/** True when a value counts as an empty/untranslated translation. */
export function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
}

