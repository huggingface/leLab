import { useEffect, useState } from "react";
import { useApi } from "@/contexts/ApiContext";
import {
  EpisodeDetail,
  EpisodeListResponse,
  getEpisode,
  listEpisodes,
} from "@/lib/datasetApi";

/** Episode listing for one local dataset. `repoId` null → idle. */
export const useEpisodes = (repoId: string | null) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [data, setData] = useState<EpisodeListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!repoId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    listEpisodes(baseUrl, fetchWithHeaders, repoId, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        // The backend reports a readable dataset it couldn't parse as
        // success:false rather than an HTTP error, so check the flag too.
        if (!r.success) {
          setData(null);
          setError(r.message ?? "Could not read dataset");
          return;
        }
        setData(r);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(e instanceof Error ? e.message : "Could not read dataset");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [baseUrl, fetchWithHeaders, repoId]);

  // Effects run after render: do not let the new dataset auto-select an
  // episode from the old list before this effect clears it.
  return { data: data?.repo_id === repoId ? data : null, loading, error };
};

/** One episode's detail. Either arg null → idle. */
export const useEpisodeDetail = (repoId: string | null, episodeIndex: number | null) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [detail, setDetail] = useState<EpisodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || episodeIndex === null) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getEpisode(baseUrl, fetchWithHeaders, repoId, episodeIndex, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        if (!r.success) {
          setDetail(null);
          setError(r.message ?? "Could not load episode");
          return;
        }
        setDetail(r);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setDetail(null);
        setError(e instanceof Error ? e.message : "Could not load episode");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    // Clicking through episodes quickly would otherwise let a slow earlier
    // response land after a faster later one.
    return () => controller.abort();
  }, [baseUrl, fetchWithHeaders, repoId, episodeIndex]);

  return { detail, loading, error };
};
