from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import time
import uuid

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


ENGINE_VERSION = "1.0.0"
SIMULATION_ONLY = True


@dataclass
class RobotConfig:
    name: str
    robot_type: str
    wheel_radius: float = 0.05
    wheel_base: float = 0.30
    max_speed: float = 1.0
    max_acceleration: float = 0.5
    battery_capacity_wh: float = 100.0
    payload_kg: float = 1.0
    arm_link_1_m: float = 0.5
    arm_link_2_m: float = 0.4
    joint_limit_deg: float = 150.0


@dataclass
class SimulationConfig:
    duration_s: float = 20.0
    timestep_s: float = 0.1
    trials: int = 5
    obstacle_margin_m: float = 0.15
    target_tolerance_m: float = 0.10
    seed: int = 42


class RoboticsEngine:

    def __init__(self, config: dict[str, Any]):
        self.robot = RobotConfig(**config["robot"])
        self.simulation = SimulationConfig(**config.get("simulation", {}))
        self.environment = config.get("environment", {})
        self.objectives = config.get(
            "objectives",
            ["safety", "accuracy", "energy", "completion_time"]
        )

        self.events = []
        self.job_id = str(uuid.uuid4())

    def emit(self, stage: str, status: str, details: dict):
        event = {
            "job_id": self.job_id,
            "sequence": len(self.events) + 1,
            "timestamp": time.time(),
            "stage": stage,
            "status": status,
            "details": details
        }

        self.events.append(event)
        print(json.dumps(event), flush=True)

    def validate(self):
        self.emit("configuration_validation", "running", {})

        if self.robot.robot_type not in {
            "differential_drive",
            "two_link_arm"
        }:
            raise ValueError("Unsupported robot_type")

        if self.simulation.timestep_s <= 0:
            raise ValueError("timestep_s must be positive")

        if self.simulation.duration_s <= 0:
            raise ValueError("duration_s must be positive")

        if self.simulation.trials < 1:
            raise ValueError("trials must be at least 1")

        if self.robot.max_speed <= 0:
            raise ValueError("max_speed must be positive")

        if self.robot.battery_capacity_wh <= 0:
            raise ValueError("Battery capacity must be positive")

        self.emit("configuration_validation", "completed", {
            "robot_type": self.robot.robot_type,
            "simulation_only": True
        })

    def simulate_mobile_robot(self, trial: int):
        start = self.environment.get("start", [0.0, 0.0])
        goal = self.environment.get("goal", [4.0, 4.0])
        obstacles = self.environment.get("obstacles", [])

        x, y = float(start[0]), float(start[1])
        gx, gy = float(goal[0]), float(goal[1])

        dt = self.simulation.timestep_s
        max_steps = int(self.simulation.duration_s / dt)

        path_length = 0.0
        energy_wh = 0.0
        collisions = 0
        completed = False
        previous_x, previous_y = x, y
        step = 0

        for step in range(max_steps):
            dx = gx - x
            dy = gy - y
            distance = math.hypot(dx, dy)

            if distance <= self.simulation.target_tolerance_m:
                completed = True
                break

            speed = min(
                self.robot.max_speed,
                distance / max(dt, 1e-9)
            )

            travel = min(speed * dt, distance)

            x += (dx / distance) * travel
            y += (dy / distance) * travel

            step_distance = math.hypot(
                x - previous_x,
                y - previous_y
            )

            path_length += step_distance
            previous_x, previous_y = x, y

            power_w = (
                20.0
                + 12.0 * speed
                + 2.0 * self.robot.payload_kg
            )

            energy_wh += power_w * dt / 3600.0

            for obstacle in obstacles:
                ox, oy = obstacle["center"]
                radius = obstacle["radius"]

                if math.hypot(x - ox, y - oy) <= (
                    radius + self.simulation.obstacle_margin_m
                ):
                    collisions += 1

            if collisions:
                break

        final_error = math.hypot(gx - x, gy - y)

        return {
            "trial": trial,
            "completed": completed,
            "duration_s": round(step * dt, 3),
            "path_length_m": round(path_length, 4),
            "final_error_m": round(final_error, 4),
            "energy_wh": round(energy_wh, 6),
            "collision_events": collisions,
            "final_position": [round(x, 4), round(y, 4)]
        }

    def simulate_robot_arm(self):
        target = self.environment.get("target", [0.5, 0.4])

        x, y = float(target[0]), float(target[1])
        l1 = self.robot.arm_link_1_m
        l2 = self.robot.arm_link_2_m

        distance = math.hypot(x, y)
        maximum_reach = l1 + l2
        minimum_reach = abs(l1 - l2)

        reachable = minimum_reach <= distance <= maximum_reach

        if not reachable:
            return {
                "reachable": False,
                "target": target,
                "target_distance_m": round(distance, 4),
                "maximum_reach_m": maximum_reach,
                "minimum_reach_m": minimum_reach,
                "joint_angles_deg": None
            }

        cos_theta2 = (
            x * x + y * y - l1 * l1 - l2 * l2
        ) / (2 * l1 * l2)

        cos_theta2 = max(-1.0, min(1.0, cos_theta2))

        theta2 = math.acos(cos_theta2)

        theta1 = (
            math.atan2(y, x)
            - math.atan2(
                l2 * math.sin(theta2),
                l1 + l2 * math.cos(theta2)
            )
        )

        angle1 = math.degrees(theta1)
        angle2 = math.degrees(theta2)

        limit = self.robot.joint_limit_deg

        within_limits = (
            abs(angle1) <= limit
            and abs(angle2) <= limit
        )

        return {
            "reachable": True,
            "within_joint_limits": within_limits,
            "target": target,
            "joint_angles_deg": [
                round(angle1, 4),
                round(angle2, 4)
            ],
            "link_lengths_m": [l1, l2],
            "target_distance_m": round(distance, 4)
        }

    def run_trials(self):
        self.emit("simulation", "running", {
            "robot_type": self.robot.robot_type,
            "trials": self.simulation.trials
        })

        results = []

        if self.robot.robot_type == "differential_drive":
            for trial in range(1, self.simulation.trials + 1):
                result = self.simulate_mobile_robot(trial)
                results.append(result)

                self.emit("simulation_trial", "completed", result)

        elif self.robot.robot_type == "two_link_arm":
            result = self.simulate_robot_arm()
            results.append(result)

            self.emit("simulation_trial", "completed", result)

        self.emit("simulation", "completed", {
            "completed_trials": len(results)
        })

        return results

    @staticmethod
    def mean(values):
        return statistics.mean(values) if values else None

    def evaluate(self, trials):
        self.emit("evaluation", "running", {})

        if self.robot.robot_type == "two_link_arm":
            result = trials[0]

            score = 100.0 if (
                result["reachable"]
                and result.get("within_joint_limits", False)
            ) else 0.0

            evaluation = {
                "score": score,
                "reachable": result["reachable"],
                "within_joint_limits": result.get(
                    "within_joint_limits", False
                )
            }

        else:
            successful = [
                result for result in trials
                if result["completed"]
                and result["collision_events"] == 0
            ]

            completion_rate = len(successful) / len(trials)

            mean_error = self.mean([
                result["final_error_m"] for result in trials
            ])

            mean_energy = self.mean([
                result["energy_wh"] for result in trials
            ])

            mean_path = self.mean([
                result["path_length_m"] for result in trials
            ])

            collision_count = sum(
                result["collision_events"] for result in trials
            )

            score = max(
                0.0,
                min(
                    100.0,
                    completion_rate * 70.0
                    + max(0.0, 20.0 - mean_error * 100.0)
                    + max(0.0, 10.0 - mean_energy)
                    - collision_count * 10.0
                )
            )

            evaluation = {
                "score": round(score, 3),
                "completion_rate": round(completion_rate, 4),
                "mean_error_m": round(mean_error, 4),
                "mean_energy_wh": round(mean_energy, 6),
                "mean_path_length_m": round(mean_path, 4),
                "collision_events": collision_count
            }

        self.emit("evaluation", "completed", evaluation)
        return evaluation

    def create_report(self, trials, evaluation):
        report = {
            "engine_version": ENGINE_VERSION,
            "job_id": self.job_id,
            "simulation_only": SIMULATION_ONLY,
            "robot": asdict(self.robot),
            "simulation": asdict(self.simulation),
            "environment": self.environment,
            "trials": trials,
            "evaluation": evaluation,
            "event_count": len(self.events),
            "limitations": [
                "This is a virtual research simulation.",
                "No physical robot was controlled.",
                "Results depend on the supplied model and assumptions.",
                "Results are not proof of real-world performance.",
                "No hardware safety certification is provided."
            ]
        }

        canonical = json.dumps(
            report,
            sort_keys=True,
            separators=(",", ":")
        )

        report["sha256"] = hashlib.sha256(
            canonical.encode("utf-8")
        ).hexdigest()

        return report

    def run(self):
        self.validate()

        trials = self.run_trials()
        evaluation = self.evaluate(trials)

        report = self.create_report(trials, evaluation)

        output_dir = Path("robotics_results")
        output_dir.mkdir(exist_ok=True)

        report_path = output_dir / f"{self.job_id}.json"
        events_path = output_dir / f"{self.job_id}.events.json"

        report_path.write_text(
            json.dumps(report, indent=2),
            encoding="utf-8"
        )

        events_path.write_text(
            json.dumps(self.events, indent=2),
            encoding="utf-8"
        )

        self.emit("report_generation", "completed", {
            "report": str(report_path),
            "events": str(events_path),
            "sha256": report["sha256"]
        })

        return report


def load_research(path: str):
    source = Path(path)

    if source.stat().st_size > 2_000_000:
        raise ValueError("Research input exceeds 2 MB limit")

    data = json.loads(source.read_text(encoding="utf-8"))

    if not isinstance(data, dict):
        raise ValueError("Research input must be a JSON object")

    if "robot" not in data:
        raise ValueError("Research input requires a robot configuration")

    return data


def main():
    parser = argparse.ArgumentParser(
        description="Virtual Robotics Research Engine"
    )

    parser.add_argument(
        "--config",
        required=True,
        help="Path to robotics research JSON configuration"
    )

    args = parser.parse_args()

    config = load_research(args.config)
    engine = RoboticsEngine(config)
    report = engine.run()

    print("\nFINAL RESEARCH RESULT")
    print(json.dumps(report["evaluation"], indent=2))


if __name__ == "__main__":
    main()
