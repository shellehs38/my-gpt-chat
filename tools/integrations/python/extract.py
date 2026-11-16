#!/usr/bin/env python3
"""Isolated read-only document conversion prototype: synthetic data only."""
import argparse
import json
from pathlib import Path
import sys

EXTENSIONS = {".pdf", ".docx", ".xlsx", ".html", ".htm", ".txt", ".md"}
MAX_INPUT_BYTES = 15 * 1024 * 1024
MAX_TEXT_CHARS = 500_000

def convert(backend: str, path: Path) -> str:
    if backend == "markitdown":
        from markitdown import MarkItDown
        return MarkItDown().convert(str(path)).text_content or ""
    if backend == "docling":
        from docling.document_converter import DocumentConverter
        return DocumentConverter().convert(str(path)).document.export_to_markdown()
    raise ValueError("Unsupported backend")

def main() -> int:
    p = argparse.ArgumentParser(description="Read-only converter on synthetic local files")
    p.add_argument("path")
    p.add_argument("--backend", choices=("markitdown", "docling"), default="markitdown")
    args = p.parse_args()
    path = Path(args.path).expanduser()
    if path.is_symlink() or not path.is_file() or path.suffix.lower() not in EXTENSIONS:
        print("ERROR: unsupported file or path", file=sys.stderr)
        return 2
    if path.stat().st_size > MAX_INPUT_BYTES:
        print("ERROR: file exceeds limit", file=sys.stderr)
        return 2
    try:
        text = convert(args.backend, path)
    except Exception:
        print("ERROR: converter failed", file=sys.stderr)
        return 1
    if len(text) > MAX_TEXT_CHARS:
        print("ERROR: extracted text exceeds limit", file=sys.stderr)
        return 2
    print(json.dumps({"backend": args.backend, "characters": len(text), "text": text}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    sys.exit(main())
