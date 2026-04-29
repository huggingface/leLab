
import React, { useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Camera, MicOff } from 'lucide-react';

interface MetricsPanelProps {
  activeTab: 'SENSORS' | 'MOTORS';
  setActiveTab: (tab: 'SENSORS' | 'MOTORS') => void;
  sensorData: any[];
  motorData: any[];
  hasPermissions: boolean;
  streamRef: React.RefObject<MediaStream | null>;
  isVoiceActive: boolean;
  micLevel: number;
}

const MetricsPanel: React.FC<MetricsPanelProps> = ({
  activeTab,
  setActiveTab,
  sensorData,
  motorData,
  hasPermissions,
  streamRef,
  isVoiceActive,
  micLevel,
}) => {
  const sensorVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (activeTab === 'SENSORS' && hasPermissions && sensorVideoRef.current && streamRef.current) {
      if (sensorVideoRef.current.srcObject !== streamRef.current) {
        sensorVideoRef.current.srcObject = streamRef.current;
      }
    }
  }, [activeTab, hasPermissions, streamRef]);

  return (
    <div className="w-full lg:w-1/2 p-2 sm:p-4">
      <div className="bg-gray-900 rounded-lg p-4 h-full flex flex-col">
        {/* Tab Headers */}
        <div className="flex mb-4">
          <button
            onClick={() => setActiveTab('MOTORS')}
            className={`px-6 py-2 rounded-t-lg text-sm sm:text-base ${
              activeTab === 'MOTORS'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            MOTORS
          </button>
          <button
            onClick={() => setActiveTab('SENSORS')}
            className={`px-6 py-2 rounded-t-lg ml-2 text-sm sm:text-base ${
              activeTab === 'SENSORS'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            SENSORS
          </button>
        </div>

        {/* Chart Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'SENSORS' && (
            <div className="space-y-4">
              {/* Webcam Feed */}
              <div className="border border-gray-800 rounded p-2 flex flex-col h-64">
                <h3 className="text-sm text-white font-medium mb-2">Live Camera Feed</h3>
                {hasPermissions ? (
                  <div className="flex-1 bg-black rounded overflow-hidden">
                    <video
                      ref={sensorVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center bg-black rounded">
                    <div className="text-center">
                      <Camera className="w-12 h-12 mx-auto text-gray-500 mb-2" />
                      <p className="text-gray-400">Camera permission not granted.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Mic Detection & Other Sensors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-gray-800 rounded p-2 flex flex-col justify-center min-h-[120px]">
                    <h3 className="text-sm text-center text-white font-medium mb-2">Voice Activity</h3>
                  {hasPermissions ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                      <div className="flex items-end h-10 gap-px w-full justify-center">
                        {[...Array(15)].map((_, i) => {
                          const barIsActive = isVoiceActive && i < (micLevel / 120 * 15);
                          return (
                            <div
                              key={i}
                              className={`w-1.5 rounded-full transition-colors duration-75 ${barIsActive ? 'bg-orange-500' : 'bg-gray-700'}`}
                              style={{ height: `${(i / 15 * 60) + 20}%` }}
                            />
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-300">
                        {isVoiceActive ? "Voice commands active" : "Voice commands muted"}
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-black rounded">
                      <div className="text-center">
                        <MicOff className="w-8 h-8 mx-auto text-gray-500 mb-2" />
                        <p className="text-gray-400">Microphone permission not granted.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sensor Charts */}
                {['sensor3', 'sensor4'].map((sensor, index) => (
                  <div key={sensor} className="border border-gray-800 rounded p-2 flex flex-col h-auto min-h-[120px]">
                    <h3 className="text-sm text-white font-medium mb-2">Sensor {index + 3}</h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={sensorData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis hide />
                        <YAxis fontSize={12} stroke="#9CA3AF" />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#1F2937', 
                            border: '1px solid #374151',
                            color: '#fff'
                          }} 
                        />
                        <Line 
                          type="monotone" 
                          dataKey={sensor} 
                          stroke={index % 2 === 1 ? '#ff6b35' : '#ffdd44'} 
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'MOTORS' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {['motor1', 'motor2', 'motor3', 'motor4', 'motor5', 'motor6'].map((motor, index) => (
                <div key={motor} className="border border-gray-800 rounded p-2 h-40">
                  <h3 className="text-sm text-white font-medium mb-2">Motor {index + 1}</h3>
                  <ResponsiveContainer width="100%" height="80%">
                    <LineChart data={motorData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis hide />
                      <YAxis fontSize={12} stroke="#9CA3AF" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1F2937', 
                          border: '1px solid #374151',
                          color: '#fff'
                        }} 
                      />
                      <Line 
                        type="monotone" 
                        dataKey={motor} 
                        stroke={index % 2 === 0 ? '#ff6b35' : '#ffdd44'} 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricsPanel;
