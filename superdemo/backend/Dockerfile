# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Container image for the superdemo FastAPI backend, deployed to Cloud Run by
# deploy/deploy-superdemo-app.sh. Dependencies are resolved with uv from the
# committed uv.lock so the image matches local dev.

FROM python:3.12-slim

# Install uv from PyPI. (It was previously copied from ghcr.io/astral-sh/uv, but
# some build environments — including this Cloud Build setup — can't egress to
# ghcr.io, only to Docker Hub + PyPI.) Pinned to the version that generated
# uv.lock; deps themselves are pinned via the lockfile.
RUN pip install --no-cache-dir uv==0.8.3

WORKDIR /app

# Copy bytecode, use plain file copies (avoids hardlink warnings in the layered FS).
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Install dependencies first (cached layer); only runtime deps, no dev group.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Application code.
COPY . .

# Put the synced virtualenv on PATH so we invoke uvicorn directly.
ENV PATH="/app/.venv/bin:$PATH"

# Drop privileges: the app only reads config over the network (Secret Manager)
# and needs no write access or root. Running as a non-root UID is defense in
# depth — see CIS Docker Benchmark 4.1.
RUN useradd --system --uid 10001 --no-create-home appuser
USER 10001

# Cloud Run sets $PORT (default 8080, non-privileged). Shell form so $PORT
# expands; exec so uvicorn becomes PID 1 and receives SIGTERM for graceful
# shutdown.
CMD exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}"
