from __future__ import annotations

import os
from pathlib import Path

from src.adapters.ollama.ollama_models import OllamaChatAdapter, OllamaEmbeddingAdapter
from src.adapters.rerank.noop_reranker import NoopReranker
from src.adapters.scenario_fs.repository import FileScenarioRepository
from src.adapters.vector.in_memory_index import InMemoryVectorIndex
from src.adapters.vector.tfidf_index import InMemoryTfIdfIndex
from src.usecases.run_rag_pipeline import RunRagPipeline
from src.usecases.scenarios import ListScenarios


class Container:
    def __init__(self) -> None:
        base_dir = Path(__file__).resolve().parents[3]
        scenarios_dir = base_dir / "scenarios"
        ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        embedding_model = os.getenv("OLLAMA_EMBED_MODEL", "embeddinggemma:latest")
        chat_model = os.getenv("OLLAMA_CHAT_MODEL", "gemma3:4b")

        self.scenario_repo = FileScenarioRepository(scenarios_dir)
        self.embeddings = OllamaEmbeddingAdapter(ollama_base_url, embedding_model)
        self.chat = OllamaChatAdapter(ollama_base_url, chat_model)
        self.vector_index = InMemoryVectorIndex(self.embeddings)
        self.tfidf_index = InMemoryTfIdfIndex()
        self.reranker = NoopReranker()

        self.list_scenarios = ListScenarios(self.scenario_repo)
        self.run_rag_pipeline = RunRagPipeline(
            scenarios=self.scenario_repo,
            embeddings=self.embeddings,
            chat=self.chat,
            vector_index=self.vector_index,
            tfidf_index=self.tfidf_index,
            reranker=self.reranker,
            scenarios_dir=scenarios_dir,
            embedding_model_name=embedding_model,
        )
