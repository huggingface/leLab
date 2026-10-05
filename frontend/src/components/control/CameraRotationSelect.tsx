import React, { useId } from "react";
import { Label } from "@/components/ui/label";
import { CAMERA_ROTATIONS, CameraRotation, cameraRotation } from "@/lib/cameraConfig";

interface Props {
  rotation: CameraRotation | null;
  onChange: (rotation: CameraRotation) => void;
  disabled?: boolean;
}

export default function CameraRotationSelect({ rotation, onChange, disabled }: Props) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-xs">
      <Label htmlFor={id} className="text-gray-400">Rotation</Label>
      <select
        id={id}
        value={rotation ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(cameraRotation(Number(event.target.value)))}
        className="bg-gray-800 border border-gray-700 rounded text-white text-xs h-7 px-2"
      >
        {rotation === null && <option value="" disabled>Choose rotation</option>}
        {CAMERA_ROTATIONS.map((angle) => (
          <option key={angle} value={angle}>{angle}° clockwise</option>
        ))}
      </select>
    </div>
  );
}
