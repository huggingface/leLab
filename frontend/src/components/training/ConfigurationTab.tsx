import React from 'react';
import EssentialsCard from './config/EssentialsCard';
import AdvancedCard from './config/AdvancedCard';
import TargetCard from './config/TargetCard';
import { ConfigComponentProps } from './types';
import { DatasetItem } from '@/lib/replayApi';
import { RunnerFlavor, RunnerProvider } from '@/lib/jobsApi';

interface ConfigurationTabProps extends ConfigComponentProps {
  datasets: DatasetItem[];
  datasetsLoading: boolean;
  authenticated: boolean;
  flavors: RunnerFlavor[];
  providers: RunnerProvider[];
  hardwareLoading: boolean;
  seeedConnecting: boolean;
  onConnectSeeedCloud: () => void;
}

const ConfigurationTab: React.FC<ConfigurationTabProps> = ({
  config,
  updateConfig,
  datasets,
  datasetsLoading,
  authenticated,
  flavors,
  providers,
  hardwareLoading,
  seeedConnecting,
  onConnectSeeedCloud,
}) => {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <TargetCard
        config={config}
        updateConfig={updateConfig}
        authenticated={authenticated}
        flavors={flavors}
        providers={providers}
        loading={hardwareLoading}
        seeedConnecting={seeedConnecting}
        onConnectSeeedCloud={onConnectSeeedCloud}
      />
      <EssentialsCard
        config={config}
        updateConfig={updateConfig}
        datasets={datasets}
        datasetsLoading={datasetsLoading}
      />
      <AdvancedCard config={config} updateConfig={updateConfig} />
    </div>
  );
};

export default ConfigurationTab;
