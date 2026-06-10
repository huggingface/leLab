from __future__ import annotations

import tomllib
from pathlib import Path


def test_lelab_fork_depends_on_seeed_cloud_plugin_by_default() -> None:
    pyproject = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())

    assert (
        "lelab-compute-seeed-cloud @ git+https://github.com/Seeed-Solution/lelab-compute-seeed-cloud.git"
        in pyproject["project"]["dependencies"]
    )
