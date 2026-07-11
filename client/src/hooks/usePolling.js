import { useState, useEffect, useRef, useCallback } from 'react';

/*
  Read-only polling (3s default). The server computes on WRITE (sim tick);
  this hook only reads — no analytics run in the request path.
*/
export function usePolling(fetcher, intervalMs = 3000, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const d = await fetcher();
      if (alive.current) { setData(d); setError(null); }
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

  return { data, error, refresh: load };
}
