import argparse
import csv
import json
from pathlib import Path
from statistics import mean


def load_json(path: Path):
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def load_metrics_csv(path: Path):
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def safe_float(value):
    if value is None or value == "":
        return None
    return float(value)


def summarize_metrics(rows):
    if not rows:
        return {}
    process_cpu = [safe_float(r["process_cpu_percent"]) for r in rows]
    ws_mb = [safe_float(r["working_set_mb"]) for r in rows]
    private_mb = [safe_float(r["private_memory_mb"]) for r in rows]
    system_cpu = [safe_float(r["system_cpu_percent"]) for r in rows]
    avail_mb = [safe_float(r["available_memory_mb"]) for r in rows]

    def clean(values):
        return [v for v in values if v is not None]

    process_cpu = clean(process_cpu)
    ws_mb = clean(ws_mb)
    private_mb = clean(private_mb)
    system_cpu = clean(system_cpu)
    avail_mb = clean(avail_mb)

    summary = {}
    if process_cpu:
      summary["process_cpu_avg"] = round(mean(process_cpu), 2)
      summary["process_cpu_peak"] = round(max(process_cpu), 2)
    if ws_mb:
      summary["working_set_peak_mb"] = round(max(ws_mb), 2)
    if private_mb:
      summary["private_memory_peak_mb"] = round(max(private_mb), 2)
    if system_cpu:
      summary["system_cpu_avg"] = round(mean(system_cpu), 2)
      summary["system_cpu_peak"] = round(max(system_cpu), 2)
    if avail_mb:
      summary["available_memory_min_mb"] = round(min(avail_mb), 2)
    return summary


def estimate_inflight(rate, delay_ms, workers):
    if rate is None or delay_ms is None:
        return None
    inflight = rate * (delay_ms / 1000.0)
    if workers:
        return round(inflight, 2)
    return round(inflight, 2)


def build_rows(run_dir: Path):
    rows = []
    for result_path in sorted(run_dir.glob("*/result.json")):
        scenario_dir = result_path.parent
        result = load_json(result_path)
        machine_info_path = run_dir / "machine-info.json"
        machine_info = load_json(machine_info_path) if machine_info_path.exists() else {}
        scenario_path = scenario_dir / "scenario.json"
        scenario = load_json(scenario_path) if scenario_path.exists() else {}
        metrics_summary = summarize_metrics(load_metrics_csv(scenario_dir / "system-metrics.csv"))

        pass_step = result.get("passingStep") or {}
        fail_step = result.get("failingStep") or {}
        workers = scenario.get("workers", result.get("workers"))
        delay_ms = scenario.get("mockDelayMs", result.get("mockDelayMs"))
        highest_pass_rate = result.get("highestConfirmedPassingRate")
        estimated_inflight = estimate_inflight(highest_pass_rate, delay_ms, workers)

        row = {
            "scenario_name": result.get("scenarioName"),
            "machine_name": machine_info.get("machineName"),
            "cpu_logical": machine_info.get("logicalCpuCount"),
            "total_memory_gb": machine_info.get("totalMemoryGB"),
            "workers": workers,
            "mock_delay_ms": delay_ms,
            "mock_error_rate": scenario.get("mockErrorRate", result.get("mockErrorRate")),
            "highest_confirmed_passing_rate": highest_pass_rate,
            "lowest_confirmed_failing_rate": result.get("lowestConfirmedFailingRate"),
            "estimated_inflight_at_pass_rate": estimated_inflight,
            "pass_submit_p95_ms": pass_step.get("submitP95Ms"),
            "pass_completion_p95_ms": pass_step.get("completionP95Ms"),
            "pass_http_failed_rate": pass_step.get("httpFailedRate"),
            "pass_e2e_success_rate": pass_step.get("e2eSuccessRate"),
            "fail_submit_p95_ms": fail_step.get("submitP95Ms"),
            "fail_completion_p95_ms": fail_step.get("completionP95Ms"),
            "fail_http_failed_rate": fail_step.get("httpFailedRate"),
            "fail_e2e_success_rate": fail_step.get("e2eSuccessRate"),
            "process_cpu_avg": metrics_summary.get("process_cpu_avg"),
            "process_cpu_peak": metrics_summary.get("process_cpu_peak"),
            "working_set_peak_mb": metrics_summary.get("working_set_peak_mb"),
            "private_memory_peak_mb": metrics_summary.get("private_memory_peak_mb"),
            "system_cpu_avg": metrics_summary.get("system_cpu_avg"),
            "system_cpu_peak": metrics_summary.get("system_cpu_peak"),
            "available_memory_min_mb": metrics_summary.get("available_memory_min_mb"),
            "status": result.get("status"),
            "scenario_dir": str(scenario_dir),
            "result_json": str(result_path),
        }
        rows.append(row)
    return rows


def format_num(value, digits=2):
    if value is None or value == "":
        return ""
    return f"{float(value):.{digits}f}"


def write_csv(rows, path: Path):
    fieldnames = [
        "scenario_name",
        "machine_name",
        "cpu_logical",
        "total_memory_gb",
        "workers",
        "mock_delay_ms",
        "mock_error_rate",
        "highest_confirmed_passing_rate",
        "lowest_confirmed_failing_rate",
        "estimated_inflight_at_pass_rate",
        "pass_submit_p95_ms",
        "pass_completion_p95_ms",
        "pass_http_failed_rate",
        "pass_e2e_success_rate",
        "fail_submit_p95_ms",
        "fail_completion_p95_ms",
        "fail_http_failed_rate",
        "fail_e2e_success_rate",
        "process_cpu_avg",
        "process_cpu_peak",
        "working_set_peak_mb",
        "private_memory_peak_mb",
        "system_cpu_avg",
        "system_cpu_peak",
        "available_memory_min_mb",
        "status",
        "scenario_dir",
        "result_json",
    ]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(rows, run_dir: Path, title: str, output: Path):
    machine_info_path = run_dir / "machine-info.json"
    machine_info = load_json(machine_info_path) if machine_info_path.exists() else {}
    lines = []
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"- Run directory: `{run_dir}`")
    if machine_info:
        lines.append(f"- Machine: `{machine_info.get('machineName', '')}`")
        lines.append(f"- CPU logical cores: `{machine_info.get('logicalCpuCount', '')}`")
        lines.append(f"- Total memory (GB): `{machine_info.get('totalMemoryGB', '')}`")
        lines.append(f"- OS: `{machine_info.get('osCaption', '')} {machine_info.get('osVersion', '')}`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Scenario | Workers | Delay ms | Highest pass rate (req/s) | Lowest fail rate (req/s) | Est. inflight at pass | Pass completion p95 (ms) | Process CPU peak % | Memory peak MB | Status |")
    lines.append("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
    for row in rows:
        lines.append(
            "| {scenario} | {workers} | {delay} | {pass_rate} | {fail_rate} | {inflight} | {completion_p95} | {cpu_peak} | {mem_peak} | {status} |".format(
                scenario=row["scenario_name"],
                workers=row["workers"],
                delay=row["mock_delay_ms"],
                pass_rate=row["highest_confirmed_passing_rate"] or "",
                fail_rate=row["lowest_confirmed_failing_rate"] or "",
                inflight=format_num(row["estimated_inflight_at_pass_rate"]),
                completion_p95=format_num(row["pass_completion_p95_ms"]),
                cpu_peak=format_num(row["process_cpu_peak"]),
                mem_peak=format_num(row["private_memory_peak_mb"]),
                status=row["status"],
            )
        )
    lines.append("")
    lines.append("## Details")
    lines.append("")
    for row in rows:
        lines.append(f"### {row['scenario_name']}")
        lines.append("")
        lines.append(f"- Workers: `{row['workers']}`")
        lines.append(f"- Mock delay: `{row['mock_delay_ms']}` ms")
        lines.append(f"- Mock error rate: `{row['mock_error_rate']}`")
        lines.append(f"- Highest confirmed passing rate: `{row['highest_confirmed_passing_rate']}` req/s")
        lines.append(f"- Lowest confirmed failing rate: `{row['lowest_confirmed_failing_rate']}` req/s")
        lines.append(f"- Estimated inflight tasks at pass rate: `{format_num(row['estimated_inflight_at_pass_rate'])}`")
        lines.append(f"- Pass completion p95: `{format_num(row['pass_completion_p95_ms'])}` ms")
        lines.append(f"- Pass HTTP failed rate: `{format_num(row['pass_http_failed_rate'], 4)}`")
        lines.append(f"- Pass end-to-end success rate: `{format_num(row['pass_e2e_success_rate'], 4)}`")
        lines.append(f"- Backend process CPU avg/peak: `{format_num(row['process_cpu_avg'])}` / `{format_num(row['process_cpu_peak'])}` %")
        lines.append(f"- Backend private memory peak: `{format_num(row['private_memory_peak_mb'])}` MB")
        lines.append(f"- System CPU avg/peak: `{format_num(row['system_cpu_avg'])}` / `{format_num(row['system_cpu_peak'])}` %")
        lines.append(f"- Minimum available memory: `{format_num(row['available_memory_min_mb'])}` MB")
        lines.append(f"- Result JSON: `{row['result_json']}`")
        lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--title", default="Load Test Report")
    parser.add_argument("--output", required=True)
    parser.add_argument("--csv-output")
    args = parser.parse_args()

    run_dir = Path(args.run_dir)
    rows = build_rows(run_dir)
    output = Path(args.output)
    write_markdown(rows, run_dir, args.title, output)
    if args.csv_output:
        write_csv(rows, Path(args.csv_output))


if __name__ == "__main__":
    main()
