import React from "react";
import { Check, ChevronsUpDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { DatasetItem } from "@/lib/replayApi";

interface Props {
  datasets: DatasetItem[];
  loading: boolean;
  value: string | null;
  onChange: (repoId: string | null) => void;
}

const REPO_ID_RE = /^[\w.-]+\/[\w.-]+$/;

const DatasetCombobox: React.FC<Props> = ({ datasets, loading, value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const [customMode, setCustomMode] = React.useState(false);
  const [customValue, setCustomValue] = React.useState("");

  const submitCustom = () => {
    const v = customValue.trim();
    if (REPO_ID_RE.test(v)) {
      onChange(v);
      setCustomMode(false);
    }
  };

  const localDatasets = datasets.filter((d) => d.source === "local" || d.source === "both");
  const hubDatasets = datasets.filter((d) => d.source === "hub");

  const renderItem = (d: DatasetItem) => (
    <CommandItem
      key={d.repo_id}
      value={d.repo_id}
      onSelect={() => { onChange(d.repo_id); setOpen(false); }}
      className="text-white aria-selected:bg-gray-700"
    >
      <Check className={cn("mr-2 h-4 w-4", value === d.repo_id ? "opacity-100" : "opacity-0")} />
      <span className="flex-1 truncate">{d.repo_id}</span>
      {d.source === "both" && <span className="text-xs text-gray-400 mr-2">on Hub</span>}
      {d.private && <span className="text-xs text-amber-400">private</span>}
    </CommandItem>
  );

  if (customMode) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); }}
          placeholder="org/dataset-name"
          className="bg-gray-800 border-gray-600 text-white"
        />
        <Button onClick={submitCustom} disabled={!REPO_ID_RE.test(customValue.trim())}>
          Use
        </Button>
        <Button variant="ghost" onClick={() => setCustomMode(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between bg-gray-800 border-gray-600 text-white hover:bg-gray-700"
        >
          {value ?? (loading ? "Loading datasets…" : "Select a dataset…")}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-gray-800 border-gray-700" align="start">
        <Command className="bg-gray-800 text-white">
          <CommandInput placeholder="Search datasets…" className="text-white" />
          <CommandList>
            <CommandEmpty>{loading ? "Loading…" : "No datasets."}</CommandEmpty>
            {localDatasets.length > 0 && (
              <CommandGroup heading="Local">
                {localDatasets.map(renderItem)}
              </CommandGroup>
            )}
            {hubDatasets.length > 0 && (
              <CommandGroup heading="Hugging Face">
                {hubDatasets.map(renderItem)}
              </CommandGroup>
            )}
            <CommandGroup>
              <CommandItem
                onSelect={() => { setCustomMode(true); setOpen(false); }}
                className="text-purple-300 aria-selected:bg-gray-700"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Use custom repo ID…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default DatasetCombobox;
