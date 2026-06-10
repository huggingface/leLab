import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ConfigComponentProps } from "../types";
import { RunnerFlavor, RunnerProvider } from "@/lib/jobsApi";
import { Check, ChevronDown, ChevronRight, Loader2, Link } from "lucide-react";
import { cn } from "@/lib/utils";

interface TargetCardProps extends ConfigComponentProps {
  authenticated: boolean;
  flavors: RunnerFlavor[];
  providers: RunnerProvider[];
  loading: boolean;
  seeedConnecting: boolean;
  onConnectSeeedCloud: () => void;
}

const formatHourly = (unitCostUsd: number, unitLabel: string): string => {
  const hourly = unitLabel === "minute" ? unitCostUsd * 60 : unitCostUsd;
  return `$${hourly.toFixed(2)}/hr`;
};

const acceleratorParts = (f: RunnerFlavor) => {
  const accelerator = f.accelerator;
  if (!accelerator) {
    return { manufacturer: "", model: f.cpu || f.pretty_name || f.name };
  }
  if (typeof accelerator === "string") {
    return {
      manufacturer: /nvidia/i.test(accelerator) ? "" : "Nvidia",
      model: accelerator,
    };
  }
  const quantity = String(accelerator.quantity ?? "").trim();
  const prefix = quantity && quantity !== "1" ? `${quantity}x ` : "";
  return {
    manufacturer: accelerator.manufacturer || "",
    model: `${prefix}${accelerator.model || f.pretty_name || f.name}`,
  };
};

const formatHardwareName = (f: RunnerFlavor): string => {
  const { manufacturer, model } = acceleratorParts(f);
  return [manufacturer, model].filter(Boolean).join(" ");
};

const formatProviderFlavor = (providerLabel: string, f: RunnerFlavor): string => {
  return `${providerLabel} ${formatHardwareName(f)} - ${formatHourly(
    f.unit_cost_usd,
    f.unit_label,
  )}`;
};

const formatFlavorMeta = (f: RunnerFlavor): string => {
  const parts = [f.cpu, f.ram].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : f.pretty_name;
};

const SEEED_PROVIDER_ID = "seeed_cloud";

const TargetCard: React.FC<TargetCardProps> = ({
  config,
  updateConfig,
  authenticated,
  flavors,
  providers,
  loading,
  seeedConnecting,
  onConnectSeeedCloud,
}) => {
  const target = config.target;
  const [open, setOpen] = useState(false);
  const [hfOpen, setHfOpen] = useState(true);
  const [providerOpen, setProviderOpen] = useState<Record<string, boolean>>({
    [SEEED_PROVIDER_ID]: true,
  });
  const safeProviders = useMemo(() => providers ?? [], [providers]);
  const safeFlavors = useMemo(() => flavors ?? [], [flavors]);
  const seeedProvider = safeProviders.find((provider) => provider.id === SEEED_PROVIDER_ID);
  const providerGroups = safeProviders.map((provider) => ({
    ...provider,
    open: providerOpen[provider.id] ?? provider.id === SEEED_PROVIDER_ID,
    label: provider.id === SEEED_PROVIDER_ID ? "Seeed Cloud" : provider.display_name,
  }));

  const selectedLabel = useMemo(() => {
    if (target.runner === "local") return "Local - your machine";
    if (target.runner === "hf_cloud") {
      const flavor = safeFlavors.find((f) => f.name === target.flavor);
      return flavor ? formatProviderFlavor("HF", flavor) : "Hugging Face";
    }
    if (target.runner === "seeed_cloud") {
      const flavor = seeedProvider?.flavors.find((f) => f.name === target.flavor);
      return flavor ? formatProviderFlavor("Seeed", flavor) : "Seeed Cloud";
    }
    const provider = safeProviders.find((p) => p.id === target.provider);
    const flavor = provider?.flavors.find((f) => f.name === target.flavor);
    return flavor
      ? formatProviderFlavor(provider?.display_name ?? "External", flavor)
      : provider?.display_name ?? "External";
  }, [safeFlavors, safeProviders, seeedProvider, target]);

  const handleChange = (v: string) => {
    if (v === "local") {
      updateConfig("target", { runner: "local" });
    } else if (v.startsWith("hf:")) {
      const flavor = v.slice("hf:".length);
      updateConfig("target", { runner: "hf_cloud", flavor });
    } else if (v.startsWith("seeed:")) {
      const flavor = v.slice("seeed:".length);
      updateConfig("target", { runner: "seeed_cloud", flavor });
    } else if (v.startsWith("external:")) {
      const [, provider, flavor] = v.split(":");
      updateConfig("target", { runner: "external", provider, flavor });
    }
    setOpen(false);
  };

  const selectedValue = target.runner === "local"
    ? "local"
    : target.runner === "hf_cloud"
    ? `hf:${target.flavor ?? ""}`
    : target.runner === "seeed_cloud"
    ? `seeed:${target.flavor ?? ""}`
    : `external:${target.provider}:${target.flavor ?? ""}`;

  const renderOption = (
    value: string,
    label: string,
    meta: string,
    disabled: boolean,
  ) => (
    <button
      key={value}
      type="button"
      disabled={disabled}
      onClick={() => handleChange(value)}
      className={cn(
        "flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
        "hover:bg-slate-700/80 focus:bg-slate-700/80 focus:outline-none",
        disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
      )}
    >
      <Check
        className={cn(
          "h-4 w-4 shrink-0 text-emerald-300",
          selectedValue === value ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-slate-100">{label}</span>
        {meta ? <span className="block truncate text-xs text-slate-500">{meta}</span> : null}
      </span>
    </button>
  );

  const setProviderExpanded = (providerId: string, nextOpen: boolean) => {
    setProviderOpen((prev) => ({ ...prev, [providerId]: nextOpen }));
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="text-white">Compute target</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-slate-300">Run training on</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="mt-1 flex h-11 w-full justify-between border-slate-600 bg-slate-900 px-3 text-left text-white hover:bg-slate-900 hover:text-white"
              >
                <span className="min-w-0 flex-1 truncate">{loading ? "Loading..." : selectedLabel}</span>
                <ChevronDown className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[min(560px,calc(100vw-2rem))] border-slate-700 bg-slate-800 p-2 text-white shadow-xl"
            >
              <div className="max-h-[440px] overflow-y-auto pr-1">
                {renderOption("local", "Local - your machine", "Free", false)}

                <Collapsible open={hfOpen} onOpenChange={setHfOpen}>
                  <CollapsibleTrigger className="mt-1 flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-slate-200 hover:bg-slate-700/70">
                    {hfOpen ? (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    )}
                    <span className="font-medium">Hugging Face</span>
                    <Badge variant="outline" className="ml-auto border-slate-600 text-slate-300">
                      {authenticated ? `${safeFlavors.length} flavors` : "Login required"}
                    </Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="ml-3 border-l border-slate-700 pl-2">
                    {authenticated && safeFlavors.length > 0 ? (
                      safeFlavors.map((f) =>
                        renderOption(
                          `hf:${f.name}`,
                          formatProviderFlavor("HF", f),
                          formatFlavorMeta(f),
                          false,
                        ),
                      )
                    ) : (
                      <div className="px-8 py-3 text-xs text-slate-500">
                        {authenticated ? "No HF hardware flavors available." : "Log in to HF to unlock official flavors."}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                {providerGroups.map((provider) => (
                  <Collapsible
                    key={provider.id}
                    open={provider.open}
                    onOpenChange={(nextOpen) => setProviderExpanded(provider.id, nextOpen)}
                  >
                    <CollapsibleTrigger className="mt-1 flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-slate-200 hover:bg-slate-700/70">
                      {provider.open ? (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      )}
                      <span className="font-medium">{provider.label}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "ml-auto border-slate-600 text-slate-300",
                          provider.authenticated && "border-emerald-500/50 text-emerald-200",
                        )}
                      >
                        {provider.authenticated
                          ? `Connected · ${provider.flavors.length} flavors`
                          : "Connect required"}
                      </Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="ml-3 border-l border-slate-700 pl-2">
                      {!provider.authenticated && provider.id === SEEED_PROVIDER_ID ? (
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="text-xs text-slate-500">Connect to unlock Seeed Cloud flavors.</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={seeedConnecting}
                            onClick={onConnectSeeedCloud}
                            className="h-8 shrink-0 border-amber-400/60 bg-slate-900 text-amber-100 hover:bg-amber-500/20"
                          >
                            {seeedConnecting ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Link className="mr-2 h-4 w-4" />
                            )}
                            Connect
                          </Button>
                        </div>
                      ) : null}
                      {provider.flavors.length > 0 ? (
                        provider.flavors.map((f) => {
                          const prefix = provider.id === SEEED_PROVIDER_ID ? "Seeed" : provider.display_name;
                          const value =
                            provider.id === SEEED_PROVIDER_ID
                              ? `seeed:${f.name}`
                              : `external:${provider.id}:${f.name}`;
                          return renderOption(
                            value,
                            formatProviderFlavor(prefix, f),
                            formatFlavorMeta(f),
                            !provider.authenticated,
                          );
                        })
                      ) : (
                        <div className="px-8 py-3 text-xs text-slate-500">No flavors available.</div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-slate-500 mt-1">
            Cost shown is per running hour. Final policy uploads to your HF
            account when training completes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default TargetCard;
