"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectClient, ProjectInfo, ProjectWorkView } from "./client.js";

export const PROJECTS_QUERY_KEY = ["projects"] as const;

export interface ProjectsQueryResult {
  data: readonly ProjectInfo[] | undefined;
  error: unknown;
  isPending: boolean;
  reload: () => Promise<void>;
}

export interface ProjectViewQueryResult {
  data: ProjectWorkView | undefined;
  error: unknown;
  isPending: boolean;
  reload: () => Promise<void>;
}

/** Loads `client.list()` and refreshes when the host calls `subscribe`. */
export function useProjects(client: ProjectClient): ProjectsQueryResult {
  const [data, setData] = useState<readonly ProjectInfo[] | undefined>();
  const [error, setError] = useState<unknown>();
  const [isPending, setPending] = useState(true);
  const request = useRef(0);

  const reload = useCallback(async () => {
    const token = ++request.current;
    try {
      const next = await client.list();
      if (token !== request.current) return;
      setData(next);
      setError(undefined);
    } catch (cause) {
      if (token !== request.current) return;
      setError(cause);
    } finally {
      if (token === request.current) setPending(false);
    }
  }, [client]);

  useEffect(() => {
    const token = ++request.current;
    setPending(true);
    void client.list().then(
      (next) => {
        if (token !== request.current) return;
        setData(next);
        setError(undefined);
        setPending(false);
      },
      (cause: unknown) => {
        if (token !== request.current) return;
        setError(cause);
        setPending(false);
      },
    );
    const unsubscribe = client.subscribe?.(() => {
      void reload();
    });
    return () => {
      request.current += 1;
      unsubscribe?.();
    };
  }, [client, reload]);

  return { data, error, isPending, reload };
}

/** Loads one project view. `refreshIntervalMs` of `0` disables polling. */
export function useProjectView(
  client: ProjectClient,
  projectId: string | null,
  refreshIntervalMs = 1500,
): ProjectViewQueryResult {
  const [data, setData] = useState<ProjectWorkView | undefined>();
  const [error, setError] = useState<unknown>();
  const [isPending, setPending] = useState(Boolean(projectId));
  const request = useRef(0);

  const reload = useCallback(async () => {
    if (!projectId) return;
    const token = ++request.current;
    try {
      const next = await client.view(projectId);
      if (token !== request.current) return;
      setData(next);
      setError(undefined);
    } catch (cause) {
      if (token !== request.current) return;
      setError(cause);
    } finally {
      if (token === request.current) setPending(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    if (!projectId) {
      request.current += 1;
      setData(undefined);
      setError(undefined);
      setPending(false);
      return;
    }
    const token = ++request.current;
    setPending(true);
    setData(undefined);
    const load = () => {
      const current = ++request.current;
      void client.view(projectId).then(
        (next) => {
          if (current !== request.current) return;
          setData(next);
          setError(undefined);
          setPending(false);
        },
        (cause: unknown) => {
          if (current !== request.current) return;
          setError(cause);
          setPending(false);
        },
      );
    };
    void client.view(projectId).then(
      (next) => {
        if (token !== request.current) return;
        setData(next);
        setError(undefined);
        setPending(false);
      },
      (cause: unknown) => {
        if (token !== request.current) return;
        setError(cause);
        setPending(false);
      },
    );
    if (refreshIntervalMs <= 0) {
      return () => {
        request.current += 1;
      };
    }
    const timer = setInterval(load, refreshIntervalMs);
    return () => {
      request.current += 1;
      clearInterval(timer);
    };
  }, [client, projectId, refreshIntervalMs]);

  return { data, error, isPending, reload };
}
