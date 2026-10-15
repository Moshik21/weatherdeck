"""A machine's load against its own norm (docs/feed-spec.md, "Machine strain").

The measure is load per core: `load.runq_per_core` when the source sends it, else `load.l1 / load.cores`. The host keeps
a slow moving mean of it per machine (the baseline) and says a machine is struggling only when every sample for
`sustain_min` minutes was above max(baseline x k, floor). A machine that always runs hot is not struggling; a quiet one
that doubles its load for a quarter of an hour is. Pure functions; the host stores the state (store.py, machine_norms).

Config `health` (defaults in defaults.json): baseline_hours 6, k 1.5, floor 1.0, sustain_min 10, warmup_min 30.
"""
import math


def load_per_core(m):
    load = m.get("load") if isinstance(m.get("load"), dict) else {}
    rq = load.get("runq_per_core")
    if isinstance(rq, (int, float)) and not isinstance(rq, bool) and rq >= 0:
        return float(rq)
    l1, cores = load.get("l1"), load.get("cores")
    if isinstance(l1, (int, float)) and isinstance(cores, int) and cores > 0 and l1 >= 0:
        return float(l1) / cores
    return None


def step(state, value, at, cfg):
    """Fold one sample (value at epoch `at`) into the state {baseline, weight_s, first_at, last_at, above_since}."""
    st = dict(state or {})
    if value is None or (st.get("last_at") is not None and at <= st["last_at"]):
        return st
    thr = threshold(st, cfg)
    if value > thr:
        if st.get("above_since") is None:
            st["above_since"] = at
    else:
        st["above_since"] = None
    tau = max(60.0, float(cfg.get("baseline_hours", 6)) * 3600)
    dt = min(at - st["last_at"], tau) if st.get("last_at") is not None else 0.0
    if st.get("baseline") is None:
        st["baseline"], st["first_at"] = value, at
    else:
        a = 1 - math.exp(-dt / tau)
        st["baseline"] = st["baseline"] + (value - st["baseline"]) * a
    st["last_at"], st["last"] = at, value
    return st


def warm(state, cfg):
    """The baseline has seen warmup_min minutes of samples: before that no machine is called struggling."""
    st = state or {}
    return st.get("first_at") is not None and (st.get("last_at") or 0) - st["first_at"] >= 60 * float(cfg.get("warmup_min", 30))


def threshold(state, cfg):
    floor = float(cfg.get("floor", 1.0))
    base = (state or {}).get("baseline")
    return max(base * float(cfg.get("k", 1.5)), floor) if base is not None and warm(state, cfg) else floor


def verdict(state, now, cfg, max_age_s=900):
    """{state: ok|struggling|unknown, value, baseline, threshold, since, sustained_s}."""
    st = state or {}
    if st.get("last_at") is None or now - st["last_at"] > max_age_s:
        return {"state": "unknown", "value": None, "baseline": st.get("baseline"), "threshold": None, "since": None, "sustained_s": 0}
    need = 60 * float(cfg.get("sustain_min", 10))
    since = st.get("above_since")
    held = (st["last_at"] - since) if since is not None else 0
    return {"state": "struggling" if since is not None and held >= need and warm(st, cfg) else "ok", "value": round(st["last"], 2),
            "warm": warm(st, cfg),
            "baseline": round(st["baseline"], 2) if st.get("baseline") is not None else None,
            "threshold": round(threshold(st, cfg), 2), "since": since, "sustained_s": int(held)}
