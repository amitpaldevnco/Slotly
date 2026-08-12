// Trails a value, so a fast-changing input drives one request instead of ten.

import { useEffect, useRef, useState } from "react";

export function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return undefined;
    }

    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebouncedValue;
