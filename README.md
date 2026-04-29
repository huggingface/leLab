# LeLab - Web Interface for LeRobot

A modern web-based interface for controlling and monitoring robots using the [LeRobot](https://github.com/huggingface/lerobot) framework. This application provides an intuitive dashboard for robot teleoperation, data recording, and calibration management.

## 🤖 About

LeLab bridges the gap between LeRobot's powerful robotics capabilities and user-friendly web interfaces. It offers:

- **Real-time robot control** through an intuitive web dashboard
- **Dataset recording** for training machine learning models
- **Live teleoperation** with WebSocket-based real-time feedback
- **Configuration management** for leader/follower robot setups
- **Joint position monitoring** and visualization

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   FastAPI        │    │   LeRobot       │
│   (React/TS)    │◄──►│   Backend        │◄──►│   Framework     │
│                 │    │                  │    │                 │
│   • Dashboard   │    │   • REST APIs    │    │   • Robot       │
│   • Controls    │    │   • WebSockets   │    │     Control     │
│   • Monitoring  │    │   • Recording    │    │   • Sensors     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## ✨ Features

### 🎮 Robot Control

- **Teleoperation**: Direct robot arm control through web interface
- **Joint monitoring**: Real-time joint position feedback via WebSocket
- **Safety controls**: Start/stop teleoperation with status monitoring

### 📹 Data Recording

- **Dataset creation**: Record episodes for training ML models
- **Session management**: Start, stop, and manage recording sessions
- **Episode controls**: Skip to next episode or re-record current one
- **Real-time status**: Monitor recording progress and status

### ⚙️ Configuration

- **Config management**: Handle leader and follower robot configurations
- **Calibration support**: Load and manage calibration settings
- **Health monitoring**: System health checks and diagnostics

### 🌐 Web Interface

- **Modern UI**: Built with React, TypeScript, and Tailwind CSS
- **Real-time updates**: WebSocket integration for live data
- **Responsive design**: Works on desktop and mobile devices

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- Node.js 16+ (for frontend development)
- LeRobot framework installed and configured
- Compatible robot hardware

### Installation

1. **Clone the repository**

   ```bash
   git clone <your-repo-url>
   cd leLab
   ```

2. **Install the Python backend**

   ```bash
   # If installing in virtual environment
   python -m venv .venv
   source .venv/bin/activate
   # If installing globally
   # Note: Git-LFS required: brew install git-lfs
   pip install -e .
   ```

### Running the Application

After installation, you can use the `lelab` command-line tools:

```bash
# Start only the backend server (default)
lelab

# Start both backend and frontend servers
lelab-fullstack

# Start only the frontend development server
lelab-frontend
```

**Command Options:**

- `lelab` - Starts only the FastAPI backend server on `http://localhost:8000`
- `lelab-fullstack` - Starts both FastAPI backend (port 8000) and Vite frontend (port 8080) with auto-browser opening
- `lelab-frontend` - Starts only the frontend development server with auto-browser opening

**Frontend:**

The frontend lives in [`frontend/`](frontend/) inside this repo. Running `lelab-frontend` or `lelab-fullstack` will:

1. Run `npm install` in `frontend/`
2. Start the Vite dev server and auto-open your browser

The same `frontend/` directory is auto-deployed to the [LeLab Hugging Face Space](https://huggingface.co/spaces/lerobot/LeLab) by [`.github/workflows/sync_space.yml`](.github/workflows/sync_space.yml) on every push to `main` that touches `frontend/**`.

### Key Endpoints

- `POST /move-arm` - Start robot teleoperation
- `POST /stop-teleoperation` - Stop current teleoperation
- `GET /joint-positions` - Get current joint positions
- `POST /start-recording` - Begin dataset recording
- `POST /stop-recording` - End recording session
- `GET /get-configs` - Retrieve available configurations
- `WS /ws/joint-data` - WebSocket for real-time joint data

## 🏗️ Project Structure

```
leLab/
├── app/                      # FastAPI backend
│   ├── main.py              # Main FastAPI application
│   ├── recording.py         # Dataset recording logic
│   ├── teleoperating.py     # Robot teleoperation logic
│   ├── calibrating.py       # Robot calibration logic
│   ├── training.py          # ML training logic
│   ├── config.py            # Configuration management
│   └── static/              # Static web files
├── scripts/                  # Command-line scripts
│   ├── backend.py           # Backend-only startup
│   ├── frontend.py          # Frontend-only startup
│   └── fullstack.py         # Full-stack startup
├── frontend/                 # React + Vite frontend (deployed to HF Space)
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── pages/           # Page components
│   │   ├── hooks/           # Custom React hooks
│   │   └── contexts/        # React contexts
│   ├── public/              # Static assets
│   ├── Dockerfile           # Used by HF Space build
│   └── package.json         # Frontend dependencies
├── .github/workflows/        # CI (auto-deploys frontend/ to HF Space)
├── pyproject.toml           # Python project configuration
├── LICENSE                  # Apache 2.0
└── README.md                # This file
```

## 🔧 Development

### Backend Development

```bash
# Install in editable mode
pip install -e .

# Run backend only with auto-reload
lelab
```

### Frontend Development

```bash
# Installs deps in frontend/ and starts the Vite dev server
lelab-frontend
```

### Full-Stack Development

```bash
# Start both backend and frontend with auto-reload
lelab-fullstack
```

**Development Notes:**

- Frontend source lives in `frontend/` and is deployed to the [HF Space](https://huggingface.co/spaces/lerobot/LeLab) via GitHub Actions
- Both commands auto-open your browser to the appropriate URL
- Backend runs on `http://localhost:8000`
- Frontend runs on `http://localhost:8080`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [LeRobot](https://github.com/huggingface/lerobot) - The underlying robotics framework
- [FastAPI](https://fastapi.tiangolo.com/) - Modern web framework for building APIs
- [React](https://reactjs.org/) - Frontend user interface library

---

**Note**: Make sure your LeRobot environment is properly configured and your robot hardware is connected before running the application.
