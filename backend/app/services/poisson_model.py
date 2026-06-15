import math
from scipy.stats import poisson

AVG_GOALS_WC = 1.35  # promedio histórico de goles por equipo en Mundiales

# Factor de goles por fase: los partidos de eliminación directa son más defensivos
STAGE_GOAL_FACTOR: dict[str, float] = {
    "group_stage": 1.00, "GROUP_STAGE": 1.00, "Group Stage": 1.00,
    "round_of_16": 0.92, "Round of 16": 0.92, "ROUND_OF_16": 0.92,
    "quarter_final": 0.88, "Quarter-final": 0.88, "QUARTER_FINAL": 0.88,
    "semi_final": 0.85, "Semi-final": 0.85, "SEMI_FINAL": 0.85,
    "final": 0.82, "Final": 0.82, "FINAL": 0.82,
}


def expected_goals(elo_home: float, elo_away: float) -> tuple[float, float]:
    elo_diff   = elo_home - elo_away
    adjustment = elo_diff / 100 * 0.12
    return max(0.3, AVG_GOALS_WC + adjustment), max(0.3, AVG_GOALS_WC - adjustment)


def _form_adjusted_lambda(
    lambda_elo: float,
    attack_scored: list[float],   # goles marcados por el equipo atacante en este WC
    defense_conceded: list[float], # goles recibidos por el equipo rival en este WC
) -> float:
    """
    Ajusta el lambda base (ELO) con la forma real del torneo actual.

    Cuantos más partidos jugados, más peso tiene la forma real.
    Con 0 partidos: 100% ELO. Con 2+ partidos: hasta 50% forma real.
    """
    n_att = len(attack_scored)
    n_def = len(defense_conceded)

    if n_att == 0 and n_def == 0:
        return lambda_elo

    # Peso que le damos a la forma real (máximo 50%)
    n_games = max(n_att, n_def)
    w = min(n_games * 0.20, 0.50)

    # Ratio de ataque: cuánto marca el equipo vs el promedio del Mundial
    if n_att > 0:
        actual_scored = sum(attack_scored) / n_att
        attack_ratio  = max(0.4, min(actual_scored / AVG_GOALS_WC, 2.5))
    else:
        attack_ratio = 1.0

    # Ratio de defensa rival: cuánto recibe el rival vs el promedio
    if n_def > 0:
        actual_conceded  = sum(defense_conceded) / n_def
        defense_ratio    = max(0.4, min(actual_conceded / AVG_GOALS_WC, 2.5))
    else:
        defense_ratio = 1.0

    # Estimación basada en datos reales
    actual_lambda = AVG_GOALS_WC * attack_ratio * defense_ratio

    return max(0.3, (1 - w) * lambda_elo + w * actual_lambda)


def goal_matrix(lambda_home: float, lambda_away: float, max_goals: int = 8) -> list[list[float]]:
    matrix = []
    for i in range(max_goals + 1):
        row = []
        for j in range(max_goals + 1):
            p = poisson.pmf(i, lambda_home) * poisson.pmf(j, lambda_away)
            row.append(p)
        matrix.append(row)
    return matrix


def calculate_probabilities(
    elo_home: float,
    elo_away: float,
    form_home: dict | None = None,   # {"scored": [...], "conceded": [...]}
    form_away: dict | None = None,
    stage: str = "group_stage",
) -> dict:
    """
    Calcula probabilidades de todos los mercados para un partido.

    form_home / form_away son dicts con goles marcados y recibidos por cada equipo
    en los partidos que ya jugó en este torneo. Si no hay datos, usa solo ELO.
    """
    lambda_home_elo, lambda_away_elo = expected_goals(elo_home, elo_away)

    # Ajustar lambdas con forma real si está disponible
    if form_home or form_away:
        scored_home   = (form_home   or {}).get("scored",   [])
        conceded_home = (form_home   or {}).get("conceded", [])
        scored_away   = (form_away   or {}).get("scored",   [])
        conceded_away = (form_away   or {}).get("conceded", [])

        # Lambda del local: su ataque vs defensa del rival
        lambda_home = _form_adjusted_lambda(lambda_home_elo, scored_home, conceded_away)
        # Lambda del visitante: su ataque vs defensa del local
        lambda_away = _form_adjusted_lambda(lambda_away_elo, scored_away, conceded_home)
    else:
        lambda_home = lambda_home_elo
        lambda_away = lambda_away_elo

    # Ajuste por fase del torneo: eliminación directa → juego más cerrado
    stage_factor = STAGE_GOAL_FACTOR.get(stage, 1.0)
    lambda_home *= stage_factor
    lambda_away *= stage_factor

    matrix = goal_matrix(lambda_home, lambda_away)
    max_g  = len(matrix) - 1

    home_win = draw = away_win = over15 = over25 = over35 = btts = 0.0

    for i in range(max_g + 1):
        for j in range(max_g + 1):
            p     = matrix[i][j]
            total = i + j
            if i > j:   home_win += p
            elif i == j: draw    += p
            else:        away_win += p
            if total > 1.5: over15 += p
            if total > 2.5: over25 += p
            if total > 3.5: over35 += p
            if i > 0 and j > 0: btts += p

    btts_over25 = sum(
        matrix[i][j]
        for i in range(1, max_g + 1)
        for j in range(1, max_g + 1)
        if i + j > 2
    )

    return {
        "lambda_home":          round(lambda_home, 4),
        "lambda_away":          round(lambda_away, 4),
        "home_win_prob":        round(home_win, 4),
        "draw_prob":            round(draw, 4),
        "away_win_prob":        round(away_win, 4),
        "over15_prob":          round(over15, 4),
        "over25_prob":          round(over25, 4),
        "under25_prob":         round(1 - over25, 4),
        "over35_prob":          round(over35, 4),
        "btts_prob":            round(btts, 4),
        "btts_over25_prob":     round(btts_over25, 4),
        "predicted_home_goals": round(lambda_home, 2),
        "predicted_away_goals": round(lambda_away, 2),
    }
