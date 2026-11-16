#!/usr/bin/env python3
"""
autonomous_controller.py

Closed-loop autonomous virtual simulation controller wired to the INTEL server
HTTP adapters (/plan, /simulate, /update on port 3000 by default).

IMPORTANT:
This controller operates strictly on configured virtual simulators
(physical_execution=False). It does not control physical laboratory equipment.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import math
import os
import random
import sqlite3
import statistics
import uuid

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import aiohttp


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "autonomous_data"

AUDIT_DB = DATA_DIR / "autonomous_audit.sqlite3"
REPORT_DIR = DATA_DIR / "reports"

POLICY_URL = os.getenv("POLICY_URL", "http://127.0.0.1:3000")
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://127.0.0.1:3000")
MONGODB_URI = os.getenv("MONGODB_URI")

BATCH_SIZE = 16
REPLICATES = 3
MAX_ITERATIONS = 30
MAX_PARALLEL_SIMULATIONS = 4
SIMULATION_TIMEOUT = 300

TARGET_REWARD = 0.75
CONFIDENCE_LEVEL = 0.95
MIN_SUCCESSFUL_REPLICATES = 3
MAX_CONFIDENCE_INTERVAL_WIDTH = 0.20
CONVERGENCE_PATIENCE = 5
RANDOM_SEED = 42

PARAMETER_BOUNDS = {
    "parameter_a": (0.0, 1.0),
    "parameter_b": (0.0, 1.0),
    "parameter_c": (0.0, 1.0),
}

REWARD_WEIGHTS = {
    "yield": 1.0,
    "toxicity": 0.2,
    "cost": 0.05,
}

DATA_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)
random.seed(RANDOM_SEED)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("autonomous_controller")


@dataclass
class Candidate:
    candidate_id: str
    iteration: int
    parameters: dict[str, float]


@dataclass
class SimulationResult:
    candidate_id: str
    replicate: int
    status: str
    metrics: dict[str, float] | None
    error: str | None = None


@dataclass
class Evaluation:
    candidate_id: str
    parameters: dict[str, float]
    replicate_count: int
    mean_reward: float
    standard_deviation: float
    confidence_lower: float
    confidence_upper: float
    confidence_width: float
    metrics_mean: dict[str, float]


@dataclass
class ControllerState:
    run_id: str
    iteration: int = 0
    best_candidate: dict | None = None
    best_reward: float = float("-inf")
    iterations_without_improvement: int = 0
    total_simulations: int = 0
    successful_simulations: int = 0
    failed_simulations: int = 0
    status: str = "initialized"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def validate_parameters(parameters: dict) -> None:
    if set(parameters) != set(PARAMETER_BOUNDS):
        raise ValueError("Candidate parameter keys do not match configured bounds.")
    for name, bounds in PARAMETER_BOUNDS.items():
        value = parameters[name]
        if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise ValueError(f"{name} must be finite numeric.")
        minimum, maximum = bounds
        if not minimum <= value <= maximum:
            raise ValueError(f"{name} is outside configured bounds.")


class AuditStore:
    def __init__(self):
        self.connection = sqlite3.connect(AUDIT_DB)
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                run_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                event TEXT NOT NULL,
                payload TEXT NOT NULL,
                previous_hash TEXT,
                record_hash TEXT NOT NULL
            )
            """
        )
        self.connection.commit()
        self.previous_hash = self._last_hash()
        self.mongo_client = None
        self.mongo_collection = None

    def _last_hash(self):
        row = self.connection.execute(
            "SELECT record_hash FROM audit_events ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return row[0] if row else "GENESIS"

    async def connect_mongodb(self):
        if not MONGODB_URI:
            return
        try:
            from motor.motor_asyncio import AsyncIOMotorClient

            self.mongo_client = AsyncIOMotorClient(
                MONGODB_URI, serverSelectionTimeoutMS=3000
            )
            await self.mongo_client.admin.command("ping")
            self.mongo_collection = self.mongo_client["autonomous_controller"][
                "audit_events"
            ]
        except Exception as exc:
            self.mongo_client = None
            self.mongo_collection = None
            log.warning("MongoDB unavailable; SQLite remains active: %s", exc)

    async def write(self, run_id: str, event: str, payload: dict | None = None):
        record = {
            "event_id": str(uuid.uuid4()),
            "run_id": run_id,
            "timestamp": utc_now(),
            "event": event,
            "payload": json_safe(payload or {}),
            "previous_hash": self.previous_hash,
        }
        record["record_hash"] = stable_hash(record)
        self.connection.execute(
            """
            INSERT INTO audit_events (
                event_id, run_id, timestamp, event, payload, previous_hash, record_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["event_id"],
                record["run_id"],
                record["timestamp"],
                record["event"],
                json.dumps(record["payload"]),
                record["previous_hash"],
                record["record_hash"],
            ),
        )
        self.connection.commit()
        self.previous_hash = record["record_hash"]
        if self.mongo_collection is not None:
            await self.mongo_collection.insert_one(record)

    def verify_chain(self) -> bool:
        rows = self.connection.execute(
            "SELECT event_id, run_id, timestamp, event, payload, previous_hash, record_hash FROM audit_events ORDER BY id ASC"
        ).fetchall()
        previous = "GENESIS"
        for row in rows:
            record = {
                "event_id": row[0],
                "run_id": row[1],
                "timestamp": row[2],
                "event": row[3],
                "payload": json.loads(row[4]),
                "previous_hash": row[5],
            }
            if record["previous_hash"] != previous or stable_hash(record) != row[6]:
                return False
            previous = row[6]
        return True

    def close(self):
        self.connection.close()
        if self.mongo_client:
            self.mongo_client.close()


class Simulator(Protocol):
    async def run(self, candidate: Candidate, replicate: int) -> dict: ...


class HTTPVirtualSimulator:
    def __init__(self, session: aiohttp.ClientSession):
        self.session = session

    async def run(self, candidate: Candidate, replicate: int) -> dict:
        url = f"{SIMULATOR_URL.rstrip('/')}/simulate"
        payload = {
            "candidate_id": candidate.candidate_id,
            "iteration": candidate.iteration,
            "replicate": replicate,
            "parameters": candidate.parameters,
            "mode": "virtual",
            "physical_execution": False,
        }
        timeout = aiohttp.ClientTimeout(total=SIMULATION_TIMEOUT)
        async with self.session.post(url, json=payload, timeout=timeout) as response:
            body = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"Simulator HTTP {response.status}: {body[:500]}")
            result = json.loads(body)
            if result.get("status") not in {"success", "completed"}:
                raise RuntimeError("Simulator did not confirm completion.")
            metrics = result.get("metrics")
            required = {"yield", "toxicity", "cost"}
            if not isinstance(metrics, dict) or not required.issubset(metrics):
                raise RuntimeError("Simulator metrics are incomplete.")
            return {k: float(metrics[k]) for k in required}


class PolicyClient:
    def __init__(self, session: aiohttp.ClientSession):
        self.session = session

    async def request_batch(self, state: ControllerState, batch_size: int) -> list[Candidate]:
        url = f"{POLICY_URL.rstrip('/')}/plan"
        payload = {
            "run_id": state.run_id,
            "iteration": state.iteration,
            "batch_size": batch_size,
            "best_reward": state.best_reward if math.isfinite(state.best_reward) else None,
            "best_candidate": state.best_candidate,
            "parameter_bounds": PARAMETER_BOUNDS,
            "mode": "virtual_simulation",
        }
        async with self.session.post(url, json=payload) as response:
            body = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"Policy HTTP {response.status}: {body[:500]}")
            raw_batch = json.loads(body).get("batch", [])
        candidates = []
        for raw in raw_batch:
            parameters = raw.get("parameters", {})
            validate_parameters(parameters)
            candidates.append(
                Candidate(
                    candidate_id=str(uuid.uuid4()),
                    iteration=state.iteration,
                    parameters=parameters,
                )
            )
        return candidates

    async def update(self, state: ControllerState, evaluation: Evaluation) -> dict:
        url = f"{POLICY_URL.rstrip('/')}/update"
        payload = {
            "run_id": state.run_id,
            "candidate_id": evaluation.candidate_id,
            "parameters": evaluation.parameters,
            "reward": evaluation.mean_reward,
            "confidence_interval": [evaluation.confidence_lower, evaluation.confidence_upper],
            "metrics_mean": evaluation.metrics_mean,
            "replicates": evaluation.replicate_count,
        }
        async with self.session.post(url, json=payload) as response:
            body = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"Policy update failed: {body[:500]}")
            return json.loads(body)


def reward_from_metrics(metrics: dict) -> float:
    return (
        REWARD_WEIGHTS["yield"] * metrics["yield"]
        - REWARD_WEIGHTS["toxicity"] * metrics["toxicity"]
        - REWARD_WEIGHTS["cost"] * metrics["cost"]
    )


def bootstrap_confidence_interval(
    values: list[float],
    confidence: float = CONFIDENCE_LEVEL,
    bootstrap_samples: int = 3000,
    seed: int = RANDOM_SEED,
) -> tuple[float, float]:
    rng = random.Random(seed)
    means = sorted(
        statistics.mean(rng.choice(values) for _ in range(len(values)))
        for _ in range(bootstrap_samples)
    )
    tail = (1.0 - confidence) / 2.0
    return (
        means[max(0, int(tail * len(means)))],
        means[min(len(means) - 1, int((1.0 - tail) * len(means)) - 1)],
    )


def evaluate_candidate(candidate: Candidate, results: list[SimulationResult]) -> Evaluation | None:
    successful = [r for r in results if r.status == "success" and r.metrics is not None]
    if len(successful) < MIN_SUCCESSFUL_REPLICATES:
        return None
    rewards = [reward_from_metrics(r.metrics) for r in successful if r.metrics]
    lower, upper = bootstrap_confidence_interval(
        rewards, seed=RANDOM_SEED + candidate.iteration
    )
    metrics_mean = {
        name: statistics.mean(r.metrics[name] for r in successful if r.metrics)
        for name in ["yield", "toxicity", "cost"]
    }
    return Evaluation(
        candidate_id=candidate.candidate_id,
        parameters=candidate.parameters,
        replicate_count=len(successful),
        mean_reward=statistics.mean(rewards),
        standard_deviation=statistics.stdev(rewards) if len(rewards) > 1 else 0.0,
        confidence_lower=lower,
        confidence_upper=upper,
        confidence_width=upper - lower,
        metrics_mean=metrics_mean,
    )


def lock_criteria_met(evaluation: Evaluation) -> bool:
    return (
        evaluation.mean_reward >= TARGET_REWARD
        and evaluation.confidence_lower >= TARGET_REWARD
        and evaluation.confidence_width <= MAX_CONFIDENCE_INTERVAL_WIDTH
        and evaluation.replicate_count >= MIN_SUCCESSFUL_REPLICATES
    )


async def execute_candidate(
    candidate: Candidate,
    simulator: Simulator,
    semaphore: asyncio.Semaphore,
    audit: AuditStore,
    run_id: str,
) -> list[SimulationResult]:
    async def execute_one(replicate: int):
        async with semaphore:
            try:
                metrics = await simulator.run(candidate, replicate)
                result = SimulationResult(candidate.candidate_id, replicate, "success", metrics)
            except Exception as exc:
                result = SimulationResult(candidate.candidate_id, replicate, "failed", None, str(exc))
            await audit.write(run_id, "simulation_replicate", asdict(result))
            return result

    return await asyncio.gather(*(execute_one(rep) for rep in range(1, REPLICATES + 1)))


def generate_report(state: ControllerState, evaluations: list[Evaluation], audit_valid: bool) -> Path:
    report = {
        "run_id": state.run_id,
        "generated_at": utc_now(),
        "status": state.status,
        "iterations": state.iteration,
        "total_simulations": state.total_simulations,
        "successful_simulations": state.successful_simulations,
        "failed_simulations": state.failed_simulations,
        "best_candidate": state.best_candidate,
        "best_reward": state.best_reward if math.isfinite(state.best_reward) else None,
        "audit_chain_valid": audit_valid,
        "physical_execution": False,
        "evaluations": [asdict(e) for e in evaluations],
    }
    path = REPORT_DIR / f"{state.run_id}.json"
    path.write_text(json.dumps(json_safe(report), indent=2), encoding="utf-8")
    return path


class AutonomousController:
    def __init__(self, audit: AuditStore, simulator: Simulator, policy: PolicyClient):
        self.audit = audit
        self.simulator = simulator
        self.policy = policy
        self.semaphore = asyncio.Semaphore(MAX_PARALLEL_SIMULATIONS)
        self.state = ControllerState(run_id=str(uuid.uuid4()))
        self.evaluations: list[Evaluation] = []

    async def run(self):
        state = self.state
        await self.audit.write(
            state.run_id,
            "controller.started",
            {
                "batch_size": BATCH_SIZE,
                "replicates": REPLICATES,
                "max_iterations": MAX_ITERATIONS,
                "parameter_bounds": PARAMETER_BOUNDS,
                "physical_execution": False,
            },
        )
        try:
            for iteration in range(1, MAX_ITERATIONS + 1):
                state.iteration = iteration
                candidates = await self.policy.request_batch(state, BATCH_SIZE)
                await self.audit.write(
                    state.run_id,
                    "candidate_batch_created",
                    {"iteration": iteration, "candidate_count": len(candidates)},
                )
                batch_results = await asyncio.gather(
                    *(
                        execute_candidate(c, self.simulator, self.semaphore, self.audit, state.run_id)
                        for c in candidates
                    )
                )
                iteration_best = None
                for candidate, results in zip(candidates, batch_results):
                    state.total_simulations += len(results)
                    state.successful_simulations += sum(r.status == "success" for r in results)
                    state.failed_simulations += sum(r.status == "failed" for r in results)
                    evaluation = evaluate_candidate(candidate, results)
                    if evaluation is None:
                        await self.audit.write(
                            state.run_id,
                            "candidate_rejected",
                            {"candidate_id": candidate.candidate_id},
                        )
                        continue
                    self.evaluations.append(evaluation)
                    await self.audit.write(state.run_id, "candidate_evaluated", asdict(evaluation))
                    await self.policy.update(state, evaluation)
                    if iteration_best is None or evaluation.mean_reward > iteration_best.mean_reward:
                        iteration_best = evaluation
                    if evaluation.mean_reward > state.best_reward:
                        state.best_reward = evaluation.mean_reward
                        state.best_candidate = asdict(evaluation)
                        state.iterations_without_improvement = 0
                        await self.audit.write(state.run_id, "new_best_candidate", asdict(evaluation))
                    else:
                        state.iterations_without_improvement += 1
                    if lock_criteria_met(evaluation):
                        state.status = "converged"
                        await self.audit.write(state.run_id, "lock_criteria_met", asdict(evaluation))
                        return await self.finish()
                await self.audit.write(
                    state.run_id,
                    "iteration.completed",
                    {"iteration": iteration, "global_best_reward": state.best_reward},
                )
                if state.iterations_without_improvement >= CONVERGENCE_PATIENCE:
                    state.status = "stopped_no_improvement"
                    await self.audit.write(state.run_id, "controller.stopped", {"reason": "patience"})
                    break
            if state.status == "initialized":
                state.status = "max_iterations_reached"
            return await self.finish()
        except Exception as exc:
            state.status = "failed"
            await self.audit.write(state.run_id, "controller.failed", {"error": str(exc)})
            raise

    async def finish(self):
        audit_valid = self.audit.verify_chain()
        if not audit_valid:
            self.state.status = "audit_integrity_failure"
        report_path = generate_report(self.state, self.evaluations, audit_valid)
        await self.audit.write(
            self.state.run_id,
            "controller.finished",
            {"status": self.state.status, "report": str(report_path), "physical_execution": False},
        )
        return {
            "run_id": self.state.run_id,
            "status": self.state.status,
            "best_reward": self.state.best_reward if math.isfinite(self.state.best_reward) else None,
            "best_candidate": self.state.best_candidate,
            "report": str(report_path),
            "audit_chain_valid": self.audit.verify_chain(),
            "physical_execution": False,
        }


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--replicates", type=int, default=REPLICATES)
    parser.add_argument("--iterations", type=int, default=MAX_ITERATIONS)
    parser.add_argument("--parallel", type=int, default=MAX_PARALLEL_SIMULATIONS)
    args = parser.parse_args()
    global BATCH_SIZE, REPLICATES, MAX_ITERATIONS, MAX_PARALLEL_SIMULATIONS
    BATCH_SIZE, REPLICATES, MAX_ITERATIONS, MAX_PARALLEL_SIMULATIONS = (
        args.batch_size,
        args.replicates,
        args.iterations,
        args.parallel,
    )
    audit = AuditStore()
    try:
        await audit.connect_mongodb()
        timeout = aiohttp.ClientTimeout(total=SIMULATION_TIMEOUT)
        connector = aiohttp.TCPConnector(limit=MAX_PARALLEL_SIMULATIONS)
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            controller = AutonomousController(
                audit, HTTPVirtualSimulator(session), PolicyClient(session)
            )
            result = await controller.run()
            print(json.dumps(json_safe(result), indent=2))
    finally:
        audit.close()


if __name__ == "__main__":
    asyncio.run(main())
