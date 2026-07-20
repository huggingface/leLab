import React, { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import VisualizerPanel from "@/components/control/VisualizerPanel";
import TeleopCameraPanel from "@/components/control/TeleopCameraPanel";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/contexts/ApiContext";
import { useUrdf } from "@/hooks/useUrdf";
import { resolveDefaultRobotType } from "@/lib/defaultUrdfModels";

// Matches useRobots.ts's SELECTED_KEY - the last robot picked on Landing.
const SELECTED_ROBOT_KEY = "lelab.selectedRobot";

const TeleoperationPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { setDefaultRobotType } = useUrdf();

  // Show the 3D model matching the arm that's actually connected (SO-101 vs
  // OMX-AI) instead of always defaulting to SO-101.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let name: string | null = null;
      try {
        name = localStorage.getItem(SELECTED_ROBOT_KEY);
      } catch {
        /* localStorage may be unavailable */
      }
      if (!name) return;
      try {
        const res = await fetchWithHeaders(
          `${baseUrl}/robots/${encodeURIComponent(name)}`
        );
        const data = await res.json();
        if (!cancelled && data?.robot?.robot_type) {
          setDefaultRobotType(resolveDefaultRobotType(data.robot.robot_type));
        }
      } catch {
        /* best-effort - falls back to the default SO-101 model */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetchWithHeaders, setDefaultRobotType]);

  // Stop teleoperation exactly once, however the user leaves, so the back
  // button, an in-app link, and the unmount safety net can't double-stop or
  // double-toast.
  const stoppedRef = useRef(false);
  const stopTeleoperation = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    try {
      const res = await fetchWithHeaders(`${baseUrl}/stop-teleoperation`, {
        method: "POST",
      });
      const data = await res.json();
      if (data?.success) {
        toast({
          title: "Teleoperation stopped",
          description: "The arm was disconnected cleanly.",
        });
      }
    } catch {
      /* best-effort */
    }
  }, [baseUrl, fetchWithHeaders, toast]);

  // Cover every exit path so a session can't keep running and block the next
  // start with "already active":
  //   - the back button awaits stopTeleoperation() then navigates (below);
  //   - any other in-app navigation unmounts this component → stop via cleanup;
  //   - a browser-level leave (URL change, reload, tab close) never runs React
  //     cleanup, so `pagehide` fires a keepalive stop that survives the unload
  //     and stashes a flag the next page reads to confirm the clean disconnect.
  //     It uses a bare fetch (no JSON Content-Type) so the request stays a CORS
  //     "simple request" and isn't dropped to a preflight mid-unload.
  useEffect(() => {
    const handlePageHide = () => {
      try {
        sessionStorage.setItem("lelab:teleop-stopped", "1");
      } catch {
        /* sessionStorage may be unavailable; the stop below still runs */
      }
      fetch(`${baseUrl}/stop-teleoperation`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      stopTeleoperation();
    };
  }, [baseUrl, stopTeleoperation]);

  const handleGoBack = async () => {
    await stopTeleoperation();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4">
      <div className="w-full h-[95vh] flex">
        <VisualizerPanel
          onGoBack={handleGoBack}
          className="lg:w-full"
          rightSlot={<TeleopCameraPanel />}
        />
      </div>
    </div>
  );
};

export default TeleoperationPage;
