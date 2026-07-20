import React, { useState } from "react";
import { Plus, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface RobotSelectorProps {
  selectedName: string | null;
  availableNames: string[];
  onSelect: (name: string) => void;
  onCreateNew: (name: string, robotType: string) => Promise<boolean>;
  isLoading: boolean;
}

const ROBOT_MODELS = [
  { value: "so101", label: "SO-101" },
  { value: "omx_ai", label: "OMX-AI" },
];

const RobotSelector: React.FC<RobotSelectorProps> = ({
  selectedName,
  availableNames,
  onSelect,
  onCreateNew,
  isLoading,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newRobotType, setNewRobotType] = useState("so101");

  const trimmed = query.trim();
  const matchesExisting = availableNames.some(
    (n) => n.toLowerCase() === trimmed.toLowerCase()
  );
  const canCreate = trimmed.length > 0 && !matchesExisting;

  const createDisabled = !canCreate;
  const createLabel = matchesExisting
    ? "Already exists"
    : trimmed === ""
      ? "Create new robot…"
      : `Create "${trimmed}"`;

  const reset = () => {
    setQuery("");
    setOpen(false);
  };

  const handlePickExisting = (name: string) => {
    onSelect(name);
    reset();
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    const ok = await onCreateNew(trimmed, newRobotType);
    if (ok) reset();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={isLoading}
          className="w-full justify-between bg-gray-900 border-gray-700 text-white hover:bg-gray-700 hover:text-white font-normal"
        >
          <span className={cn("truncate", selectedName ? "" : "text-gray-400")}>
            {isLoading
              ? "Loading..."
              : selectedName ?? "Select a robot or type a new name"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 bg-gray-800 border-gray-700 text-white"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
      >
        <Command className="bg-gray-800">
          <CommandInput
            placeholder="Search or type new name..."
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                handleCreate();
              }
            }}
            className="text-white"
          />
          <CommandList>
            {availableNames.length === 0 && (
              <CommandEmpty className="py-4 text-sm text-gray-400 text-center">
                No robots yet. Type a name to create one.
              </CommandEmpty>
            )}
            {availableNames.length > 0 && (
              <CommandGroup heading="Existing">
                {availableNames.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => handlePickExisting(name)}
                    className="text-white aria-selected:bg-gray-700"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedName === name ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="border-t border-gray-700">
            {canCreate && (
              <div className="flex items-center gap-1.5 px-3 pt-2">
                <span className="text-xs text-gray-400">Model:</span>
                {ROBOT_MODELS.map((model) => (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => setNewRobotType(model.value)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs",
                      newRobotType === model.value
                        ? "border-blue-400 bg-blue-500/20 text-blue-300"
                        : "border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                    )}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={handleCreate}
              disabled={createDisabled}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent"
            >
              <Plus className="h-4 w-4" />
              {createLabel}
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default RobotSelector;
