
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type Joint = {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

const JOINTS: Joint[] = [
  { name: "shoulder_pan.pos", label: "Shoulder Pan", min: -180, max: 180, step: 1, default: 0 },
  { name: "shoulder_lift.pos", label: "Shoulder Lift", min: -180, max: 180, step: 1, default: 0 },
  { name: "elbow_flex.pos", label: "Elbow Flex", min: -180, max: 180, step: 1, default: 0 },
  { name: "wrist_flex.pos", label: "Wrist Flex", min: -180, max: 180, step: 1, default: 0 },
  { name: "wrist_roll.pos", label: "Wrist Roll", min: -180, max: 180, step: 1, default: 0 },
  { name: "gripper.pos", label: "Gripper", min: 0, max: 100, step: 1, default: 0 },
];

type Props = {
  onSendAction?: (values: Record<string, number>) => void;
  className?: string;
};
const initialJointState = () => {
  const state: Record<string, number> = {};
  JOINTS.forEach(j => (state[j.name] = j.default));
  return state;
};

const DirectFollowerControlPanel: React.FC<Props> = ({ onSendAction, className }) => {
  const [jointValues, setJointValues] = useState<Record<string, number>>(initialJointState);

  // Handler for slider changes
  const handleSliderChange = (joint: Joint, value: number[]) => {
    setJointValues(v => ({ ...v, [joint.name]: value[0] }));
  };

  // Quick action examples
  const handleHome = () => {
    const home: Record<string, number> = {};
    JOINTS.forEach(j => (home[j.name] = 0));
    setJointValues(home);
  };

  const handleSend = () => {
    // You'd call the backend API here. For now, just call prop if present.
    if (onSendAction) onSendAction(jointValues);

    // TODO: Real API integration
    fetch("http://localhost:8000/send-follower-command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jointValues),
    }).then(res => {
      // Optionally handle response
      // Could use a toast here
    });
  };

  return (
    <div className={`w-full max-w-lg mx-auto p-6 bg-gray-900 rounded-lg shadow space-y-6 ${className || ""}`}>
      <h2 className="text-xl font-bold text-white mb-4 text-center">Direct Follower Control</h2>
      <div className="space-y-4">
        {JOINTS.map(joint => (
          <div key={joint.name} className="flex flex-col">
            <label className="text-gray-300 text-sm mb-1 flex justify-between">
              <span>{joint.label}</span>
              <span className="ml-2 font-mono text-gray-400">{jointValues[joint.name]}</span>
            </label>
            <Slider
              min={joint.min}
              max={joint.max}
              step={joint.step}
              value={[jointValues[joint.name]]}
              onValueChange={value => handleSliderChange(joint, value)}
              className="my-1"
            />
            <div className="flex justify-between text-xs text-gray-500 select-none">
              <span>{joint.min}</span>
              <span>{joint.max}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 justify-center pt-4">
        <Button variant="secondary" onClick={handleHome}>Home</Button>
        <Button variant="default" className="px-8" onClick={handleSend}>
          Send Action
        </Button>
      </div>
    </div>
  );
};

export default DirectFollowerControlPanel;
