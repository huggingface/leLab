
import React from 'react';
import DatasetConfig from './config/DatasetConfig';
import PolicyConfig from './config/PolicyConfig';
import TrainingParams from './config/TrainingParams';
import OptimizerConfig from './config/OptimizerConfig';
import LoggingConfig from './config/LoggingConfig';
import WandbConfig from './config/WandbConfig';
import EnvEvalConfig from './config/EnvEvalConfig';
import AdvancedConfig from './config/AdvancedConfig';
import { ConfigComponentProps } from './types';

const ConfigurationTab: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <DatasetConfig config={config} updateConfig={updateConfig} />
      <PolicyConfig config={config} updateConfig={updateConfig} />
      <TrainingParams config={config} updateConfig={updateConfig} />
      <OptimizerConfig config={config} updateConfig={updateConfig} />
      <LoggingConfig config={config} updateConfig={updateConfig} />
      <WandbConfig config={config} updateConfig={updateConfig} />
      <EnvEvalConfig config={config} updateConfig={updateConfig} />
      <AdvancedConfig config={config} updateConfig={updateConfig} />
    </div>
  );
};

export default ConfigurationTab;
