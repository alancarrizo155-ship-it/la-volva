"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getUpcomingMarkets } from "@/lib/api";
import { teamName } from "@/lib/teamNames";

type Markets = {
  home: number; draw: number; away: number;
  over15: number; over25: number; under25: number;
  btts: number; btts_over25: number;
};

type FormSummary = { games: number; scored: number; conceded: number } | null;

type ValueBet = { odd: number; ev: number; value: boolean };

type MatchData = {
  id: number;
  match_date: string;
  status: string;
  home_team: { name: string; country_code: string };
  away_team: { name: string; country_code: string };
  markets: Markets;
  predicted_goals: { home: number; away: number };
  form?: { home: FormSummary; away: FormSummary };
  value_bets?: Record<string, ValueBet>;
  odds_available?: boolean;
  bookmakers_count?: number;
};

type Pick = {
  bet: string;
  marketKey: string;
  prob: number;
  fairOdd: number;
  why: string;
  confidence: "alta" | "media" | "baja" | "impredecible";
  alternatives: { label: string; prob: number; marketKey: string }[];
};

type CombinadaLeg = {
  matchLabel: string;
  matchId: number;
  bet: string;
  prob: number;
  marketOdd: number | null;
};

type Combinada = {
  size: number;
  legs: CombinadaLeg[];
  combinedProb: number;
  fairOdd: number;
  marketOdd: number | null;
  ev: number | null;
};

// ── Lógica de picks ───────────────────────────────────────────

function buildPick(m: MatchData): Pick {
  const { markets } = m;
  const home = m.home_team.name;
  const away = m.away_team.name;

  const candidates = [
    { label: `Gana ${teamName(home)}`, marketKey: "home",   prob: markets.home },
    { label: "Empate",                  marketKey: "draw",   prob: markets.draw },
    { label: `Gana ${teamName(away)}`, marketKey: "away",   prob: markets.away },
    ...(markets.over25 >= 0.58 ? [{ label: "Más de 2.5 goles", marketKey: "over25", prob: markets.over25 }] : []),
    ...(markets.btts   >= 0.58 ? [{ label: "Ambos anotan",     marketKey: "btts",   prob: markets.btts   }] : []),
  ].sort((a, b) => b.prob - a.prob);

  const top  = candidates[0];
  const alts = candidates.slice(1).filter(c => c.prob >= 0.20).slice(0, 2);

  let confidence: "alta" | "media" | "baja" | "impredecible";
  if      (top.prob >= 0.70) confidence = "alta";
  else if (top.prob >= 0.55) confidence = "media";
  else if (top.prob >= 0.40) confidence = "baja";
  else                       confidence = "impredecible";

  const isGoals = top.marketKey === "over25" || top.marketKey === "btts";
  const team    = top.label.replace("Gana ", "");

  const why: Record<string, string> = {
    alta:         isGoals ? `El modelo espera un partido con goles — alta probabilidad de ${top.label.toLowerCase()}`
                           : `${team} es el favorito claro según el modelo`,
    media:        isGoals ? `El modelo da ventaja a que haya goles, aunque el partido puede ser cerrado`
                           : `El modelo da ventaja a ${team}, aunque hay incertidumbre`,
    baja:         isGoals ? `Ligera ventaja en goles — partido parejo`
                           : `Ligera ventaja para ${team} — partido parejo`,
    impredecible: `El modelo no detecta un favorito claro en este partido`,
  };

  return {
    bet:        top.label,
    marketKey:  top.marketKey,
    prob:       top.prob,
    fairOdd:    1 / top.prob,
    why:        why[confidence],
    confidence,
    alternatives: alts,
  };
}

// ── Lógica de combinadas ──────────────────────────────────────

function buildCombinadas(matches: MatchData[]): Combinada[] {
  const legs: CombinadaLeg[] = [];

  for (const m of matches) {
    if (!m.markets) continue;
    const pick = buildPick(m);
    if (!pick || pick.confidence === "impredecible") continue;
    if (pick.prob < 0.45) continue; // solo apuestas con chance real

    const vb = m.value_bets?.[pick.marketKey];
    legs.push({
      matchLabel: `${teamName(m.home_team.name)} vs ${teamName(m.away_team.name)}`,
      matchId:    m.id,
      bet:        pick.bet,
      prob:       pick.prob,
      marketOdd:  vb?.odd ?? null,
    });
  }

  // Ordenar por probabilidad descendente
  legs.sort((a, b) => b.prob - a.prob);

  const combinadas: Combinada[] = [];
  for (const size of [2, 3, 4]) {
    const selected = legs.slice(0, size);
    if (selected.length < size) break;

    const combinedProb  = selected.reduce((p, l) => p * l.prob, 1);
    const fairOdd       = 1 / combinedProb;
    const hasAllOdds    = selected.every(l => l.marketOdd !== null);
    const marketOdd     = hasAllOdds ? selected.reduce((p, l) => p * l.marketOdd!, 1) : null;
    const ev            = marketOdd !== null ? combinedProb * marketOdd - 1 : null;

    combinadas.push({ size, legs: selected, combinedProb, fairOdd, marketOdd, ev });
  }

  return combinadas;
}

// ── Componentes ───────────────────────────────────────────────

function ConfBadge({ c }: { c: "alta" | "media" | "baja" | "impredecible" }) {
  const map = {
    alta:         "bg-green-800 text-green-200",
    media:        "bg-yellow-900 text-yellow-200",
    baja:         "bg-gray-800 text-gray-400",
    impredecible: "bg-gray-800 text-gray-500",
  };
  const lbl = {
    alta:         "Confianza alta",
    media:        "Confianza media",
    baja:         "Confianza baja",
    impredecible: "Impredecible",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${map[c]}`}>{lbl[c]}</span>;
}

const SIZE_LABEL: Record<number, string> = { 2: "Doble", 3: "Triple", 4: "Cuádruple" };
const SIZE_RISK: Record<number, string>  = { 2: "Conservadora", 3: "Moderada", 4: "Arriesgada" };
const SIZE_COLOR: Record<number, string> = {
  2: "border-blue-700 bg-blue-950/60",
  3: "border-yellow-700 bg-yellow-950/40",
  4: "border-red-800 bg-red-950/40",
};

function CombinadaCard({ c }: { c: Combinada }) {
  const pct = Math.round(c.combinedProb * 100);
  return (
    <div className={`rounded-2xl border p-4 min-w-[280px] flex-none ${SIZE_COLOR[c.size]}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-xs font-bold text-white uppercase tracking-wider">{SIZE_LABEL[c.size]}</span>
          <span className="ml-2 text-xs text-gray-500">{SIZE_RISK[c.size]}</span>
        </div>
        {c.ev !== null && c.ev > 0 && (
          <span className="text-xs bg-green-500 text-black font-bold px-2 py-0.5 rounded-full">
            +{(c.ev * 100).toFixed(1)}% valor
          </span>
        )}
      </div>

      <div className="space-y-2 mb-4">
        {c.legs.map((leg, i) => (
          <div key={i} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 truncate">{leg.matchLabel}</p>
              <p className="text-sm font-semibold text-white">{leg.bet}</p>
            </div>
            <div className="text-right flex-none">
              <p className="text-sm font-bold text-gray-300">{Math.round(leg.prob * 100)}%</p>
              {leg.marketOdd && (
                <p className="text-xs text-gray-600">{leg.marketOdd.toFixed(2)}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-700 pt-3">
        <div className="flex justify-between items-end">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Prob. combinada</p>
            <p className="text-xl font-black text-white">{pct}%</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 mb-0.5">
              {c.marketOdd ? "Cuota del mercado" : "Cuota justa mínima"}
            </p>
            <p className={`text-xl font-black ${c.ev !== null && c.ev > 0 ? "text-green-400" : "text-gray-300"}`}>
              {(c.marketOdd ?? c.fairOdd).toFixed(2)}
            </p>
          </div>
        </div>
        {c.ev !== null && (
          <p className={`text-xs mt-2 ${c.ev > 0 ? "text-green-400" : "text-gray-600"}`}>
            {c.ev > 0
              ? `El mercado paga más de lo justo — apostá si conseguís esta cuota`
              : `Cuota justa: ${c.fairOdd.toFixed(2)} — buscá al menos eso en Betsson`}
          </p>
        )}
        {c.marketOdd === null && (
          <p className="text-xs text-gray-600 mt-2">
            Multiplicá las cuotas individuales en Betsson para obtener la cuota combinada real
          </p>
        )}
      </div>
    </div>
  );
}

// ── Utilidades ────────────────────────────────────────────────

const REFRESH_MS = 15 * 60 * 1000;

function countValueBets(ms: MatchData[]) {
  const ids = new Set<string>();
  for (const m of ms) {
    for (const [k, v] of Object.entries(m.value_bets ?? {})) {
      if (v.value) ids.add(`${m.id}:${k}`);
    }
  }
  return ids;
}

// ── Página principal ──────────────────────────────────────────

export default function AnalizarPage() {
  const [matches, setMatches]         = useState<MatchData[]>([]);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newVBCount, setNewVBCount]   = useState(0);
  const [tabComb, setTabComb]         = useState(0); // índice de combinada activa
  const prevVBs = useRef<Set<string>>(new Set());

  function applyData(raw: MatchData[]) {
    const current = countValueBets(raw);
    if (prevVBs.current.size > 0) {
      let newCount = 0;
      for (const id of current) {
        if (!prevVBs.current.has(id)) newCount++;
      }
      setNewVBCount(newCount);
    }
    prevVBs.current = current;
    setMatches(raw);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    getUpcomingMarkets().then((raw) => {
      applyData(Array.isArray(raw) ? raw : []);
      setLoading(false);
    });

    const timer = setInterval(() => {
      getUpcomingMarkets().then((raw) => {
        if (Array.isArray(raw)) applyData(raw);
      });
    }, REFRESH_MS);

    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Analizando partidos...</p>
      </div>
    );
  }

  const byDate: Record<string, MatchData[]> = {};
  for (const m of matches) {
    const localDate = new Date(m.match_date).toLocaleDateString("en-CA");
    if (!byDate[localDate]) byDate[localDate] = [];
    byDate[localDate].push(m);
  }
  const days    = Object.keys(byDate).sort();
  const hasOdds = matches.some(m => m.odds_available);

  const combinadas = buildCombinadas(matches);
  const activeComb = combinadas[tabComb] ?? null;

  const MKT_LABELS = (m: MatchData): Record<string, string> => ({
    home:    `Gana ${teamName(m.home_team.name)}`,
    draw:    "Empate",
    away:    `Gana ${teamName(m.away_team.name)}`,
    over25:  "Más de 2.5 goles",
    under25: "Menos de 2.5 goles",
    btts:    "Ambos anotan",
  });

  return (
    <div className="max-w-2xl mx-auto">

      {/* ── Encabezado ── */}
      <div className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Apostá hoy</h1>
            <p className="text-sm text-gray-400 mt-1">
              {matches.length} partidos próximos
              {hasOdds && <span className="ml-2 text-green-400">· odds en tiempo real activas</span>}
            </p>
          </div>
          <div className="text-right flex-none">
            {newVBCount > 0 && (
              <div
                className="mb-1 bg-green-500 text-black text-xs font-bold px-2.5 py-1 rounded-full cursor-pointer"
                onClick={() => setNewVBCount(0)}
              >
                🔔 {newVBCount} nuevo{newVBCount !== 1 ? "s" : ""} value bet{newVBCount !== 1 ? "s" : ""}
              </div>
            )}
            {lastUpdated && (
              <p className="text-xs text-gray-600">
                Actualizado {lastUpdated.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                <br />
                <span className="text-gray-700">· refresca cada 15 min</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Combinadas recomendadas ── */}
      {combinadas.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-300 uppercase tracking-widest">Combinadas recomendadas</h2>
            <p className="text-xs text-gray-600">Selecciones de mayor probabilidad del día</p>
          </div>

          {/* Tabs */}
          {combinadas.length > 1 && (
            <div className="flex gap-2 mb-3">
              {combinadas.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setTabComb(i)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                    tabComb === i
                      ? "bg-white text-black"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {SIZE_LABEL[c.size]} · {Math.round(c.combinedProb * 100)}%
                </button>
              ))}
            </div>
          )}

          {/* Card activa */}
          {activeComb && (
            <div className={`rounded-2xl border p-5 ${SIZE_COLOR[activeComb.size]}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-base font-black text-white">{SIZE_LABEL[activeComb.size]}</span>
                  <span className="ml-2 text-xs text-gray-500">{SIZE_RISK[activeComb.size]}</span>
                </div>
                {activeComb.ev !== null && activeComb.ev > 0 && (
                  <span className="text-xs bg-green-500 text-black font-bold px-2.5 py-1 rounded-full">
                    VALUE BET · +{(activeComb.ev * 100).toFixed(1)}%
                  </span>
                )}
              </div>

              {/* Legs */}
              <div className="space-y-3 mb-5">
                {activeComb.legs.map((leg, i) => (
                  <Link key={i} href={`/matches/${leg.matchId}`} className="flex items-center justify-between gap-3 group">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500 mb-0.5 group-hover:text-gray-400 transition-colors">{leg.matchLabel}</p>
                      <p className="text-sm font-bold text-white">{leg.bet}</p>
                    </div>
                    <div className="text-right flex-none">
                      <p className="text-lg font-black text-white">{Math.round(leg.prob * 100)}%</p>
                      {leg.marketOdd && (
                        <p className="text-xs text-gray-500">cuota {leg.marketOdd.toFixed(2)}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>

              {/* Probabilidad bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Probabilidad combinada</span>
                  <span className="font-bold text-white">{Math.round(activeComb.combinedProb * 100)}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${Math.round(activeComb.combinedProb * 100)}%` }}
                  />
                </div>
              </div>

              {/* Cuota y EV */}
              <div className="border-t border-gray-700 pt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">
                    {activeComb.marketOdd ? "Cuota del mercado" : "Cuota justa mínima"}
                  </p>
                  <p className={`text-2xl font-black ${activeComb.ev !== null && activeComb.ev > 0 ? "text-green-400" : "text-gray-200"}`}>
                    {(activeComb.marketOdd ?? activeComb.fairOdd).toFixed(2)}
                  </p>
                  {activeComb.ev !== null && (
                    <p className={`text-xs mt-0.5 ${activeComb.ev > 0 ? "text-green-400" : "text-gray-600"}`}>
                      {activeComb.ev > 0
                        ? `El mercado paga más de lo justo`
                        : `Buscá al menos ${activeComb.fairOdd.toFixed(2)} en Betsson`}
                    </p>
                  )}
                  {activeComb.marketOdd === null && (
                    <p className="text-xs text-gray-600 mt-0.5">
                      Multiplicá las cuotas individuales en Betsson
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-600">Si apostás $100</p>
                  <p className="text-lg font-black text-gray-300">
                    ${Math.round(100 * (activeComb.marketOdd ?? activeComb.fairOdd))}
                  </p>
                  <p className="text-xs text-gray-600">ganancia potencial</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!hasOdds && (
        <div className="mb-5 p-3 bg-yellow-950 border border-yellow-800 rounded-xl text-xs text-yellow-300 flex gap-2">
          <span className="flex-none">💡</span>
          <span>
            Sin odds automáticas — el sistema muestra la cuota mínima justa, pero no puede detectar value bets.
          </span>
        </div>
      )}

      {days.length === 0 && (
        <p className="text-center text-gray-500 py-12">No hay partidos próximos.</p>
      )}

      {/* ── Partidos individuales ── */}
      <div className="space-y-8">
        {days.map(day => (
          <div key={day}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
              {new Date(day + "T12:00:00-03:00").toLocaleDateString("es-AR", {
                weekday: "long", day: "numeric", month: "long"
              })}
            </p>

            <div className="space-y-3">
              {byDate[day].map(m => {
                const pick      = m.markets ? buildPick(m) : null;
                const matchTime = new Date(m.match_date).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                const labels    = MKT_LABELS(m);

                const allValueBets = m.value_bets
                  ? Object.entries(m.value_bets).filter(([, v]) => v.value)
                  : [];
                const hasValueBet = allValueBets.length > 0;

                const pickHasValue = pick && m.value_bets
                  ? (m.value_bets[pick.marketKey]?.value ?? false)
                  : false;

                const otherValueBets = allValueBets.filter(([k]) => k !== pick?.marketKey);

                const cardBorder = hasValueBet
                  ? "border-green-500 bg-gradient-to-br from-green-950 to-gray-900"
                  : pick?.confidence === "alta"
                    ? "border-green-800 bg-gradient-to-br from-green-950/50 to-gray-900"
                    : pick?.confidence === "impredecible"
                      ? "border-gray-700 bg-gray-900"
                      : "border-gray-800 bg-gray-900";

                const pickVB  = pick && m.value_bets ? m.value_bets[pick.marketKey] : null;
                const pickOdd = pickVB?.odd ?? 0;
                const pickEv  = pickVB?.ev  ?? null;

                return (
                  <div key={m.id} className={`rounded-2xl border overflow-hidden ${cardBorder}`}>

                    <div className="px-4 pt-3 pb-2 flex items-start justify-between">
                      <div>
                        <p className="font-bold text-white text-base">
                          {teamName(m.home_team.name)} <span className="text-gray-500 font-normal">vs</span> {teamName(m.away_team.name)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {matchTime} hs
                          {m.odds_available && (
                            <span className="ml-2 text-gray-600">· {m.bookmakers_count} casas</span>
                          )}
                        </p>
                      </div>
                      {hasValueBet
                        ? <span className="text-xs bg-green-500 text-black font-bold px-2 py-0.5 rounded-full">VALUE BET</span>
                        : pick && <ConfBadge c={pick.confidence} />
                      }
                    </div>

                    {(m.form?.home || m.form?.away) && (
                      <div className="px-4 pb-2 flex flex-wrap gap-3 text-xs text-gray-500">
                        {m.form?.home && (
                          <span>{teamName(m.home_team.name).split(" ")[0]}: <span className="text-white">{m.form.home.scored}G</span> marc · <span className="text-white">{m.form.home.conceded}G</span> rec · {m.form.home.games} PJ</span>
                        )}
                        {m.form?.away && (
                          <span>{teamName(m.away_team.name).split(" ")[0]}: <span className="text-white">{m.form.away.scored}G</span> marc · <span className="text-white">{m.form.away.conceded}G</span> rec · {m.form.away.games} PJ</span>
                        )}
                      </div>
                    )}

                    <div className="px-4 pb-4">
                      {!pick || pick.confidence === "impredecible" ? (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-400 font-semibold mb-0.5">Partido sin favorito claro</p>
                            <p className="text-xs text-gray-600">El modelo no detecta una opción con ventaja suficiente.</p>
                          </div>
                          <Link href={`/matches/${m.id}`} className="text-xs text-blue-400 hover:underline flex-none ml-3">Ver probabilidades →</Link>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs uppercase tracking-wider mb-1 font-semibold"
                            style={{ color: pickHasValue ? "#86efac" : pick.confidence === "alta" ? "#4ade80" : "#9ca3af" }}>
                            {pickHasValue ? "⚡ Apostá acá" : "Modelo recomienda"}
                          </p>
                          <p className={`text-xl font-black mb-1 ${pickHasValue ? "text-green-300" : pick.confidence === "alta" ? "text-green-400" : "text-white"}`}>
                            {pick.bet}
                          </p>
                          <p className="text-sm text-gray-400 mb-3">{pick.why}</p>

                          <div className="mb-3">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                              <span>Probabilidad según el modelo</span>
                              <span className="font-bold text-white">{Math.round(pick.prob * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pickHasValue ? "bg-green-400" : pick.confidence === "alta" ? "bg-green-600" : "bg-blue-500"}`}
                                style={{ width: `${Math.round(pick.prob * 100)}%` }}
                              />
                            </div>
                          </div>

                          {pick.alternatives.length > 0 && (
                            <div className="mb-3 flex gap-3">
                              {pick.alternatives.map(alt => (
                                <span key={alt.marketKey} className="text-xs text-gray-600">
                                  {alt.label} <span className="text-gray-500">{Math.round(alt.prob * 100)}%</span>
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex items-end justify-between border-t border-gray-800 pt-3">
                            <div>
                              {pickOdd > 0 ? (
                                <>
                                  <p className="text-xs text-gray-500 mb-0.5">Cuota disponible</p>
                                  <p className={`text-lg font-bold ${pickHasValue ? "text-green-400" : "text-gray-300"}`}>
                                    {pickOdd.toFixed(2)}
                                    {pickEv !== null && (
                                      <span className={`ml-2 text-sm font-normal ${pickEv > 0 ? "text-green-400" : "text-red-400"}`}>
                                        {pickEv > 0 ? `+${(pickEv * 100).toFixed(1)}% ✅` : `${(pickEv * 100).toFixed(1)}% ❌`}
                                      </span>
                                    )}
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="text-xs text-gray-500">Cuota mínima para tener valor</p>
                                  <p className="text-base font-bold text-gray-200">{pick.fairOdd.toFixed(2)}</p>
                                </>
                              )}

                              {!pickHasValue && otherValueBets.length > 0 && (
                                <p className="text-xs text-green-600 mt-1">
                                  También hay valor en: {otherValueBets.map(([k, v]) => `${labels[k] ?? k} (${v.odd.toFixed(2)})`).join(", ")}
                                </p>
                              )}
                            </div>
                            <Link href={`/matches/${m.id}`} className="text-xs text-blue-400 hover:underline pb-1">Ver más →</Link>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
