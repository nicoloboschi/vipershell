import { useState, useEffect, useRef, useCallback } from 'react';

export interface GitStatus {
  branch: string;
  dirty: boolean;
  detached: boolean;
  ahead: number;
  behind: number;
}

export interface GitRoot {
  [sessionId: string]: string | null;
}

export interface Worktree {
  path: string;
  branch?: string;
}

export interface GithubPR {
  prUrl?: string;
  repoUrl?: string;
}

export function useGit(sessionId: string | null, intervalMs = 5000): GitStatus | null {
  const [git, setGit] = useState<GitStatus | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionId) { setGit(null); return; }

    async function fetchGit() {
      try {
        const res = await fetch(`/api/git/${encodeURIComponent(sessionId!)}`);
        if (res.ok) setGit(await res.json());
      } catch { /* ignore */ }
    }

    fetchGit();
    timerRef.current = setInterval(fetchGit, intervalMs);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionId, intervalMs]);

  return git;
}

export function useGitRoots(intervalMs = 15000): GitRoot | null {
  const [roots, setRoots] = useState<GitRoot | null>(null);
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

export function useWorktrees(sessionId: string | null, intervalMs = 10000): [Worktree[] | null, () => Promise<void>] {
  const [data, setData] = useState<Worktree[] | null>(null);
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

export function useGithubPR(sessionId: string | null, intervalMs = 30000): GithubPR | null {
  const [data, setData] = useState<GithubPR | null>(null);

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
