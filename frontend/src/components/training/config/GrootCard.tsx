import React, { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfigComponentProps } from '../types';

// Sensible GR00T N1.7 defaults, seeded the first time the user picks the policy
// so the form matches the canonical fine-tuning command out of the box.
const GROOT_DEFAULTS = {
  policy_base_model_path: 'nvidia/GR00T-N1.7-3B',
  policy_embodiment_tag: 'new_embodiment',
  policy_chunk_size: 16,
  policy_n_action_steps: 16,
  policy_use_relative_actions: true,
  policy_relative_exclude_joints: ['gripper'],
  policy_use_bf16: true,
  dataset_image_transforms_enable: true,
} as const;

const GrootCard: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  const isGroot = config.policy_type === 'groot';

  // Seed defaults once when groot is selected. Each key is only written when
  // still undefined, so the effect can't loop and never clobbers user edits.
  useEffect(() => {
    if (!isGroot) return;
    (Object.keys(GROOT_DEFAULTS) as (keyof typeof GROOT_DEFAULTS)[]).forEach((key) => {
      if (config[key] === undefined) {
        updateConfig(key, GROOT_DEFAULTS[key] as never);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroot]);

  if (!isGroot) return null;

  const excludeJoints = (config.policy_relative_exclude_joints ?? []).join(', ');

  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="text-white">GR00T N1.7</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="policy_base_model_path" className="text-slate-300">
            Base Model Path
          </Label>
          <Input
            id="policy_base_model_path"
            value={config.policy_base_model_path ?? ''}
            onChange={(e) =>
              updateConfig('policy_base_model_path', e.target.value || undefined)
            }
            placeholder="nvidia/GR00T-N1.7-3B"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
          <p className="text-xs text-slate-500 mt-1">
            HuggingFace repo of the pretrained GR00T backbone to fine-tune.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="policy_embodiment_tag" className="text-slate-300">
              Embodiment Tag
            </Label>
            <Input
              id="policy_embodiment_tag"
              value={config.policy_embodiment_tag ?? ''}
              onChange={(e) =>
                updateConfig('policy_embodiment_tag', e.target.value || undefined)
              }
              placeholder="new_embodiment"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>

          <div>
            <Label htmlFor="policy_relative_exclude_joints" className="text-slate-300">
              Relative Exclude Joints
            </Label>
            <Input
              id="policy_relative_exclude_joints"
              value={excludeJoints}
              onChange={(e) =>
                updateConfig(
                  'policy_relative_exclude_joints',
                  e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder="gripper"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
            <p className="text-xs text-slate-500 mt-1">
              Comma-separated joints kept absolute when relative actions are on.
            </p>
          </div>

          <div>
            <Label htmlFor="policy_chunk_size" className="text-slate-300">
              Chunk Size
            </Label>
            <NumberInput
              id="policy_chunk_size"
              value={config.policy_chunk_size}
              onChange={(v) => updateConfig('policy_chunk_size', v)}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>

          <div>
            <Label htmlFor="policy_n_action_steps" className="text-slate-300">
              Action Steps
            </Label>
            <NumberInput
              id="policy_n_action_steps"
              value={config.policy_n_action_steps}
              onChange={(v) => updateConfig('policy_n_action_steps', v)}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <Switch
              id="policy_use_relative_actions"
              checked={config.policy_use_relative_actions ?? false}
              onCheckedChange={(checked) =>
                updateConfig('policy_use_relative_actions', checked)
              }
              className="data-[state=checked]:bg-green-500"
            />
            <Label htmlFor="policy_use_relative_actions" className="text-slate-300">
              Use Relative Actions
            </Label>
          </div>

          <div className="flex items-center space-x-3">
            <Switch
              id="policy_use_bf16"
              checked={config.policy_use_bf16 ?? false}
              onCheckedChange={(checked) => updateConfig('policy_use_bf16', checked)}
              className="data-[state=checked]:bg-green-500"
            />
            <Label htmlFor="policy_use_bf16" className="text-slate-300">
              Use bfloat16
            </Label>
          </div>

          <div className="flex items-center space-x-3">
            <Switch
              id="dataset_image_transforms_enable"
              checked={config.dataset_image_transforms_enable ?? false}
              onCheckedChange={(checked) =>
                updateConfig('dataset_image_transforms_enable', checked)
              }
              className="data-[state=checked]:bg-green-500"
            />
            <Label htmlFor="dataset_image_transforms_enable" className="text-slate-300">
              Enable Image Augmentations
            </Label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default GrootCard;
