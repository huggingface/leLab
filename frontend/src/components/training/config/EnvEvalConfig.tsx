
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const EnvEvalConfig: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <Activity className="w-5 h-5 text-sky-400" />
          </div>
          Environment & Evaluation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="env_type" className="text-slate-300">
            Environment Type (optional)
          </Label>
          <Select
            value={config.env_type || "none"}
            onValueChange={(value) =>
              updateConfig(
                "env_type",
                value === "none" ? undefined : value
              )
            }
          >
            <SelectTrigger className="bg-slate-900 border-slate-600 text-white rounded-lg">
              <SelectValue placeholder="Select environment type" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="aloha">Aloha</SelectItem>
              <SelectItem value="pusht">PushT</SelectItem>
              <SelectItem value="xarm">XArm</SelectItem>
              <SelectItem value="gym_manipulator">
                Gym Manipulator
              </SelectItem>
              <SelectItem value="hil">HIL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="env_task" className="text-slate-300">
            Environment Task (optional)
          </Label>
          <Input
            id="env_task"
            value={config.env_task || ""}
            onChange={(e) =>
              updateConfig("env_task", e.target.value || undefined)
            }
            placeholder="e.g., insertion_human"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="eval_n_episodes" className="text-slate-300">
              Eval Episodes
            </Label>
            <Input
              id="eval_n_episodes"
              type="number"
              value={config.eval_n_episodes}
              onChange={(e) =>
                updateConfig(
                  "eval_n_episodes",
                  parseInt(e.target.value)
                )
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div>
            <Label htmlFor="eval_batch_size" className="text-slate-300">
              Eval Batch Size
            </Label>
            <Input
              id="eval_batch_size"
              type="number"
              value={config.eval_batch_size}
              onChange={(e) =>
                updateConfig(
                  "eval_batch_size",
                  parseInt(e.target.value)
                )
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>
        <div className="flex items-center space-x-3 pt-2">
          <Switch
            id="eval_use_async_envs"
            checked={config.eval_use_async_envs}
            onCheckedChange={(checked) =>
              updateConfig("eval_use_async_envs", checked)
            }
          />
          <Label
            htmlFor="eval_use_async_envs"
            className="text-slate-300"
          >
            Use Asynchronous Environments
          </Label>
        </div>
      </CardContent>
    </Card>
  );
};

export default EnvEvalConfig;
