import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Terminal } from "lucide-react";
import { useApi } from "@/contexts/ApiContext";

interface UsageInstructionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const UsageInstructionsModal: React.FC<UsageInstructionsModalProps> = ({
  open,
  onOpenChange,
}) => {
  const { baseUrl } = useApi();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-700 text-gray-300 sm:max-w-xl">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-white flex items-center justify-center gap-2 text-xl">
            <Terminal className="w-6 h-6" />
            Getting Started with LeLab
          </DialogTitle>
          <DialogDescription>
            Quick setup guide to get LeLab running on your machine.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 text-sm py-4">
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-100 text-lg mb-3 border-b border-gray-700 pb-2">
              1. Installation
            </h4>
            <p className="text-gray-300 leading-relaxed">
              Install LeLab directly from GitHub (virtual environment
              recommended):
            </p>
            <pre className="bg-gray-800 p-4 rounded-lg text-xs overflow-x-auto text-left border border-gray-700">
              <code className="text-green-400">
                pip install git+https://github.com/huggingface/leLab
              </code>
            </pre>
            <p className="text-gray-400 text-xs mt-2">
              💡 <strong>Tip:</strong> Create a virtual environment first with{" "}
              <code className="bg-gray-800 px-1 rounded text-xs">
                python -m venv .venv
              </code>
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-gray-100 text-lg mb-3 border-b border-gray-700 pb-2">
              2. Running LeLab
            </h4>
            <p className="text-gray-300 leading-relaxed">
              After installation, start LeLab with:
            </p>
            <pre className="bg-gray-800 p-4 rounded-lg text-xs overflow-x-auto text-left border border-gray-700">
              <code className="text-blue-400">lelab</code>
            </pre>
            <p className="text-gray-300 leading-relaxed">
              This will start the FastAPI backend server on{" "}
              <a
                href={baseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline font-medium"
              >
                {baseUrl}
              </a>
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-gray-100 text-lg mb-3 border-b border-gray-700 pb-2">
              3. Additional Commands
            </h4>
            <div className="space-y-3">
              <div>
                <code className="bg-gray-800 px-2 py-1 rounded font-mono text-sm text-yellow-400">
                  lelab-fullstack
                </code>
                <p className="text-gray-400 text-xs mt-1 ml-2">
                  Starts both backend and frontend development servers
                </p>
              </div>
              <div>
                <code className="bg-gray-800 px-2 py-1 rounded font-mono text-sm text-purple-400">
                  lelab-frontend
                </code>
                <p className="text-gray-400 text-xs mt-1 ml-2">
                  Starts only the frontend development server
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <p className="text-gray-400 text-xs text-center">
              For detailed documentation, visit the{" "}
              <a
                href="https://github.com/huggingface/leLab"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline font-medium"
              >
                LeLab GitHub repository
              </a>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UsageInstructionsModal;
