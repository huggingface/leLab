import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import type { CameraConfig } from "@/components/recording/CameraConfiguration";

export interface RobotRecord {
  name: string;
  leader_port: string;
  follower_port: string;
  leader_config: string;
  follower_config: string;
  cameras: CameraConfig[];
  is_clean: boolean;
  robot_type?: string;
}

const SELECTED_KEY = "lelab.selectedRobot";

const readSelected = (): string | null => {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    return raw && typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
};

const writeSelected = (name: string | null) => {
  try {
    if (name) localStorage.setItem(SELECTED_KEY, name);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    // Storage may be unavailable (private mode, quota). Failures here are non-fatal.
  }
};

export const useRobots = () => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();
  const location = useLocation();

  const [records, setRecords] = useState<Record<string, RobotRecord>>({});
  const [selectedName, setSelectedName] = useState<string | null>(() => readSelected());
  const [isLoading, setIsLoading] = useState(false);

  // Re-fetch records when location changes (RobotConfigManager mounts only on Landing,
  // so this fires on initial mount and on back-navigation to Landing)
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const res = await fetchWithHeaders(`${baseUrl}/robots`);
        const data = await res.json();
        if (cancelled) return;
        const next: Record<string, RobotRecord> = {};
        for (const r of data.robots ?? []) next[r.name] = r;
        setRecords(next);
        // Drop the selection if the underlying record vanished (deleted from another tab)
        setSelectedName((prev) => (prev && prev in next ? prev : null));
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to fetch robots:", e);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetchWithHeaders, location.key]);

  // Persist selection to localStorage
  useEffect(() => {
    writeSelected(selectedName);
  }, [selectedName]);

  const selectRobot = useCallback((name: string) => {
    setSelectedName(name);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedName(null);
  }, []);

  const createRobot = useCallback(
    async (rawName: string, robotType: string = "so101"): Promise<boolean> => {
      const name = rawName.trim();
      if (!name) {
        toast({ title: "Missing name", description: "Robot name cannot be empty.", variant: "destructive" });
        return false;
      }
      if (/[/\\]|\.\./.test(name)) {
        toast({ title: "Invalid name", description: "Robot names cannot contain '/', '\\', or '..'", variant: "destructive" });
        return false;
      }
      try {
        const res = await fetchWithHeaders(`${baseUrl}/robots/${encodeURIComponent(name)}?create=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ robot_type: robotType }),
        });
        if (res.status === 409) {
          toast({
            title: "Already exists",
            description: `A robot named "${name}" already exists. Pick it from the dropdown or choose a different name.`,
            variant: "destructive",
          });
          return false;
        }
        if (!res.ok) {
          const text = await res.text();
          toast({ title: "Failed to create", description: text, variant: "destructive" });
          return false;
        }
        const data = await res.json();
        if (data.robot) {
          setRecords((prev) => ({ ...prev, [name]: data.robot }));
          setSelectedName(name);
        }
        return true;
      } catch (e) {
        toast({ title: "Network error", description: String(e), variant: "destructive" });
        return false;
      }
    },
    [baseUrl, fetchWithHeaders, toast]
  );

  const deleteRobot = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const res = await fetchWithHeaders(`${baseUrl}/robots/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const text = await res.text();
          toast({ title: "Failed to delete", description: text, variant: "destructive" });
          return false;
        }
        setRecords((prev) => {
          const { [name]: _omit, ...rest } = prev;
          return rest;
        });
        setSelectedName((prev) => (prev === name ? null : prev));
        return true;
      } catch (e) {
        toast({ title: "Network error", description: String(e), variant: "destructive" });
        return false;
      }
    },
    [baseUrl, fetchWithHeaders, toast]
  );

  const selectedRecord = useMemo(
    () => (selectedName ? records[selectedName] ?? null : null),
    [selectedName, records]
  );

  const availableNames = useMemo(
    () => Object.keys(records).sort(),
    [records]
  );

  return {
    records,
    selectedName,
    selectedRecord,
    availableNames,
    isLoading,
    selectRobot,
    clearSelection,
    createRobot,
    deleteRobot,
  };
};
