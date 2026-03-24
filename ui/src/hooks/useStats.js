import { useState, useEffect, useRef } from 'react';

export function useStats(sessionId, intervalMs = 2000) {
  const [stats, setStats] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const url = sessionId
          ? `/api/stats?session_id=${encodeURIComponent(sessionId)}`
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
  }, [sessionId, intervalMs]);

  return stats;
}
