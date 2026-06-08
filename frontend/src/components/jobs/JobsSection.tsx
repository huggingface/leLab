import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { useJobsChangedSignal } from "@/hooks/useJobsChangedSignal";
import {
  HubJob,
  HubModel,
  JobProgressSnapshot,
  JobRecord,
  deleteJob,
  listHubJobs,
  listJobs,
  stopJob,
} from "@/lib/jobsApi";
import JobCard from "./JobCard";
import HubJobCard from "./HubJobCard";
import HubModelCard from "./HubModelCard";
import InferenceModal from "@/components/landing/InferenceModal";
import ImportModelModal from "./ImportModelModal";
import { useRobots } from "@/hooks/useRobots";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Download, RefreshCw, Search } from "lucide-react";

const LIMIT = 10;

// Hub stages still doing work. Anything outside this set (COMPLETED, FAILED,
// CANCELED, …) gets demoted to UNTRACKED.
const HUB_ACTIVE_STAGES = new Set(["RUNNING", "QUEUED", "SCHEDULING"]);

const isJobActive = (j: JobRecord) =>
  j.state === "running" || j.checkpoint_count > 0;

const isHubJobActive = (h: HubJob) =>
  HUB_ACTIVE_STAGES.has((h.status?.stage ?? "").toUpperCase());

const JobsSection: React.FC = () => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [hubJobs, setHubJobs] = useState<HubJob[]>([]);
  const [hubModels, setHubModels] = useState<HubModel[]>([]);
  const [hubAuthenticated, setHubAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { selectedRecord } = useRobots();
  const [inferenceModalOpen, setInferenceModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [inferenceJob, setInferenceJob] = useState<JobRecord | null>(null);
  const [inferenceStep, setInferenceStep] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [next, hub] = await Promise.all([
        listJobs(baseUrl, fetchWithHeaders, LIMIT),
        listHubJobs(baseUrl, fetchWithHeaders),
      ]);
      setJobs(next);
      setHubJobs(hub.jobs);
      setHubModels(hub.models);
      setHubAuthenticated(hub.authenticated);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [baseUrl, fetchWithHeaders]);

  // Initial fetch on mount + refetch when the tab regains focus. Backend
  // pushes a `jobs_changed` WS event on every registry mutation, which
  // covers any change originating on this machine. The focus refresh
  // catches changes originating elsewhere (e.g. a job submitted from
  // another tab or the HF dashboard) without burning the rate limit.
  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const applyProgress = useCallback((snapshots: JobProgressSnapshot[]) => {
    if (snapshots.length === 0) return;
    setJobs((prev) => {
      if (prev.length === 0) return prev;
      const byId = new Map(snapshots.map((s) => [s.id, s]));
      let mutated = false;
      const next = prev.map((j) => {
        const s = byId.get(j.id);
        if (!s) return j;
        mutated = true;
        return {
          ...j,
          state: s.state,
          metrics: s.metrics,
          wandb_run_url: s.wandb_run_url,
          checkpoint_count: s.checkpoint_count,
        };
      });
      return mutated ? next : prev;
    });
  }, []);

  useJobsChangedSignal(refresh, applyProgress);

  const handleStop = async (id: string) => {
    try {
      await stopJob(baseUrl, fetchWithHeaders, id);
      toast({ title: "Job stopping" });
      refresh();
    } catch (e) {
      toast({
        title: "Stop failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const handlePlay = (job: JobRecord, step: number) => {
    setInferenceJob(job);
    setInferenceStep(step);
    setInferenceModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteJob(baseUrl, fetchWithHeaders, id);
      toast({ title: "Job removed" });
      refresh();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const query = search.trim().toLowerCase();
  const matchesQuery = useCallback(
    (text: string | null | undefined) =>
      !query || (text ?? "").toLowerCase().includes(query),
    [query],
  );

  const filteredJobs = useMemo(
    () => jobs.filter((j) => matchesQuery(j.name)),
    [jobs, matchesQuery],
  );
  const filteredHubJobs = useMemo(
    () =>
      hubJobs.filter((h) =>
        matchesQuery(h.docker_image ?? h.space_id ?? h.id),
      ),
    [hubJobs, matchesQuery],
  );
  const filteredHubModels = useMemo(
    () => hubModels.filter((m) => matchesQuery(m.repo_id)),
    [hubModels, matchesQuery],
  );

  const localJobs = useMemo(
    () => filteredJobs.filter((j) => j.runner === "local"),
    [filteredJobs],
  );
  const trackedCloudJobs = useMemo(
    () => filteredJobs.filter((j) => j.runner === "hf_cloud"),
    [filteredJobs],
  );
  const importedJobs = useMemo(
    () => filteredJobs.filter((j) => j.runner === "imported"),
    [filteredJobs],
  );
  // Hub jobs already mirrored by a local JobRecord get their richer card via
  // trackedCloudJobs; everything else from the hub gets a plain HubJobCard.
  const trackedHfJobIds = useMemo(
    () =>
      new Set(
        trackedCloudJobs
          .map((j) => j.hf_job_id)
          .filter((id): id is string => !!id),
      ),
    [trackedCloudJobs],
  );
  const untrackedHubJobs = useMemo(
    () => filteredHubJobs.filter((h) => !trackedHfJobIds.has(h.id)),
    [filteredHubJobs, trackedHfJobIds],
  );
  // Hide model repos that map 1-to-1 to a tracked cloud job (those already
  // appear via JobCard); the remainder are past trainings the registry no
  // longer remembers.
  const trackedRepoIds = useMemo(
    () =>
      new Set(
        trackedCloudJobs
          .map((j) => j.hf_repo_id)
          .filter((id): id is string => !!id),
      ),
    [trackedCloudJobs],
  );
  const untrackedHubModels = useMemo(
    () => filteredHubModels.filter((m) => !trackedRepoIds.has(m.repo_id)),
    [filteredHubModels, trackedRepoIds],
  );

  // Active = running or has runnable checkpoints. Everything else collapses
  // under UNTRACKED so the eye lands on what's still relevant.
  const localActive = useMemo(() => localJobs.filter(isJobActive), [localJobs]);
  const localUntracked = useMemo(
    () => localJobs.filter((j) => !isJobActive(j)),
    [localJobs],
  );
  const trackedCloudActive = useMemo(
    () => trackedCloudJobs.filter(isJobActive),
    [trackedCloudJobs],
  );
  const trackedCloudUntracked = useMemo(
    () => trackedCloudJobs.filter((j) => !isJobActive(j)),
    [trackedCloudJobs],
  );
  const untrackedHubActive = useMemo(
    () => untrackedHubJobs.filter(isHubJobActive),
    [untrackedHubJobs],
  );
  const untrackedHubInactive = useMemo(
    () => untrackedHubJobs.filter((h) => !isHubJobActive(h)),
    [untrackedHubJobs],
  );

  const untrackedCount =
    localUntracked.length +
    trackedCloudUntracked.length +
    untrackedHubInactive.length;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Jobs</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs"
              className="h-8 w-48 sm:w-60 pl-8 bg-slate-800/50 border-slate-700 text-sm text-white placeholder:text-slate-500"
              aria-label="Search jobs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportModalOpen(true)}
            className="h-8 border-slate-700 bg-slate-800/50 text-slate-200 hover:text-white"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Import model
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            className="h-7 w-7 text-slate-400 hover:text-white"
            aria-label="Refresh jobs"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-300">Couldn't load jobs: {error}</p> : null}

      <Collapsible defaultOpen>
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-90" />
          Local jobs ({localActive.length})
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          {localActive.length === 0 ? (
            <p className="text-sm text-slate-500">
              {query
                ? "No local jobs match your search."
                : "No active local jobs. Start one from the Training page."}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {localActive.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStop={handleStop}
                  onDelete={handleDelete}
                  onPlay={handlePlay}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {importedJobs.length > 0 ? (
        <>
          <div className="border-t border-slate-700" />
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition-colors">
              <ChevronRight className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-90" />
              Imported models ({importedJobs.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {importedJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onStop={handleStop}
                    onDelete={handleDelete}
                    onPlay={handlePlay}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}

      <div className="border-t border-slate-700" />

      <Collapsible defaultOpen>
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-90" />
          Online jobs (
          {trackedCloudActive.length +
            untrackedHubActive.length +
            untrackedHubModels.length}
          )
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          {!hubAuthenticated && trackedCloudJobs.length === 0 ? (
            <p className="text-sm text-slate-500">
              Sign in with Hugging Face to see your cloud jobs.
            </p>
          ) : trackedCloudActive.length === 0 &&
            untrackedHubActive.length === 0 &&
            untrackedHubModels.length === 0 ? (
            <p className="text-sm text-slate-500">
              {query ? "No online jobs match your search." : "No active cloud jobs."}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {trackedCloudActive.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStop={handleStop}
                  onDelete={handleDelete}
                  onPlay={handlePlay}
                />
              ))}
              {untrackedHubActive.map((job) => (
                <HubJobCard key={job.id} job={job} />
              ))}
              {untrackedHubModels.map((model) => (
                <HubModelCard key={model.repo_id} model={model} />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {untrackedCount > 0 ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition-colors">
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-90" />
            Untracked ({untrackedCount})
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {localUntracked.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStop={handleStop}
                  onDelete={handleDelete}
                  onPlay={handlePlay}
                />
              ))}
              {trackedCloudUntracked.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStop={handleStop}
                  onDelete={handleDelete}
                  onPlay={handlePlay}
                />
              ))}
              {untrackedHubInactive.map((job) => (
                <HubJobCard key={job.id} job={job} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {inferenceJob ? (
        <InferenceModal
          open={inferenceModalOpen}
          onOpenChange={setInferenceModalOpen}
          robot={selectedRecord}
          jobId={inferenceJob.id}
          initialStep={inferenceStep}
        />
      ) : null}

      <ImportModelModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onImported={refresh}
      />
    </section>
  );
};

export default JobsSection;
