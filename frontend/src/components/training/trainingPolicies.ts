import { TrainingConfig } from "./types";

export const OFFLINE_TRAINING_POLICY_OPTIONS = [
  { value: "act", label: "ACT (Action Chunking Transformer)" },
  { value: "diffusion", label: "Diffusion Policy" },
  { value: "pi0", label: "PI0" },
  { value: "pi05", label: "PI0.5" },
  { value: "pi0_fast", label: "PI0 Fast" },
  { value: "smolvla", label: "SmolVLA" },
  { value: "vqbet", label: "VQ-BeT" },
] as const;

const PI0_POLICY_TYPES = new Set(["pi0", "pi05"]);
const PI0_FAST_POLICY_TYPES = new Set(["pi0_fast"]);
const SMOLVLA_POLICY_TYPES = new Set(["smolvla"]);

export function policyAdvancedCapabilities(policyType: string) {
  return {
    dtype: PI0_POLICY_TYPES.has(policyType) || PI0_FAST_POLICY_TYPES.has(policyType),
    gradientCheckpointing:
      PI0_POLICY_TYPES.has(policyType) || PI0_FAST_POLICY_TYPES.has(policyType),
    freezeVisionEncoder: PI0_POLICY_TYPES.has(policyType) || SMOLVLA_POLICY_TYPES.has(policyType),
    trainExpertOnly: PI0_POLICY_TYPES.has(policyType) || SMOLVLA_POLICY_TYPES.has(policyType),
  };
}

const resetPolicyAdvancedOptions = {
  policy_dtype: undefined,
  policy_gradient_checkpointing: undefined,
  policy_freeze_vision_encoder: undefined,
  policy_train_expert_only: undefined,
};

export function defaultsForPolicy(
  policyType: string,
  current: TrainingConfig,
): Partial<TrainingConfig> {
  if (PI0_POLICY_TYPES.has(policyType)) {
    return {
      ...resetPolicyAdvancedOptions,
      batch_size: Math.min(current.batch_size || 1, 1),
      policy_use_amp: true,
      policy_dtype: "bfloat16",
      policy_gradient_checkpointing: true,
      policy_freeze_vision_encoder: true,
      policy_train_expert_only: true,
    };
  }

  if (PI0_FAST_POLICY_TYPES.has(policyType)) {
    return {
      ...resetPolicyAdvancedOptions,
      batch_size: Math.min(current.batch_size || 1, 1),
      policy_use_amp: true,
      policy_dtype: "bfloat16",
      policy_gradient_checkpointing: true,
    };
  }

  if (SMOLVLA_POLICY_TYPES.has(policyType)) {
    return {
      ...resetPolicyAdvancedOptions,
      batch_size: Math.min(current.batch_size || 1, 1),
      policy_use_amp: true,
      policy_freeze_vision_encoder: true,
      policy_train_expert_only: true,
    };
  }

  return {
    ...resetPolicyAdvancedOptions,
    policy_use_amp: false,
  };
}
