/**
 * Automatically starts ngrok if not already running
 */
export const autoStartNgrok = async (): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    console.log('🚀 Attempting to auto-start ngrok...');
    
    // First check if ngrok is already running
    const existingUrl = await detectNgrokUrl();
    if (existingUrl) {
      console.log('✅ ngrok already running:', existingUrl);
      return { success: true, url: existingUrl };
    }
    
    // Try to start ngrok via backend API call
    const response = await fetch('http://localhost:8000/start-ngrok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 8080 })
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.url) {
        console.log('✅ ngrok started successfully:', data.url);
        return { success: true, url: data.url };
      }
    }
    
    // Fallback: try to detect if ngrok started externally
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    const newUrl = await detectNgrokUrl();
    if (newUrl) {
      console.log('✅ ngrok detected after waiting:', newUrl);
      return { success: true, url: newUrl };
    }
    
    return { 
      success: false, 
      error: 'Could not start ngrok automatically. Please run: ngrok http 8080' 
    };
    
  } catch (error) {
    console.error('❌ Error auto-starting ngrok:', error);
    return { 
      success: false, 
      error: 'Failed to start ngrok. Please run manually: ngrok http 8080' 
    };
  }
};

/**
 * Detects if ngrok is running and returns the HTTPS URL
 */
const detectNgrokUrl = async (): Promise<string | null> => {
  try {
    // Try to get ngrok tunnels from the local API
    const response = await fetch('http://localhost:4040/api/tunnels');
    if (response.ok) {
      const data = await response.json();
      const tunnel = data.tunnels?.find((t: { config?: { addr?: string }; public_url?: string }) => 
        t.config?.addr === 'http://localhost:8080' && t.public_url?.startsWith('https://')
      );
      if (tunnel?.public_url) {
        console.log('🔗 Detected ngrok HTTPS tunnel:', tunnel.public_url);
        return tunnel.public_url;
      }
    }
  } catch (error) {
    // Ngrok not running or not accessible
    console.log('📡 No ngrok tunnel detected');
  }
  return null;
};

/**
 * Detects the accessible frontend address, prioritizing HTTPS
 */
export const getAccessibleFrontendAddress = async (): Promise<string> => {
  // First, check if we're already on HTTPS (production or direct HTTPS access)
  if (window.location.protocol === 'https:') {
    return window.location.origin;
  }
  
  // For development with localhost, check for ngrok tunnel first
  const ngrokUrl = await detectNgrokUrl();
  if (ngrokUrl) {
    return ngrokUrl;
  }
  
  const currentHostname = window.location.hostname;
  const currentPort = window.location.port;
  const currentProtocol = window.location.protocol;
  
  // If already on a network IP or domain, reuse it
  if (currentHostname !== 'localhost' && currentHostname !== '127.0.0.1') {
    return `${currentProtocol}//${currentHostname}${currentPort ? `:${currentPort}` : ''}`;
  }
  
  // For localhost/127.0.0.1, try to detect local network IP
  const localIP = await detectLocalNetworkIP();
  if (localIP) {
    return `${currentProtocol}//${localIP}${currentPort ? `:${currentPort}` : ''}`;
  }
  
  // Fallback to current address
  return window.location.origin;
};

/**
 * Uses WebRTC to detect the local network IP address
 */
export const detectLocalNetworkIP = (): Promise<string | null> => {
  return new Promise((resolve) => {
    // Create a RTCPeerConnection to get local IP
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    let resolved = false;
    
    pc.onicecandidate = (event) => {
      if (event.candidate && !resolved) {
        const candidate = event.candidate.candidate;
        // Look for the local IP address (typically starts with 192.168, 10., or 172.)
        const ipMatch = candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          const ip = ipMatch[1];
          // Check if it's a local network IP
          if (ip.startsWith('192.168.') || ip.startsWith('10.') || 
              (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31)) {
            resolved = true;
            pc.close();
            resolve(ip);
          }
        }
      }
    };
    
    // Create a data channel to trigger ICE gathering
    pc.createDataChannel('ip-detection');
    pc.createOffer().then(offer => pc.setLocalDescription(offer));
    
    // Timeout after 3 seconds
    setTimeout(() => {
      if (!resolved) {
        pc.close();
        resolve(null);
      }
    }, 3000);
  });
};

/**
 * Generates a QR code URL for phone camera access
 */
export const generatePhoneCameraQR = async (webrtcId: string): Promise<string> => {
  try {
    // Always prioritize HTTPS URLs for phone camera access
    const baseUrl = await getAccessibleFrontendAddress();
    const phoneUrl = `${baseUrl}/remote_cam/${webrtcId}`;
    console.log('📱 Generated phone camera URL:', phoneUrl);
    return phoneUrl;
  } catch (error) {
    console.error('Error generating phone camera QR:', error);
    // Fallback to localhost if detection fails
    return `http://localhost:8080/remote_cam/${webrtcId}`;
  }
};

/**
 * Generates a unique WebRTC session ID
 */
export const generateWebRTCId = (): string => {
  return `phone_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}; 
