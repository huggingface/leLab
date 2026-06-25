import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useInstallExtra } from "@/hooks/useInstallExtra";
import {
  InstallProgress,
  InstallTitleIcon,
  RestartInstructions,
  installTitle,
} from "./InstallProgress";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyType: string;
  packageName: string; // the probed module, e.g. "transformers"
  installTarget: string; // e.g. "lerobot[smolvla]"
  installHint: string; // e.g. "pip install 'lerobot[smolvla]'"
}

// Some policies (smolvla, pi0, pi0_fast, diffusion) need an optional LeRobot
// extra. This catches the missing package before training starts and offers a
// one-click install, instead of the run dying with a buried ImportError.
const PolicyExtraDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  policyType,
  packageName,
  installTarget,
  installHint,
}) => {
  const install = useInstallExtra(`system/policy-extra/${policyType}`, open);
  const title = `${policyType.toUpperCase()} needs an extra package`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-white">
            <InstallTitleIcon state={install.state} />
            {installTitle(install.state, title)}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Install {installTarget} to train {policyType}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <InstallProgress
            state={install.state}
            error={install.error}
            logs={install.logs}
            logBoxRef={install.logBoxRef}
            onInstall={install.handleInstall}
            onRetry={install.handleRetry}
            installHint={installHint}
            packageName={installTarget}
            idleTitle={title}
            idleDescription={
              <>
                Training a <span className="font-semibold">{policyType}</span> policy needs the{" "}
                <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">{packageName}</code>{" "}
                package (installed via{" "}
                <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">{installTarget}</code>),
                which isn't in this environment yet. Install it to train this policy.
              </>
            }
            doneDescription={<RestartInstructions purpose={`${policyType} training`} />}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PolicyExtraDialog;
