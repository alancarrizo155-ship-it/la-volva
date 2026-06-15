"""
Obtiene las odds en tiempo real de The Odds API.
Caché de 60 minutos para no gastar los 500 requests/mes del plan gratuito.
"""
import time
import httpx

SPORT_KEY = "soccer_fifa_world_cup"
BASE_URL  = "https://api.the-odds-api.com/v4"
CACHE_TTL = 3600  # 1 hora

_cache: dict = {"data": None, "ts": 0.0}

# Variantes de nombres que usa The Odds API vs nuestros nombres en DB
_NAME_ALIASES: dict[str, str] = {
    "holland":               "netherlands",
    "the netherlands":       "netherlands",
    "ivory coast":           "ivory coast",
    "côte d'ivoire":         "ivory coast",
    "cote d'ivoire":         "ivory coast",
    "united states":         "usa",
    "united states of america": "usa",
    "south korea":           "korea republic",
    "republic of ireland":   "ireland",
    "northern ireland":      "northern ireland",
    "cape verde":            "cape verde islands",
    "cape verde islands":    "cape verde islands",
}

def _normalize(name: str) -> str:
    n = name.lower().strip()
    return _NAME_ALIASES.get(n, n)


def fetch_wc_odds(api_key: str) -> list[dict]:
    """Devuelve lista de eventos con odds. Usa caché de 1h."""
    if not api_key:
        return []

    now = time.monotonic()
    if _cache["data"] is not None and now - _cache["ts"] < CACHE_TTL:
        return _cache["data"]

    try:
        resp = httpx.get(
            f"{BASE_URL}/sports/{SPORT_KEY}/odds/",
            params={
                "apiKey":     api_key,
                "regions":    "eu,uk",
                "markets":    "h2h,totals",
                "oddsFormat": "decimal",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        _cache["data"] = data
        _cache["ts"]   = now
        return data
    except Exception:
        return _cache["data"] or []


def extract_best_odds(events: list[dict], home_name: str, away_name: str) -> dict | None:
    """
    Busca el partido y devuelve las odds de Betsson si están disponibles.
    Si Betsson no tiene un mercado específico, usa la mejor odd disponible.

    Devuelve:
      {
        "home": float, "draw": float, "away": float,
        "over25": float, "under25": float,
        "source": "betsson" | "mercado",
        "bookmakers_used": int,
      }
    """
    h = _normalize(home_name)
    a = _normalize(away_name)

    match_event = None
    for ev in events:
        eh = _normalize(ev.get("home_team", ""))
        ea = _normalize(ev.get("away_team", ""))
        if eh == h and ea == a:
            match_event = ev
            break
        if eh == a and ea == h:
            match_event = ev
            break

    if not match_event:
        return None

    home_team_api = match_event["home_team"]
    away_team_api = match_event["away_team"]

    betsson:  dict = {"home": 0.0, "draw": 0.0, "away": 0.0, "over25": 0.0, "under25": 0.0}
    best_all: dict = {"home": 0.0, "draw": 0.0, "away": 0.0, "over25": 0.0, "under25": 0.0}
    bookmakers_seen = set()

    for bm in match_event.get("bookmakers", []):
        bookmakers_seen.add(bm["key"])
        is_betsson = bm["key"] == "betsson"

        for mkt in bm.get("markets", []):
            if mkt["key"] == "h2h":
                for o in mkt["outcomes"]:
                    p, name = o["price"], o["name"]
                    key = "home" if name == home_team_api else "away" if name == away_team_api else "draw" if name == "Draw" else None
                    if key:
                        best_all[key] = max(best_all[key], p)
                        if is_betsson:
                            betsson[key] = p

            elif mkt["key"] == "totals":
                for o in mkt["outcomes"]:
                    if abs(o.get("point", 0) - 2.5) < 0.01:
                        key = "over25" if o["name"] == "Over" else "under25" if o["name"] == "Under" else None
                        if key:
                            best_all[key] = max(best_all[key], o["price"])
                            if is_betsson:
                                betsson[key] = o["price"]

    # Preferir Betsson; para mercados sin odds de Betsson, usar el mejor disponible
    has_betsson = any(v > 0 for v in betsson.values())
    result = {}
    for k in ("home", "draw", "away", "over25", "under25"):
        result[k] = betsson[k] if betsson[k] > 0 else best_all[k]

    result["source"]           = "betsson" if has_betsson else "mercado"
    result["bookmakers_used"]  = len(bookmakers_seen)
    return result if any(result[k] > 0 for k in ("home", "draw", "away", "over25", "under25")) else None


def extract_bookmaker_breakdown(
    events: list[dict], home_name: str, away_name: str, target_market: str
) -> list[dict]:
    """
    Para un mercado específico, devuelve las cuotas de cada casa de apuestas
    ordenadas de mayor a menor. Máximo 8 casas.
    target_market: "home"|"draw"|"away"|"over25"|"under25"
    """
    h = _normalize(home_name)
    a = _normalize(away_name)

    match_event = None
    for ev in events:
        eh = _normalize(ev.get("home_team", ""))
        ea = _normalize(ev.get("away_team", ""))
        if (eh == h and ea == a) or (eh == a and ea == h):
            match_event = ev
            break

    if not match_event:
        return []

    home_team_api = match_event["home_team"]
    away_team_api = match_event["away_team"]

    results = []
    for bm in match_event.get("bookmakers", []):
        odd = None
        for mkt in bm.get("markets", []):
            if target_market in ("home", "draw", "away") and mkt["key"] == "h2h":
                for o in mkt["outcomes"]:
                    if target_market == "home" and o["name"] == home_team_api:
                        odd = o["price"]
                    elif target_market == "away" and o["name"] == away_team_api:
                        odd = o["price"]
                    elif target_market == "draw" and o["name"] == "Draw":
                        odd = o["price"]
            elif target_market in ("over25", "under25") and mkt["key"] == "totals":
                for o in mkt["outcomes"]:
                    if abs(o.get("point", 0) - 2.5) < 0.01:
                        if target_market == "over25" and o["name"] == "Over":
                            odd = o["price"]
                        elif target_market == "under25" and o["name"] == "Under":
                            odd = o["price"]

        if odd and odd > 1:
            results.append({
                "key":        bm["key"],
                "name":       bm.get("title", bm["key"]),
                "odd":        float(odd),
                "is_betsson": bm["key"] == "betsson",
                "is_best":    False,
            })

    results.sort(key=lambda x: x["odd"], reverse=True)
    if results:
        best = results[0]["odd"]
        for r in results:
            r["is_best"] = r["odd"] == best
    return results[:8]


def calculate_ev(our_prob: float, bookmaker_odd: float) -> float:
    """EV = (prob * odd) - 1. Positivo = value bet."""
    if bookmaker_odd <= 0:
        return -99.0
    return round(our_prob * bookmaker_odd - 1, 4)


def blend_with_market(model_probs: dict, market_odds: dict, alpha: float = 0.40) -> dict:
    """
    Mezcla probabilidades del modelo con las implícitas del mercado (normalizadas por vig).
    alpha = peso del modelo propio (0.40 = 40% modelo, 60% mercado).

    Por qué: el mercado de 40+ casas incorpora info que el ELO no tiene
    (lesiones, alineaciones, forma reciente). El blend mejora la calibración
    sin perder la ventaja estadística del modelo Poisson.
    """
    blended = dict(model_probs)

    # 1X2 — normalizar las 3 cuotas para eliminar el margen de la casa
    raw_h2h = {k: 1.0 / market_odds[k] for k in ("home", "draw", "away") if (market_odds.get(k) or 0) > 1}
    h2h_sum = sum(raw_h2h.values())
    if h2h_sum > 0:
        for mkt, prob_key in [("home", "home_win_prob"), ("draw", "draw_prob"), ("away", "away_win_prob")]:
            if mkt in raw_h2h:
                implied = raw_h2h[mkt] / h2h_sum
                blended[prob_key] = round(alpha * model_probs[prob_key] + (1 - alpha) * implied, 4)

    # Over/Under 2.5 — normalizar par de cuotas
    raw_ou = {k: 1.0 / market_odds[k] for k in ("over25", "under25") if (market_odds.get(k) or 0) > 1}
    ou_sum = sum(raw_ou.values())
    if ou_sum > 0:
        for mkt, prob_key in [("over25", "over25_prob"), ("under25", "under25_prob")]:
            if mkt in raw_ou:
                implied = raw_ou[mkt] / ou_sum
                blended[prob_key] = round(alpha * model_probs[prob_key] + (1 - alpha) * implied, 4)

    return blended
