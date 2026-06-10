"""Pytest setup: keep the test suite hermetic.

The tests use the local KB backend (mongomock + infra/sample_kb), independent of
whatever `.env` sets for real deployments. We set these before any app import;
python-dotenv's load_dotenv(override=False) then won't clobber them.
"""

import os

os.environ["KB_BACKEND"] = "local"
os.environ.pop("MONGODB_URI", None)
os.environ["KB_DISABLE_VECTOR"] = "1"  # no real Bedrock/Chroma calls during tests
os.environ["KB_DISABLE_CLASSIFY"] = "1"  # no real Bedrock classification during tests
os.environ["BRAIN_SKIP_MODEL_PROBE"] = "1"  # don't probe Bedrock at import during tests
