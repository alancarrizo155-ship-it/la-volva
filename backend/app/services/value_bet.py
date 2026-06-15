"""
Calculadora de Value Bets.

Una apuesta tiene valor cuando:
  EV = (probabilidad_propia × odds_betsson) - 1 > 0

Ejemplo:
  Probabilidad calculada de que gane Argentina: 65%
  Odds de Betsson para Argentina: 2.10
  EV = (0.65 × 2.10) - 1 = 0.365 → hay valor, conviene apostar
"""


def expected_value(probability: float, odds: float) -> float:
    """Calcula el valor esperado de una apuesta."""
    return round((probability * odds) - 1, 4)


def is_value_bet(probability: float, odds: float, min_ev: float = 0.0) -> bool:
    """Retorna True si la apuesta tiene valor positivo."""
    return expected_value(probability, odds) > min_ev


def implied_probability(odds: float) -> float:
    """Convierte odds decimales a probabilidad implícita."""
    return round(1 / odds, 4)


def analyze_match(probabilities: dict, betsson_odds: dict) -> list[dict]:
    """
    Analiza todos los mercados de un partido y detecta value bets.

    probabilities: dict con home_win_prob, draw_prob, away_win_prob, over25_prob, etc.
    betsson_odds:  dict con las odds de Betsson para cada mercado, ej:
                   {"home": 2.10, "draw": 3.20, "away": 3.50, "over25": 1.85}

    Retorna lista de mercados con EV calculado.
    """
    market_map = {
        "home":    "home_win_prob",
        "draw":    "draw_prob",
        "away":    "away_win_prob",
        "over25":  "over25_prob",
        "under25": "under25_prob",
        "over15":  "over15_prob",
        "over35":  "over35_prob",
        "btts":    "btts_prob",
    }

    results = []
    for selection, prob_key in market_map.items():
        if selection not in betsson_odds:
            continue

        odds = betsson_odds[selection]
        prob = probabilities.get(prob_key, 0)
        ev   = expected_value(prob, odds)

        results.append({
            "selection":        selection,
            "our_probability":  prob,
            "betsson_odds":     odds,
            "implied_prob":     implied_probability(odds),
            "expected_value":   ev,
            "is_value_bet":     ev > 0,
        })

    results.sort(key=lambda x: x["expected_value"], reverse=True)
    return results
