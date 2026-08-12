// The one way this app reads data from the server.


import { useCallback, useEffect, useRef, useState } from "react";
import { isCanceled, parseApiError } from "../api/client";


export function useApiResource(fetcher, options = {}) {
  const {
    deps = [],
    enabled = true,
    fallback = "Something went wrong. Please try again.",
    initialData = null,
    keepPreviousData = false,
  } = options;

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // The request in flight. A slower earlier request must not be able to land
  // after a faster later one and leave the screen showing superseded data.
  const inFlight = useRef(null);

  // Whether anything has ever arrived. Decides which of the two flags a re-fetch
  // sets, and stays false after a failed first load so a retry shows the skeleton
  // rather than flashing an empty state.
  const hasLoaded = useRef(false);

  // Read through a ref so a new inline `fetcher` on every render does not
  // re-trigger the effect. `deps` is the intended trigger.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    if (hasLoaded.current && keepPreviousData) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const result = await fetcherRef.current({ signal: controller.signal });

      // Superseded while awaiting: the request that replaced this one owns the
      // state now, and writing to it here would undo their work.
      if (controller.signal.aborted) return;

      setData(result);
      hasLoaded.current = true;
    } catch (err) {
      // Aborted, not failed. Showing an error for a request the app itself
      // cancelled would be a lie.
      if (isCanceled(err) || controller.signal.aborted) return;
      setError(parseApiError(err, fallback).message);
    } finally {
      // Only the newest request may clear the flags. An aborted one reaches here
      // after its replacement has already claimed `inFlight`.
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [fallback, keepPreviousData]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    run();

    // Abort on unmount and before every re-run, so a request whose screen has
    // gone away cannot call `setState` on an unmounted component.
    return () => inFlight.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { data, setData, loading, refreshing, error, reload: run };
}

export default useApiResource;
