
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FileText } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const LoggingConfig: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <FileText className="w-5 h-5 text-sky-400" />
          </div>
          Logging & Checkpointing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="log_freq" className="text-slate-300">
              Log Frequency
            </Label>
            <Input
              id="log_freq"
              type="number"
              value={config.log_freq}
              onChange={(e) =>
                updateConfig("log_freq", parseInt(e.target.value))
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div>
            <Label htmlFor="save_freq" className="text-slate-300">
              Save Frequency
            </Label>
            <Input
              id="save_freq"
              type="number"
              value={config.save_freq}
              onChange={(e) =>
                updateConfig("save_freq", parseInt(e.target.value))
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div>
            <Label htmlFor="eval_freq" className="text-slate-300">
              Eval Frequency
            </Label>
            <Input
              id="eval_freq"
              type="number"
              value={config.eval_freq}
              onChange={(e) =>
                updateConfig("eval_freq", parseInt(e.target.value))
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="output_dir" className="text-slate-300">
            Output Directory
          </Label>
          <Input
            id="output_dir"
            value={config.output_dir}
            onChange={(e) => updateConfig("output_dir", e.target.value)}
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
        </div>
        <div>
          <Label htmlFor="job_name" className="text-slate-300">
            Job Name (optional)
          </Label>
          <Input
            id="job_name"
            value={config.job_name || ""}
            onChange={(e) =>
              updateConfig("job_name", e.target.value || undefined)
            }
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
        </div>
        <div className="flex items-center space-x-3 pt-2">
          <Switch
            id="save_checkpoint"
            checked={config.save_checkpoint}
            onCheckedChange={(checked) =>
              updateConfig("save_checkpoint", checked)
            }
          />
          <Label htmlFor="save_checkpoint" className="text-slate-300">
            Save Checkpoints
          </Label>
        </div>
        <div className="flex items-center space-x-3">
          <Switch
            id="resume"
            checked={config.resume}
            onCheckedChange={(checked) =>
              updateConfig("resume", checked)
            }
          />
          <Label htmlFor="resume" className="text-slate-300">
            Resume from Checkpoint
          </Label>
        </div>
      </CardContent>
    </Card>
  );
};

export default LoggingConfig;
