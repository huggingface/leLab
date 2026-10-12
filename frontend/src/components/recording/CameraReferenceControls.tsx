import React from "react";
import { Button } from "@/components/ui/button";

interface Props {
  hasReference: boolean;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  onSave: () => void;
  onClear: () => void;
  disabled: boolean;
  error: string | null;
}

/** Save the current frame as the reference, then slide the ghost overlay over the live preview. */
const CameraReferenceControls: React.FC<Props> = ({
  hasReference,
  opacity,
  onOpacityChange,
  onSave,
  onClear,
  disabled,
  error,
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onSave}
        disabled={disabled}
        className="h-7 px-2 text-xs bg-gray-800 border-gray-700 text-white hover:bg-gray-700"
      >
        {hasReference ? "Replace reference" : "Set reference"}
      </Button>
      {hasReference && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClear}
          className="h-7 px-2 text-xs text-gray-400 hover:text-white"
        >
          Clear
        </Button>
      )}
    </div>
    {hasReference && (
      <label className="flex items-center gap-2 text-xs text-gray-400">
        Ghost
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          className="flex-1"
          aria-label="Reference overlay opacity"
        />
      </label>
    )}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </div>
);

export default CameraReferenceControls;
