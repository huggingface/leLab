
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, FastForward, Rewind, ChevronsRight, ChevronsLeft } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

interface PlaybackControlsProps {
    duration: number; // in seconds
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({ duration }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    useEffect(() => {
      // Reset time when episode changes (duration changes)
      setCurrentTime(0);
      setIsPlaying(false);
    }, [duration]);

    // This is a mock playback timer.
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isPlaying && currentTime < duration) {
            interval = setInterval(() => {
                setCurrentTime(prev => Math.min(prev + (1 * playbackSpeed), duration));
            }, 1000);
        }
        if (currentTime >= duration) {
            setIsPlaying(false);
        }
        return () => clearInterval(interval);
    }, [isPlaying, duration, playbackSpeed, currentTime]);

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const speedOptions = [0.5, 1, 1.5, 2];

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <Slider
                    value={[currentTime]}
                    max={duration}
                    step={1}
                    onValueChange={(value) => setCurrentTime(value[0])}
                    className="w-full"
                />
            </div>
             <div className="flex justify-between items-center text-xs text-gray-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
            </div>
            <div className="flex items-center justify-center gap-2">
                <Button variant="ghost" size="icon" className="text-gray-300 hover:text-white hover:bg-gray-700">
                    <ChevronsLeft />
                </Button>
                 <Button onClick={() => setCurrentTime(t => Math.max(0, t - 5))} variant="ghost" size="icon" className="text-gray-300 hover:text-white hover:bg-gray-700">
                    <Rewind />
                </Button>
                <Button onClick={() => setIsPlaying(!isPlaying)} variant="ghost" size="icon" className="h-12 w-12 text-gray-300 hover:text-white hover:bg-gray-700">
                    {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                </Button>
                <Button onClick={() => setCurrentTime(t => Math.min(duration, t + 5))} variant="ghost" size="icon" className="text-gray-300 hover:text-white hover:bg-gray-700">
                    <FastForward />
                </Button>
                 <Button variant="ghost" size="icon" className="text-gray-300 hover:text-white hover:bg-gray-700">
                    <ChevronsRight />
                </Button>
            </div>
            <div className="flex justify-center items-center gap-2 pt-2">
                <span className="text-sm text-gray-400">Speed:</span>
                {speedOptions.map(speed => (
                    <Button
                        key={speed}
                        variant={playbackSpeed === speed ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setPlaybackSpeed(speed)}
                        className="text-xs"
                    >
                        {speed}x
                    </Button>
                ))}
            </div>
        </div>
    );
};

export default PlaybackControls;
