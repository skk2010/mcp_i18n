import { describe, expect, it } from 'vitest';
import { extractPlaceholders, flatten, isEmptyValue, joinKey, splitKey } from '../src/keys.js';

describe('splitKey / joinKey', () => {
  it('splits a dot-separated path', () => {
    expect(splitKey('roles_scope.super_admin')).toEqual(['roles_scope', 'super_admin']);
  });

  it('drops empty segments', () => {
    expect(splitKey('a..b.')).toEqual(['a', 'b']);
  });

  it('round-trips through joinKey', () => {
    expect(joinKey(splitKey('a.b.c'))).toBe('a.b.c');
  });
});

describe('flatten', () => {
  it('flattens nested objects into dot paths', () => {
    const tree = {
      common: { cancel: 'Cancel', nested: { deep: 'Deep' } },
      top: 'Top',
      list: ['a', 'b'],
    };
    const flat = flatten(tree);
    expect(flat.get('common.cancel')).toBe('Cancel');
    expect(flat.get('common.nested.deep')).toBe('Deep');
    expect(flat.get('top')).toBe('Top');
    expect(flat.get('list')).toEqual(['a', 'b']);
  });

  it('keeps empty objects as leaves', () => {
    const flat = flatten({ empty: {} });
    expect(flat.get('empty')).toEqual({});
  });
});

describe('extractPlaceholders', () => {
  it('finds placeholder names', () => {
    expect(extractPlaceholders('Hello %{name}, you have %{count} messages')).toEqual(['name', 'count']);
  });

  it('deduplicates repeated placeholders', () => {
    expect(extractPlaceholders('%{a} %{a}')).toEqual(['a']);
  });

  it('returns an empty list for non-strings', () => {
    expect(extractPlaceholders(42)).toEqual([]);
    expect(extractPlaceholders(null)).toEqual([]);
  });
});

describe('isEmptyValue', () => {
  it('treats undefined, null and blank strings as empty', () => {
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('   ')).toBe(true);
    expect(isEmptyValue('x')).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
  });
});
