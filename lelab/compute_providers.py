from __future__ import annotations

import importlib
import importlib.metadata
import logging
import os
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)

ENTRY_POINT_GROUP = "lelab.compute_providers"
ENV_PROVIDER_MODULES = "LELAB_COMPUTE_PROVIDER_MODULES"


class ComputeProvider(Protocol):
    id: str
    display_name: str

    def is_configured(self) -> bool: ...
    def list_flavors(self) -> list[dict]: ...
    def create_runner(self, metrics, log_file_path: Path, target): ...


def discover_compute_providers() -> list[ComputeProvider]:
    providers: list[ComputeProvider] = []
    providers.extend(_load_env_provider_modules())
    providers.extend(_load_entry_point_providers())
    return _dedupe_providers(providers)


def get_compute_provider(provider_id: str) -> ComputeProvider | None:
    for provider in discover_compute_providers():
        if provider.id == provider_id:
            return provider
    return None


def _load_env_provider_modules() -> list[ComputeProvider]:
    raw = os.environ.get(ENV_PROVIDER_MODULES, "").strip()
    if not raw:
        return []
    providers: list[ComputeProvider] = []
    for spec in [part.strip() for part in raw.split(",") if part.strip()]:
        try:
            providers.append(_load_provider_object(spec))
        except Exception as exc:
            logger.warning("Failed to load compute provider %s: %s", spec, exc)
    return providers


def _load_entry_point_providers() -> list[ComputeProvider]:
    providers: list[ComputeProvider] = []
    try:
        entry_points = importlib.metadata.entry_points()
        if hasattr(entry_points, "select"):
            selected = entry_points.select(group=ENTRY_POINT_GROUP)
        else:
            selected = entry_points.get(ENTRY_POINT_GROUP, [])
    except Exception as exc:
        logger.warning("Failed to inspect compute provider entry points: %s", exc)
        return []
    for entry_point in selected:
        try:
            providers.append(_instantiate(entry_point.load()))
        except Exception as exc:
            logger.warning("Failed to load compute provider entry point %s: %s", entry_point.name, exc)
    return providers


def _load_provider_object(spec: str) -> ComputeProvider:
    module_name, sep, attr = spec.partition(":")
    if not sep or not module_name or not attr:
        raise ValueError(f"Expected module:attribute, got {spec!r}")
    module = importlib.import_module(module_name)
    return _instantiate(getattr(module, attr))


def _instantiate(obj) -> ComputeProvider:
    if isinstance(obj, type):
        return obj()
    candidate = obj()
    return candidate


def _dedupe_providers(providers: list[ComputeProvider]) -> list[ComputeProvider]:
    seen: set[str] = set()
    out: list[ComputeProvider] = []
    for provider in providers:
        provider_id = getattr(provider, "id", "")
        if not provider_id or provider_id in seen:
            continue
        seen.add(provider_id)
        out.append(provider)
    return out
