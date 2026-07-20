# 🦾 LeLab Windows 설치 및 실행 가이드 (Windows Installation Guide)

이 문서는 **Windows 환경**에서 **LeLab**(LeRobot의 공식 웹 그래픽 인터페이스)을 설치하고 실행하기 위한 가이드입니다. 강의 내용 및 개발 표준(CLAUDE.md)을 바탕으로 작성되었습니다.

---

## 📋 시스템 요구사항 (Prerequisites)

- **OS**: Windows 10 이상
- **Python**: 3.12 이상 (권장)
- **Git**: 소스 코드 복제용
- **uv**: 빠르고 안정적인 패키지 및 가상환경 관리를 위해 강력히 권장합니다.

---

## ⚙️ 1단계: 개발 환경 구성

### 1. `uv` 설치 (미설치된 경우)
PowerShell을 열고 아래 명령어를 실행하여 `uv`를 설치합니다:
```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### 2. 가상환경(Virtual Environment) 생성
프로젝트 루트 폴더(`leLab/`)로 이동하여 Python 3.12 기반의 가상환경을 생성합니다. (`uv`는 필요한 Python 버전을 자동으로 감지하여 다운로드합니다.)
```powershell
uv venv --python 3.12
```

### 3. 가상환경 활성화 (Activate)
- **PowerShell**:
  ```powershell
  .venv\Scripts\Activate.ps1
  ```
- **기본 CMD**:
  ```cmd
  .venv\Scripts\activate.bat
  ```

---

## 📥 2단계: 패키지 및 종속성 설치

Windows 환경 전용 카메라 지원 라이브러리(`pygrabber`)와 개발/테스트 도구를 포함하여 **Editable 모드(-e)**로 패키지를 설치합니다:

```powershell
# 개발 및 테스트 종속성을 함께 설치
uv pip install -e ".[dev,test]"
```

> [!NOTE]
> - Windows 환경에서는 카메라의 브라우저 `deviceId`와 실제 DirectShow 카메라 이름을 매핑하기 위해 `pygrabber` 패키지가 자동으로 함께 설치됩니다.
> - `lerobot` 핵심 라이브러리는 `pyproject.toml`에 명시된 Hugging Face 공식 리포지토리의 특정 커밋 버전을 참조하여 자동으로 빌드 및 설치됩니다.

---

## 🚀 3단계: LeLab 실행하기

가상환경이 활성화된 상태에서 아래 명령어를 사용하여 앱을 실행할 수 있습니다.

### A. 일반 모드 (서버 & 빌드된 프론트엔드 통합 실행)
Vite로 빌드된 정적 프론트엔드 파일과 FastAPI 백엔드가 포트 `8000`에서 동시에 실행되며, 브라우저 창이 자동으로 열립니다.
```powershell
lelab
```

### B. 개발자 모드 (핫 리로드 및 실시간 코드 수정)
백엔드 FastAPI 서버(`:8000`, 자동 재실행 적용)와 프론트엔드 Vite 개발 서버(`:8080`)를 동시에 띄우며, 코드 수정 시 실시간으로 화면에 반영됩니다.
```powershell
lelab --dev
```

---

## 💡 Windows 환경 핵심 핵심 포인트 및 문제 해결

### 1. 포트 자동 인식 (Unplug-to-detect)
로봇 팔(SO-101 리더/팔로워) 연결 시 어떤 시리얼 포트(COM Port)에 연결되었는지 일일이 찾을 필요가 없습니다. USB 케이블을 뽑았다가 다시 꽂으면 화면에서 자동으로 포트를 인식하여 교정(Calibration)을 바로 시작할 수 있습니다.

### 2. 설정 및 교정 파일 저장 경로
Windows에서 교정 데이터 및 설정 파일들은 다음 경로에 안전하게 저장 및 유지됩니다:
- `C:\Users\<사용자이름>\.cache\huggingface\lerobot\calibration\` (리더/팔로워 조인트 설정 등)
- `C:\Users\<사용자이름>\.cache\huggingface\lerobot\ports\` (최근 사용 포트 기록)

### 3. 모바일 카메라 스트리밍 (HTTPS 구성)
스마트폰 카메라를 로봇 학습용 외부 카메라로 사용하려면 브라우저 보안 정책상 **HTTPS** 환경이 필수적입니다.
- self-signed 인증서 파일을 `certs/` 디렉토리에 배치한 후 uvicorn을 수동으로 구동해야 합니다:
  ```powershell
  uvicorn lelab.server:app --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem --host 0.0.0.0 --port 8000
  ```

### 4. 허깅페이스 CLI 로그인 (Hugging Face CLI Authentication)
LeLab의 클라우드 GPU 학습 기능(HF Jobs)이나 데이터셋 업로드 기능을 사용하려면 Hugging Face 계정 인증이 필요합니다.

Hugging Face CLI인 `hf` 도구는 **이미 가상환경 내에 설치되어 있습니다**. 따라서 별도의 추가 설치 없이 가상환경 활성화 상태에서 아래 명령어로 로그인할 수 있습니다:

1. **가상환경 활성화 상태**의 터미널에서 아래 명령어를 실행합니다:
   ```powershell
   hf auth login
   ```
2. 프롬프트가 나타나면 [Hugging Face Settings -> Access Tokens](https://huggingface.co/settings/tokens)에서 발급받은 **Access Token (Write 권한 권장)**을 복사하여 붙여넣습니다. (Windows PowerShell에서는 마우스 우클릭으로 붙여넣기가 가능하며, 보안상 입력 중인 문자나 별표는 화면에 표시되지 않습니다.)
3. **로그인 상태 확인**: 제대로 연동이 되었는지 아래 명령어를 통해 로그인 정보를 확인합니다:
   ```powershell
   hf auth whoami
   ```

만약 가상환경 외부(글로벌 환경)에서 개별적으로 Hugging Face CLI를 관리/사용하고 싶다면, 아래와 같이 `uv`를 사용해 글로벌 도구로 설치할 수도 있습니다:
```powershell
# 글로벌 환경에 hf CLI 설치
uv tool install huggingface_hub

# 로그인 실행
hf auth login

# 로그인 확인
hf auth whoami
```
