import React from "react";

const LandingHeader: React.FC = () => {
  return (
    <div className="relative w-full">
      <div className="text-center space-y-4 w-full pt-8">
        <img
          src="/lovable-uploads/5e648747-34b7-4d8f-93fd-4dbd00aeeefc.png"
          alt="LiveLab Logo"
          className="mx-auto h-20 w-20"
        />
        <h1 className="text-5xl font-bold tracking-tight">LeLab</h1>
        <p className="text-xl text-gray-400">LeRobot but on HFSpace.</p>
      </div>
    </div>
  );
};
export default LandingHeader;
