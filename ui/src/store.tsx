import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MutationResponse, PollResponse, ProfilesView, ProjectView, RequestLog } from '../../src/core/view';
import { ApiError, api } from './api';

const MAX_LOGS = 500;

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

interface Studio {
  view: ProjectView | null;
  profiles: ProfilesView | null;
  refreshProfiles(): Promise<void>;
  applyView(view: ProjectView): void;
  logs: RequestLog[];
  notice: Notice | null;
  dismissNotice(): void;
  sessionLost: boolean;
  /** Runs a mutation; the returned view replaces the current one. Errors become a notice. */
  act<T extends MutationResponse>(request: () => Promise<T>): Promise<T | undefined>;
  clearLogs(): Promise<void>;
}

const Context = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const value = useContext(Context);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  return value;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [profiles, setProfiles] = useState<ProfilesView | null>(null);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const revision = useRef(0);
  const lastLog = useRef(0);

  const applyView = useCallback((next: ProjectView) => {
    revision.current = next.revision;
    setView(next);
  }, []);

  const refreshProfiles = useCallback(async () => {
    try { setProfiles(await api<ProfilesView>('GET', '/api/profiles')); }
    catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }); }
  }, []);

  useEffect(() => { if (view) void refreshProfiles(); }, [view?.revision, refreshProfiles]);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const response = await api<PollResponse>('GET', `/api/poll?revision=${revision.current}&after=${lastLog.current}`);
        if (stopped) return;
        if (response.view) applyView(response.view);
        if (response.logs.length > 0) {
          lastLog.current = response.logs[response.logs.length - 1]?.id ?? lastLog.current;
          setLogs((previous) => [...previous, ...response.logs].slice(-MAX_LOGS));
        }
        setSessionLost(false);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setSessionLost(true);
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [applyView]);

  const act = useCallback(
    async <T extends MutationResponse>(request: () => Promise<T>): Promise<T | undefined> => {
      try {
        const result = await request();
        applyView(result.view);
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setSessionLost(true);
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
    },
    [applyView],
  );

  const clearLogs = useCallback(async () => {
    await act(() => api<MutationResponse>('POST', '/api/runtime/logs/clear'));
    setLogs([]);
  }, [act]);

  const value = useMemo<Studio>(
    () => ({ view, profiles, refreshProfiles, applyView, logs, notice, dismissNotice: () => setNotice(null), sessionLost, act, clearLogs }),
    [view, profiles, refreshProfiles, applyView, logs, notice, sessionLost, act, clearLogs],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
