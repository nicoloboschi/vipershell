import { useState, useEffect, useRef } from 'react';
import useStore from '../store.js';

export function useStats(intervalMs = 2000) {
  const [stats, setStats] = useState(null);
  const currentSessionId = useStore(s => s.currentSessionId);
  const timerRef = useRef(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const url = currentSessionId
          ? `/api/stats?session_id=${encodeURIComponent(currentSessionId)}`
          : '/api/stats';
        const res = await fetch(url);
        if (res.ok) setStats(await res.json());
      } catch {
        // ignore
      }
    }

    fetchStats();
    timerRef.current = setInterval(fetchStats, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [currentSessionId, intervalMs]);

  return stats;
}
