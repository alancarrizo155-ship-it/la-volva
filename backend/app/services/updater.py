import httpx
from supabase import Client
from backend.app.config import settings
from backend.app.services.elo_calculator import recalculate_all_elos
from backend.app.services.predictor import predict_all_matches


STATUS_MAP = {
    "FINISHED":   "finished",
    "IN_PLAY":    "live",
    "PAUSED":     "live",
    "HALFTIME":   "live",
    "SCHEDULED":  "scheduled",
    "TIMED":      "scheduled",
    "POSTPONED":  "scheduled",
}


def fetch_and_update_results(supabase: Client) -> dict:
    """
    Pulls latest WC2026 match results from football-data.org,
    updates scores in Supabase, recalculates ELOs and predictions.
    Returns a summary of what changed.
    """
    headers = {"X-Auth-Token": settings.football_data_key}
    updated = 0

    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{settings.football_data_base_url}/competitions/WC/matches",
            headers=headers,
        )
        if resp.status_code != 200:
            return {"error": f"API respondio {resp.status_code}", "updated": 0}

        matches_api = resp.json().get("matches", [])

    # Build index of existing matches by api_football_id
    existing = supabase.table("matches").select("id, api_football_id, status, home_goals, away_goals").execute().data or []
    existing_map = {m["api_football_id"]: m for m in existing if m.get("api_football_id")}

    newly_finished = 0

    for m in matches_api:
        api_id = m.get("id")
        if api_id not in existing_map:
            continue

        db_match  = existing_map[api_id]
        new_status = STATUS_MAP.get(m.get("status", ""), "scheduled")
        score      = m.get("score", {})
        full_time  = score.get("fullTime", {})
        home_goals = full_time.get("home")
        away_goals = full_time.get("away")

        # Only update if something changed
        if (
            db_match["status"] == new_status
            and db_match["home_goals"] == home_goals
            and db_match["away_goals"] == away_goals
        ):
            continue

        was_finished = db_match["status"] == "finished"
        update_data  = {"status": new_status}
        if home_goals is not None:
            update_data["home_goals"] = home_goals
        if away_goals is not None:
            update_data["away_goals"] = away_goals

        supabase.table("matches").update(update_data).eq("id", db_match["id"]).execute()
        updated += 1

        if new_status == "finished" and not was_finished:
            newly_finished += 1

    # If any match newly finished, recalculate ELOs and predictions
    if newly_finished > 0:
        recalculate_all_elos(supabase)
        predict_all_matches()

    # Invalida caché si hubo cualquier cambio
    if updated > 0:
        from backend.app.routers.matches import invalidate_matches_cache
        invalidate_matches_cache()

    return {
        "updated":         updated,
        "newly_finished":  newly_finished,
        "total_from_api":  len(matches_api),
        "elos_recalculated": newly_finished > 0,
    }
