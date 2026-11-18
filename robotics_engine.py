from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import statistics
import time
import uuid

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


ENGINE_VERSION = "1.1.0"
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
    elbow_config: str = "elbow_down"
    rotor_count: int = 4
    cruise_altitude_m: float = 2.0


@dataclass
class SimulationConfig:
    duration_s: float = 20.0
    timestep_s: float = 0.1
    trials: int = 5
    obstacle_margin_m: float = 0.15
    target_tolerance_m: float = 0.10
    seed: int = 42
    planner: str = "straight_line"


class RoboticsEngine:

    def __init__(self, config: dict[str, Any]):
        robot_raw = dict(config["robot"])
        sim_raw = dict(config.get("simulation", {}))
        self.robot = RobotConfig(**robot_raw)
        self.simulation = SimulationConfig(**sim_raw)
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
            "two_link_arm",
            "quadrotor_3d"
        }:
            raise ValueError("Unsupported robot_type")

        if self.simulation.planner not in {
            "straight_line",
            "potential_field"
        }:
            raise ValueError("Unsupported simulation planner")

        if self.robot.elbow_config not in {"elbow_down", "elbow_up"}:
            raise ValueError("Unsupported elbow_config")

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
            "planner": self.simulation.planner,
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
        use_avoidance = self.simulation.planner == "potential_field"
        rng = random.Random(self.simulation.seed + trial)

        path_length = 0.0
        energy_wh = 0.0
        collisions = 0
        completed = False
        previous_x, previous_y = x, y
        step = 0
        trajectory: list[list[float]] = [[round(x, 4), round(y, 4)]]
        min_clearance_m = float("inf")

        for step in range(max_steps):
            dx = gx - x
            dy = gy - y
            distance = math.hypot(dx, dy)

            if distance <= self.simulation.target_tolerance_m:
                completed = True
                break

            ux = dx / distance
            uy = dy / distance

            if use_avoidance:
                # Attractive pull toward goal + smooth repulsive & tangential curl deflection
                rep_x = 0.0
                rep_y = 0.0
                for obstacle in obstacles:
                    ox, oy = float(obstacle["center"][0]), float(obstacle["center"][1])
                    radius = float(obstacle["radius"])
                    safe_r = radius + self.simulation.obstacle_margin_m
                    influence_r = safe_r + 0.65
                    vx = x - ox
                    vy = y - oy
                    d_obs = math.hypot(vx, vy)
                    if 1e-6 < d_obs < influence_r:
                        clearance = max(0.05, d_obs - safe_r)
                        prox = (influence_r - d_obs) / max(0.2, influence_r - safe_r)
                        rep_mag = min(2.2, prox * (0.65 / clearance))
                        nx = vx / d_obs
                        ny = vy / d_obs
                        cross_z = ux * (-ny) - uy * (-nx)
                        sign = 1.0 if cross_z >= 0 else -1.0
                        tx = -ny * sign
                        ty = nx * sign
                        rep_x += (nx * 0.45 + tx * 1.1) * rep_mag
                        rep_y += (ny * 0.45 + ty * 1.1) * rep_mag

                noise_ang = rng.uniform(-0.02, 0.02)
                comb_x = ux + rep_x
                comb_y = uy + rep_y
                norm = math.hypot(comb_x, comb_y)
                if norm > 1e-6:
                    ux = (comb_x / norm) * math.cos(noise_ang) - (comb_y / norm) * math.sin(noise_ang)
                    uy = (comb_x / norm) * math.sin(noise_ang) + (comb_y / norm) * math.cos(noise_ang)

            speed = min(
                self.robot.max_speed,
                distance / max(dt, 1e-9)
            )

            travel = min(speed * dt, distance)

            x += ux * travel
            y += uy * travel

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

            if step % 4 == 0:
                trajectory.append([round(x, 4), round(y, 4)])

            for obstacle in obstacles:
                ox, oy = obstacle["center"]
                radius = obstacle["radius"]
                d_center = math.hypot(x - ox, y - oy)
                min_clearance_m = min(min_clearance_m, d_center - radius)

                if d_center <= (radius + self.simulation.obstacle_margin_m):
                    collisions += 1

            if collisions:
                break

        final_pt = [round(x, 4), round(y, 4)]
        if trajectory[-1] != final_pt:
            trajectory.append(final_pt)

        final_error = math.hypot(gx - x, gy - y)

        result = {
            "trial": trial,
            "planner": self.simulation.planner,
            "completed": completed,
            "duration_s": round(step * dt, 3),
            "path_length_m": round(path_length, 4),
            "final_error_m": round(final_error, 4),
            "energy_wh": round(energy_wh, 6),
            "collision_events": collisions,
            "final_position": final_pt,
            "trajectory": trajectory,
        }
        if min_clearance_m != float("inf"):
            result["min_clearance_m"] = round(min_clearance_m, 4)
        return result

    def _solve_2dof_point(self, tx: float, ty: float):
        l1 = self.robot.arm_link_1_m
        l2 = self.robot.arm_link_2_m
        distance = math.hypot(tx, ty)
        maximum_reach = l1 + l2
        minimum_reach = abs(l1 - l2)
        reachable = minimum_reach <= distance <= maximum_reach

        if not reachable:
            return {
                "reachable": False,
                "within_joint_limits": False,
                "target": [tx, ty],
                "target_distance_m": round(distance, 4),
                "maximum_reach_m": maximum_reach,
                "minimum_reach_m": minimum_reach,
                "joint_angles_deg": None,
            }

        cos_theta2 = (tx * tx + ty * ty - l1 * l1 - l2 * l2) / (2 * l1 * l2)
        cos_theta2 = max(-1.0, min(1.0, cos_theta2))
        theta2 = math.acos(cos_theta2)
        if self.robot.elbow_config == "elbow_up":
            theta2 = -theta2

        theta1 = (
            math.atan2(ty, tx)
            - math.atan2(
                l2 * math.sin(theta2),
                l1 + l2 * math.cos(theta2)
            )
        )
        angle1 = math.degrees(theta1)
        angle2 = math.degrees(theta2)
        limit = self.robot.joint_limit_deg
        within_limits = abs(angle1) <= limit and abs(angle2) <= limit

        elbow_x = l1 * math.cos(theta1)
        elbow_y = l1 * math.sin(theta1)
        eff_x = elbow_x + l2 * math.cos(theta1 + theta2)
        eff_y = elbow_y + l2 * math.sin(theta1 + theta2)

        return {
            "reachable": True,
            "within_joint_limits": within_limits,
            "target": [tx, ty],
            "joint_angles_deg": [round(angle1, 4), round(angle2, 4)],
            "elbow_position": [round(elbow_x, 4), round(elbow_y, 4)],
            "end_effector_position": [round(eff_x, 4), round(eff_y, 4)],
            "link_lengths_m": [l1, l2],
            "target_distance_m": round(distance, 4),
        }

    def simulate_robot_arm(self):
        waypoints = self.environment.get("waypoints")
        if isinstance(waypoints, list) and len(waypoints) > 0:
            pts = [[float(p[0]), float(p[1])] for p in waypoints]
        else:
            target = self.environment.get("target", [0.5, 0.4])
            pts = [[float(target[0]), float(target[1])]]

        solutions = [self._solve_2dof_point(px, py) for px, py in pts]
        primary = solutions[0]
        all_reachable = all(s["reachable"] for s in solutions)
        all_within_limits = all(s.get("within_joint_limits", False) for s in solutions)

        # Build joint-space interpolated frames for smooth SVG/3D kinematics playback
        frames: list[dict[str, Any]] = []
        valid_sols = [s for s in solutions if s["reachable"] and s["joint_angles_deg"]]
        if len(valid_sols) == 1:
            a1, a2 = valid_sols[0]["joint_angles_deg"]
            for idx in range(9):
                frac = idx / 8.0
                t1_rad = math.radians(a1 * frac)
                t2_rad = math.radians(a2 * frac)
                ex = self.robot.arm_link_1_m * math.cos(t1_rad)
                ey = self.robot.arm_link_1_m * math.sin(t1_rad)
                px = ex + self.robot.arm_link_2_m * math.cos(t1_rad + t2_rad)
                py = ey + self.robot.arm_link_2_m * math.sin(t1_rad + t2_rad)
                frames.append({
                    "joint_angles_deg": [round(a1 * frac, 3), round(a2 * frac, 3)],
                    "elbow": [round(ex, 4), round(ey, 4)],
                    "end_effector": [round(px, 4), round(py, 4)],
                })
        elif len(valid_sols) > 1:
            for seg in range(len(valid_sols) - 1):
                s0 = valid_sols[seg]["joint_angles_deg"]
                s1 = valid_sols[seg + 1]["joint_angles_deg"]
                steps = 6
                for idx in range(steps + (1 if seg == len(valid_sols) - 2 else 0)):
                    frac = idx / steps
                    cur_a1 = s0[0] + (s1[0] - s0[0]) * frac
                    cur_a2 = s0[1] + (s1[1] - s0[1]) * frac
                    t1_rad = math.radians(cur_a1)
                    t2_rad = math.radians(cur_a2)
                    ex = self.robot.arm_link_1_m * math.cos(t1_rad)
                    ey = self.robot.arm_link_1_m * math.sin(t1_rad)
                    px = ex + self.robot.arm_link_2_m * math.cos(t1_rad + t2_rad)
                    py = ey + self.robot.arm_link_2_m * math.sin(t1_rad + t2_rad)
                    frames.append({
                        "joint_angles_deg": [round(cur_a1, 3), round(cur_a2, 3)],
                        "elbow": [round(ex, 4), round(ey, 4)],
                        "end_effector": [round(px, 4), round(py, 4)],
                    })

        energy_wh = round((0.008 + 0.004 * self.robot.payload_kg) * max(1, len(pts)), 6)

        if not primary["reachable"] and len(pts) == 1:
            return primary

        return {
            "reachable": all_reachable,
            "within_joint_limits": all_within_limits,
            "elbow_config": self.robot.elbow_config,
            "target": pts[-1],
            "waypoints_count": len(pts),
            "joint_angles_deg": solutions[-1].get("joint_angles_deg"),
            "link_lengths_m": [self.robot.arm_link_1_m, self.robot.arm_link_2_m],
            "target_distance_m": solutions[-1].get("target_distance_m"),
            "energy_wh": energy_wh,
            "trajectory": frames,
        }

    def simulate_quadrotor_3d(self, trial: int):
        start_raw = self.environment.get("start", [0.0, 0.0, 0.5])
        goal_raw = self.environment.get("goal", [4.0, 4.0, 1.5])
        obstacles = self.environment.get("obstacles", [])
        raw_waypoints = self.environment.get("waypoints", [])

        sx, sy = float(start_raw[0]), float(start_raw[1])
        sz = float(start_raw[2]) if len(start_raw) > 2 else 0.5
        gx, gy = float(goal_raw[0]), float(goal_raw[1])
        gz = float(goal_raw[2]) if len(goal_raw) > 2 else 1.5

        nav_points: list[tuple[float, float, float]] = []
        if isinstance(raw_waypoints, list):
            for wp in raw_waypoints:
                nav_points.append((
                    float(wp[0]),
                    float(wp[1]),
                    float(wp[2]) if len(wp) > 2 else self.robot.cruise_altitude_m,
                ))
        nav_points.append((gx, gy, gz))

        dt = self.simulation.timestep_s
        max_steps = int(self.simulation.duration_s / dt)
        use_avoidance = self.simulation.planner == "potential_field"
        rng = random.Random(self.simulation.seed + trial)

        x, y, z = sx, sy, sz
        wp_idx = 0
        path_length = 0.0
        energy_wh = 0.0
        collisions = 0
        completed = False
        step = 0
        trajectory: list[list[float]] = [[round(x, 4), round(y, 4), round(z, 4)]]
        min_clearance_m = float("inf")

        for step in range(max_steps):
            tx, ty, tz = nav_points[wp_idx]
            dx, dy, dz = tx - x, ty - y, tz - z
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)

            if dist <= self.simulation.target_tolerance_m:
                if wp_idx < len(nav_points) - 1:
                    wp_idx += 1
                    continue
                completed = True
                break

            ux, uy, uz = dx / dist, dy / dist, dz / dist

            if use_avoidance:
                rep_x, rep_y, rep_z = 0.0, 0.0, 0.0
                goal_attenuation = min(1.0, dist / 0.65)
                for obstacle in obstacles:
                    ox, oy = float(obstacle["center"][0]), float(obstacle["center"][1])
                    obs_r = float(obstacle["radius"])
                    obs_h = float(obstacle.get("height_m", 3.2))
                    if z <= obs_h + self.simulation.obstacle_margin_m:
                        vx, vy = x - ox, y - oy
                        d_xy = math.hypot(vx, vy)
                        safe_r = obs_r + self.simulation.obstacle_margin_m
                        inf_r = safe_r + 0.65
                        if 1e-6 < d_xy < inf_r:
                            clearance = max(0.05, d_xy - safe_r)
                            prox = (inf_r - d_xy) / max(0.2, inf_r - safe_r)
                            mag = min(2.0, prox * (0.55 / clearance)) * max(0.35, goal_attenuation)
                            nx, ny = vx / d_xy, vy / d_xy
                            sign = 1.0 if (ux * (-ny) - uy * (-nx)) >= 0 else -1.0
                            rep_x += (nx * 0.4 + (-ny * sign) * 1.1) * mag
                            rep_y += (ny * 0.4 + (nx * sign) * 1.1) * mag
                            if z > obs_h * 0.65:
                                rep_z += 0.3 * mag

                jitter_xy = rng.uniform(-0.015, 0.015)
                cx, cy, cz = ux + rep_x + jitter_xy, uy + rep_y - jitter_xy, uz + rep_z
                cn = math.sqrt(cx * cx + cy * cy + cz * cz)
                if cn > 1e-6:
                    ux, uy, uz = cx / cn, cy / cn, cz / cn

            speed = min(self.robot.max_speed, dist / max(dt, 1e-9))
            travel = min(speed * dt, dist)

            prev_x, prev_y, prev_z = x, y, z
            x += ux * travel
            y += uy * travel
            z = max(0.05, z + uz * travel)

            path_length += math.sqrt((x - prev_x) ** 2 + (y - prev_y) ** 2 + (z - prev_z) ** 2)
            hover_w = 115.0 + 38.0 * self.robot.payload_kg
            aero_w = 18.0 * (speed ** 2) + 22.0 * max(0.0, uz * speed)
            energy_wh += (hover_w + aero_w) * dt / 3600.0

            if step % 3 == 0:
                trajectory.append([round(x, 4), round(y, 4), round(z, 4)])

            for obstacle in obstacles:
                ox, oy = float(obstacle["center"][0]), float(obstacle["center"][1])
                obs_r = float(obstacle["radius"])
                obs_h = float(obstacle.get("height_m", 3.2))
                if z <= obs_h + self.simulation.obstacle_margin_m:
                    d_xy = math.hypot(x - ox, y - oy)
                    min_clearance_m = min(min_clearance_m, d_xy - obs_r)
                    if d_xy <= obs_r + self.simulation.obstacle_margin_m:
                        collisions += 1

            if collisions or energy_wh >= self.robot.battery_capacity_wh:
                break

        final_pt = [round(x, 4), round(y, 4), round(z, 4)]
        if trajectory[-1] != final_pt:
            trajectory.append(final_pt)

        final_error = math.sqrt((gx - x) ** 2 + (gy - y) ** 2 + (gz - z) ** 2)
        battery_remaining_pct = max(
            0.0,
            min(100.0, (1.0 - energy_wh / self.robot.battery_capacity_wh) * 100.0)
        )

        result = {
            "trial": trial,
            "planner": self.simulation.planner,
            "completed": completed,
            "duration_s": round(step * dt, 3),
            "path_length_m": round(path_length, 4),
            "final_error_m": round(final_error, 4),
            "energy_wh": round(energy_wh, 6),
            "battery_remaining_pct": round(battery_remaining_pct, 2),
            "collision_events": collisions,
            "final_position": final_pt,
            "trajectory": trajectory,
        }
        if min_clearance_m != float("inf"):
            result["min_clearance_m"] = round(min_clearance_m, 4)
        return result

    def run_trials(self):
        self.emit("simulation", "running", {
            "robot_type": self.robot.robot_type,
            "planner": self.simulation.planner,
            "trials": self.simulation.trials
        })

        results = []

        if self.robot.robot_type == "differential_drive":
            for trial in range(1, self.simulation.trials + 1):
                result = self.simulate_mobile_robot(trial)
                results.append(result)
                self.emit("simulation_trial", "completed", {
                    k: v for k, v in result.items() if k != "trajectory"
                })

        elif self.robot.robot_type == "two_link_arm":
            result = self.simulate_robot_arm()
            results.append(result)
            self.emit("simulation_trial", "completed", {
                k: v for k, v in result.items() if k != "trajectory"
            })

        elif self.robot.robot_type == "quadrotor_3d":
            for trial in range(1, self.simulation.trials + 1):
                result = self.simulate_quadrotor_3d(trial)
                results.append(result)
                self.emit("simulation_trial", "completed", {
                    k: v for k, v in result.items() if k != "trajectory"
                })

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
            if "energy_wh" in result:
                evaluation["energy_wh"] = result["energy_wh"]

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
            if "battery_remaining_pct" in trials[0]:
                evaluation["mean_battery_remaining_pct"] = round(
                    self.mean([r["battery_remaining_pct"] for r in trials]),
                    2,
                )

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
