"""Seed the app's vector DB (.brain/chroma, collection 'company_kb') from the sample
knowledge base, so /vsearch works immediately for the demo.

    python seed_vectors.py
"""

from __future__ import annotations

from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()

from brain_kb.vectorstore import VectorIndex

SAMPLE = Path(__file__).parent / "infra" / "sample_kb" / "md"


def main() -> None:
    idx = VectorIndex(persist_dir=".brain/chroma", reset=True)  # collection 'company_kb'
    n = 0
    for p in sorted(SAMPLE.rglob("*.md")):
        raw = p.read_text(encoding="utf-8")
        fm, body = {}, raw
        if raw.startswith("---"):
            _, _, rest = raw.partition("---")
            fmtext, _, body = rest.partition("---")
            fm = yaml.safe_load(fmtext) or {}
        if not fm.get("doc_id"):
            continue
        idx.index(fm["doc_id"], body.strip(),
                  {"title": fm.get("title"), "sensitivity": fm.get("sensitivity")})
        print(f"  indexed [{fm.get('sensitivity'):12}] {fm.get('title')}")
        n += 1
    print(f"\n{n} documents embedded into the vector DB (.brain/chroma).")


if __name__ == "__main__":
    main()
