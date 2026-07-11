import { useState, useEffect, useRef, useCallback } from 'react';

/*
  Read-only polling (3s default). The server computes alerts on WRITE (sim tick);
  this hook only reads — no alert generation in the request path.
  Exposes lastUpdated + error so pages can show data freshness and a visible
  "connection lost" state instead of silently going stale.
*/
export function usePolling(fetcher, intervalMs = 3000, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const d = await fetcher();
      if (alive.current) { setData(d); setError(null); setLastUpdated(new Date()); }
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, intervalMs]);

  useEffect(() => {
    window.addEventListener('sust:data-updated', load);
    return () => window.removeEventListener('sust:data-updated', load);
  }, [load]);

  return { data, error, lastUpdated, refresh: load };
}
