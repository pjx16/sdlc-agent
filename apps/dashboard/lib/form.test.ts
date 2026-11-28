import { describe, expect, it } from 'vitest';
import { collapseListErrors, getIn, setIn, stringifyNumbers, toNumber } from './form';

describe('collapseListErrors', () => {
  it('folds item errors onto the list path and leaves others alone', () => {
    expect(collapseListErrors({ 'a.0': 'x', 'a.2': 'y', b: 'z', 'c.1': 'w' }, ['a'])).toEqual({ a: 'line 1: x; line 3: y', b: 'z', 'c.1': 'w' });
  });
});

describe('dotted paths and number text', () => {
  it('reads and writes a nested value without touching the rest', () => {
    const v = { a: { b: '1', c: '2' }, d: '3' };
    expect(getIn(v, 'a.b')).toBe('1');
    expect(getIn(v, 'a.x.y')).toBeUndefined();
    expect(setIn(v, 'a.b', '9')).toEqual({ a: { b: '9', c: '2' }, d: '3' });
    expect(v.a.b).toBe('1');
    expect(setIn({}, 'a.b.c', 'new')).toEqual({ a: { b: { c: 'new' } } });
  });
  it('numbers become text in the form and blank text becomes null at the API', () => {
    expect(stringifyNumbers({ a: 1, b: { c: 2.5 }, d: 'x', e: null })).toEqual({ a: '1', b: { c: '2.5' }, d: 'x', e: null });
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber('  ')).toBeNull();
    expect(toNumber(7)).toBe(7);
  });
});
