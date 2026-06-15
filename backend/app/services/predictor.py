"""
Orquestador del motor de predicción.

Usa ELO + Poisson para generar predicciones de todos los partidos
del Mundial y las guarda en la tabla predictions.
"""

import sys, os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from supabase import create_client
from backend.app.config import settings
from backend.app.services.elo_calculator import seed_initial_elos, recalculate_all_elos
from backend.app.services.poisson_model import calculate_probabilities

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)


def predict_all_matches():
    """
    Genera predicciones para todos los partidos del Mundial
    y las guarda en la tabla predictions.
    """
    # 1. Cargar ELO inicial y actualizar con resultados jugados
    print("Cargando ELO inicial...")
    seed_initial_elos(supabase)

    print("Actualizando ELO con partidos jugados...")
    elo_map = recalculate_all_elos(supabase)  # team_db_id → elo_rating

    # 2. Obtener todos los partidos
    matches = (
        supabase.table("matches")
        .select("id, home_team_id, away_team_id, status")
        .execute()
        .data
    )

    print(f"\nGenerando predicciones para {len(matches)} partidos...\n")

    for m in matches:
        hid = m["home_team_id"]
        aid = m["away_team_id"]

        elo_home = elo_map.get(hid, 1500)
        elo_away = elo_map.get(aid, 1500)

        probs = calculate_probabilities(elo_home, elo_away)

        row = {
            "match_id":             m["id"],
            "home_win_prob":        probs["home_win_prob"],
            "draw_prob":            probs["draw_prob"],
            "away_win_prob":        probs["away_win_prob"],
            "predicted_home_goals": probs["predicted_home_goals"],
            "predicted_away_goals": probs["predicted_away_goals"],
            "over25_prob":          probs["over25_prob"],
            "under25_prob":         probs["under25_prob"],
            "btts_prob":            probs["btts_prob"],
            "home_elo_used":        round(elo_home, 2),
            "away_elo_used":        round(elo_away, 2),
            "model_version":        "v1",
        }

        supabase.table("predictions").upsert(row, on_conflict="match_id").execute()

    print(f"Predicciones generadas para {len(matches)} partidos.")


def predict_match(home_team_code: str, away_team_code: str) -> dict:
    """
    Predice un partido específico por código de país.
    Ej: predict_match("ARG", "FRA")
    """
    teams = (
        supabase.table("teams")
        .select("id, name, country_code, elo_rating")
        .in_("country_code", [home_team_code, away_team_code])
        .execute()
        .data
    )

    team_map = {t["country_code"]: t for t in teams}

    if home_team_code not in team_map or away_team_code not in team_map:
        return {"error": f"Equipo no encontrado"}

    home = team_map[home_team_code]
    away = team_map[away_team_code]

    probs = calculate_probabilities(home["elo_rating"], away["elo_rating"])

    return {
        "home_team":  home["name"],
        "away_team":  away["name"],
        "home_elo":   home["elo_rating"],
        "away_elo":   away["elo_rating"],
        **probs,
    }


if __name__ == "__main__":
    predict_all_matches()
