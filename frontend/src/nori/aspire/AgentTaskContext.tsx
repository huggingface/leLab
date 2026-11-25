// NORI: the running ASPIRE task, held above the pages so leaving the Agent page does not end it. It owns what must outlive
// that page: the deadman check-ins, the guard that keeps this app from taking the robot's one session, and a STOP that
// stays reachable from every page. Closing the tab still stops the robot: the check-ins end with the page and the backend
// cancels the task (PRESENCE_TIMEOUT_S). The id is in sessionStorage so a reload finds the task again; closing the tab
// clears it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { OctagonX } from "lucide-react";
import { useApi } from "@/contexts/ApiContext";
import { useTeleopSession } from "@/nori/TeleopSessionContext";
import { useNori } from "@/nori/NoriContext";
import { aspireApi, TERMINAL, type TaskStatus } from "@/nori/aspire/api";
import { archiveTaskHarness, pendingHarnessTasks } from "./harnesses";
import { backgroundTick, holdAwake } from "@/nori/aspire/backgroundTick";

const PRESENCE_MS = 2000;       // the backend cancels after 6 s without a check-in
const KEY = "nori_agent_task";

interface Tracked { id: string; presence: boolean }

interface AgentTaskValue {
  taskId: string | null;
  status: TaskStatus | null;
  active: boolean;
  harnessError: string | null;
  track: (id: string, presence: boolean) => void;
  stop: (reason: string) => Promise<void>;
}

const AgentTaskContext = createContext<AgentTaskValue | undefined>(undefined);

function restore(): Tracked | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Tracked | null; } catch { return null; }
}

export const AgentTaskProvider = ({ children }: { children: ReactNode }) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { setYield } = useTeleopSession();
  const { activeRobotSerial, customer } = useNori();
  const api = useMemo(() => aspireApi(baseUrl, fetchWithHeaders), [baseUrl, fetchWithHeaders]);
  const [task, setTask] = useState<Tracked | null>(restore);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const owner = customer?.id;
  const robot = activeRobotSerial ?? customer?.robot_serial_number ?? "the robot";
  const finished = status !== null && TERMINAL.has(status);
  const active = !!task && status !== null && !finished;

  const track = useCallback((id: string, presence: boolean) => {
    setHarnessError(null); setStatus(null); setTask({ id, presence });
    try { sessionStorage.setItem(KEY, JSON.stringify({ id, presence })); } catch { /* a reload just loses the task view */ }
  }, []);

  // One tick drives both: the status read, and the check-in until the task has ended.
  useEffect(() => {
    if (!task || (finished && !harnessError)) return;
    let stale = false;
    let reading = false;
    const tick = () => {
      if (task.presence && !finished) void api.presence(task.id).catch(() => { /* retried next tick */ });
      if (reading) return;
      reading = true;
      void api.task(task.id).then((r) => {
        if (stale) return;
        if (r.authored_harness || r.constraints?.harness === "authored") {
          try {
            if (!owner) throw new Error("Waiting for account");
            archiveTaskHarness(owner, r);
            setHarnessError(null);
          } catch {
            setHarnessError("Could not save the harness on this device. Check browser storage. Saving will retry.");
          }
        }
        setStatus(r.status);
      }).catch(() => { /* retried next tick */ }).finally(() => { reading = false; });
    };
    tick();
    const stop = backgroundTick(PRESENCE_MS, tick);
    return () => { stale = true; stop(); };
  }, [api, task, finished, owner, harnessError]);

  // Finish archiving runs started in a tab that has since closed, without taking over their presence check-ins.
  useEffect(() => {
    if (!owner) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function recover(account: string) {
      try {
        const ids = pendingHarnessTasks(account).filter((id) => id !== task?.id);
        if (!ids.length) return;
        for (const id of ids) {
          if (closed) return;
          try {
            const record = await api.task(id);
            if (!closed) archiveTaskHarness(account, record);
          } catch { /* retry this run independently of other pending runs */ }
        }
      } catch { /* a later read can recover the saved task */ }
      if (!closed) timer = setTimeout(() => void recover(account), 10000);
    }
    void recover(owner);
    return () => { closed = true; clearTimeout(timer); };
  }, [api, owner, task?.id]);

  useEffect(() => {
    if (!finished || harnessError) return;
    try { sessionStorage.removeItem(KEY); } catch { /* nothing to clean */ }
  }, [finished, harnessError]);

  useEffect(() => (active ? holdAwake("nori-agent-task") : undefined), [active]);

  // The robot has ONE session: this app must not reconnect while the worker holds it, on any page.
  useEffect(() => {
    setYield("agent-task", active ? `ASPIRE task running on ${robot} (Agent page)` : null);
    return () => setYield("agent-task", null);
  }, [setYield, active, robot]);

  const stop = useCallback(async (reason: string) => {
    if (task) await api.cancel(task.id, reason);
  }, [api, task]);

  const value = useMemo(() => ({ taskId: task?.id ?? null, status, active, track, stop, harnessError }), [task, status, active, track, stop, harnessError]);
  return (
    <AgentTaskContext.Provider value={value}>
      {children}
      <RunningTaskBar />
    </AgentTaskContext.Provider>
  );
};

export const useAgentTask = (): AgentTaskValue => {
  const ctx = useContext(AgentTaskContext);
  if (ctx === undefined) throw new Error("useAgentTask must be used within an AgentTaskProvider");
  return ctx;
};

/** STOP must stay in reach once a task can run while the operator is on another page. */
const RunningTaskBar = () => {
  const { active, stop } = useAgentTask();
  const { pathname } = useLocation();
  const [failed, setFailed] = useState(false);
  if (!active || pathname.startsWith("/nori/agent")) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-md border border-nori-h14131a/15 bg-nori-hf6f4eb px-3 py-2 text-xs text-nori-h14131a shadow-lg">
      <span>{failed ? "Stop failed, try again" : "ASPIRE task running"}</span>
      <Link to="/nori/agent" className="underline">Open</Link>
      <button type="button" onClick={() => { setFailed(false); stop("operator stop").catch(() => setFailed(true)); }}
        className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 font-bold text-white hover:bg-red-700">
        <OctagonX className="h-3.5 w-3.5" /> STOP
      </button>
    </div>
  );
};
