from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from src.domain.models.types import PipelineEdge, PipelineNode, PipelineSpec, Scenario
from src.domain.ports.services import ScenarioRepositoryPort
from src.domain.validation import validate_scenario


def _resolve_document_path(base_dir: Path, relative_path: str) -> Path:
    """Open `relative_path` under base_dir; if missing, try `{stem}.seed{suffix}` beside it."""
    target = (base_dir / relative_path).resolve()
    if target.is_file():
        return target
    seed = target.parent / f"{target.stem}.seed{target.suffix}"
    if seed.is_file():
        return seed
    return target


class FileScenarioRepository(ScenarioRepositoryPort):
    def __init__(self, scenarios_dir: Path) -> None:
        self._scenarios_dir = scenarios_dir

    async def list_scenarios(self) -> list[Scenario]:
        scenarios: list[Scenario] = []
        for file_path in sorted(self._scenarios_dir.glob("*.yaml")):
            scenarios.append(await self._load_file(file_path))
        return scenarios

    async def get_scenario(self, scenario_id: str) -> Scenario:
        for scenario in await self.list_scenarios():
            if scenario.id == scenario_id:
                return scenario
        raise KeyError(f"Scenario '{scenario_id}' not found")

    async def _load_file(self, file_path: Path) -> Scenario:
        with file_path.open("r", encoding="utf-8") as handle:
            raw = yaml.safe_load(handle)
        return self._map_scenario(raw, file_path.parent)

    def _map_scenario(self, raw: dict[str, Any], base_dir: Path) -> Scenario:
        nodes = [
            PipelineNode(
                id=n["id"],
                label=n["label"],
                kind=n["kind"],
                enabled=bool(n.get("enabled", True)),
                config=dict(n.get("config", {})),
            )
            for n in raw["pipeline"]["nodes"]
        ]
        edges = [PipelineEdge(source=e["source"], target=e["target"]) for e in raw["pipeline"]["edges"]]
        docs: list[str] = []
        for relative_path in raw.get("documents", []):
            target = _resolve_document_path(base_dir, relative_path)
            with target.open("r", encoding="utf-8") as doc_file:
                docs.append(doc_file.read())

        scenario = Scenario(
            id=raw["id"],
            name=raw["name"],
            description=raw.get("description", ""),
            pipeline=PipelineSpec(nodes=nodes, edges=edges),
            documents=docs,
            config=dict(raw.get("config", {})),
        )
        validate_scenario(scenario)
        return scenario
