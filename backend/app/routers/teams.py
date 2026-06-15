from fastapi import APIRouter
from supabase import create_client
from backend.app.config import settings

router   = APIRouter(prefix="/teams", tags=["Equipos"])
supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("/")
def get_teams():
    """Devuelve todos los equipos con su ELO actual, ordenados de mayor a menor."""
    result = (
        supabase.table("teams")
        .select("id, name, country_code, elo_rating, group_wc2026")
        .order("elo_rating", desc=True)
        .execute()
    )
    return result.data


@router.get("/{country_code}/matches")
def get_team_matches(country_code: str):
    """Devuelve todos los partidos de un equipo en el Mundial."""
    team = (
        supabase.table("teams")
        .select("id, name")
        .eq("country_code", country_code.upper())
        .single()
        .execute()
    )

    if not team.data:
        return {"error": "Equipo no encontrado"}

    team_id = team.data["id"]

    result = (
        supabase.table("matches")
        .select("""
            id, match_date, stage, home_goals, away_goals, status,
            home_team:teams!matches_home_team_id_fkey(name, country_code),
            away_team:teams!matches_away_team_id_fkey(name, country_code),
            predictions(home_win_prob, draw_prob, away_win_prob, over25_prob)
        """)
        .or_(f"home_team_id.eq.{team_id},away_team_id.eq.{team_id}")
        .order("match_date")
        .execute()
    )

    return {"team": team.data["name"], "matches": result.data}
