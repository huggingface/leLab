from __future__ import annotations

import io
import json
import tarfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class _RemoteMetrics:
    current_step: int = 20
    total_steps: int = 100
    current_loss: float | None = 1.2
    current_lr: float | None = 0.0001
    grad_norm: float | None = 0.8
    eta_seconds: float | None = 120


@dataclass(frozen=True)
class _RemoteJob:
    id: str = "lerobot-job-1"
    status: str = "SUCCEEDED"
    gpu_type: str = "RTX 4090D"
    policy_type: str = "act"
    train_steps: int = 100
    artifact_url: str = "https://r2.example.com/model.tar.gz"
    error_message: str = ""
    created_at: str = "2026-06-07T08:37:30Z"
    updated_at: str = "2026-06-07T08:40:01Z"
    external_job_url: str = "https://gpu.example.com/jobs/lerobot-job-1"
    metrics: _RemoteMetrics = _RemoteMetrics()
    training_config: dict | None = None
    target: dict | None = None

    def __post_init__(self):
        if self.training_config is None:
            object.__setattr__(
                self,
                "training_config",
                {
                    "dataset_repo_id": "links7/soarm101",
                    "policy_type": self.policy_type,
                    "steps": self.train_steps,
                    "batch_size": 8,
                },
            )
        if self.target is None:
            object.__setattr__(
                self,
                "target",
                {"provider": "seeed_cloud", "flavor": "rtx-4090d", "gpu_type": self.gpu_type},
            )


@dataclass(frozen=True)
class _RemoteHistoryPoint:
    step: int
    loss: float | None = None
    lr: float | None = None
    grad_norm: float | None = None


class _Provider:
    id = "seeed_cloud"
    display_name = "Seeed Cloud Platform"

    def is_configured(self) -> bool:
        return True

    def list_flavors(self):
        return [
            {
                "name": "rtx-4090",
                "pretty_name": "Seeed RTX 4090",
                "cpu": "",
                "ram": "",
                "accelerator": "RTX 4090",
                "unit_cost_usd": 0.0,
                "unit_label": "hour",
            }
        ]

    def list_jobs(self):
        return [_RemoteJob()]

    def list_metrics_history(self, job_id: str):
        assert job_id == "lerobot-job-1"
        return [
            _RemoteHistoryPoint(step=10, loss=37.69, lr=0.00001, grad_norm=100.5),
            _RemoteHistoryPoint(step=100, loss=4.124, lr=0.00001, grad_norm=105.453),
        ]

    def list_logs(self, job_id: str):
        assert job_id == "lerobot-job-1"
        return [
            type("RemoteLog", (), {"content": "line 1", "created_at": "2026-06-07T08:37:30Z"})(),
            type("RemoteLog", (), {"content": "INFO step:100 loss:4.124 grdn:105.453 lr:1.0e-05", "created_at": "2026-06-07T08:40:01Z"})(),
        ]

    def download_artifact(self, job_id: str, destination):
        assert job_id == "lerobot-job-1"
        config = {
            "type": "act",
            "input_features": {
                "observation.images.front": {"type": "VISUAL", "shape": [3, 480, 640]},
            },
        }
        data = json.dumps(config).encode("utf-8")
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(path, "w:gz") as archive:
            info = tarfile.TarInfo("pretrained_model/config.json")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        return path


class _UnconfiguredProvider(_Provider):
    def is_configured(self) -> bool:
        return False


class _ExternalRunner:
    def __init__(self) -> None:
        self.started = False
        self.reattached_job_id = None

    def start(self, job_id: str, config, output_dir: str) -> None:
        self.started = True

    def stop(self) -> None:
        pass

    def is_running(self) -> bool:
        return True

    def returncode(self) -> int | None:
        return None

    def stream_log_lines(self):
        return []

    def wandb_run_url(self) -> str | None:
        return None

    def external_job_id(self) -> str:
        return "remote-job-123"

    def external_job_url(self) -> str:
        return "https://gpu.example.com/jobs/remote-job-123"

    def reattach(self, job_id: str) -> None:
        self.reattached_job_id = job_id


class _ExternalProvider(_Provider):
    runner: _ExternalRunner | None = None

    def create_runner(self, metrics, log_file_path, target):
        self.runner = _ExternalRunner()
        return self.runner


class _RunningProvider(_ExternalProvider):
    def list_jobs(self):
        return [_RemoteJob(status="TRAINING_RUNNING")]


class _EntryPoint:
    name = "seeed_cloud"

    def load(self):
        return _Provider


class _EntryPoints:
    def select(self, *, group: str):
        if group == "lelab.compute_providers":
            return [_EntryPoint()]
        return []


def test_discover_compute_providers_loads_module_factories(monkeypatch) -> None:
    from lelab.compute_providers import discover_compute_providers

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_Provider")

    providers = discover_compute_providers()

    assert [p.id for p in providers] == ["seeed_cloud"]
    assert providers[0].display_name == "Seeed Cloud Platform"


def test_discover_compute_providers_loads_entry_points(monkeypatch) -> None:
    import importlib.metadata

    from lelab.compute_providers import discover_compute_providers

    monkeypatch.delenv("LELAB_COMPUTE_PROVIDER_MODULES", raising=False)
    monkeypatch.setattr(importlib.metadata, "entry_points", lambda: _EntryPoints())

    providers = discover_compute_providers()

    assert [p.id for p in providers] == ["seeed_cloud"]


def test_job_registry_starts_external_provider_runner(monkeypatch, tmp_path) -> None:
    from lelab.jobs import JobRegistry, JobTarget
    from lelab.train import TrainingRequest

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_ExternalProvider")

    registry = JobRegistry(tmp_path)
    try:
        record = registry.start(
            TrainingRequest(dataset_repo_id="https://storage.example.com/so101.zip", policy_type="act", steps=100),
            JobTarget(runner="external", provider="seeed_cloud", flavor="RTX 4090"),
        )
    finally:
        registry.shutdown()

    assert record.runner == "external"
    assert record.external_provider == "seeed_cloud"
    assert record.external_flavor == "RTX 4090"
    assert record.external_job_id == "remote-job-123"
    assert record.external_job_url == "https://gpu.example.com/jobs/remote-job-123"


def test_job_registry_starts_seeed_cloud_provider_runner(monkeypatch, tmp_path) -> None:
    from lelab.jobs import JobRegistry, JobTarget
    from lelab.train import TrainingRequest

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_ExternalProvider")

    registry = JobRegistry(tmp_path)
    try:
        record = registry.start(
            TrainingRequest(dataset_repo_id="links7/soarm101", policy_type="act", steps=100),
            JobTarget(runner="seeed_cloud", flavor="rtx-4090"),
        )
    finally:
        registry.shutdown()

    assert record.runner == "seeed_cloud"
    assert record.external_provider == "seeed_cloud"
    assert record.external_flavor == "rtx-4090"
    assert record.external_job_id == "remote-job-123"


def test_job_registry_reads_external_metrics_history(monkeypatch, tmp_path) -> None:
    from lelab.jobs import JobRegistry

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_Provider")

    registry = JobRegistry(tmp_path)
    try:
        record = registry.attach_external("seeed_cloud", "lerobot-job-1")
        points = registry.read_metrics_history(record.id)
    finally:
        registry.shutdown()

    assert len(points) == 2
    assert points[0].step == 10
    assert points[0].loss == 37.69
    assert points[1].step == 100
    assert points[1].loss == 4.124


def test_job_registry_reads_external_training_logs(monkeypatch, tmp_path) -> None:
    from lelab.jobs import JobRegistry

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_Provider")

    registry = JobRegistry(tmp_path)
    try:
        record = registry.attach_external("seeed_cloud", "lerobot-job-1")
        logs = registry.read_persisted_logs(record.id)
    finally:
        registry.shutdown()

    assert len(logs) == 2
    assert logs[0].message == "line 1"
    assert logs[1].message.endswith("lr:1.0e-05")


def test_job_registry_exposes_external_artifact_checkpoint(monkeypatch, tmp_path) -> None:
    from lelab.jobs import JobRegistry

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_Provider")

    registry = JobRegistry(tmp_path)
    try:
        record = registry.attach_external("seeed_cloud", "lerobot-job-1")
        checkpoints = registry.list_checkpoints(record.id)
        summary = registry.get_policy_config_summary(record.id, checkpoints[0].step)
    finally:
        registry.shutdown()

    assert len(checkpoints) == 1
    assert checkpoints[0].step == 20
    assert checkpoints[0].source == "external"
    assert checkpoints[0].ref.startswith("seeed-cloud://seeed_cloud/lerobot-job-1/")
    assert summary["policy_type"] == "act"
    assert summary["image_features"] == {"front": {"height": 480, "width": 640}}


def test_runner_hardware_includes_configured_external_providers(monkeypatch) -> None:
    from lelab import server

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_Provider")
    monkeypatch.setattr(server, "cached_whoami", lambda: None)

    body = server.get_runners_hardware()

    assert body["authenticated"] is False
    assert body["providers"] == [
        {
            "id": "seeed_cloud",
            "display_name": "Seeed Cloud Platform",
            "authenticated": True,
            "flavors": [
                {
                    "name": "rtx-4090",
                    "pretty_name": "Seeed RTX 4090",
                    "cpu": "",
                    "ram": "",
                    "accelerator": "RTX 4090",
                    "unit_cost_usd": 0.0,
                    "unit_label": "hour",
                    "provider": "seeed_cloud",
                    "provider_label": "Seeed Cloud Platform",
                }
            ],
        }
    ]


def test_runner_hardware_includes_unconfigured_provider_flavor_catalog(monkeypatch) -> None:
    from lelab import server

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_UnconfiguredProvider")
    monkeypatch.setattr(server, "cached_whoami", lambda: None)

    body = server.get_runners_hardware()

    assert body["providers"] == [
        {
            "id": "seeed_cloud",
            "display_name": "Seeed Cloud Platform",
            "authenticated": False,
            "flavors": [
                {
                    "name": "rtx-4090",
                    "pretty_name": "Seeed RTX 4090",
                    "cpu": "",
                    "ram": "",
                    "accelerator": "RTX 4090",
                    "unit_cost_usd": 0.0,
                    "unit_label": "hour",
                    "provider": "seeed_cloud",
                    "provider_label": "Seeed Cloud Platform",
                }
            ],
        }
    ]


def test_hub_jobs_includes_seeed_cloud_jobs_without_hf_login(monkeypatch) -> None:
    from lelab import server

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_Provider")
    monkeypatch.setattr(server, "cached_whoami", lambda: None)

    body = server.list_hub_jobs()

    assert body["authenticated"] is True
    assert body["models"] == []
    assert body["jobs"] == [
        {
            "id": "lerobot-job-1",
            "created_at": "2026-06-07T08:37:30Z",
            "docker_image": "Seeed · ACT · lerobot-job-…",
            "space_id": None,
            "flavor": "RTX 4090D",
            "status": {"stage": "COMPLETED", "message": None},
            "owner": "Seeed Cloud",
            "url": "https://gpu.example.com/jobs/lerobot-job-1",
            "provider": "seeed_cloud",
        }
    ]


def test_job_registry_attaches_seeed_cloud_remote_job(monkeypatch, tmp_path) -> None:
    from lelab.jobs import JobRegistry

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_RunningProvider")

    registry = JobRegistry(tmp_path)
    try:
        record = registry.attach_external("seeed_cloud", "lerobot-job-1")
        same_record = registry.attach_external("seeed_cloud", "lerobot-job-1")
    finally:
        registry.shutdown()

    assert same_record.id == record.id
    assert record.runner == "seeed_cloud"
    assert record.state == "running"
    assert record.config.dataset_repo_id == "links7/soarm101"
    assert record.external_provider == "seeed_cloud"
    assert record.external_flavor == "rtx-4090d"
    assert record.external_job_id == "lerobot-job-1"
    assert record.external_job_url == "https://gpu.example.com/jobs/lerobot-job-1"
    assert record.metrics.current_step == 20
    assert record.metrics.total_steps == 100
    assert record.metrics.current_loss == 1.2


def test_attach_provider_job_route_returns_local_record(monkeypatch, tmp_path) -> None:
    from lelab import server
    from lelab.jobs import JobRegistry

    monkeypatch.setenv("LELAB_COMPUTE_PROVIDER_MODULES", "tests.test_compute_providers:_Provider")
    registry = JobRegistry(tmp_path)
    monkeypatch.setattr(server, "job_registry", registry)

    try:
        record = server.attach_provider_job("seeed_cloud", "lerobot-job-1")
    finally:
        registry.shutdown()

    assert record.runner == "seeed_cloud"
    assert record.state == "done"
    assert record.external_job_id == "lerobot-job-1"
