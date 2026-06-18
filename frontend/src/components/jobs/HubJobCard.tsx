import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HubJob } from "@/lib/jobsApi";
import {
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
  HelpCircle,
} from "lucide-react";

interface Props {
  job: HubJob;
  onOpen?: (job: HubJob) => void;
  busy?: boolean;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, (Date.now() - t) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface StagePresentation {
  label: string;
  color: string;
  Icon: React.ComponentType<{ className?: string }>;
  spin?: boolean;
}

const stagePresentation: Record<string, StagePresentation> = {
  RUNNING: { label: "Running", color: "text-green-400", Icon: Loader2, spin: true },
  QUEUED: { label: "Queued", color: "text-amber-400", Icon: Clock },
  SCHEDULING: { label: "Scheduling", color: "text-amber-400", Icon: Clock },
  COMPLETED: { label: "Done", color: "text-slate-400", Icon: CheckCircle2 },
  FAILED: { label: "Failed", color: "text-red-400", Icon: XCircle },
  // HF API uses "CANCELED" (single L); accept both spellings.
  CANCELED: { label: "Cancelled", color: "text-amber-400", Icon: AlertTriangle },
  CANCELLED: { label: "Cancelled", color: "text-amber-400", Icon: AlertTriangle },
};

const HubJobCard: React.FC<Props> = ({ job, onOpen, busy = false }) => {
  const stage = job.status?.stage?.toUpperCase() ?? "";
  const present: StagePresentation = stagePresentation[stage] ?? {
    label: stage || "Unknown",
    color: "text-slate-400",
    Icon: HelpCircle,
  };
  const Icon = present.Icon;
  const title =
    job.docker_image ?? job.space_id ?? `Job ${job.id.slice(0, 12)}…`;
  const hasUrl = Boolean(job.url);
  const canOpen = Boolean(onOpen || hasUrl);

  return (
    <Card
      onClick={() => {
        if (busy) return;
        if (onOpen) {
          onOpen(job);
          return;
        }
        if (hasUrl) window.open(job.url, "_blank", "noopener,noreferrer");
      }}
      className={`bg-slate-800/50 border-slate-700 rounded-xl hover:border-slate-500 transition-colors ${
        canOpen ? "cursor-pointer" : ""
      }`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${present.color}`}>
            <Icon className={`w-3.5 h-3.5 ${present.spin || busy ? "animate-spin" : ""}`} />
            {present.label}
          </div>
          {hasUrl ? (
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-7 w-7 text-slate-400 hover:text-white"
              aria-label="View provider job"
            >
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
        <div>
          <div className="text-white font-semibold truncate" title={title}>
            {title}
          </div>
          <div className="text-xs text-slate-400 truncate">
            {job.flavor ?? "—"} · {relativeTime(job.created_at)}
            {job.owner ? ` · ${job.owner}` : ""}
          </div>
        </div>
        {job.status?.message ? (
          <div className="text-xs text-slate-500 truncate" title={job.status.message}>
            {job.status.message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default HubJobCard;
