import random
import numpy as np
from collections import defaultdict


AVG_GOALS_WC = 1.35


def _lambdas(elo_home: float, elo_away: float):
    adj = (elo_home - elo_away) / 100 * 0.12
    return max(0.3, AVG_GOALS_WC + adj), max(0.3, AVG_GOALS_WC - adj)


def _sim_match(elo_home: float, elo_away: float, knockout: bool = False) -> str:
    lh, la = _lambdas(elo_home, elo_away)
    gh = int(np.random.poisson(lh))
    ga = int(np.random.poisson(la))
    if gh > ga:
        return "home"
    if ga > gh:
        return "away"
    # Draw in knockout → random penalty winner (slight home advantage by ELO)
    if knockout:
        p_home = 0.5 + (elo_home - elo_away) / 4000
        return "home" if random.random() < p_home else "away"
    return "draw"


def _sim_group(teams: list) -> tuple[list, dict]:
    """Round-robin. Returns (teams_sorted_by_standing, points_dict)."""
    pts = defaultdict(int)
    gf  = defaultdict(int)
    ga  = defaultdict(int)

    for i in range(len(teams)):
        for j in range(i + 1, len(teams)):
            h, a = teams[i], teams[j]
            lh, la = _lambdas(h["elo_rating"], a["elo_rating"])
            gh = int(np.random.poisson(lh))
            ga_s = int(np.random.poisson(la))
            gf[h["id"]] += gh;  ga[h["id"]] += ga_s
            gf[a["id"]] += ga_s; ga[a["id"]] += gh
            if gh > ga_s:
                pts[h["id"]] += 3
            elif ga_s > gh:
                pts[a["id"]] += 3
            else:
                pts[h["id"]] += 1
                pts[a["id"]] += 1

    sorted_teams = sorted(
        teams,
        key=lambda t: (pts[t["id"]], gf[t["id"]] - ga[t["id"]], gf[t["id"]], random.random()),
        reverse=True,
    )
    return sorted_teams, dict(pts)


def _sim_knockout_round(teams: list) -> list:
    """Single elimination round. Pairs consecutive teams, returns winners."""
    random.shuffle(teams)
    winners = []
    for i in range(0, len(teams) - 1, 2):
        h, a = teams[i], teams[i + 1]
        result = _sim_match(h["elo_rating"], a["elo_rating"], knockout=True)
        winners.append(h if result == "home" else a)
    return winners


def _find_groups(gs_matches: list, team_map: dict) -> list[list]:
    """Build groups from group-stage match schedule using graph connectivity."""
    adj = defaultdict(set)
    for m in gs_matches:
        h, a = m["home_team_id"], m["away_team_id"]
        adj[h].add(a)
        adj[a].add(h)

    visited: set = set()
    groups: list = []
    for tid in sorted(adj):
        if tid not in visited:
            group_ids: list = []
            stack = [tid]
            while stack:
                t = stack.pop()
                if t not in visited:
                    visited.add(t)
                    group_ids.append(t)
                    stack.extend(adj[t] - visited)
            group_teams = [team_map[i] for i in group_ids if i in team_map]
            if group_teams:
                groups.append(group_teams)
    return groups


def run_simulation(supabase, n: int = 5000) -> dict:
    """
    Simulate the full WC2026 tournament n times.
    Returns champion / finalist / semifinalist probabilities per team.
    """
    teams_raw = supabase.table("teams").select("id, name, country_code, elo_rating").execute().data or []
    team_map  = {t["id"]: t for t in teams_raw}

    gs_matches = (
        supabase.table("matches")
        .select("home_team_id, away_team_id")
        .eq("stage", "GROUP_STAGE")
        .execute().data or []
    )

    groups = _find_groups(gs_matches, team_map)

    champion_c    = defaultdict(int)
    finalist_c    = defaultdict(int)
    semifinal_c   = defaultdict(int)

    for _ in range(n):
        # ── Group stage ──────────────────────────────────────
        top2       = []
        third_pool = []

        for group in groups:
            standing, pts = _sim_group(group)
            top2.extend(standing[:2])
            if len(standing) > 2:
                third_pool.append({**standing[2], "_pts": pts.get(standing[2]["id"], 0)})

        # Best 8 third-place teams
        third_pool.sort(key=lambda t: t.get("_pts", 0), reverse=True)
        advancing = top2 + third_pool[:8]   # 24 + 8 = 32 teams

        # ── Knockout: 32 → 16 → 8 → 4 (SF) → 2 (F) → 1 ─────
        random.shuffle(advancing)
        r16     = _sim_knockout_round(advancing)   # 32 → 16
        qf_in   = _sim_knockout_round(r16)         # 16 → 8  (QF entrants)
        sf_in   = _sim_knockout_round(qf_in)       # 8  → 4  (SF entrants)

        for t in sf_in:
            semifinal_c[t["id"]] += 1

        finalists = _sim_knockout_round(sf_in)     # 4  → 2  (finalists)
        for t in finalists:
            finalist_c[t["id"]] += 1

        # Final
        if len(finalists) == 2:
            res  = _sim_match(finalists[0]["elo_rating"], finalists[1]["elo_rating"], knockout=True)
            champ = finalists[0] if res == "home" else finalists[1]
            champion_c[champ["id"]] += 1

    results = [
        {
            "team":           t["name"],
            "country_code":   t["country_code"],
            "elo_rating":     t["elo_rating"],
            "champion_prob":  round(champion_c[t["id"]] / n, 4),
            "finalist_prob":  round(finalist_c[t["id"]] / n, 4),
            "semifinal_prob": round(semifinal_c[t["id"]] / n, 4),
        }
        for t in teams_raw
        if champion_c[t["id"]] + finalist_c[t["id"]] + semifinal_c[t["id"]] > 0
    ]
    results.sort(key=lambda x: x["champion_prob"], reverse=True)
    return {"simulations": n, "teams": results}
