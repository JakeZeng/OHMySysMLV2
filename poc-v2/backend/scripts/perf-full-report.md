# Performance Baseline Report

**Generated**: 2026-09-19T15:20:10.103Z
**Target**: http://localhost:8080
**Scenario**: full
**VUs**: 15   **Duration**: 25s

## Environment

| Field | Value |
|-------|-------|
| Node  | v22.12.0 |
| OS    | win32 10.0.26200 (x64) |
| CPU   | Intel(R) Core(TM) i5-8350U CPU @ 1.70GHz |
| k6 alternative | Native Node.js http (M6 W3) |

## Summary

| Scenario | Count | Failed | Fail% | RPS | Avg (ms) | p50 | p95 | p99 | max |
|----------|------:|-------:|------:|----:|---------:|----:|----:|----:|----:|
| health | 816 | 0 | 0.00% | 32.6 | 7.9 | 4.3 | 23.3 | 43.0 | 161.4 |
| list_teams | 619 | 0 | 0.00% | 24.8 | 3.9 | 2.3 | 10.0 | 23.8 | 141.3 |
| openapi_json | 604 | 0 | 0.00% | 24.2 | 20.3 | 18.5 | 37.3 | 51.9 | 163.4 |
| list_projects | 555 | 0 | 0.00% | 22.2 | 4.7 | 3.1 | 12.3 | 27.4 | 113.0 |
| metamodel | 552 | 0 | 0.00% | 22.1 | 2.5 | 1.9 | 6.9 | 12.3 | 31.0 |
| openapi_yaml | 563 | 0 | 0.00% | 22.5 | 3.2 | 2.5 | 7.6 | 13.4 | 16.5 |
| list_templates | 805 | 0 | 0.00% | 32.2 | 2.3 | 1.8 | 5.9 | 10.8 | 18.2 |
| metamodel_search | 547 | 0 | 0.00% | 21.9 | 2.6 | 1.9 | 6.8 | 13.1 | 18.0 |
| audit_logs | 275 | 0 | 0.00% | 11.0 | 15.3 | 10.8 | 40.1 | 61.0 | 79.0 |
| create_project | 273 | 0 | 0.00% | 10.9 | 18.9 | 14.8 | 35.6 | 68.1 | 173.3 |
| _overall | 5609 | 0 | 0.00% | 224.4 | 7.1 | 3.0 | 23.2 | 40.7 | 173.3 |

## M6 Targets

- [ ] **P95 < 500ms** for read endpoints
- [ ] **P99 < 1s** overall
- [ ] **Fail rate < 1%** under steady-state load

- **health**: ✅ PASS (p95=23.3ms, p99=43.0ms, fail=0.00%)
- **list_teams**: ✅ PASS (p95=10.0ms, p99=23.8ms, fail=0.00%)
- **openapi_json**: ✅ PASS (p95=37.3ms, p99=51.9ms, fail=0.00%)
- **list_projects**: ✅ PASS (p95=12.3ms, p99=27.4ms, fail=0.00%)
- **metamodel**: ✅ PASS (p95=6.9ms, p99=12.3ms, fail=0.00%)
- **openapi_yaml**: ✅ PASS (p95=7.6ms, p99=13.4ms, fail=0.00%)
- **list_templates**: ✅ PASS (p95=5.9ms, p99=10.8ms, fail=0.00%)
- **metamodel_search**: ✅ PASS (p95=6.8ms, p99=13.1ms, fail=0.00%)
- **audit_logs**: ✅ PASS (p95=40.1ms, p99=61.0ms, fail=0.00%)
- **create_project**: ✅ PASS (p95=35.6ms, p99=68.1ms, fail=0.00%)
- **_overall**: ✅ PASS (p95=23.2ms, p99=40.7ms, fail=0.00%)

## Overall

✅ **All scenarios pass M6 targets.**
