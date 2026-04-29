import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/contexts/ApiContext";

interface JointData {
  type: "joint_update";
  joints: Record<string, number>;
  timestamp: number;
}

const WebSocketTest: React.FC = () => {
  const { baseUrl, wsBaseUrl, fetchWithHeaders } = useApi();
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<JointData | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<string>("Disconnected");
  const [ws, setWs] = useState<WebSocket | null>(null);

  const connect = () => {
    // First test server health
    fetchWithHeaders(`${baseUrl}/health`)
      .then((response) => response.json())
      .then((data) => {
        console.log("Server health:", data);

        // Now try WebSocket connection
        const websocket = new WebSocket(`${wsBaseUrl}/ws/joint-data`);

        websocket.onopen = () => {
          console.log("WebSocket connected");
          setIsConnected(true);
          setConnectionStatus("Connected");
          setWs(websocket);
        };

        websocket.onmessage = (event) => {
          try {
            const data: JointData = JSON.parse(event.data);
            setLastMessage(data);
            console.log("Received joint data:", data);
          } catch (error) {
            console.error("Error parsing message:", error);
          }
        };

        websocket.onclose = (event) => {
          console.log("WebSocket closed:", event.code, event.reason);
          setIsConnected(false);
          setConnectionStatus(`Closed (${event.code})`);
          setWs(null);
        };

        websocket.onerror = (error) => {
          console.error("WebSocket error:", error);
          setConnectionStatus("Error");
        };
      })
      .catch((error) => {
        console.error("Server health check failed:", error);
        setConnectionStatus("Server unreachable");
      });
  };

  const disconnect = () => {
    if (ws) {
      ws.close();
    }
  };

  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  return (
    <div className="p-4 bg-gray-900 text-white rounded-lg">
      <h3 className="text-lg font-bold mb-4">WebSocket Connection Test</h3>

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div
            className={`w-3 h-3 rounded-full ${
              isConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span>Status: {connectionStatus}</span>
        </div>

        <div className="flex gap-2">
          <Button onClick={connect} disabled={isConnected}>
            Connect
          </Button>
          <Button
            onClick={disconnect}
            disabled={!isConnected}
            variant="outline"
          >
            Disconnect
          </Button>
        </div>

        {lastMessage && (
          <div className="bg-gray-800 p-3 rounded">
            <h4 className="font-semibold mb-2">Last Joint Data:</h4>
            <div className="text-sm font-mono">
              <div>
                Timestamp:{" "}
                {new Date(lastMessage.timestamp * 1000).toLocaleTimeString()}
              </div>
              <div className="mt-2">Joints:</div>
              {Object.entries(lastMessage.joints).map(([joint, value]) => (
                <div key={joint} className="ml-4">
                  {joint}: {value.toFixed(4)} rad (
                  {((value * 180) / Math.PI).toFixed(2)}°)
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-sm text-gray-400">
          <div>Expected URL: {wsBaseUrl}/ws/joint-data</div>
          <div>Make sure your FastAPI server is running!</div>
        </div>
      </div>
    </div>
  );
};

export default WebSocketTest;
