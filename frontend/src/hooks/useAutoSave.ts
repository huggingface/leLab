import { useCallback, useRef } from 'react';
import { useApi } from '@/contexts/ApiContext';

export const useAutoSave = () => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const timeoutRefs = useRef<{ [key: string]: NodeJS.Timeout }>({});
  const configTimeoutRefs = useRef<{ [key: string]: NodeJS.Timeout }>({});

  const savePortAutomatically = useCallback(async (robotType: 'leader' | 'follower', port: string) => {
    if (!port.trim()) return;
    
    try {
      await fetchWithHeaders(`${baseUrl}/save-robot-port`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          robot_type: robotType,
          port: port.trim(),
        }),
      });
      console.log(`Auto-saved ${robotType} port: ${port}`);
    } catch (error) {
      console.error(`Error saving ${robotType} port:`, error);
    }
  }, [baseUrl, fetchWithHeaders]);

  const saveConfigAutomatically = useCallback(async (robotType: 'leader' | 'follower', configName: string) => {
    if (!configName.trim()) return;
    
    try {
      await fetchWithHeaders(`${baseUrl}/save-robot-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          robot_type: robotType,
          config_name: configName.trim(),
        }),
      });
      console.log(`Auto-saved ${robotType} config: ${configName}`);
    } catch (error) {
      console.error(`Error saving ${robotType} config:`, error);
    }
  }, [baseUrl, fetchWithHeaders]);

  const debouncedSavePort = useCallback((robotType: 'leader' | 'follower', port: string, delay: number = 1500) => {
    // Clear existing timeout for this robotType
    if (timeoutRefs.current[robotType]) {
      clearTimeout(timeoutRefs.current[robotType]);
    }

    // Set new timeout
    timeoutRefs.current[robotType] = setTimeout(() => {
      savePortAutomatically(robotType, port);
      delete timeoutRefs.current[robotType];
    }, delay);
  }, [savePortAutomatically]);

  const debouncedSaveConfig = useCallback((robotType: 'leader' | 'follower', configName: string, delay: number = 1000) => {
    const key = `${robotType}_config`;
    
    // Clear existing timeout for this robotType config
    if (configTimeoutRefs.current[key]) {
      clearTimeout(configTimeoutRefs.current[key]);
    }

    // Set new timeout
    configTimeoutRefs.current[key] = setTimeout(() => {
      saveConfigAutomatically(robotType, configName);
      delete configTimeoutRefs.current[key];
    }, delay);
  }, [saveConfigAutomatically]);

  return { debouncedSavePort, debouncedSaveConfig };
};