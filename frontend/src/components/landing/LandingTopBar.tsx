import React from "react";
import HfAuthChip from "./HfAuthChip";
import TourLauncher from "@/components/onboarding/TourLauncher";

const LandingTopBar: React.FC = () => {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-800 bg-black/95 backdrop-blur supports-[backdrop-filter]:bg-black/70">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <img
            src="/lovable-uploads/5e648747-34b7-4d8f-93fd-4dbd00aeeefc.png"
            alt="LeLab"
            className="h-7 w-7"
          />
          <span className="text-base font-semibold tracking-tight text-white">
            LeLab
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TourLauncher variant="inline" />
          <HfAuthChip />
        </div>
      </div>
    </header>
  );
};

export default LandingTopBar;
