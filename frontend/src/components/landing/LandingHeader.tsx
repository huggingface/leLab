import React from "react";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

interface LandingHeaderProps {
  onShowInstructions: () => void;
}

const LandingHeader: React.FC<LandingHeaderProps> = ({
  onShowInstructions,
}) => {
  return (
    <div className="relative w-full">
      {/* Main header content */}
      <div className="text-center space-y-4 w-full pt-8">
        <img
          src="/lovable-uploads/5e648747-34b7-4d8f-93fd-4dbd00aeeefc.png"
          alt="LiveLab Logo"
          className="mx-auto h-20 w-20"
        />
        <h1 className="text-5xl font-bold tracking-tight">LeLab</h1>
        <p className="text-xl text-gray-400">LeRobot but on HFSpace.</p>
        <Button
          variant="outline"
          onClick={onShowInstructions}
          className="mx-auto flex items-center gap-2 border-blue-500 text-blue-400 hover:text-white hover:bg-blue-600 hover:border-blue-600 transition-colors duration-200 px-6 py-2"
        >
          👉&nbsp;&nbsp;&nbsp;&nbsp;Getting started&nbsp;&nbsp;&nbsp;&nbsp;👈
        </Button>
      </div>
    </div>
  );
};
export default LandingHeader;
