#!/usr/bin/env python3
"""
Precompute chunk embeddings for a scenario and write JSON the backend can load at retrieve time.

Requires the same embedding model the API uses (default: OLLAMA_EMBED_MODEL or scenario YAML
`embedding_model`). Run from repo root:

  cd backend && PYTHONPATH=. python ../scripts/build_embedding_cache.py --scenario-id medicine-rag

Or:

  PYTHONPATH=backend python scripts/build_embedding_cache.py --scenario-id medicine-rag

Output path comes from scenario `config.embedding_cache` (relative to scenarios/), or --out.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _ensure_backend_path() -> Path:
    backend = _repo_root() / "backend"
    if not (backend / "src").is_dir():
        print("Expected backend/src next to scripts/", file=sys.stderr)
        sys.exit(1)
    sys.path.insert(0, str(backend))
    return backend


async def _main_async() -> int:
    _ensure_backend_path()
    from src.adapters.ollama.ollama_models import OllamaEmbeddingAdapter
    from src.adapters.scenario_fs.repository import FileScenarioRepository
    from src.domain.chunking import chunks_from_scenario, documents_fingerprint

    parser = argparse.ArgumentParser(description="Build embedding cache JSON for a YAML scenario.")
    parser.add_argument(
        "--scenarios-dir",
        type=Path,
        default=_repo_root() / "scenarios",
        help="Directory containing *.yaml scenarios",
    )
    parser.add_argument("--scenario-id", required=True, help="Scenario id (YAML `id:` field)")
    parser.add_argument(
        "--base-url",
        default="http://localhost:11434",
        help="Ollama base URL",
    )
    parser.add_argument(
        "--embedding-model",
        default="",
        help="Ollama embedding model (default: scenario config embedding_model or embeddinggemma:latest)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Override output path (default: scenario config.embedding_cache under scenarios-dir)",
    )
    args = parser.parse_args()

    scenarios_dir = args.scenarios_dir.resolve()
    repo = FileScenarioRepository(scenarios_dir)
    try:
        scenario = await repo.get_scenario(args.scenario_id)
    except KeyError:
        print(f"Unknown scenario id {args.scenario_id!r}", file=sys.stderr)
        return 1

    model = (args.embedding_model or "").strip() or str(
        scenario.config.get("embedding_model") or "embeddinggemma:latest"
    ).strip()
    chunks = chunks_from_scenario(scenario)
    if not chunks:
        print("Scenario has no document chunks; nothing to embed.", file=sys.stderr)
        return 1

    out_rel = str(scenario.config.get("embedding_cache") or "").strip()
    if args.out is not None:
        out_path = args.out.resolve()
    elif out_rel:
        out_path = (scenarios_dir / out_rel).resolve()
    else:
        print(
            "Set config.embedding_cache on the scenario or pass --out PATH.",
            file=sys.stderr,
        )
        return 1

    fp = documents_fingerprint(scenario)
    cs = int(scenario.config.get("chunk_size", 500))
    co = int(scenario.config.get("chunk_overlap", 50))

    print(
        f"Embedding {len(chunks)} chunks with model={model!r} …\n"
        f"  documents_sha256={fp[:16]}… chunk_size={cs} overlap={co}\n"
        f"  -> {out_path}",
        file=sys.stderr,
    )

    embedder = OllamaEmbeddingAdapter(args.base_url, model)
    vectors = await embedder.embed([c.text for c in chunks])
    if len(vectors) != len(chunks):
        print("Embedding count mismatch", file=sys.stderr)
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "scenario_id": scenario.id,
        "embedding_model": model,
        "chunk_size": cs,
        "chunk_overlap": co,
        "documents_sha256": fp,
        "entries": [
            {
                "id": ch.id,
                "source": ch.source,
                "text": ch.text,
                "embedding": vec,
            }
            for ch, vec in zip(chunks, vectors, strict=True)
        ],
    }
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(out_path)
    print(f"Wrote {out_path} ({len(chunks)} vectors)", file=sys.stderr)
    return 0


def main() -> int:
    return asyncio.run(_main_async())


if __name__ == "__main__":
    raise SystemExit(main())
