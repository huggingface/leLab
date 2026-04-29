
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const TrainingParams: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <TrendingUp className="w-5 h-5 text-sky-400" />
          </div>
          Training Parameters
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="steps" className="text-slate-300">
              Training Steps
            </Label>
            <Input
              id="steps"
              type="number"
              value={config.steps}
              onChange={(e) =>
                updateConfig("steps", parseInt(e.target.value))
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div>
            <Label htmlFor="batch_size" className="text-slate-300">
              Batch Size
            </Label>
            <Input
              id="batch_size"
              type="number"
              value={config.batch_size}
              onChange={(e) =>
                updateConfig("batch_size", parseInt(e.target.value))
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="seed" className="text-slate-300">
              Random Seed
            </Label>
            <Input
              id="seed"
              type="number"
              value={config.seed || ""}
              onChange={(e) =>
                updateConfig(
                  "seed",
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div>
            <Label htmlFor="num_workers" className="text-slate-300">
              Number of Workers
            </Label>
            <Input
              id="num_workers"
              type="number"
              value={config.num_workers}
              onChange={(e) =>
                updateConfig("num_workers", parseInt(e.target.value))
              }
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TrainingParams;
