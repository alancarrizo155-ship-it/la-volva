export type Pred = {
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  over25_prob: number;
  under25_prob: number;
  btts_prob: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  home_elo_used?: number;
  away_elo_used?: number;
};

export type Recommendation = {
  market: string;
  label: string;
  prob: number;
  reason: string;
};

export type Confidence = {
  color: "green" | "yellow" | "red";
  label: string;
  borderClass: string;
  badgeClass: string;
  dot: string;
};

const pct = (p: number) => (p * 100).toFixed(0);

export function getConfidence(pred: Pred): Confidence {
  const maxOutcome = Math.max(pred.home_win_prob, pred.draw_prob, pred.away_win_prob);
  if (maxOutcome > 0.60) return {
    color: "green",
    label: "Favorito claro",
    borderClass: "border-l-green-500",
    badgeClass: "bg-green-900/40 text-green-300 border-green-700",
    dot: "🟢",
  };
  if (maxOutcome > 0.47) return {
    color: "yellow",
    label: "Parejo",
    borderClass: "border-l-yellow-500",
    badgeClass: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
    dot: "🟡",
  };
  return {
    color: "red",
    label: "Impredecible",
    borderClass: "border-l-red-500",
    badgeClass: "bg-red-900/40 text-red-300 border-red-700",
    dot: "🔴",
  };
}

export function getFavoriteLabel(pred: Pred, homeName: string, awayName: string): string {
  const max = Math.max(pred.home_win_prob, pred.draw_prob, pred.away_win_prob);
  if (pred.home_win_prob === max && pred.home_win_prob > 0.42) return `Fav: ${homeName}`;
  if (pred.away_win_prob === max && pred.away_win_prob > 0.42) return `Fav: ${awayName}`;
  return "Sin favorito";
}

export function getRecommendations(pred: Pred, homeName: string, awayName: string): Recommendation[] {
  const results: Recommendation[] = [
    {
      market: "home",
      label: `Gana ${homeName}`,
      prob: pred.home_win_prob,
      reason: `${pct(pred.home_win_prob)}% de probabilidad de victoria local`,
    },
    {
      market: "away",
      label: `Gana ${awayName}`,
      prob: pred.away_win_prob,
      reason: `${pct(pred.away_win_prob)}% de probabilidad de victoria visitante`,
    },
  ];
  const goals: Recommendation[] = [
    {
      market: "over25",
      label: "Over 2.5 goles",
      prob: pred.over25_prob,
      reason: `${pct(pred.over25_prob)}% de chances de que caigan 3 o más goles`,
    },
    {
      market: "btts",
      label: "Ambos anotan",
      prob: pred.btts_prob,
      reason: `${pct(pred.btts_prob)}% de chances de que ambos equipos conviertan`,
    },
  ];

  // Mismos umbrales que /analizar: 65% para resultados, 62% para goles
  const bestResult = results.reduce((a, b) => a.prob > b.prob ? a : b);
  const bestGoals  = goals.reduce((a, b) => a.prob > b.prob ? a : b);

  const picks: Recommendation[] = [];
  if (bestResult.prob >= 0.65) picks.push(bestResult);
  if (bestGoals.prob >= 0.62)  picks.push(bestGoals);

  return picks.sort((a, b) => b.prob - a.prob).slice(0, 3);
}

export function getPickScore(pred: Pred): number {
  return Math.max(
    pred.home_win_prob,
    pred.away_win_prob,
    pred.over25_prob,
    pred.under25_prob,
    pred.btts_prob,
  );
}

export function getModelAccuracy(
  pred: Pred,
  homeGoals: number,
  awayGoals: number,
): { correct: boolean; predictedLabel: string; actualLabel: string } {
  const maxProb = Math.max(pred.home_win_prob, pred.draw_prob, pred.away_win_prob);
  const predicted =
    pred.home_win_prob === maxProb ? "home" :
    pred.away_win_prob === maxProb ? "away" : "draw";
  const actual =
    homeGoals > awayGoals ? "home" :
    awayGoals > homeGoals ? "away" : "draw";
  const labels: Record<string, string> = {
    home: "Victoria local", draw: "Empate", away: "Victoria visitante",
  };
  return {
    correct: predicted === actual,
    predictedLabel: labels[predicted],
    actualLabel: labels[actual],
  };
}

export const SELECTION_LABEL: Record<string, string> = {
  home:    "Gana local",
  draw:    "Empate",
  away:    "Gana visitante",
  over25:  "Over 2.5 goles",
  under25: "Under 2.5 goles",
  btts:    "Ambos anotan",
};

// ── Mis apuestas (localStorage) ──────────────────────────────

export type Bet = {
  id: string;
  matchId: number;
  matchLabel: string;
  matchDate: string;
  selection: string;
  selectionLabel: string;
  amount: number;
  odds: number;
  potentialWin: number;
  placedAt: string;
  result: "pending" | "won" | "lost";
};

const BET_KEY = "lavolva_bets";

export function loadBets(): Bet[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(BET_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveBet(bet: Omit<Bet, "id" | "placedAt" | "result">): Bet {
  const bets = loadBets();
  const newBet: Bet = {
    ...bet,
    id: crypto.randomUUID(),
    placedAt: new Date().toISOString(),
    result: "pending",
  };
  localStorage.setItem(BET_KEY, JSON.stringify([newBet, ...bets]));
  return newBet;
}

export function updateBetResult(id: string, result: "won" | "lost"): void {
  const bets = loadBets().map((b) => (b.id === id ? { ...b, result } : b));
  localStorage.setItem(BET_KEY, JSON.stringify(bets));
}

export function deleteBet(id: string): void {
  const bets = loadBets().filter((b) => b.id !== id);
  localStorage.setItem(BET_KEY, JSON.stringify(bets));
}
