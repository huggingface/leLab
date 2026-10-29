import React from "react";
import { Button } from "@/components/ui/button";
import { ALIGNED_SCORE, LIGHTING_FAIR, LIGHTING_GOOD } from "@/lib/cameraReferenceScore";
import type { ReferenceScores } from "@/hooks/useReferenceScores";

interface Props {
  hasReference: boolean;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  onSave: () => void;
  onClear: () => void;
  disabled: boolean;
  error: string | null;
  scores?: ReferenceScores;
}

const lightingTone = (match: number) =>
  match >= LIGHTING_GOOD ? "text-green-400" : match >= LIGHTING_FAIR ? "text-amber-400" : "text-red-400";

/** Live alignment and lighting match against the reference, with the lighting breakdown as text. */
const ScoreLine: React.FC<{ scores: ReferenceScores }> = ({ scores: { alignment, lighting } }) => (
  <p className="text-xs text-gray-400" aria-live="polite">
    Alignment{" "}
    {alignment === null ? (
      <span>–</span>
    ) : (
      <span className={alignment >= ALIGNED_SCORE ? "text-green-400" : "text-orange-400"}>
        {Math.round(alignment)}%
      </span>
    )}
    {lighting && (
      <>
        {" · "}Lighting <span className={lightingTone(lighting.match)}>{Math.round(lighting.match)}%</span>
        {` (brightness ${lighting.brightnessDiff.toFixed(1)}%, color ${lighting.colorDiff.toFixed(1)}%)`}
      </>
    )}
  </p>
);

/** Save the current frame as the reference, then slide the ghost overlay over the live preview. */
const CameraReferenceControls: React.FC<Props> = ({
  hasReference,
  opacity,
  onOpacityChange,
  onSave,
  onClear,
  disabled,
  error,
  scores,
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
    {hasReference && scores && <ScoreLine scores={scores} />}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </div>
);

export default CameraReferenceControls;
