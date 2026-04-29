
import React from 'react';
import MonitoringStats from './monitoring/MonitoringStats';
import TrainingLogs from './monitoring/TrainingLogs';
import { TrainingStatus, LogEntry } from './types';

interface MonitoringTabProps {
  trainingStatus: TrainingStatus;
  logs: LogEntry[];
  logContainerRef: React.RefObject<HTMLDivElement>;
  getProgressPercentage: () => number;
  formatTime: (seconds: number) => string;
}

const MonitoringTab: React.FC<MonitoringTabProps> = ({ 
  trainingStatus, 
  logs, 
  logContainerRef, 
  getProgressPercentage, 
  formatTime 
}) => {
  return (
    <div className="space-y-6">
      <MonitoringStats 
        trainingStatus={trainingStatus}
        getProgressPercentage={getProgressPercentage}
        formatTime={formatTime}
      />
      <TrainingLogs logs={logs} logContainerRef={logContainerRef} />
    </div>
  );
};

export default MonitoringTab;
