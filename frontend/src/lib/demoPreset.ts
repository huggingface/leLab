import { StartInferenceRequest } from "./inferenceApi";

const STORAGE_KEY = "lelab-demo-preset";

export interface DemoPreset {
  request: StartInferenceRequest;
  policyLabel: string;
  robotName: string;
  savedAt: string;
}

export function getDemoPreset(): DemoPreset | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const preset = JSON.parse(raw) as DemoPreset;
    return preset && preset.request ? preset : null;
  } catch {
    return null;
  }
}

export function saveDemoPreset(preset: DemoPreset) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preset));
  } catch {
    // localStorage unavailable — demo mode simply stays unconfigured.
  }
}
