
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText } from 'lucide-react';
import { LogEntry } from '../types';

interface TrainingLogsProps {
  logs: LogEntry[];
  logContainerRef: React.RefObject<HTMLDivElement>;
}

const TrainingLogs: React.FC<TrainingLogsProps> = ({ logs, logContainerRef }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <FileText className="w-5 h-5 text-sky-400" />
          </div>
          Training Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={logContainerRef}
          className="bg-slate-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm border border-slate-700"
        >
          {logs.length === 0 ? (
            <div className="text-slate-500 text-center py-8">
              No training logs yet. Start training to see output.
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="flex items-start mb-1">
                <span className="text-slate-500 mr-4">
                  {new Date(log.timestamp * 1000).toLocaleTimeString()}
                </span>
                <span className="flex-1 text-slate-300 break-words whitespace-pre-wrap">
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TrainingLogs;
