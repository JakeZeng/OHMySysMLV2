# Performance Baseline Report

**Generated**: 2026-09-19T15:19:36.791Z
**Target**: http://localhost:8080
**Scenario**: smoke
**VUs**: 10   **Duration**: 20s

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
| openapi_yaml | 434 | 0 | 0.00% | 21.7 | 2.4 | 2.1 | 4.3 | 7.3 | 14.4 |
| list_templates | 732 | 0 | 0.00% | 36.6 | 1.9 | 1.6 | 3.6 | 6.4 | 14.5 |
| register | 171 | 0 | 0.00% | 8.6 | 14.9 | 12.8 | 26.1 | 35.8 | 44.5 |
| list_projects | 635 | 0 | 0.00% | 31.8 | 2.8 | 2.1 | 7.1 | 12.2 | 23.0 |
| health | 649 | 0 | 0.00% | 32.5 | 4.2 | 2.8 | 13.5 | 23.8 | 44.5 |
| metamodel | 481 | 0 | 0.00% | 24.1 | 2.0 | 1.5 | 4.0 | 9.0 | 14.0 |
| _overall | 3102 | 0 | 0.00% | 155.1 | 3.4 | 2.1 | 12.5 | 21.4 | 44.5 |

## M6 Targets

- [ ] **P95 < 500ms** for read endpoints
- [ ] **P99 < 1s** overall
- [ ] **Fail rate < 1%** under steady-state load

- **openapi_yaml**: ✅ PASS (p95=4.3ms, p99=7.3ms, fail=0.00%)
- **list_templates**: ✅ PASS (p95=3.6ms, p99=6.4ms, fail=0.00%)
- **register**: ✅ PASS (p95=26.1ms, p99=35.8ms, fail=0.00%)
- **list_projects**: ✅ PASS (p95=7.1ms, p99=12.2ms, fail=0.00%)
- **health**: ✅ PASS (p95=13.5ms, p99=23.8ms, fail=0.00%)
- **metamodel**: ✅ PASS (p95=4.0ms, p99=9.0ms, fail=0.00%)
- **_overall**: ✅ PASS (p95=12.5ms, p99=21.4ms, fail=0.00%)

## Overall

✅ **All scenarios pass M6 targets.**
