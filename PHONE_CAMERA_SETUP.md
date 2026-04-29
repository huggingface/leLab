# 📱 Phone Camera Setup Guide

## Overview

The LeRobot system now supports using your phone as a wireless camera for recording! This feature allows you to:

- Add multiple phone cameras to your recording setup
- Stream video wirelessly from any smartphone with a browser
- Position cameras in hard-to-reach places
- Record from multiple angles simultaneously

## 🚀 Quick Start

### 1. Generate HTTPS Certificates

Phone cameras require HTTPS for security. Run:

```bash
python generate_certs.py
```

This will:

- Detect your local network IP (e.g., `192.168.1.103`)
- Generate SSL certificates for `localhost` and your local IP
- Create a `certs/` directory with the certificates

### 2. Start the System

Use the demo script to start both frontend and backend with HTTPS:

```bash
python scripts/start_phone_camera_demo.py
```

Or start manually:

```bash
# Backend with HTTPS
uvicorn app.main:app --host 0.0.0.0 --port 8000 --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem --reload

# Frontend with HTTPS (in another terminal)
cd frontend && npm run dev
```

### 3. Access the System

- **Desktop**: `https://localhost:5173` or `https://your-local-ip:5173`
- **Mobile**: `https://your-local-ip:5173` (same Wi-Fi network)

⚠️ **Important**: You'll need to accept SSL certificate warnings in your browser since we're using self-signed certificates.

## 📱 Adding a Phone Camera

### Step 1: Configure Camera

1. Go to the **Recording** page
2. In the **Camera Configuration** section, click **Add Camera**
3. From the dropdown, select **📱 Phone Camera**
4. Give it a descriptive name (e.g., "overhead_view", "side_angle")
5. Click **Add Camera**

### Step 2: Connect Your Phone

1. A QR code will appear in the camera preview card
2. Open your phone's camera app
3. Point it at the QR code on your desktop screen
4. Tap the notification/link to open the camera page
5. Accept any SSL certificate warnings
6. Allow camera access when prompted

### Step 3: Start Streaming

1. On the phone camera page, select the desired camera (front/back)
2. Tap **Start Streaming**
3. Position your phone to frame the desired view
4. The desktop will show "CONNECTED" status with a live indicator

## 🎯 Features

### Multiple Phone Cameras

- Add as many phone cameras as needed
- Each gets a unique QR code and session
- All cameras can stream simultaneously

### Camera Controls (Mobile)

- **Camera Selection**: Switch between front/back cameras
- **Quality Settings**: Automatic optimization for network conditions
- **Real-time Preview**: See exactly what's being recorded
- **Connection Status**: Visual indicators for connection health

### Desktop Integration

- **QR Code Display**: Easy phone connection
- **Live Status**: Real-time connection and streaming status
- **Stream Preview**: See phone camera feeds in recording dashboard
- **Session Management**: Automatic cleanup of disconnected sessions

## 🔧 Technical Details

### Network Requirements

- **Same Wi-Fi Network**: Phone and desktop must be on the same network
- **HTTPS Required**: Phone browsers require secure connections for camera access
- **Firewall**: Ensure ports 5173 (frontend) and 8000 (backend) are accessible

### Supported Browsers (Mobile)

- **iOS**: Safari 14.5+, Chrome 90+
- **Android**: Chrome 90+, Firefox 88+, Samsung Internet 14+

### Video Quality

- **Default**: 1280x720 @ 30fps
- **Adaptive**: Automatically adjusts based on network conditions
- **Optimized**: Lower latency for real-time streaming

## 🛠 Troubleshooting

### Common Issues

#### 1. QR Code Not Working

- Ensure phone and desktop are on same Wi-Fi
- Check that HTTPS certificates are properly generated
- Try accessing the URL manually: `https://your-ip:5173/remote-camera/session-id`

#### 2. Camera Permission Denied

- Phone browsers require HTTPS for camera access
- Accept SSL certificate warnings
- Go to browser settings and allow camera access for the site

#### 3. Connection Fails

- Check firewall settings on your computer
- Ensure WebSocket connections are allowed
- Try restarting the backend: `uvicorn app.main:app --reload`

#### 4. Poor Video Quality

- Move closer to Wi-Fi router
- Close other apps using the camera
- Check network bandwidth with other devices

### Advanced Configuration

#### Custom Certificate (Trusted)

For better security without browser warnings, install `mkcert`:

```bash
# macOS
brew install mkcert

# Ubuntu/Debian
sudo apt install mkcert

# Then regenerate certificates
python generate_certs.py
```

#### Network Optimization

For best performance:

- Use 5GHz Wi-Fi when available
- Ensure strong signal strength
- Minimize network congestion

## 📋 Usage Examples

### Basic Recording Setup

1. Add 2 phone cameras: "workspace_overhead" and "arm_side_view"
2. Position phones using stands or mounts
3. Start recording session
4. Phone cameras automatically included in dataset

### Multi-Angle Training Data

1. Add 3-4 phone cameras at different angles
2. Record robot demonstrations
3. Each camera view saved as separate video stream
4. Training data includes all perspectives

### Remote Monitoring

1. Add phone camera as "monitor_cam"
2. Leave phone in fixed position
3. Check robot status remotely via camera feed
4. Use for debugging and verification

## 🔄 Workflow Integration

The phone cameras integrate seamlessly with the existing LeRobot recording workflow:

1. **Configuration**: Add phone cameras alongside regular USB cameras
2. **Recording**: All cameras (USB + phone) record simultaneously
3. **Dataset**: Phone camera videos included in HDF5 datasets
4. **Training**: Multi-view data available for policy learning
5. **Replay**: All camera angles available during episode playback

## 📊 Performance Considerations

### Bandwidth Usage

- Each phone camera: ~2-5 Mbps (depending on quality)
- Multiple cameras: Ensure adequate Wi-Fi bandwidth
- Monitor network performance during recording

### Battery Life

- Phone cameras drain battery during streaming
- Use phone chargers for long recording sessions
- Consider power banks for mobile setups

### Latency

- Typical latency: 100-300ms (Wi-Fi dependent)
- Acceptable for most recording scenarios
- Real-time control may need dedicated cameras

## 🎉 Success!

You should now have a fully functional phone camera system integrated with LeRobot!

For questions or issues, check the troubleshooting section above or refer to the main LeRobot documentation.

Happy recording! 📹🤖
