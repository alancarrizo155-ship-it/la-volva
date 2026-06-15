"""
Motor ELO para selecciones nacionales.

ELO sube si ganás, baja si perdés.
El cambio depende de cuánto se esperaba que ganaras:
  - ganarle a Brasil siendo Qatar sube mucho
  - ganarle a Qatar siendo Brasil sube poco
"""

import math
from supabase import Client

# K-factor para torneos importantes (Mundial)
K = 60

# ELO inicial por equipo basado en rankings FIFA/ELO 2026
INITIAL_ELO = {
    "FRA": 2050, "BRA": 2030, "ENG": 2010, "ESP": 1990, "ARG": 1980,
    "POR": 1950, "NED": 1940, "GER": 1920, "BEL": 1870, "URY": 1850,
    "CRO": 1830, "COL": 1800, "USA": 1780, "MEX": 1760, "MAR": 1750,
    "SEN": 1730, "JPN": 1720, "SUI": 1710, "AUS": 1680, "TUR": 1660,
    "KSA": 1650, "IRN": 1640, "CIV": 1630, "TUN": 1620, "ECU": 1610,
    "KOR": 1600, "AUT": 1590, "SWE": 1580, "NOR": 1570, "CAN": 1560,
    "GHA": 1540, "EGY": 1530, "SCO": 1520, "PAR": 1510, "PAN": 1500,
    "CZE": 1490, "ALG": 1480, "IRQ": 1470, "JOR": 1460, "BIH": 1450,
    "QAT": 1440, "RSA": 1430, "NZL": 1420, "HAI": 1410, "CPV": 1400,
    "UZB": 1390, "CUW": 1380, "COD": 1370,
}


def expected_score(elo_a: float, elo_b: float) -> float:
    """Probabilidad esperada de que A gane contra B."""
    return 1 / (1 + 10 ** ((elo_b - elo_a) / 400))


def new_elo(elo: float, expected: float, actual: float) -> float:
    """Calcula el nuevo ELO después de un partido."""
    return elo + K * (actual - expected)


def update_elos_from_match(
    home_elo: float,
    away_elo: float,
    home_goals: int,
    away_goals: int,
) -> tuple[float, float]:
    """
    Recibe ELO actual y resultado, devuelve (nuevo_elo_home, nuevo_elo_away).
    """
    exp_home = expected_score(home_elo, away_elo)
    exp_away = 1 - exp_home

    if home_goals > away_goals:
        actual_home, actual_away = 1.0, 0.0
    elif home_goals < away_goals:
        actual_home, actual_away = 0.0, 1.0
    else:
        actual_home, actual_away = 0.5, 0.5

    return new_elo(home_elo, exp_home, actual_home), new_elo(away_elo, exp_away, actual_away)


def seed_initial_elos(supabase: Client):
    """
    Actualiza el ELO inicial de cada equipo según INITIAL_ELO.
    Se ejecuta una sola vez al inicio.
    """
    teams = supabase.table("teams").select("id, country_code").execute().data
    for team in teams:
        code = team["country_code"]
        elo  = INITIAL_ELO.get(code, 1500)
        supabase.table("teams").update({"elo_rating": elo}).eq("id", team["id"]).execute()
    print(f"ELO inicial cargado para {len(teams)} equipos.")


def recalculate_all_elos(supabase: Client):
    """
    Recorre todos los partidos jugados y actualiza el ELO de cada equipo.
    Se puede correr después de cada jornada.
    """
    matches = (
        supabase.table("matches")
        .select("id, home_team_id, away_team_id, home_goals, away_goals")
        .eq("status", "finished")
        .order("match_date")
        .execute()
        .data
    )

    teams = supabase.table("teams").select("id, elo_rating").execute().data
    elo_map = {t["id"]: t["elo_rating"] for t in teams}

    for m in matches:
        hid = m["home_team_id"]
        aid = m["away_team_id"]
        hg  = m["home_goals"]
        ag  = m["away_goals"]

        if hg is None or ag is None:
            continue

        h_elo, a_elo = update_elos_from_match(elo_map[hid], elo_map[aid], hg, ag)
        elo_map[hid] = h_elo
        elo_map[aid] = a_elo

        supabase.table("elo_history").upsert({
            "team_id":    hid,
            "elo_rating": h_elo,
            "match_id":   m["id"],
        }).execute()
        supabase.table("elo_history").upsert({
            "team_id":    aid,
            "elo_rating": a_elo,
            "match_id":   m["id"],
        }).execute()

    for team_id, elo in elo_map.items():
        supabase.table("teams").update({"elo_rating": elo}).eq("id", team_id).execute()

    print(f"ELO recalculado para {len(matches)} partidos jugados.")
    return elo_map
