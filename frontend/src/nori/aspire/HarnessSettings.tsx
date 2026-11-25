import { useEffect, useState } from "react";
import { EFFORTS, MODELS, PRIMITIVES, modelSpeeds, type AgentSettings } from "./settings";
import { HARNESSES_CHANGED, listHarnesses, type SavedHarness } from "./harnesses";

const selectStyle = "min-w-0 max-w-full rounded border border-nori-h14131a/20 bg-transparent px-1 py-0.5";
const labelStyle = "flex min-w-0 items-center gap-1.5";

interface Props {
  settings: AgentSettings;
  tune: (patch: Partial<AgentSettings>) => void;
  owner?: string;
  selected: string;
  onSelect: (id: string) => void;
}

export function HarnessSettings({ settings, tune, owner, selected, onSelect }: Props) {
  const provider = MODELS.find((m) => m.id === settings.model)!.provider;
  const speeds = modelSpeeds(settings.model);
  const [saved, setSaved] = useState<SavedHarness[]>([]);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    function refresh() {
      try {
        setSaved(owner ? listHarnesses(owner, settings.model) : []);
        setStorageError(false);
      } catch {
        setSaved([]);
        setStorageError(true);
      }
    }
    refresh();
    window.addEventListener(HARNESSES_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HARNESSES_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [owner, settings.model]);

  function chooseModel(model: AgentSettings["model"]) {
    onSelect("");
    tune({ model, modelSpeed: modelSpeeds(model).includes(settings.modelSpeed) ? settings.modelSpeed : "standard" });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className={labelStyle}>provider
        <select className={selectStyle} value={provider}
          onChange={(e) => chooseModel(MODELS.find((m) => m.provider === e.target.value)!.id)}>
          <option>Anthropic</option><option>OpenAI</option>
        </select>
      </label>
      <label className={labelStyle}>model
        <select className={selectStyle} value={settings.model}
          onChange={(e) => chooseModel(e.target.value as AgentSettings["model"])}>
          {MODELS.filter((m) => m.provider === provider).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className={labelStyle}>reasoning effort
        <select className={selectStyle} value={settings.effort}
          onChange={(e) => tune({ effort: e.target.value as AgentSettings["effort"] })}>
          {EFFORTS.map((e) => <option key={e}>{e}</option>)}
        </select>
      </label>
      <label className={labelStyle} title="Faster processing uses premium provider pricing.">
        model speed
        <select className={selectStyle} value={settings.modelSpeed} disabled={speeds.length === 1}
          onChange={(e) => tune({ modelSpeed: e.target.value as AgentSettings["modelSpeed"] })}>
          {speeds.map((speed) => <option key={speed} value={speed}>{speed[0].toUpperCase() + speed.slice(1)}</option>)}
        </select>
      </label>
      <label className={labelStyle}>harness
        <select className={selectStyle} value={settings.harness}
          onChange={(e) => { onSelect(""); tune({ harness: e.target.value as AgentSettings["harness"] }); }}>
          <option value="nori">Nori primitives</option>
          <option value="authored">Model-built tools</option>
        </select>
      </label>
      {settings.harness === "nori" ? (
        <label className={labelStyle} title="Position adds target-based tools such as move_to and locate_object. Jog uses timed movements.">primitives
          <select className={selectStyle} value={settings.primitives}
            onChange={(e) => tune({ primitives: e.target.value as AgentSettings["primitives"] })}>
            {PRIMITIVES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      ) : (
        <label className={labelStyle}>local harness
          <select className={selectStyle} value={selected} onChange={(e) => onSelect(e.target.value)}>
            <option value="">Build a new harness</option>
            {saved.map((h) => <option key={h.id} value={h.id}>{h.label.slice(0, 55)} · {h.id.slice(0, 8)} · {h.snapshot.tools.length} tools</option>)}
          </select>
        </label>
      )}
      {settings.harness === "authored" && storageError && <span role="alert">Local harness storage is unavailable.</span>}
    </div>
  );
}
