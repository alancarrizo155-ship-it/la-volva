const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function getMatches(status?: string) {
  const url = status ? `${API_URL}/matches/?status=${status}` : `${API_URL}/matches/`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.json();
  } catch {
    return [];
  }
}

export async function getMatch(id: number) {
  try {
    const res = await fetch(`${API_URL}/matches/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getTeams() {
  const res = await fetch(`${API_URL}/teams/`, { cache: "no-store" });
  return res.json();
}

export async function getPrediction(matchId: number) {
  const res = await fetch(`${API_URL}/predictions/${matchId}`, { cache: "no-store" });
  return res.json();
}

export async function calculateValueBet(matchId: number, odds: Record<string, number>) {
  const res = await fetch(`${API_URL}/predictions/${matchId}/value-bet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(odds),
  });
  return res.json();
}

export async function getMatchMarkets(matchId: number) {
  try {
    // Usa el mismo endpoint que /analizar para garantizar datos idénticos
    const upcoming = await getUpcomingMarkets();
    if (Array.isArray(upcoming)) {
      const found = upcoming.find((m: any) => m.id === matchId);
      if (found) return found;
    }
    // Fallback para partidos terminados (no están en upcoming-markets)
    const res = await fetch(`${API_URL}/predictions/${matchId}/markets`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getUpcomingMarkets() {
  try {
    const res = await fetch(`${API_URL}/matches/upcoming-markets`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function getOddsComparison(matchId: number, market: string) {
  try {
    const res = await fetch(`${API_URL}/matches/${matchId}/odds-comparison?market=${encodeURIComponent(market)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getSimulation(n = 5000) {
  try {
    const res = await fetch(`${API_URL}/simulation/?n=${n}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function refreshSimulation() {
  try {
    const res = await fetch(`${API_URL}/simulation/refresh`, { method: "POST" });
    return res.json();
  } catch {
    return null;
  }
}

export async function updateResults() {
  try {
    const res = await fetch(`${API_URL}/update/results/now`, { method: "POST" });
    return res.json();
  } catch {
    return null;
  }
}
