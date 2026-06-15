from fastapi import APIRouter, HTTPException, BackgroundTasks
from supabase import create_client
from backend.app.config import settings
from backend.app.models.schemas import BetssonOddsIn, ValueBetOut, ValueBetResult
from backend.app.services.poisson_model import calculate_probabilities
from backend.app.services.value_bet import analyze_match
from backend.app.services.predictor import predict_all_matches
from backend.app.services.odds_fetcher import fetch_wc_odds, extract_best_odds, calculate_ev, blend_with_market

router   = APIRouter(prefix="/predictions", tags=["Predicciones"])
supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("/")
def get_all_predictions():
    result = supabase.table("predictions").select(
        "match_id, home_win_prob, draw_prob, away_win_prob, "
        "predicted_home_goals, predicted_away_goals, "
        "over25_prob, under25_prob, btts_prob, home_elo_used, away_elo_used"
    ).execute()
    return result.data


@router.get("/{match_id}")
def get_prediction(match_id: int):
    result = (
        supabase.table("predictions")
        .select("*")
        .eq("match_id", match_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Prediccion no encontrada")
    return result.data


@router.post("/{match_id}/value-bet")
def calculate_value_bet(match_id: int, odds: BetssonOddsIn) -> ValueBetOut:
    """Recibe las odds de Betsson y calcula qué mercados tienen valor."""
    match_result = (
        supabase.table("matches")
        .select("id, home_team_id, away_team_id")
        .eq("id", match_id)
        .single()
        .execute()
    )
    if not match_result.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    m = match_result.data
    teams_result = (
        supabase.table("teams")
        .select("id, name, country_code, elo_rating")
        .in_("id", [m["home_team_id"], m["away_team_id"]])
        .execute()
    )
    teams     = {t["id"]: t for t in (teams_result.data or [])}
    home_team = teams.get(m["home_team_id"])
    away_team = teams.get(m["away_team_id"])

    if not home_team or not away_team:
        raise HTTPException(status_code=404, detail="Equipos no encontrados")

    probs     = calculate_probabilities(home_team["elo_rating"], away_team["elo_rating"])
    odds_dict = {k: v for k, v in odds.model_dump().items() if v is not None}
    markets   = analyze_match(probs, odds_dict)

    supabase.table("value_bets").insert([
        {
            "match_id":        match_id,
            "market":          "1X2" if v["selection"] in ("home", "draw", "away") else "over_under",
            "selection":       v["selection"],
            "betsson_odds":    v["betsson_odds"],
            "our_probability": v["our_probability"],
            "expected_value":  v["expected_value"],
        }
        for v in markets
    ]).execute()

    return ValueBetOut(
        match_id  = match_id,
        home_team = home_team["name"],
        away_team = away_team["name"],
        markets   = [ValueBetResult(**v) for v in markets],
    )


@router.get("/{match_id}/markets")
def get_match_markets(match_id: int):
    """
    Devuelve todas las probabilidades calculables para un partido.
    Usado por la página 'Analizar apuesta de Betsson'.
    """
    # Buscar ELO de los equipos del partido
    match_result = (
        supabase.table("matches")
        .select("id, home_team_id, away_team_id, status, stage")
        .eq("id", match_id)
        .single()
        .execute()
    )
    if not match_result.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    m = match_result.data
    teams_result = (
        supabase.table("teams")
        .select("id, name, country_code, elo_rating")
        .in_("id", [m["home_team_id"], m["away_team_id"]])
        .execute()
    )
    teams     = {t["id"]: t for t in (teams_result.data or [])}
    home_team = teams.get(m["home_team_id"])
    away_team = teams.get(m["away_team_id"])

    if not home_team or not away_team:
        raise HTTPException(status_code=404, detail="Equipos no encontrados")

    probs = calculate_probabilities(
        home_team["elo_rating"], away_team["elo_rating"],
        stage=m.get("stage", "group_stage"),
    )

    # Odds en tiempo real y blend con consenso del mercado
    live_odds = fetch_wc_odds(settings.odds_api_key)
    best_odds = extract_best_odds(live_odds, home_team["name"], away_team["name"])
    if best_odds:
        probs = blend_with_market(probs, best_odds)

    MIN_VALUE_BET_PROB = 0.20  # mínimo 20% de probabilidad para recomendar

    value_bets = {}
    if best_odds:
        for mkt_key, prob_key in [
            ("home",    "home_win_prob"),
            ("draw",    "draw_prob"),
            ("away",    "away_win_prob"),
            ("over25",  "over25_prob"),
            ("under25", "under25_prob"),
        ]:
            odd = best_odds.get(mkt_key, 0)
            if odd > 1:
                prob = float(probs[prob_key])
                ev   = float(calculate_ev(prob, float(odd)))
                value_bets[mkt_key] = {"odd": float(odd), "ev": ev, "value": bool(ev > 0 and prob >= MIN_VALUE_BET_PROB)}

    return {
        "match_id":       match_id,
        "home_team":      home_team["name"],
        "away_team":      away_team["name"],
        "status":         m["status"],
        "markets": {
            "home":        probs["home_win_prob"],
            "draw":        probs["draw_prob"],
            "away":        probs["away_win_prob"],
            "over15":      probs["over15_prob"],
            "over25":      probs["over25_prob"],
            "under25":     probs["under25_prob"],
            "btts":        probs["btts_prob"],
            "btts_over25": probs["btts_over25_prob"],
        },
        "predicted_goals": {
            "home": probs["predicted_home_goals"],
            "away": probs["predicted_away_goals"],
        },
        "value_bets":     value_bets,
        "odds_available": best_odds is not None,
    }


@router.post("/recalculate")
def recalculate(background_tasks: BackgroundTasks):
    background_tasks.add_task(predict_all_matches)
    return {"message": "Recalculando predicciones en segundo plano..."}
