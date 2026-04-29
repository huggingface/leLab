import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Logo from '@/components/Logo';
import { TrainingStatus } from './types';
interface TrainingHeaderProps {
  trainingStatus: TrainingStatus;
}
const TrainingHeader: React.FC<TrainingHeaderProps> = ({
  trainingStatus
}) => {
  const navigate = useNavigate();
  const getStatusColor = () => {
    if (trainingStatus.training_active) return "text-green-400";
    return "text-gray-400";
  };
  const getStatusText = () => {
    if (trainingStatus.training_active) return "Training Active";
    return "Ready to Train";
  };
  return <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4 text-3xl">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Logo />
        <h1 className="font-bold text-white text-2xl">
          Training Dashboard
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${trainingStatus.training_active ? "bg-green-400 animate-pulse" : "bg-slate-500"}`}></div>
        <span className={`font-semibold ${getStatusColor()}`}>
          {getStatusText()}
        </span>
      </div>
    </div>;
};
export default TrainingHeader;