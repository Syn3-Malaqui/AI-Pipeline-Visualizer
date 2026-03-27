from __future__ import annotations

from src.domain.models.types import Scenario


def validate_scenario(scenario: Scenario) -> None:
    node_ids = [node.id for node in scenario.pipeline.nodes]
    if len(node_ids) != len(set(node_ids)):
        raise ValueError(f"Scenario '{scenario.id}' has duplicated node ids")
    if not scenario.pipeline.nodes:
        raise ValueError(f"Scenario '{scenario.id}' has an empty pipeline")
