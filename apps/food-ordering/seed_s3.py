"""Upload the sample-KB fixture documents into the S3 content store, so the s3
backend can serve them (the catalog is seeded from the same fixtures' frontmatter).

    python seed_s3.py
"""

from __future__ import annotations

import os
from pathlib import Path

import boto3
from dotenv import load_dotenv

load_dotenv()

BUCKET = os.environ["KB_S3_BUCKET"]
REGION = os.environ.get("AWS_REGION_NAME") or os.environ.get("AWS_DEFAULT_REGION", "us-west-2")
SAMPLE = Path(__file__).parent / "infra" / "sample_kb" / "md"


def main() -> None:
    s3 = boto3.client("s3", region_name=REGION)
    n = 0
    for p in sorted(SAMPLE.rglob("*.md")):
        raw = p.read_text(encoding="utf-8")
        if not raw.startswith("---"):
            continue  # only the fixtures with frontmatter (the catalog docs)
        key = "md/" + str(p.relative_to(SAMPLE))  # md/<tier>/<domain>/<file>
        s3.put_object(Bucket=BUCKET, Key=key, Body=raw.encode("utf-8"), ContentType="text/markdown")
        print(f"  uploaded s3://{BUCKET}/{key}")
        n += 1
    print(f"\n{n} fixtures uploaded to S3.")


if __name__ == "__main__":
    main()
