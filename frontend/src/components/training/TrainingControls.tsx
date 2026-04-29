
import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Square } from 'lucide-react';
import { TrainingConfig, TrainingStatus } from './types';

interface TrainingControlsProps {
  trainingStatus: TrainingStatus;
  isStartingTraining: boolean;
  trainingConfig: TrainingConfig;
  handleStartTraining: () => void;
  handleStopTraining: () => void;
}

const TrainingControls: React.FC<TrainingControlsProps> = ({
  trainingStatus,
  isStartingTraining,
  trainingConfig,
  handleStartTraining,
  handleStopTraining,
}) => {
  return (
    <div className="fixed bottom-6 right-6 flex gap-3">
      {!trainingStatus.training_active ? (
        <Button
          onClick={handleStartTraining}
          disabled={
            isStartingTraining || !trainingConfig.dataset_repo_id.trim()
          }
          size="lg"
          className="bg-green-500 hover:bg-green-600 text-white font-semibold px-6 py-3 text-base rounded-full shadow-lg transition-all hover:scale-105"
        >
          {isStartingTraining ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="w-5 h-5 mr-2" />
              Start Training
            </>
          )}
        </Button>
      ) : (
        <Button
          onClick={handleStopTraining}
          disabled={!trainingStatus.available_controls.stop_training}
          size="lg"
          className="bg-red-500 hover:bg-red-600 text-white font-semibold px-6 py-3 text-base rounded-full shadow-lg transition-all hover:scale-105"
        >
          <Square className="w-5 h-5 mr-2" />
          Stop Training
        </Button>
      )}
    </div>
  );
};

export default TrainingControls;
