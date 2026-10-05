import React, { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { useRobots } from "@/hooks/useRobots";
import { apiRequest } from "@/lib/apiClient";

interface ReplayResponse {
  success: boolean;
  message: string;
}

interface ReplayStatus {
  replay_active: boolean;
  error: string | null;
}

interface ReplayButtonProps {
  repoId: string;
  episodeIndex: number;
  /** Called once the arm starts moving, so the footage can run alongside it. */
  onStart: () => void;
}

/**
 * Plays the episode's recorded actions on the selected follower arm. Only
 * shown when that arm is ready to move.
 */
const ReplayButton: React.FC<ReplayButtonProps> = ({ repoId, episodeIndex, onStart }) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { selectedRecord: robot } = useRobots();
  const { toast } = useToast();
  const [phase, setPhase] = useState<"idle" | "starting" | "playing">("idle");
  // Paging to another episode while the arm connects must not drag the
  // footage back to the one being replayed.
  const episodeRef = useRef(episodeIndex);
  episodeRef.current = episodeIndex;

  // A replay keeps running when this button unmounts (another dataset, another
  // page), so pick it back up to keep it stoppable.
  useEffect(() => {
    apiRequest<ReplayStatus>(baseUrl, fetchWithHeaders, "/replay-status")
      .then((status) => {
        if (status.replay_active) setPhase("playing");
      })
      .catch(() => undefined);
  }, [baseUrl, fetchWithHeaders]);

  // Poll only while the arm moves, to notice when the episode ends or fails.
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setInterval(async () => {
      try {
        const status = await apiRequest<ReplayStatus>(baseUrl, fetchWithHeaders, "/replay-status");
        if (status.replay_active) return;
        setPhase("idle");
        if (status.error) {
          toast({ title: "Replay failed", description: status.error, variant: "destructive" });
        }
      } catch {
        // Keep the Stop button: the next poll retries.
      }
    }, 500);
    return () => clearInterval(timer);
  }, [phase, baseUrl, fetchWithHeaders, toast]);

  if (!robot?.is_clean) return null;

  const start = async () => {
    setPhase("starting");
    try {
      const res = await apiRequest<ReplayResponse>(baseUrl, fetchWithHeaders, "/start-replay", {
        method: "POST",
        body: {
          follower_port: robot.follower_port,
          follower_config: robot.follower_config,
          dataset_repo_id: repoId,
          episode_index: episodeIndex,
        },
        action: "Replay",
      });
      if (!res.success) throw new Error(res.message);
      setPhase("playing");
      if (episodeRef.current === episodeIndex) onStart();
    } catch (e) {
      setPhase("idle");
      toast({
        title: "Could not replay this episode",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const stop = async () => {
    try {
      await apiRequest(baseUrl, fetchWithHeaders, "/stop-replay", { method: "POST", action: "Stop" });
      setPhase("idle");
    } catch (e) {
      toast({
        title: "Could not stop the robot",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  if (phase === "playing") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={stop}
        className="h-7 gap-1.5 border-red-900 bg-red-950/40 text-xs text-red-300 hover:bg-red-950 hover:text-red-200"
      >
        <Square className="h-3 w-3 fill-current" />
        Stop robot
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={start}
      disabled={phase === "starting"}
      title={`Replay this episode on ${robot.name}`}
      className="h-7 gap-1.5 border-gray-800 bg-gray-950 text-xs text-gray-300 hover:bg-gray-900"
    >
      {phase === "starting" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Bot className="h-3.5 w-3.5" />
      )}
      Play on robot
    </Button>
  );
};

export default ReplayButton;
