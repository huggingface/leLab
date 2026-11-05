import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigComponentProps } from '../types';
import DatasetCombobox from '@/components/replay/DatasetCombobox';
import { DatasetItem } from '@/lib/replayApi';

interface EssentialsCardProps extends ConfigComponentProps {
  datasets: DatasetItem[];
  datasetsLoading: boolean;
}

const EssentialsCard: React.FC<EssentialsCardProps> = ({ config, updateConfig, datasets, datasetsLoading }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="text-white">Run Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label className="text-slate-300">Dataset Repository ID *</Label>
          <div className="mt-1">
            <DatasetCombobox
              datasets={datasets}
              loading={datasetsLoading}
              value={config.dataset_repo_id || null}
              onChange={(repoId) => {
                if (repoId) updateConfig('dataset_repo_id', repoId);
              }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            HuggingFace Hub dataset repository ID
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="policy_type" className="text-slate-300">
              Policy
            </Label>
            <Select
              value={config.policy_type}
              onValueChange={(value) => updateConfig('policy_type', value)}
            >
              <SelectTrigger id="policy_type" className="bg-slate-900 border-slate-600 text-white rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600 text-white">
                <SelectItem value="act">ACT (Action Chunking Transformer)</SelectItem>
                <SelectItem value="diffusion">Diffusion Policy</SelectItem>
                <SelectItem value="multi_task_dit">Multi-Task DiT</SelectItem>
                <SelectItem value="pi0">PI0</SelectItem>
                <SelectItem value="pi0_fast">PI0 Fast</SelectItem>
                <SelectItem value="pi05">PI0.5</SelectItem>
                <SelectItem value="smolvla">SmolVLA</SelectItem>
                <SelectItem value="groot">GR00T N1.7</SelectItem>
                <SelectItem value="xvla">X-VLA</SelectItem>
                <SelectItem value="wall_x">WALL-OSS</SelectItem>
                <SelectItem value="eo1">EO-1</SelectItem>
                <SelectItem value="evo1">Evo-1</SelectItem>
                <SelectItem value="molmoact2">MolmoAct2</SelectItem>
                <SelectItem value="vla_jepa">VLA-JEPA</SelectItem>
                <SelectItem value="fastwam">FastWAM</SelectItem>
                <SelectItem value="lingbot_va">LingBot-VA</SelectItem>
                <SelectItem value="tdmpc">TD-MPC</SelectItem>
                <SelectItem value="vqbet">VQ-BeT</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="steps" className="text-slate-300">
              Training Steps
            </Label>
            <NumberInput
              id="steps"
              value={config.steps}
              onChange={(v) => {
                if (v !== undefined) updateConfig('steps', v);
              }}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>

          <div>
            <Label htmlFor="batch_size" className="text-slate-300">
              Batch Size
            </Label>
            <NumberInput
              id="batch_size"
              value={config.batch_size}
              onChange={(v) => {
                if (v !== undefined) updateConfig('batch_size', v);
              }}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>

          <div className="flex items-center space-x-3 pt-6">
            <Switch
              id="trackio_enable"
              checked={config.trackio_enable}
              onCheckedChange={(checked) => updateConfig('trackio_enable', checked)}
              className="data-[state=checked]:bg-green-500"
            />
            <Label htmlFor="trackio_enable" className="text-slate-300">
              Track with Trackio
            </Label>
          </div>
        </div>

        {config.trackio_enable && (
          <div>
            <Label htmlFor="trackio_project" className="text-slate-300">
              Trackio Project Name
            </Label>
            <Input
              id="trackio_project"
              value={config.trackio_project || ''}
              onChange={(e) =>
                updateConfig('trackio_project', e.target.value || undefined)
              }
              placeholder="lerobot"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EssentialsCard;
