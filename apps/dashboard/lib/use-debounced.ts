import { useEffect, useState } from 'react';

/** The value, but only once it has stopped changing for `ms`: for a preview that should not redraw at every key. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
