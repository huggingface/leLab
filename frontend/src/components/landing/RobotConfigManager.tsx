import React from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { RobotRecord } from "@/hooks/useRobots";
import RobotTile from "./RobotTile";

interface RobotConfigManagerProps {
  selectedName: string | null;
  selectedRecord: RobotRecord | null;
  availableNames: string[];
  isLoading: boolean;
  selectRobot: (name: string) => void;
  createRobot: (name: string, robotType: string) => Promise<boolean>;
  deleteRobot: (name: string) => Promise<boolean>;
}

const RobotConfigManager: React.FC<RobotConfigManagerProps> = ({
  selectedName,
  selectedRecord,
  availableNames,
  isLoading,
  selectRobot,
  createRobot,
  deleteRobot,
}) => {
  const navigate = useNavigate();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  const handleConfigure = (name: string) => {
    navigate("/calibration", { state: { robot_name: name } });
  };

  const handleTeleop = async (robot: RobotRecord) => {
    try {
      const res = await fetchWithHeaders(`${baseUrl}/move-arm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leader_port: robot.leader_port,
          follower_port: robot.follower_port,
          leader_config: robot.leader_config,
          follower_config: robot.follower_config,
          robot_type: robot.robot_type || "so101",
        }),
      });
      const data = await res.json();
      // The backend returns HTTP 200 with `{ success: false }` for logical
      // failures (arm not connected, already active), so gate on `data.success`
      // — not just `res.ok` — or we'd navigate to an empty teleop screen.
      if (res.ok && data.success) {
        toast({
          title: "Teleoperation Started",
          description: data.message || `Started teleoperation for ${robot.name}.`,
        });
        navigate("/teleoperation");
      } else {
        toast({
          title: "Error Starting Teleoperation",
          description: data.message || "Failed to start.",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    }
  };

  return (
    <RobotTile
      robot={selectedRecord}
      selectedName={selectedName}
      availableNames={availableNames}
      isLoading={isLoading}
      onSelect={selectRobot}
      onCreateNew={createRobot}
      onConfigure={handleConfigure}
      onTeleop={handleTeleop}
      onDelete={deleteRobot}
    />
  );
};

export default RobotConfigManager;
