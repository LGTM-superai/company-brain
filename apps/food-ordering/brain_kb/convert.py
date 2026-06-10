"""Convert uploaded files to Markdown for ingestion.

Supports UTF-8 text/Markdown (passthrough), PDF (pypdf text extraction), and DOCX
(python-docx with heading/list/table mapping). Unsupported or non-text files raise
ValueError.
"""

from __future__ import annotations

import io

SUPPORTED = ("md", "markdown", "txt", "text", "pdf", "docx")

_DOCX_MIME = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
)


def _ext(filename: str | None) -> str:
    name = (filename or "").lower()
    return name.rsplit(".", 1)[-1] if "." in name else ""


def to_markdown(filename: str | None, data: bytes, content_type: str | None = None) -> str:
    """Return Markdown text extracted from `data`, dispatched by extension/MIME."""
    ext = _ext(filename)
    if ext == "pdf" or content_type == "application/pdf":
        return _pdf_to_md(data)
    if ext == "docx" or content_type in _DOCX_MIME:
        return _docx_to_md(data)
    # text / markdown
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError(
            "Unsupported file. Use UTF-8 text, Markdown, PDF, or DOCX."
        ) from e


def _pdf_to_md(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for page in reader.pages:
        text = (page.extract_text() or "").strip()
        if text:
            pages.append(text)
    if not pages:
        raise ValueError("No extractable text found in the PDF (it may be scanned/image-only).")
    return "\n\n".join(pages)


def _docx_to_md(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    lines: list[str] = []

    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        style = (p.style.name or "").lower() if p.style else ""
        if style == "title" or style.startswith("heading 1"):
            lines.append(f"# {text}")
        elif style.startswith("heading 2"):
            lines.append(f"## {text}")
        elif style.startswith("heading 3"):
            lines.append(f"### {text}")
        elif style.startswith("heading"):
            lines.append(f"#### {text}")
        elif style.startswith("list"):
            lines.append(f"- {text}")
        else:
            lines.append(text)

    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")

    md = "\n\n".join(lines).strip()
    if not md:
        raise ValueError("No extractable text found in the DOCX.")
    return md
