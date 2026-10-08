# Copyright 2026 The HuggingFace Inc. team. All rights reserved.
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

"""Build frontend/dist while building the wheel.

Node comes from the nodejs-wheel-binaries build requirement, so installing
LeLab from git needs no Node.js on the user's machine.
"""

import os
import shutil
from pathlib import Path

from nodejs_wheel import executable, npm
from setuptools import setup
from setuptools.command.build_py import build_py

FRONTEND = Path(__file__).parent / "frontend"
# npm scripts like `vite build` start `node` from PATH.
NODE_DIR = executable.ROOT_DIR if os.name == "nt" else os.path.join(executable.ROOT_DIR, "bin")


class BuildFrontend(build_py):
    def run(self):
        # Editable installs are for development, where `lelab --dev` serves the frontend through Vite.
        if not self.editable_mode:
            env = {
                **os.environ,
                "PATH": NODE_DIR + os.pathsep + os.environ.get("PATH", ""),
                # The lockfile resolves from the public registry; a user's mirror may not serve it.
                "npm_config_registry": "https://registry.npmjs.org/",
            }
            for args in (["ci", "--ignore-scripts"], ["run", "build"]):
                if npm(args, cwd=FRONTEND, env=env) != 0:
                    raise SystemExit(f"`npm {' '.join(args)}` failed in {FRONTEND}")
            # uv keeps the source checkout in its cache, so 450 MB of node_modules would stay per version.
            shutil.rmtree(FRONTEND / "node_modules")
        super().run()


setup(cmdclass={"build_py": BuildFrontend})
