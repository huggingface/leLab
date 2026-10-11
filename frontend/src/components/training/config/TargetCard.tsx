import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfigComponentProps, SshConnectionConfig } from "../types";
import { RunnerFlavor } from "@/lib/jobsApi";

const DEFAULT_SSH: SshConnectionConfig = {
  host: "",
  port: 22,
  username: "",
  ssh_key_path: "",
  remote_workdir: "",
  remote_python_cmd: "python",
};

interface TargetCardProps extends ConfigComponentProps {
  authenticated: boolean;
  flavors: RunnerFlavor[];
  loading: boolean;
}

const formatHourly = (unitCostUsd: number, unitLabel: string): string => {
  const hourly = unitLabel === "minute" ? unitCostUsd * 60 : unitCostUsd;
  return `$${hourly.toFixed(2)}/hr`;
};

const formatFlavorLine = (f: RunnerFlavor): string => {
  const accel = f.accelerator ? f.accelerator : f.cpu;
  return `${f.pretty_name} · ${accel} · ${formatHourly(f.unit_cost_usd, f.unit_label)}`;
};

const TargetCard: React.FC<TargetCardProps> = ({
  config,
  updateConfig,
  authenticated,
  flavors,
  loading,
}) => {
  const target = config.target;
  const value =
    target.runner === "local"
      ? "local"
      : target.runner === "ssh_remote"
      ? "ssh"
      : `hf:${target.flavor ?? ""}`;

  const handleChange = (v: string) => {
    if (v === "local") {
      updateConfig("target", { runner: "local" });
    } else if (v === "ssh") {
      updateConfig("target", { runner: "ssh_remote", ssh: target.ssh ?? DEFAULT_SSH });
    } else if (v.startsWith("hf:")) {
      const flavor = v.slice("hf:".length);
      updateConfig("target", { runner: "hf_cloud", flavor });
    }
  };

  const updateSsh = <K extends keyof SshConnectionConfig>(key: K, value: SshConnectionConfig[K]) => {
    updateConfig("target", {
      runner: "ssh_remote",
      ssh: { ...(target.ssh ?? DEFAULT_SSH), [key]: value },
    });
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="text-white">Compute target</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-slate-300">Run training on</Label>
          <Select value={value} onValueChange={handleChange}>
            <SelectTrigger className="bg-slate-900 border-slate-600 text-white rounded-lg mt-1">
              <SelectValue placeholder={loading ? "Loading…" : "Select target"} />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600 text-white">
              <SelectItem value="local">Local — your machine (free)</SelectItem>
              <SelectItem value="ssh">Remote server (SSH) — your own machine</SelectItem>
              {flavors.map((f) => (
                <SelectItem
                  key={f.name}
                  value={`hf:${f.name}`}
                  disabled={!authenticated}
                >
                  {formatFlavorLine(f)}
                  {!authenticated && (
                    <span className="text-amber-300 ml-2 text-xs">
                      log in to HF
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500 mt-1">
            Cost shown is per running hour. Final policy uploads to your HF
            account when training completes.
          </p>
        </div>

        {target.runner === "ssh_remote" && (
          <div className="space-y-4 pt-2 border-t border-slate-700">
            <p className="text-xs text-slate-500">
              lelab makes no assumption about what's installed on this server — it
              copies the dataset over via scp and runs the command below as-is.
              Make sure lerobot is already set up there.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Label className="text-slate-300">Host</Label>
                <Input
                  value={target.ssh?.host ?? ""}
                  onChange={(e) => updateSsh("host", e.target.value)}
                  placeholder="gpu.example.com or 192.168.1.10"
                  className="bg-slate-900 border-slate-600 text-white rounded-lg mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300">Port</Label>
                <NumberInput
                  value={target.ssh?.port ?? 22}
                  onChange={(v) => v !== undefined && updateSsh("port", v)}
                  className="bg-slate-900 border-slate-600 text-white rounded-lg mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Username</Label>
                <Input
                  value={target.ssh?.username ?? ""}
                  onChange={(e) => updateSsh("username", e.target.value)}
                  placeholder="noah"
                  className="bg-slate-900 border-slate-600 text-white rounded-lg mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300">SSH key path (optional)</Label>
                <Input
                  value={target.ssh?.ssh_key_path ?? ""}
                  onChange={(e) => updateSsh("ssh_key_path", e.target.value)}
                  placeholder="Leave empty to use ssh-agent / default identity"
                  className="bg-slate-900 border-slate-600 text-white rounded-lg mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300">Remote working directory</Label>
              <Input
                value={target.ssh?.remote_workdir ?? ""}
                onChange={(e) => updateSsh("remote_workdir", e.target.value)}
                placeholder="/home/noah/lelab-runs"
                className="bg-slate-900 border-slate-600 text-white rounded-lg mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">
                Datasets and outputs are staged under here — nothing outside it is touched.
              </p>
            </div>
            <div>
              <Label className="text-slate-300">Remote Python command</Label>
              <Input
                value={target.ssh?.remote_python_cmd ?? "python"}
                onChange={(e) => updateSsh("remote_python_cmd", e.target.value)}
                placeholder="python, or e.g. source ~/venv/bin/activate && python"
                className="bg-slate-900 border-slate-600 text-white rounded-lg mt-1 font-mono text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                Whatever it takes to reach an interpreter with lerobot installed —
                lelab runs this verbatim, followed by the training command.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TargetCard;
