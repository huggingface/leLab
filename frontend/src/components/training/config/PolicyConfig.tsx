
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Cpu } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const PolicyConfig: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <Cpu className="w-5 h-5 text-sky-400" />
          </div>
          Policy Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="policy_type" className="text-slate-300">
            Policy Type
          </Label>
          <Select
            value={config.policy_type}
            onValueChange={(value) =>
              updateConfig("policy_type", value)
            }
          >
            <SelectTrigger className="bg-slate-900 border-slate-600 text-white rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="act">ACT (Action Chunking Transformer)</SelectItem>
              <SelectItem value="diffusion">Diffusion Policy</SelectItem>
              <SelectItem value="pi0">PI0</SelectItem>
              <SelectItem value="smolvla">SmolVLA</SelectItem>
              <SelectItem value="tdmpc">TD-MPC</SelectItem>
              <SelectItem value="vqbet">VQ-BeT</SelectItem>
              <SelectItem value="pi0fast">PI0 Fast</SelectItem>
              <SelectItem value="sac">SAC</SelectItem>
              <SelectItem value="reward_classifier">Reward Classifier</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="policy_device" className="text-slate-300">
            Device
          </Label>
          <Select
            value={config.policy_device || "cuda"}
            onValueChange={(value) =>
              updateConfig("policy_device", value)
            }
          >
            <SelectTrigger className="bg-slate-900 border-slate-600 text-white rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="cuda">CUDA (GPU)</SelectItem>
              <SelectItem value="cpu">CPU</SelectItem>
              <SelectItem value="mps">MPS (Apple Silicon)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center space-x-3 pt-2">
          <Switch
            id="policy_use_amp"
            checked={config.policy_use_amp}
            onCheckedChange={(checked) =>
              updateConfig("policy_use_amp", checked)
            }
          />
          <Label htmlFor="policy_use_amp" className="text-slate-300">
            Use Automatic Mixed Precision (AMP)
          </Label>
        </div>
      </CardContent>
    </Card>
  );
};

export default PolicyConfig;
