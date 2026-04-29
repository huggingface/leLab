
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const OptimizerConfig: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <Settings className="w-5 h-5 text-sky-400" />
          </div>
          Optimizer Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="optimizer_type" className="text-slate-300">
            Optimizer Type
          </Label>
          <Select
            value={config.optimizer_type || "adam"}
            onValueChange={(value) =>
              updateConfig("optimizer_type", value)
            }
          >
            <SelectTrigger className="bg-slate-900 border-slate-600 text-white rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="adam">Adam</SelectItem>
              <SelectItem value="adamw">AdamW</SelectItem>
              <SelectItem value="sgd">SGD</SelectItem>
              <SelectItem value="multi_adam">Multi Adam</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="optimizer_lr" className="text-slate-300">
              Learning Rate
            </Label>
            <Input
              id="optimizer_lr"
              type="number"
              step="0.0001"
              value={config.optimizer_lr || ""}
              onChange={(e) =>
                updateConfig(
                  "optimizer_lr",
                  e.target.value
                    ? parseFloat(e.target.value)
                    : undefined
                )
              }
              placeholder="Use policy default"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div>
            <Label
              htmlFor="optimizer_weight_decay"
              className="text-slate-300"
            >
              Weight Decay
            </Label>
            <Input
              id="optimizer_weight_decay"
              type="number"
              step="0.0001"
              value={config.optimizer_weight_decay || ""}
              onChange={(e) =>
                updateConfig(
                  "optimizer_weight_decay",
                  e.target.value
                    ? parseFloat(e.target.value)
                    : undefined
                )
              }
              placeholder="Use policy default"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div>
            <Label
              htmlFor="optimizer_grad_clip_norm"
              className="text-slate-300"
            >
              Gradient Clipping
            </Label>
            <Input
              id="optimizer_grad_clip_norm"
              type="number"
              value={config.optimizer_grad_clip_norm || ""}
              onChange={(e) =>
                updateConfig(
                  "optimizer_grad_clip_norm",
                  e.target.value
                    ? parseFloat(e.target.value)
                    : undefined
                )
              }
              placeholder="Use policy default"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default OptimizerConfig;
