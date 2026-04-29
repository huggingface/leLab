
import React from 'react';
import ReplayHeader from '@/components/replay/ReplayHeader';
import DatasetSelector from '@/components/replay/DatasetSelector';
import EpisodePlayer from '@/components/replay/EpisodePlayer';
import ReplayVisualizer from '@/components/replay/ReplayVisualizer';

// Mock data for now, this would be fetched from the backend
const mockDatasets = [
  { id: 'dataset-1', name: 'Kitchen Task - Day 1' },
  { id: 'dataset-2', name: 'Assembly Task - Morning' },
  { id: 'dataset-3', name: 'Sorting Cans - Run 4' },
];

const mockEpisodes = {
  'dataset-1': [
    { id: 'ep-1', name: 'Episode 1', duration: 62 },
    { id: 'ep-2', name: 'Episode 2', duration: 58 },
  ],
  'dataset-2': [
    { id: 'ep-3', name: 'Episode 1', duration: 120 },
  ],
  'dataset-3': [
    { id: 'ep-4', name: 'Episode 1', duration: 45 },
    { id: 'ep-5', name: 'Episode 2', duration: 47 },
    { id: 'ep-6', name: 'Episode 3', duration: 43 },
  ],
};


const ReplayDataset = () => {
  // Normally you would fetch datasets and handle loading/error states
  const [selectedDataset, setSelectedDataset] = React.useState<string | null>(mockDatasets.length > 0 ? mockDatasets[0].id : null);
  const [selectedEpisode, setSelectedEpisode] = React.useState<string | null>(null);

  const episodes = selectedDataset ? mockEpisodes[selectedDataset] || [] : [];

  React.useEffect(() => {
    // When dataset changes, reset episode selection
    setSelectedEpisode(null);
  }, [selectedDataset]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col p-4 sm:p-6 lg:p-8">
      <ReplayHeader />
      <div className="flex-1 flex flex-col lg:flex-row gap-6 mt-6">
        <div className="w-full lg:w-1/3 xl:w-1/4 flex flex-col gap-6">
          <DatasetSelector 
            datasets={mockDatasets}
            selectedDataset={selectedDataset}
            onSelectDataset={setSelectedDataset}
          />
          <EpisodePlayer
            episodes={episodes}
            selectedEpisode={selectedEpisode}
            onSelectEpisode={setSelectedEpisode}
          />
        </div>
        <div className="flex-1">
          <ReplayVisualizer />
        </div>
      </div>
    </div>
  );
};

export default ReplayDataset;
