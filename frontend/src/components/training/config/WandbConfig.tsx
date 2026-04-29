
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const WandbConfig: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <TrendingUp className="w-5 h-5 text-sky-400" />
          </div>
          Weights & Biases
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-3 pt-2">
          <Switch
            id="wandb_enable"
            checked={config.wandb_enable}
            onCheckedChange={(checked) =>
              updateConfig("wandb_enable", checked)
            }
          />
          <Label htmlFor="wandb_enable" className="text-slate-300">
            Enable Weights & Biases Logging
          </Label>
        </div>
        {config.wandb_enable && (
          <>
            <div>
              <Label htmlFor="wandb_project" className="text-slate-300">
                W&B Project Name
              </Label>
              <Input
                id="wandb_project"
                value={config.wandb_project || ""}
                onChange={(e) =>
                  updateConfig(
                    "wandb_project",
                    e.target.value || undefined
                  )
                }
                placeholder="my-robotics-project"
                className="bg-slate-900 border-slate-600 text-white rounded-lg"
              />
            </div>
            <div>
              <Label htmlFor="wandb_entity" className="text-slate-300">
                W&B Entity (optional)
              </Label>
              <Input
                id="wandb_entity"
                value={config.wandb_entity || ""}
                onChange={(e) =>
                  updateConfig(
                    "wandb_entity",
                    e.target.value || undefined
                  )
                }
                placeholder="your-username"
                className="bg-slate-900 border-slate-600 text-white rounded-lg"
              />
            </div>
            <div>
              <Label htmlFor="wandb_notes" className="text-slate-300">
                W&B Notes (optional)
              </Label>
              <Input
                id="wandb_notes"
                value={config.wandb_notes || ""}
                onChange={(e) =>
                  updateConfig(
                    "wandb_notes",
                    e.target.value || undefined
                  )
                }
                placeholder="Training run notes..."
                className="bg-slate-900 border-slate-600 text-white rounded-lg"
              />
            </div>
            <div>
              <Label htmlFor="wandb_mode" className="text-slate-300">
                W&B Mode
              </Label>
              <Select
                value={config.wandb_mode || "online"}
                onValueChange={(value) =>
                  updateConfig("wandb_mode", value)
                }
              >
                <SelectTrigger className="bg-slate-900 border-slate-600 text-white rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-3 pt-2">
              <Switch
                id="wandb_disable_artifact"
                checked={config.wandb_disable_artifact}
                onCheckedChange={(checked) =>
                  updateConfig("wandb_disable_artifact", checked)
                }
              />
              <Label
                htmlFor="wandb_disable_artifact"
                className="text-slate-300"
              >
                Disable Artifacts
              </Label>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default WandbConfig;
