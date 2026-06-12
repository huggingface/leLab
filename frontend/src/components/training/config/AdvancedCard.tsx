import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ConfigComponentProps } from '../types';
import { policyAdvancedCapabilities } from '../trainingPolicies';

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
    {children}
  </h4>
);

const AdvancedCard: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  const [expanded, setExpanded] = useState(false);
  const policyCapabilities = policyAdvancedCapabilities(config.policy_type);

  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="cursor-pointer select-none flex flex-row items-center justify-between"
      >
        <span className="text-white font-semibold">Advanced</span>
        <span className="flex items-center gap-1 text-slate-400 text-sm">
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          {expanded ? 'Hide' : 'Show'}
        </span>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-8">
          {/* Policy */}
          <section className="space-y-4">
            <SectionHeading>Policy</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="policy_device" className="text-slate-300">
                  Device
                </Label>
                <Select
                  value={config.policy_device || 'cuda'}
                  onValueChange={(value) => updateConfig('policy_device', value)}
                >
                  <SelectTrigger id="policy_device" className="bg-slate-900 border-slate-600 text-white rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    <SelectItem value="cuda">CUDA (GPU)</SelectItem>
                    <SelectItem value="cpu">CPU</SelectItem>
                    <SelectItem value="mps">MPS (Apple Silicon)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-3 pt-6">
                <Switch
                  id="policy_use_amp"
                  checked={config.policy_use_amp}
                  onCheckedChange={(checked) => updateConfig('policy_use_amp', checked)}
                />
                <Label htmlFor="policy_use_amp" className="text-slate-300">
                  Use Automatic Mixed Precision
                </Label>
              </div>
              {policyCapabilities.dtype && (
                <div>
                  <Label htmlFor="policy_dtype" className="text-slate-300">
                    Policy dtype
                  </Label>
                  <Select
                    value={config.policy_dtype || 'default'}
                    onValueChange={(value) =>
                      updateConfig('policy_dtype', value === 'default' ? undefined : value)
                    }
                  >
                    <SelectTrigger id="policy_dtype" className="bg-slate-900 border-slate-600 text-white rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-600 text-white">
                      <SelectItem value="default">Policy default</SelectItem>
                      <SelectItem value="bfloat16">bfloat16</SelectItem>
                      <SelectItem value="float32">float32</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {policyCapabilities.gradientCheckpointing && (
                <div className="flex items-center space-x-3 pt-6">
                  <Switch
                    id="policy_gradient_checkpointing"
                    checked={Boolean(config.policy_gradient_checkpointing)}
                    onCheckedChange={(checked) =>
                      updateConfig('policy_gradient_checkpointing', checked)
                    }
                  />
                  <Label htmlFor="policy_gradient_checkpointing" className="text-slate-300">
                    Gradient checkpointing
                  </Label>
                </div>
              )}
              {policyCapabilities.freezeVisionEncoder && (
                <div className="flex items-center space-x-3 pt-6">
                  <Switch
                    id="policy_freeze_vision_encoder"
                    checked={Boolean(config.policy_freeze_vision_encoder)}
                    onCheckedChange={(checked) =>
                      updateConfig('policy_freeze_vision_encoder', checked)
                    }
                  />
                  <Label htmlFor="policy_freeze_vision_encoder" className="text-slate-300">
                    Freeze vision encoder
                  </Label>
                </div>
              )}
              {policyCapabilities.trainExpertOnly && (
                <div className="flex items-center space-x-3 pt-6">
                  <Switch
                    id="policy_train_expert_only"
                    checked={Boolean(config.policy_train_expert_only)}
                    onCheckedChange={(checked) =>
                      updateConfig('policy_train_expert_only', checked)
                    }
                  />
                  <Label htmlFor="policy_train_expert_only" className="text-slate-300">
                    Train expert only
                  </Label>
                </div>
              )}
            </div>
          </section>

          <Separator className="bg-slate-700" />

          {/* Training */}
          <section className="space-y-4">
            <SectionHeading>Training</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="seed" className="text-slate-300">
                  Random Seed
                </Label>
                <NumberInput
                  id="seed"
                  value={config.seed}
                  onChange={(v) => updateConfig('seed', v)}
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="num_workers" className="text-slate-300">
                  Number of Workers
                </Label>
                <NumberInput
                  id="num_workers"
                  value={config.num_workers}
                  onChange={(v) => {
                    if (v !== undefined) updateConfig('num_workers', v);
                  }}
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
              </div>
            </div>
          </section>

          <Separator className="bg-slate-700" />

          {/* Optimizer */}
          <section className="space-y-4">
            <SectionHeading>Optimizer</SectionHeading>
            <div>
              <Label htmlFor="optimizer_type" className="text-slate-300">
                Optimizer
              </Label>
              <Select
                value={config.optimizer_type || 'adam'}
                onValueChange={(value) => updateConfig('optimizer_type', value)}
              >
                <SelectTrigger id="optimizer_type" className="bg-slate-900 border-slate-600 text-white rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600 text-white">
                  <SelectItem value="adam">Adam</SelectItem>
                  <SelectItem value="adamw">AdamW</SelectItem>
                  <SelectItem value="sgd">SGD</SelectItem>
                  <SelectItem value="multi_adam">Multi Adam</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="optimizer_lr" className="text-slate-300">
                  Learning Rate
                </Label>
                <NumberInput
                  id="optimizer_lr"
                  integer={false}
                  step="0.0001"
                  value={config.optimizer_lr}
                  onChange={(v) => updateConfig('optimizer_lr', v)}
                  placeholder="Use policy default"
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="optimizer_weight_decay" className="text-slate-300">
                  Weight Decay
                </Label>
                <NumberInput
                  id="optimizer_weight_decay"
                  integer={false}
                  step="0.0001"
                  value={config.optimizer_weight_decay}
                  onChange={(v) => updateConfig('optimizer_weight_decay', v)}
                  placeholder="Use policy default"
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="optimizer_grad_clip_norm" className="text-slate-300">
                  Gradient Clipping
                </Label>
                <NumberInput
                  id="optimizer_grad_clip_norm"
                  integer={false}
                  step="0.0001"
                  value={config.optimizer_grad_clip_norm}
                  onChange={(v) => updateConfig('optimizer_grad_clip_norm', v)}
                  placeholder="Use policy default"
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
              </div>
            </div>
          </section>

          <Separator className="bg-slate-700" />

          {/* Logging & Checkpointing */}
          <section className="space-y-4">
            <SectionHeading>Logging & Checkpointing</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="log_freq" className="text-slate-300">
                  Log Frequency
                </Label>
                <NumberInput
                  id="log_freq"
                  value={config.log_freq}
                  onChange={(v) => {
                    if (v !== undefined) updateConfig('log_freq', v);
                  }}
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="save_freq" className="text-slate-300">
                  Save Frequency
                </Label>
                <NumberInput
                  id="save_freq"
                  value={config.save_freq}
                  onChange={(v) => {
                    if (v !== undefined) updateConfig('save_freq', v);
                  }}
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Switch
                id="save_checkpoint"
                checked={config.save_checkpoint}
                onCheckedChange={(checked) => updateConfig('save_checkpoint', checked)}
              />
              <Label htmlFor="save_checkpoint" className="text-slate-300">
                Save Checkpoints
              </Label>
            </div>
            <div className="flex items-center space-x-3">
              <Switch
                id="resume"
                checked={config.resume}
                onCheckedChange={(checked) => updateConfig('resume', checked)}
              />
              <Label htmlFor="resume" className="text-slate-300">
                Resume from Checkpoint
              </Label>
            </div>
          </section>

          {config.wandb_enable && (
            <>
              <Separator className="bg-slate-700" />
              <section className="space-y-4">
                <SectionHeading>Weights & Biases</SectionHeading>
                <div>
                  <Label htmlFor="wandb_entity" className="text-slate-300">
                    W&B Entity (optional)
                  </Label>
                  <Input
                    id="wandb_entity"
                    value={config.wandb_entity || ''}
                    onChange={(e) =>
                      updateConfig('wandb_entity', e.target.value || undefined)
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
                    value={config.wandb_notes || ''}
                    onChange={(e) =>
                      updateConfig('wandb_notes', e.target.value || undefined)
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
                    value={config.wandb_mode || 'online'}
                    onValueChange={(value) => updateConfig('wandb_mode', value)}
                  >
                    <SelectTrigger id="wandb_mode" className="bg-slate-900 border-slate-600 text-white rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-600 text-white">
                      <SelectItem value="online">Online</SelectItem>
                      <SelectItem value="offline">Offline</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center space-x-3">
                  <Switch
                    id="wandb_disable_artifact"
                    checked={config.wandb_disable_artifact}
                    onCheckedChange={(checked) =>
                      updateConfig('wandb_disable_artifact', checked)
                    }
                  />
                  <Label htmlFor="wandb_disable_artifact" className="text-slate-300">
                    Disable Artifacts
                  </Label>
                </div>
              </section>
            </>
          )}

          {!config.wandb_enable && <Separator className="bg-slate-700" />}

          {/* Misc */}
          <section className="space-y-4">
            <SectionHeading>Misc</SectionHeading>
            <div className="flex items-center space-x-3">
              <Switch
                id="use_policy_training_preset"
                checked={config.use_policy_training_preset}
                onCheckedChange={(checked) =>
                  updateConfig('use_policy_training_preset', checked)
                }
              />
              <Label htmlFor="use_policy_training_preset" className="text-slate-300">
                Use Policy Training Preset
              </Label>
            </div>
          </section>
        </CardContent>
      )}
    </Card>
  );
};

export default AdvancedCard;
