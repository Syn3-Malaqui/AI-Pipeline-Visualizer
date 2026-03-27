from __future__ import annotations

from src.domain.ports.services import ScenarioRepositoryPort


class ListScenarios:
    def __init__(self, scenarios: ScenarioRepositoryPort) -> None:
        self._scenarios = scenarios

    async def execute(self):
        return await self._scenarios.list_scenarios()


class LoadScenario:
    def __init__(self, scenarios: ScenarioRepositoryPort) -> None:
        self._scenarios = scenarios

    async def execute(self, scenario_id: str):
        return await self._scenarios.get_scenario(scenario_id)
