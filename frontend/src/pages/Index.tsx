
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { generateSensorData, generateMotorData } from '@/lib/mockData';
import VisualizerPanel from '@/components/control/VisualizerPanel';
import MetricsPanel from '@/components/control/MetricsPanel';
import CommandBar from '@/components/control/CommandBar';

const Index = () => {
  const [command, setCommand] = useState('');
  const [activeTab, setActiveTab] = useState<'SENSORS' | 'MOTORS'>('SENSORS');
  const [isVoiceActive, setIsVoiceActive] = useState(true);
  const [showCamera, setShowCamera] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [sensorData, setSensorData] = useState<any[]>([]);
  const [motorData, setMotorData] = useState<any[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let audioContext: AudioContext | null = null;
    const getPermissions = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        
        setHasPermissions(true);
        
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioContext = new AudioContextClass();
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);
          
          let animationFrameId: number;
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateMicLevel = () => {
            if (audioContext?.state === 'closed') return;
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            setMicLevel(average);
            animationFrameId = requestAnimationFrame(updateMicLevel);
          };
          updateMicLevel();

          return () => {
            cancelAnimationFrame(animationFrameId);
            audioContext?.close();
          };
        }
      } catch (error) {
        console.error("Permission to access media devices was denied.", error);
      }
    };

    let cleanup: (() => void) | undefined;
    getPermissions().then(returnedCleanup => {
      cleanup = returnedCleanup;
    });

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setSensorData(prev => [...prev, generateSensorData()].slice(-50));
      setMotorData(prev => [...prev, generateMotorData()].slice(-50));
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const handleSendCommand = () => {
    if (command.trim()) {
      toast({
        title: "Command Sent",
        description: `Robot command: "${command}"`,
      });
      setCommand('');
    }
  };

  const handleGoBack = () => {
    navigate('/');
  };

  const handleEndSession = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    toast({
      title: "Session Ended",
      description: "Robot control session terminated safely.",
      variant: "destructive",
    });
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="flex-1 flex flex-col lg:flex-row">
        <VisualizerPanel onGoBack={handleGoBack} />
        <MetricsPanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          sensorData={sensorData}
          motorData={motorData}
          hasPermissions={hasPermissions}
          streamRef={streamRef}
          isVoiceActive={isVoiceActive}
          micLevel={micLevel}
        />
      </div>

      <CommandBar
        command={command}
        setCommand={setCommand}
        handleSendCommand={handleSendCommand}
        isVoiceActive={isVoiceActive}
        setIsVoiceActive={setIsVoiceActive}
        showCamera={showCamera}
        setShowCamera={setShowCamera}
        handleEndSession={handleEndSession}
      />
    </div>
  );
};

export default Index;
