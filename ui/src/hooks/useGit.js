import { useState, useEffect, useRef, useCallback } from 'react';

export function useGit(sessionId, intervalMs = 5000) {
  const [git, setGit] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!sessionId) { setGit(null); return; }

    async function fetchGit() {
      try {
        const res = await fetch(`/api/git/${encodeURIComponent(sessionId)}`);
        if (res.ok) setGit(await res.json());
      } catch { /* ignore */ }
    }

    fetchGit();
    timerRef.current = setInterval(fetchGit, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [sessionId, intervalMs]);

  return git;
}

export function useGitRoots(intervalMs = 15000) {
  const [roots, setRoots] = useState(null);
  useEffect(() => {
    async function fetchRoots() {
      try {
        const res = await fetch('/api/sessions/git-roots');
        if (res.ok) setRoots(await res.json());
      } catch { /* ignore */ }
    }
    fetchRoots();
    const t = setInterval(fetchRoots, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return roots;
}

export function useWorktrees(sessionId, intervalMs = 10000) {
  const [data, setData] = useState(null);
  const fetchData = useCallback(async () => {
    if (!sessionId) { setData(null); return; }
    try {
      const res = await fetch(`/api/git/${encodeURIComponent(sessionId)}/worktrees`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
  }, [sessionId]);
  useEffect(() => {
    setData(null);
    fetchData();
    const t = setInterval(fetchData, intervalMs);
    return () => clearInterval(t);
  }, [fetchData, intervalMs]);
  return [data, fetchData];
}

export function useGithubPR(sessionId, intervalMs = 30000) {
  const [data, setData] = useState(null);

  const fetchData = useCallback(async () => {
    if (!sessionId) { setData(null); return; }
    try {
      const res = await fetch(`/api/git/${encodeURIComponent(sessionId)}/github`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
  }, [sessionId]);

  useEffect(() => {
    setData(null);
    fetchData();
    const t = setInterval(fetchData, intervalMs);
    return () => clearInterval(t);
  }, [fetchData, intervalMs]);

  return data;
}
