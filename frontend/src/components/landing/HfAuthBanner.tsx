import React, { useState } from "react";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHfAuth } from "@/contexts/HfAuthContext";

const HfAuthBanner: React.FC = () => {
  const { auth, refetch } = useHfAuth();
  const [copied, setCopied] = useState(false);
  const [refetching, setRefetching] = useState(false);

  if (auth.status === "loading") {
    return null;
  }

  if (auth.status === "authenticated") {
    return (
      <div className="text-xs text-gray-500 text-center pb-2">
        Logged in to Hugging Face as{" "}
        <span className="text-gray-300 font-medium">{auth.username}</span>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(auth.loginCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("Clipboard write failed:", err);
    }
  };

  const handleRefetch = async () => {
    setRefetching(true);
    try {
      await refetch();
    } finally {
      setRefetching(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto mb-6 p-4 rounded-lg border border-amber-700 bg-amber-950/40 text-amber-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-400" />
        <div className="flex-1 space-y-3">
          <div>
            <p className="font-medium text-amber-200">
              Hugging Face CLI not configured
            </p>
            <p className="text-sm text-amber-100/80">
              Uploads, training, and replay-from-Hub require a logged-in HF
              CLI. Run this in a terminal:
            </p>
          </div>
          <pre className="bg-gray-900 p-3 rounded border border-gray-700 text-xs sm:text-sm overflow-x-auto flex items-center justify-between gap-2">
            <code className="text-green-400">{auth.loginCommand}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors"
              aria-label="Copy command"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </pre>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefetch}
            disabled={refetching}
            className="border-amber-700 bg-transparent text-amber-100 hover:bg-amber-900/40 hover:text-amber-50"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${refetching ? "animate-spin" : ""}`}
            />
            I've logged in — recheck
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HfAuthBanner;
