"""Pure text chunking and scenario document fingerprinting (no IO frameworks)."""

from __future__ import annotations

import hashlib

from src.domain.models.types import DocumentChunk, Scenario


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    if size <= 0:
        return [text]
    out: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        out.append(text[start:end])
        if end == len(text):
            break
        start = max(end - overlap, start + 1)
    return out


def documents_fingerprint(scenario: Scenario) -> str:
    """Stable hash of concatenated scenario document bodies (invalidates embedding cache when corpus changes)."""
    blob = "\0".join(scenario.documents).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def chunks_from_scenario(scenario: Scenario) -> list[DocumentChunk]:
    chunk_size = int(scenario.config.get("chunk_size", 500))
    chunk_overlap = int(scenario.config.get("chunk_overlap", 50))
    chunks: list[DocumentChunk] = []
    idx = 0
    for doc in scenario.documents:
        for piece in chunk_text(doc, chunk_size, chunk_overlap):
            chunks.append(DocumentChunk(id=f"chunk-{idx}", source="scenario", text=piece))
            idx += 1
    return chunks
