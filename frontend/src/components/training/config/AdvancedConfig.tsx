
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Settings } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const AdvancedConfig: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <Settings className="w-5 h-5 text-sky-400" />
          </div>
          Advanced Options
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="config_path" className="text-slate-300">
            Config Path (optional)
          </Label>
          <Input
            id="config_path"
            value={config.config_path || ""}
            onChange={(e) =>
              updateConfig("config_path", e.target.value || undefined)
            }
            placeholder="path/to/config.yaml"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
        </div>
        <div className="flex items-center space-x-3 pt-2">
          <Switch
            id="use_policy_training_preset"
            checked={config.use_policy_training_preset}
            onCheckedChange={(checked) =>
              updateConfig("use_policy_training_preset", checked)
            }
          />
          <Label
            htmlFor="use_policy_training_preset"
            className="text-slate-300"
          >
            Use Policy Training Preset
          </Label>
        </div>
      </CardContent>
    </Card>
  );
};

export default AdvancedConfig;
