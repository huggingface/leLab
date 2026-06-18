# Copyright 2025 The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Tests for lelab.utils.hf_auth — whoami caching."""

from __future__ import annotations

from unittest.mock import patch


def test_invalidate_whoami_cache_clears_cached_value() -> None:
    from lelab.utils import hf_auth

    # cached_whoami() delegates to _WHOAMI_API.whoami(cache=True), which stores
    # results in _WHOAMI_API._whoami_cache keyed by token. Patching the whole
    # whoami() method would bypass the cache logic, so we patch _inner_whoami
    # (the actual HTTP call) instead — the real caching code then runs around it.
    # get_token() must return a truthy value so cached_whoami() doesn't short-circuit.
    with (
        patch("lelab.utils.hf_auth.get_token", return_value="hf_fake_token"),
        patch.object(hf_auth._WHOAMI_API, "_inner_whoami", return_value={"name": "alice"}) as spy,
    ):
        # Clear any pre-existing cache entry.
        hf_auth.invalidate_whoami_cache()

        first = hf_auth.cached_whoami()
        second = hf_auth.cached_whoami()
        assert first == {"name": "alice"}
        assert second == {"name": "alice"}
        # Cached: only one upstream call.
        assert spy.call_count == 1

        hf_auth.invalidate_whoami_cache()

        third = hf_auth.cached_whoami()
        assert third == {"name": "alice"}
        # After invalidation, the next call hits whoami again.
        assert spy.call_count == 2


def test_handle_hf_auth_status_returns_dict() -> None:
    from lelab.utils import hf_auth

    # handle_hf_auth_status() delegates through cached_whoami(), so patch the
    # shared HfApi's underlying network call and force a deterministic token.
    with (
        patch("lelab.utils.hf_auth.get_token", return_value="hf_fake_token"),
        patch.object(hf_auth._WHOAMI_API, "_inner_whoami", return_value={"name": "alice", "orgs": []}),
    ):
        hf_auth.invalidate_whoami_cache()
        result = hf_auth.handle_hf_auth_status()
        assert isinstance(result, dict)
        # Real return shape: {"authenticated": bool, "username": ..., "orgs": ..., "login_command": ...}
        assert result["authenticated"] is True
        assert result["username"] == "alice"
        assert "orgs" in result
        assert "login_command" in result
