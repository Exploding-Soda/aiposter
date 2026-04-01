# Current Config Concurrency Summary

## Test Context

- Date: `2026-04-01`
- Machine: `DESKTOP-9L6EJPL`
- CPU logical cores: `6`
- Memory: `16 GB`
- Backend workers: `2`
- Mock AI delay: `5000 ms`
- Mock AI error rate: `0.02`
- Per-step test duration: `15s`
- Stop rule: `http_req_failed <= 5%` and `ai_task_e2e_success >= 90%`

## Conclusion

- Current configuration has a **maximum verified passing concurrency of `850`**.
- The **first verified failing concurrency is `900`**.
- So the practical upper bound measured in this round is **between `850` and `900` concurrent users**.
- `1000` concurrent users did not pass. In the 15-second test window, no task fully completed.

## Concurrency Table

| Concurrency | Pass/Fail | E2E Success | HTTP Fail Rate | Completed | Failed | Completion p95 | Submit p95 | User Feeling |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 10 | Pass | 100.00% | 0.47% | 30 | 0 | 5289 ms | 157 ms | Nearly the same as the 5s mock baseline; feels responsive. |
| 20 | Pass | 96.55% | 0.00% | 56 | 2 | 6617 ms | 690 ms | Noticeable wait, but still usable for many users. |
| 50 | Pass | 97.78% | 0.00% | 88 | 2 | 15567 ms | 1907 ms | Clearly slow; users will feel queueing and lag. |
| 100 | Pass | 98.43% | 0.00% | 125 | 2 | 35331 ms | 1712 ms | Very slow; users will feel the system is backed up. |
| 200 | Pass on hard-limit rule | 98.13% | 0.01% | 157 | 3 | 39976 ms | 2875 ms | System still completes work, but the experience is poor. |
| 400 | Pass | 99.38% | 0.01% | 159 | 1 | 41088 ms | 4189 ms | Service survives, but requests are heavily queued. |
| 800 | Pass | 95.92% | 0.00% | 47 | 2 | 40042 ms | 7457 ms | Barely acceptable only if “survival” is the goal; not good UX. |
| 850 | Pass | 95.36% | 0.01% | 144 | 7 | 41682 ms | 7713 ms | Highest verified passing point; system is at the edge. |
| 900 | Fail | 0.00% | 0.00% | 0 | 0 | n/a | 4090 ms | In the test window, tasks no longer complete; this is beyond the usable limit. |
| 1000 | Fail | 0.00% | 0.00% | 0 | 0 | n/a | 3440 ms | Server still accepts traffic, but work does not finish in time. |

## Interpretation

- If your goal is **system survival**, the current config can be described as:
  `safe through 850`, `fails by 900`.
- If your goal is **reasonable user experience**, the threshold is much lower:
  around `10-20` concurrency still feels acceptable.
- Around `50` concurrency and above, the system still works, but user wait time becomes very obvious.
- At `100+` concurrency, this starts to look like a queueing system rather than an interactive experience.

## Source Runs

- `loadtest-results/concurrency-workers2-20260401/concurrency-limit-result.json`
- `loadtest-results/concurrency-workers2-hardlimit-2-20260401/concurrency-limit-result.json`
- `loadtest-results/concurrency-workers2-refine-20260401/concurrency-limit-result.json`
