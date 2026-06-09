import React, { useState } from 'react';
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
import WandbInstallDialog from '../WandbInstallDialog';
import { useApi } from '@/contexts/ApiContext';

interface EssentialsCardProps extends ConfigComponentProps {
  datasets: DatasetItem[];
  datasetsLoading: boolean;
}

const EssentialsCard: React.FC<EssentialsCardProps> = ({ config, updateConfig, datasets, datasetsLoading }) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [wandbDialogOpen, setWandbDialogOpen] = useState(false);
  const [wandbInstallHint, setWandbInstallHint] = useState('pip install wandb');

  const handleWandbToggle = async (checked: boolean) => {
    if (!checked) {
      updateConfig('wandb_enable', false);
      return;
    }
    // Check availability before flipping the switch on. If wandb isn't
    // importable in this lelab process, surface the same install flow used
    // for the training extra (accelerate) instead of letting the user start
    // a run that will fail.
    try {
      const r = await fetchWithHeaders(`${baseUrl}/system/wandb-extra`);
      const data: { available: boolean; install_hint: string } = await r.json();
      if (data.available) {
        updateConfig('wandb_enable', true);
      } else {
        setWandbInstallHint(data.install_hint);
        setWandbDialogOpen(true);
      }
    } catch {
      // Backend unreachable — let the user proceed; training start will
      // surface the real error if wandb is genuinely missing.
      updateConfig('wandb_enable', true);
    }
  };

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
                <SelectItem value="pi0">PI0</SelectItem>
                <SelectItem value="smolvla">SmolVLA</SelectItem>
                <SelectItem value="tdmpc">TD-MPC</SelectItem>
                <SelectItem value="vqbet">VQ-BeT</SelectItem>
                <SelectItem value="pi0_fast">PI0 Fast</SelectItem>
                <SelectItem value="sac">SAC</SelectItem>
                <SelectItem value="reward_classifier">Reward Classifier</SelectItem>
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
              id="wandb_enable"
              checked={config.wandb_enable}
              onCheckedChange={handleWandbToggle}
              className="data-[state=checked]:bg-green-500"
            />
            <Label htmlFor="wandb_enable" className="text-slate-300">
              Enable Weights & Biases
            </Label>
          </div>
        </div>

        <WandbInstallDialog
          open={wandbDialogOpen}
          onOpenChange={setWandbDialogOpen}
          installHint={wandbInstallHint}
        />

        {config.wandb_enable && (
          <div>
            <Label htmlFor="wandb_project" className="text-slate-300">
              W&B Project Name
            </Label>
            <Input
              id="wandb_project"
              value={config.wandb_project || ''}
              onChange={(e) =>
                updateConfig('wandb_project', e.target.value || undefined)
              }
              placeholder="my-robotics-project"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EssentialsCard;
