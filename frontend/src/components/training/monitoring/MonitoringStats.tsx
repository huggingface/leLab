
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TrainingStatus } from '../types';
import { TrendingUp, CheckCircle, Activity, Clock } from 'lucide-react';

interface MonitoringStatsProps {
  trainingStatus: TrainingStatus;
  getProgressPercentage: () => number;
  formatTime: (seconds: number) => string;
}

const MonitoringStats: React.FC<MonitoringStatsProps> = ({ trainingStatus, getProgressPercentage, formatTime }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm text-slate-400 mb-1">Progress</h3>
              <div className="text-2xl font-bold text-white">
                {trainingStatus.current_step} / {trainingStatus.total_steps}
              </div>
            </div>
          </div>
          <Progress value={getProgressPercentage()} className="mt-4" />
        </CardContent>
      </Card>

      <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/20 text-green-400">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm text-slate-400 mb-1">Current Loss</h3>
              <div className="text-2xl font-bold text-white">
                {trainingStatus.current_loss?.toFixed(4) || "N/A"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/20 text-orange-400">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm text-slate-400 mb-1">Learning Rate</h3>
              <div className="text-2xl font-bold text-white">
                {trainingStatus.current_lr?.toExponential(2) || "N/A"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm text-slate-400 mb-1">ETA</h3>
              <div className="text-2xl font-bold text-white">
                {trainingStatus.eta_seconds ? formatTime(trainingStatus.eta_seconds) : "N/A"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MonitoringStats;
