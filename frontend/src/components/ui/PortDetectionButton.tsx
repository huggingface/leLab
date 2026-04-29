import React from "react";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

interface PortDetectionButtonProps {
  onClick: () => void;
  robotType?: "leader" | "follower";
  className?: string;
}

const PortDetectionButton: React.FC<PortDetectionButtonProps> = ({
  onClick,
  robotType,
  className = "",
}) => {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="outline"
      size="sm"
      className={`
        h-8 px-2 
        border-gray-600 hover:border-blue-500 
        text-gray-400 hover:text-blue-400 
        bg-gray-800 hover:bg-gray-700
        transition-all duration-200
        ${className}
      `}
      title={`Find ${robotType || "robot"} port automatically`}
    >
      <Search className="w-3 h-3 mr-1" />
      Find
    </Button>
  );
};

export default PortDetectionButton;
