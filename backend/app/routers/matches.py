import time
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from supabase import create_client
from backend.app.config import settings
from backend.app.services.poisson_model import calculate_probabilities
from backend.app.services.odds_fetcher import fetch_wc_odds, extract_best_odds, calculate_ev, blend_with_market, extract_bookmaker_breakdown

router   = APIRouter(prefix="/matches", tags=["Partidos"])
supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

# ── Caché en memoria ─────────────────────────────────────────
_cache: dict = {}

TEAMS_TTL   = 3600   # equipos no cambian → 1 hora
PREDS_TTL   = 120    # predicciones cambian sólo cuando termina un partido → 2 min
MATCHES_TTL = 60     # partidos → 1 min


def _cached(key: str, ttl: int, fn):
    now = time.monotonic()
    if key in _cache and now - _cache[key]["ts"] < ttl:
        return _cache[key]["v"]
    v = fn()
    _cache[key] = {"ts": now, "v": v}
    return v


def invalidate_matches_cache():
    """Llamar después de actualizar resultados."""
    for k in list(_cache.keys()):
        if k != "teams":          # equipos siguen válidos
            _cache.pop(k, None)


def _teams():
    result = supabase.table("teams").select("id, name, country_code, elo_rating").execute()
    return {t["id"]: t for t in (result.data or [])}


def _predictions():
    result = supabase.table("predictions").select(
        "match_id, home_win_prob, draw_prob, away_win_prob, "
        "over25_prob, under25_prob, btts_prob, "
        "predicted_home_goals, predicted_away_goals, "
        "home_elo_used, away_elo_used"
    ).execute()
    return {p["match_id"]: p for p in (result.data or [])}


# ── Endpoints ────────────────────────────────────────────────

@router.get("/")
def get_matches(status: str = None):
    """Devuelve todos los partidos con equipos y predicciones."""
    cache_key = f"matches_{status}"
    now = time.monotonic()

    if cache_key in _cache and now - _cache[cache_key]["ts"] < MATCHES_TTL:
        return _cache[cache_key]["v"]

    teams       = _cached("teams", TEAMS_TTL, _teams)
    predictions = _cached("predictions", PREDS_TTL, _predictions)

    query = (
        supabase.table("matches")
        .select("id, match_date, stage, home_goals, away_goals, status, home_team_id, away_team_id")
        .order("match_date")
    )
    if status:
        query = query.eq("status", status)

    matches = query.execute().data or []
    for m in matches:
        m["home_team"] = teams.get(m.get("home_team_id"))
        m["away_team"] = teams.get(m.get("away_team_id"))
        m["prediction"] = predictions.get(m["id"])

    _cache[cache_key] = {"ts": now, "v": matches}
    return matches


def _wc_form() -> dict:
    """
    Calcula goles marcados y recibidos por cada equipo en los partidos
    ya terminados del torneo. Devuelve {team_id: {"scored": [...], "conceded": [...]}}.
    """
    res = (
        supabase.table("matches")
        .select("home_team_id, away_team_id, home_goals, away_goals")
        .eq("status", "finished")
        .execute()
    )
    form: dict = {}
    for m in (res.data or []):
        hg = m.get("home_goals")
        ag = m.get("away_goals")
        if hg is None or ag is None:
            continue
        h, a = m["home_team_id"], m["away_team_id"]
        for tid in (h, a):
            if tid not in form:
                form[tid] = {"scored": [], "conceded": []}
        form[h]["scored"].append(hg)
        form[h]["conceded"].append(ag)
        form[a]["scored"].append(ag)
        form[a]["conceded"].append(hg)
    return form


@router.get("/upcoming-markets")
def get_upcoming_markets():
    """
    Devuelve probabilidades de todos los mercados para partidos no terminados
    en los próximos 30 días, ajustadas con la forma real del torneo.
    """
    cache_key = "upcoming_markets"
    now_mono  = time.monotonic()

    if cache_key in _cache and now_mono - _cache[cache_key]["ts"] < 120:
        return _cache[cache_key]["v"]

    teams = _cached("teams", TEAMS_TTL, _teams)
    form  = _cached("wc_form", 120, _wc_form)  # se refresca cada 2 min

    cutoff = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    matches_res = (
        supabase.table("matches")
        .select("id, match_date, status, home_team_id, away_team_id")
        .neq("status", "finished")
        .lte("match_date", cutoff)
        .order("match_date")
        .execute()
    )
    matches = matches_res.data or []

    # Odds en tiempo real (caché 1h para no gastar el plan gratuito)
    live_odds = fetch_wc_odds(settings.odds_api_key)

    def form_summary(f):
        if not f or not f["scored"]:
            return None
        return {"games": len(f["scored"]), "scored": sum(f["scored"]), "conceded": sum(f["conceded"])}

    results = []
    for m in matches:
        home = teams.get(m.get("home_team_id"))
        away = teams.get(m.get("away_team_id"))
        if not home or not away:
            continue

        form_home = form.get(m["home_team_id"])
        form_away = form.get(m["away_team_id"])

        probs = calculate_probabilities(
            home["elo_rating"], away["elo_rating"],
            form_home=form_home, form_away=form_away,
            stage=m.get("stage", "group_stage"),
        )

        # Buscar odds reales y mezclar con consenso del mercado
        best_odds = extract_best_odds(live_odds, home["name"], away["name"])
        if best_odds:
            probs = blend_with_market(probs, best_odds)

        MIN_VALUE_BET_PROB = 0.20  # mínimo 20% de probabilidad para recomendar

        value_bets = {}
        if best_odds:
            for market_key, prob_key in [
                ("home",    "home_win_prob"),
                ("draw",    "draw_prob"),
                ("away",    "away_win_prob"),
                ("over25",  "over25_prob"),
                ("under25", "under25_prob"),
            ]:
                odd = best_odds.get(market_key, 0)
                if odd > 1:
                    prob = float(probs[prob_key])
                    ev   = float(calculate_ev(prob, float(odd)))
                    value_bets[market_key] = {"odd": float(odd), "ev": ev, "value": bool(ev > 0 and prob >= MIN_VALUE_BET_PROB)}

        results.append({
            "id":         m["id"],
            "match_date": m["match_date"],
            "status":     m["status"],
            "home_team":  {"name": home["name"], "country_code": home.get("country_code", "")},
            "away_team":  {"name": away["name"], "country_code": away.get("country_code", "")},
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
            "form": {
                "home": form_summary(form_home),
                "away": form_summary(form_away),
            },
            "value_bets":        value_bets,          # mercados con valor detectado
            "odds_available":    best_odds is not None,
            "bookmakers_count":  (best_odds or {}).get("bookmakers_used", 0),
        })

    _cache[cache_key] = {"ts": now_mono, "v": results}
    return results


@router.get("/{match_id}/odds-comparison")
def get_odds_comparison(match_id: int, market: str = "home"):
    """Devuelve las cuotas de cada casa de apuestas para un mercado específico."""
    match_result = (
        supabase.table("matches")
        .select("id, home_team_id, away_team_id")
        .eq("id", match_id)
        .single()
        .execute()
    )
    if not match_result.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    m      = match_result.data
    teams  = _cached("teams", TEAMS_TTL, _teams)
    home   = teams.get(m["home_team_id"])
    away   = teams.get(m["away_team_id"])

    if not home or not away:
        raise HTTPException(status_code=404, detail="Equipos no encontrados")

    live_odds = fetch_wc_odds(settings.odds_api_key)
    breakdown = extract_bookmaker_breakdown(live_odds, home["name"], away["name"], market)

    return {
        "match_id":   match_id,
        "market":     market,
        "home_team":  home["name"],
        "away_team":  away["name"],
        "bookmakers": breakdown,
    }


@router.get("/{match_id}")
def get_match(match_id: int):
    """Devuelve un partido específico con su predicción."""
    cache_key = f"match_{match_id}"
    now = time.monotonic()

    if cache_key in _cache and now - _cache[cache_key]["ts"] < MATCHES_TTL:
        return _cache[cache_key]["v"]

    result = (
        supabase.table("matches")
        .select("id, match_date, stage, home_goals, away_goals, status, home_team_id, away_team_id")
        .eq("id", match_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    match = result.data
    teams = _cached("teams", TEAMS_TTL, _teams)
    match["home_team"] = teams.get(match.get("home_team_id"))
    match["away_team"] = teams.get(match.get("away_team_id"))

    pred_result = (
        supabase.table("predictions")
        .select(
            "home_win_prob, draw_prob, away_win_prob, "
            "predicted_home_goals, predicted_away_goals, "
            "over25_prob, under25_prob, btts_prob, "
            "home_elo_used, away_elo_used"
        )
        .eq("match_id", match_id)
        .execute()
    )
    match["predictions"] = pred_result.data or []

    _cache[cache_key] = {"ts": now, "v": match}
    return match
