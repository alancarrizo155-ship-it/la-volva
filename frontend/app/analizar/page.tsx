"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getUpcomingMarkets } from "@/lib/api";

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

function buildPick(m: MatchData): Pick {
  const { markets } = m;
  const home = m.home_team.name;
  const away = m.away_team.name;

  const candidates = [
    { label: `Gana ${home}`, key: "home",   prob: markets.home },
    { label: "Empate",        key: "draw",   prob: markets.draw },
    { label: `Gana ${away}`, key: "away",   prob: markets.away },
    ...(markets.over25 >= 0.58 ? [{ label: "Más de 2.5 goles", key: "over25", prob: markets.over25 }] : []),
    ...(markets.btts   >= 0.58 ? [{ label: "Ambos anotan",     key: "btts",   prob: markets.btts   }] : []),
  ].sort((a, b) => b.prob - a.prob);

  const top  = candidates[0];
  const alts = candidates.slice(1).filter(c => c.prob >= 0.20).slice(0, 2);

  let confidence: "alta" | "media" | "baja" | "impredecible";
  if      (top.prob >= 0.70) confidence = "alta";
  else if (top.prob >= 0.55) confidence = "media";
  else if (top.prob >= 0.40) confidence = "baja";
  else                       confidence = "impredecible";

  const isGoals = top.key === "over25" || top.key === "btts";
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
    marketKey:  top.key,
    prob:       top.prob,
    fairOdd:    1 / top.prob,
    why:        why[confidence],
    confidence,
    alternatives: alts,
  };
}

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

export default function AnalizarPage() {
  const [matches, setMatches]         = useState<MatchData[]>([]);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newVBCount, setNewVBCount]   = useState(0);
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
  const days   = Object.keys(byDate).sort();
  const hasOdds = matches.some(m => m.odds_available);

  const MKT_LABELS = (m: MatchData): Record<string, string> => ({
    home:    `Gana ${m.home_team.name}`,
    draw:    "Empate",
    away:    `Gana ${m.away_team.name}`,
    over25:  "Más de 2.5 goles",
    under25: "Menos de 2.5 goles",
    btts:    "Ambos anotan",
  });

  return (
    <div className="max-w-2xl mx-auto">

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

      {!hasOdds && (
        <div className="mb-5 p-3 bg-yellow-950 border border-yellow-800 rounded-xl text-xs text-yellow-300 flex gap-2">
          <span className="flex-none">💡</span>
          <span>
            Sin odds automáticas — el sistema muestra la cuota mínima justa, pero no puede detectar value bets.
            Agregá tu ODDS_API_KEY en el <code>.env</code> para activar la detección automática.
          </span>
        </div>
      )}

      {days.length === 0 && (
        <p className="text-center text-gray-500 py-12">No hay partidos próximos.</p>
      )}

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

                // Value bets del backend (prob >= 20% + EV > 0)
                const allValueBets = m.value_bets
                  ? Object.entries(m.value_bets).filter(([, v]) => v.value)
                  : [];
                const hasValueBet = allValueBets.length > 0;

                // ¿El mercado recomendado tiene valor?
                const pickHasValue = pick && m.value_bets
                  ? (m.value_bets[pick.marketKey]?.value ?? false)
                  : false;

                // Value bets en mercados distintos al pick
                const otherValueBets = allValueBets.filter(([k]) => k !== pick?.marketKey);

                // Apariencia de la card
                const cardBorder = hasValueBet
                  ? "border-green-500 bg-gradient-to-br from-green-950 to-gray-900"
                  : pick?.confidence === "alta"
                    ? "border-green-800 bg-gradient-to-br from-green-950/50 to-gray-900"
                    : pick?.confidence === "impredecible"
                      ? "border-gray-700 bg-gray-900"
                      : "border-gray-800 bg-gray-900";

                // Datos de cuota para el mercado recomendado
                const pickVB  = pick && m.value_bets ? m.value_bets[pick.marketKey] : null;
                const pickOdd = pickVB?.odd ?? 0;
                const pickEv  = pickVB?.ev  ?? null;

                return (
                  <div key={m.id} className={`rounded-2xl border overflow-hidden ${cardBorder}`}>

                    {/* Cabecera */}
                    <div className="px-4 pt-3 pb-2 flex items-start justify-between">
                      <div>
                        <p className="font-bold text-white text-base">
                          {m.home_team.name} <span className="text-gray-500 font-normal">vs</span> {m.away_team.name}
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

                    {/* Forma */}
                    {(m.form?.home || m.form?.away) && (
                      <div className="px-4 pb-2 flex flex-wrap gap-3 text-xs text-gray-500">
                        {m.form?.home && (
                          <span>{m.home_team.name.split(" ")[0]}: <span className="text-white">{m.form.home.scored}G</span> marc · <span className="text-white">{m.form.home.conceded}G</span> rec · {m.form.home.games} PJ</span>
                        )}
                        {m.form?.away && (
                          <span>{m.away_team.name.split(" ")[0]}: <span className="text-white">{m.form.away.scored}G</span> marc · <span className="text-white">{m.form.away.conceded}G</span> rec · {m.form.away.games} PJ</span>
                        )}
                      </div>
                    )}

                    {/* Contenido principal */}
                    <div className="px-4 pb-4">
                      {!pick || pick.confidence === "impredecible" ? (
                        /* Estado impredecible */
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-400 font-semibold mb-0.5">Partido sin favorito claro</p>
                            <p className="text-xs text-gray-600">El modelo no detecta una opción con ventaja suficiente.</p>
                          </div>
                          <Link href={`/matches/${m.id}`} className="text-xs text-blue-400 hover:underline flex-none ml-3">Ver probabilidades →</Link>
                        </div>
                      ) : (
                        /* Recomendación por probabilidad */
                        <>
                          <p className="text-xs uppercase tracking-wider mb-1 font-semibold"
                            style={{ color: pickHasValue ? "#86efac" : pick.confidence === "alta" ? "#4ade80" : "#9ca3af" }}>
                            {pickHasValue ? "⚡ Apostá acá" : "Modelo recomienda"}
                          </p>
                          <p className={`text-xl font-black mb-1 ${pickHasValue ? "text-green-300" : pick.confidence === "alta" ? "text-green-400" : "text-white"}`}>
                            {pick.bet}
                          </p>
                          <p className="text-sm text-gray-400 mb-3">{pick.why}</p>

                          {/* Barra de probabilidad */}
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

                          {/* Alternativas ranked */}
                          {pick.alternatives.length > 0 && (
                            <div className="mb-3 flex gap-3">
                              {pick.alternatives.map(alt => (
                                <span key={alt.marketKey} className="text-xs text-gray-600">
                                  {alt.label} <span className="text-gray-500">{Math.round(alt.prob * 100)}%</span>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Cuota y EV */}
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

                              {/* Nota: hay valor en otro mercado */}
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
