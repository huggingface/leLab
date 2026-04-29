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

After installation, run:

```bash
lelab          # default: serves built frontend + backend on :8000
lelab --dev    # contributor mode: Vite HMR (:8080) + uvicorn --reload (:8000)
```

**Default mode** runs the backend on `http://localhost:8000` and serves the pre-built React frontend at `/`. One process, one port. No Node.js required at runtime — the built bundle ships with the package.

**`--dev` mode** spawns the Vite dev server in `frontend/` for hot module reload and runs uvicorn with `--reload`. Requires Node.js. Use this when working on frontend or backend code.

The `frontend/` directory is also the source of truth for the [LeLab Hugging Face Space](https://huggingface.co/spaces/lerobot/LeLab), auto-deployed by [`.github/workflows/sync_space.yml`](.github/workflows/sync_space.yml) on every push to `main` that touches `frontend/**`.

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
│   ├── main.py              # Main FastAPI application; mounts frontend/dist at /
│   ├── recording.py         # Dataset recording logic
│   ├── teleoperating.py     # Robot teleoperation logic
│   ├── calibrating.py       # Robot calibration logic
│   ├── training.py          # ML training logic
│   └── config.py            # Configuration management
├── scripts/
│   └── backend.py           # `lelab` entry point (default + --dev)
├── frontend/                 # React + Vite frontend (also deployed to HF Space)
│   ├── src/                 # React components, pages, hooks, contexts
│   ├── public/              # Static assets
│   ├── dist/                # Built bundle, ships with the Python package
│   ├── Dockerfile           # Used by HF Space build
│   └── package.json
├── .github/workflows/        # CI (auto-deploys frontend/ to HF Space)
├── pyproject.toml
├── LICENSE                   # Apache 2.0
└── README.md
```

## 🔧 Development

```bash
pip install -e .            # editable install
cd frontend && npm install  # one-time, only if you'll touch the frontend
lelab --dev                 # full HMR for backend + frontend
```

After making frontend changes, before committing run `cd frontend && npm run build` so `frontend/dist/` (which ships in the wheel) stays in sync.

- Backend: `http://localhost:8000`
- Frontend (HMR): `http://localhost:8080`

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
