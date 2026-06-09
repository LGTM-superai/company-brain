"""Pytest setup: keep the test suite hermetic.

The tests use the local KB backend (mongomock + infra/sample_kb), independent of
whatever `.env` sets for real deployments. We set these before any app import;
python-dotenv's load_dotenv(override=False) then won't clobber them.
"""

import os

os.environ["KB_BACKEND"] = "local"
os.environ.pop("MONGODB_URI", None)
