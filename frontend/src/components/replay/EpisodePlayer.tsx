
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Film, ListVideo } from 'lucide-react';
import PlaybackControls from './PlaybackControls';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface Episode {
    id: string;
    name: string;
    duration: number;
}

interface EpisodePlayerProps {
    episodes: Episode[];
    selectedEpisode: string | null;
    onSelectEpisode: (id: string | null) => void;
}

const EpisodePlayer: React.FC<EpisodePlayerProps> = ({ episodes, selectedEpisode, onSelectEpisode }) => {
    const currentEpisode = episodes.find(e => e.id === selectedEpisode);

    return (
        <Card className="bg-gray-900 border-gray-700 flex-1 flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-3 text-white">
                    <ListVideo className="w-5 h-5 text-purple-400" />
                    Episodes
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4">
                <ScrollArea className="h-48 pr-4 border border-gray-700 rounded-lg">
                    <div className="p-2 space-y-1">
                        {episodes.length > 0 ? (
                            episodes.map(episode => (
                                <button
                                    key={episode.id}
                                    onClick={() => onSelectEpisode(episode.id)}
                                    className={cn(
                                        "w-full text-left p-2 rounded-md transition-colors text-sm",
                                        selectedEpisode === episode.id
                                            ? "bg-purple-500/20 text-purple-300"
                                            : "hover:bg-gray-800 text-gray-300"
                                    )}
                                >
                                    {episode.name} ({episode.duration}s)
                                </button>
                            ))
                        ) : (
                            <div className="text-center text-gray-500 py-16">
                                Select a dataset to see episodes.
                            </div>
                        )}
                    </div>
                </ScrollArea>

                {currentEpisode ? (
                    <div className="border-t border-gray-700 pt-4 flex flex-col gap-4">
                       <div className="flex items-center gap-3">
                         <Film className="w-5 h-5 text-gray-400" />
                         <h3 className="font-semibold">{currentEpisode.name}</h3>
                       </div>
                        <PlaybackControls duration={currentEpisode.duration} />
                    </div>
                ) : (
                    <div className="text-center text-gray-500 pt-16 border-t border-gray-700">
                        Select an episode to play.
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default EpisodePlayer;
