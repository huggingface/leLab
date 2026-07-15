import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { useApi } from "@/contexts/ApiContext";
import { getMotion } from "@/lib/datasetApi";

interface MotionTraceProps {
  repoId: string;
  episodeIndex: number;
  currentFrame: number;
  onSeekFrame: (frameIndex: number) => void;
}

/**
 * Aggregate joint motion across the episode — one value per frame, summing the
 * absolute change of every joint in the commanded action vector.
 *
 * Collapsing all joints into a single trace is the point: it makes the shape of
 * a demonstration legible at a glance (idle head, the busy middle, idle tail)
 * without asking anyone to read six overlapping lines.
 */
const MotionTrace: React.FC<MotionTraceProps> = ({
  repoId,
  episodeIndex,
  currentFrame,
  onSeekFrame,
}) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [motion, setMotion] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getMotion(baseUrl, fetchWithHeaders, repoId, episodeIndex, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        if (!r.success) {
          setMotion(null);
          setError(r.message ?? "No action stream");
          return;
        }
        setMotion(r.motion);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setMotion(null);
        setError(e instanceof Error ? e.message : "No action stream");
      });
    return () => controller.abort();
  }, [baseUrl, fetchWithHeaders, repoId, episodeIndex]);

  const data = useMemo(
    () => (motion ?? []).map((v, i) => ({ frame: i, motion: v })),
    [motion],
  );

  if (error) {
    return (
      <div className="flex h-[64px] items-center justify-center rounded-md border border-gray-800 bg-gray-950 text-[11px] text-gray-600">
        Joint motion unavailable — {error}
      </div>
    );
  }

  if (!motion) {
    return <div className="h-[64px] rounded-md border border-gray-800 bg-gray-950" />;
  }

  return (
    <div className="rounded-md border border-gray-800 bg-gray-950 px-1 pb-1 pt-1.5">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-600">
          Joint motion
        </span>
        <span className="text-[10px] tabular-nums text-gray-600">
          frame {currentFrame}
        </span>
      </div>
      <div className="h-[52px] w-full cursor-pointer">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 2, right: 4, bottom: 0, left: 4 }}
            onClick={(e) => {
              // activeLabel is the `frame` value under the cursor.
              const f = e?.activeLabel;
              if (f !== undefined && f !== null) onSeekFrame(Number(f));
            }}
          >
            <defs>
              <linearGradient id="motionFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              contentStyle={{
                background: "#0a0a0a",
                border: "1px solid #1f2937",
                borderRadius: 6,
                fontSize: 11,
                padding: "4px 8px",
              }}
              labelStyle={{ color: "#9ca3af" }}
              itemStyle={{ color: "#fb923c" }}
              formatter={(v: number) => [v.toFixed(2), "motion"]}
              labelFormatter={(l) => `Frame ${l}`}
            />
            <Area
              type="monotone"
              dataKey="motion"
              stroke="#f97316"
              strokeWidth={1.25}
              fill="url(#motionFill)"
              isAnimationActive={false}
              dot={false}
            />
            <ReferenceLine x={currentFrame} stroke="#e5e7eb" strokeWidth={1} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default MotionTrace;
