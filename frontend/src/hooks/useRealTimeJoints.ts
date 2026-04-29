import { useEffect, useRef, useCallback } from "react";
import { URDFViewerElement } from "@/lib/urdfViewerHelpers";
import { useApi } from "@/contexts/ApiContext";

interface JointData {
  type: "joint_update";
  joints: Record<string, number>;
  timestamp: number;
}

interface UseRealTimeJointsProps {
  viewerRef: React.RefObject<URDFViewerElement>;
  enabled?: boolean;
  websocketUrl?: string;
}

export const useRealTimeJoints = ({
  viewerRef,
  enabled = true,
  websocketUrl,
}: UseRealTimeJointsProps) => {
  const { baseUrl, wsBaseUrl, fetchWithHeaders } = useApi();
  const defaultWebSocketUrl = `${wsBaseUrl}/ws/joint-data`;
  const finalWebSocketUrl = websocketUrl || defaultWebSocketUrl;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef<boolean>(false);

  const updateJointValues = useCallback(
    (joints: Record<string, number>) => {
      const viewer = viewerRef.current;
      if (!viewer || typeof viewer.setJointValue !== "function") {
        return;
      }

      // Update each joint value in the URDF viewer
      Object.entries(joints).forEach(([jointName, value]) => {
        try {
          viewer.setJointValue(jointName, value);
        } catch (error) {
          console.warn(`Failed to set joint ${jointName}:`, error);
        }
      });
    },
    [viewerRef]
  );

  const connectWebSocket = useCallback(() => {
    if (!enabled) return;

    // First, test if the server is running
    const testServerConnection = async () => {
      try {
        const response = await fetchWithHeaders(`${baseUrl}/health`);
        if (!response.ok) {
          console.error("❌ Server health check failed:", response.status);
          return false;
        }
        const data = await response.json();
        console.log("✅ Server is running:", data);
        return true;
      } catch (error) {
        console.error("❌ Server is not reachable:", error);
        return false;
      }
    };

    // Test server connection first
    testServerConnection().then((serverAvailable) => {
      if (!serverAvailable) {
        console.error("❌ Cannot connect to WebSocket: Server is not running");
        console.log(
          "💡 Make sure to start the FastAPI server with: python -m uvicorn lerobot.livelab.app.main:app --reload"
        );
        return;
      }

      try {
        console.log("🔗 Connecting to WebSocket:", finalWebSocketUrl);

        const ws = new WebSocket(finalWebSocketUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("✅ WebSocket connected for real-time joints");
          isConnectedRef.current = true;

          // Clear any existing reconnect timeout
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data: JointData = JSON.parse(event.data);

            if (data.type === "joint_update" && data.joints) {
              updateJointValues(data.joints);
            }
          } catch (error) {
            console.error("❌ Error parsing WebSocket message:", error);
          }
        };

        ws.onclose = (event) => {
          console.log(
            "🔌 WebSocket connection closed:",
            event.code,
            event.reason
          );
          isConnectedRef.current = false;
          wsRef.current = null;

          // Provide more specific error information
          if (event.code === 1006) {
            console.error(
              "❌ WebSocket connection failed - server may not be running or endpoint not found"
            );
          } else if (event.code === 1000) {
            console.log("✅ WebSocket closed normally");
          }

          // Attempt to reconnect after a delay if enabled
          if (enabled && !reconnectTimeoutRef.current && event.code !== 1000) {
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log("🔄 Attempting to reconnect WebSocket...");
              connectWebSocket();
            }, 3000); // Reconnect after 3 seconds
          }
        };

        ws.onerror = (error) => {
          console.error("❌ WebSocket error:", error);
          console.log("💡 Troubleshooting tips:");
          console.log(
            "  1. Make sure FastAPI server is running on localhost:8000"
          );
          console.log("  2. Check if the /ws/joint-data endpoint exists");
          console.log(
            "  3. Restart the server if you just added WebSocket support"
          );
          isConnectedRef.current = false;
        };
      } catch (error) {
        console.error("❌ Failed to create WebSocket connection:", error);
      }
    });
  }, [enabled, websocketUrl, updateJointValues]);

  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close WebSocket connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectedRef.current = false;
  }, []);

  // Effect to manage WebSocket connection
  useEffect(() => {
    if (enabled) {
      connectWebSocket();
    } else {
      disconnect();
    }

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [enabled, connectWebSocket, disconnect]);

  // Return connection status and control functions
  return {
    isConnected: isConnectedRef.current,
    disconnect,
    reconnect: connectWebSocket,
  };
};
