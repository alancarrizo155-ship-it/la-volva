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
type ValueBet    = { odd: number; ev: number; value: boolean };

type BackendRecommendation = {
  market: string;
  prob: number;
  ev: number | null;
  ev_shield_applied: boolean;
  skipped_by_ev: { market: string; prob: number; ev: number }[];
};

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
  recommendation?: BackendRecommendation | null;
};

type Confidence = "muy-alta" | "alta" | "media" | "baja";

type Pick = {
  bet: string;
  marketKey: string;
  prob: number;
  fairOdd: number;
  why: string;
  confidence: Confidence;
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

// ── Confianza ─────────────────────────────────────────────────

const CONF: Record<Confidence, { label: string; color: string; bar: string; badge: string }> = {
  "muy-alta": { label: "Muy alta", color: "text-emerald-400", bar: "bg-emerald-400", badge: "bg-emerald-900 text-emerald-300" },
  "alta":     { label: "Alta",     color: "text-green-400",   bar: "bg-green-400",   badge: "bg-green-900 text-green-300" },
  "media":    { label: "Media",    color: "text-yellow-400",  bar: "bg-yellow-400",  badge: "bg-yellow-900 text-yellow-300" },
  "baja":     { label: "Baja",     color: "text-red-400",     bar: "bg-red-500",     badge: "bg-red-900 text-red-300" },
};

function getConfidence(prob: number): Confidence {
  if (prob >= 0.80) return "muy-alta";
  if (prob >= 0.70) return "alta";
  if (prob >= 0.60) return "media";
  return "baja";
}

// ── Builds ────────────────────────────────────────────────────

function buildPick(m: MatchData): Pick {
  const { markets } = m;
  const home = teamName(m.home_team.name);
  const away = teamName(m.away_team.name);

  const candidates = [
    { label: `Gana ${home}`, marketKey: "home",   prob: markets.home },
    { label: "Empate",        marketKey: "draw",   prob: markets.draw },
    { label: `Gana ${away}`, marketKey: "away",   prob: markets.away },
    ...(markets.over25 >= 0.58 ? [{ label: "Más de 2.5 goles", marketKey: "over25", prob: markets.over25 }] : []),
    ...(markets.btts   >= 0.58 ? [{ label: "Ambos anotan",     marketKey: "btts",   prob: markets.btts   }] : []),
  ].sort((a, b) => b.prob - a.prob);

  const top  = candidates[0];
  const alts = candidates.slice(1).filter(c => c.prob >= 0.20).slice(0, 2);
  const conf = getConfidence(top.prob);

  const isGoals = top.marketKey === "over25" || top.marketKey === "btts";
  const team    = top.label.replace("Gana ", "");

  const whyMap: Record<Confidence, string> = {
    "muy-alta": isGoals ? `El modelo espera un partido con muchos goles — señal muy fuerte` : `${team} es el gran favorito según el modelo`,
    "alta":     isGoals ? `El modelo espera goles en este partido` : `${team} es el favorito claro según el modelo`,
    "media":    isGoals ? `El modelo da ventaja a que haya goles, aunque el partido puede ser cerrado` : `El modelo da ventaja a ${team}, aunque hay incertidumbre`,
    "baja":     isGoals ? `Ligera ventaja en goles — partido parejo` : `Ligera ventaja para ${team} — partido parejo`,
  };

  return {
    bet: top.label, marketKey: top.marketKey, prob: top.prob,
    fairOdd: 1 / top.prob, why: whyMap[conf], confidence: conf, alternatives: alts,
  };
}

function marketLabel(market: string, m: MatchData): string {
  const home = teamName(m.home_team.name);
  const away = teamName(m.away_team.name);
  const MAP: Record<string, string> = {
    home:    `Gana ${home}`,
    draw:    "Empate",
    away:    `Gana ${away}`,
    over25:  "Más de 2.5 goles",
    under25: "Menos de 2.5 goles",
    btts:    "Ambos anotan",
  };
  return MAP[market] ?? market;
}

function buildCombinadas(matches: MatchData[]): Combinada[] {
  const legs: CombinadaLeg[] = [];
  for (const m of matches) {
    // Usar el campo recommendation del backend: ya tiene el filtro EV aplicado.
    const rec = m.recommendation;
    if (!rec || rec.prob < 0.45) continue;
    const vb = m.value_bets?.[rec.market];
    legs.push({
      matchLabel: `${teamName(m.home_team.name)} vs ${teamName(m.away_team.name)}`,
      matchId: m.id,
      bet: marketLabel(rec.market, m),
      prob: rec.prob,
      marketOdd: vb?.odd ?? null,
    });
  }
  legs.sort((a, b) => b.prob - a.prob);

  const combinadas: Combinada[] = [];
  for (const size of [2, 3, 4]) {
    const sel = legs.slice(0, size);
    if (sel.length < size) break;
    const combinedProb = sel.reduce((p, l) => p * l.prob, 1);
    const fairOdd      = 1 / combinedProb;
    const hasAll       = sel.every(l => l.marketOdd !== null);
    const marketOdd    = hasAll ? sel.reduce((p, l) => p * l.marketOdd!, 1) : null;
    const ev           = marketOdd !== null ? combinedProb * marketOdd - 1 : null;
    combinadas.push({ size, legs: sel, combinedProb, fairOdd, marketOdd, ev });
  }
  return combinadas;
}

// ── Componentes ───────────────────────────────────────────────

const SIZE_LABEL: Record<number, string> = { 2: "Doble", 3: "Triple", 4: "Cuádruple" };
const SIZE_RISK:  Record<number, string>  = { 2: "Conservadora", 3: "Moderada", 4: "Arriesgada" };
const SIZE_COLOR: Record<number, string>  = {
  2: "border-blue-700 bg-blue-950/60",
  3: "border-yellow-700 bg-yellow-950/40",
  4: "border-red-800 bg-red-950/40",
};

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

function calcPayout(amount: number, odd: number) {
  const cobras   = +(amount * odd).toFixed(0);
  const ganancia = cobras - amount;
  return { cobras, ganancia };
}

// ── Página ────────────────────────────────────────────────────

export default function AnalizarPage() {
  const [matches, setMatches]         = useState<MatchData[]>([]);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newVBCount, setNewVBCount]   = useState(0);
  const [monto, setMonto]             = useState("");
  const [tabComb, setTabComb]         = useState(0);
  const [expandedAdv, setExpandedAdv] = useState<Set<number>>(new Set());
  const [filterConf, setFilterConf]   = useState<Set<Confidence>>(new Set(["muy-alta", "alta"]));
  const prevVBs = useRef<Set<string>>(new Set());

  function applyData(raw: MatchData[]) {
    const current = countValueBets(raw);
    if (prevVBs.current.size > 0) {
      let n = 0;
      for (const id of current) { if (!prevVBs.current.has(id)) n++; }
      setNewVBCount(n);
    }
    prevVBs.current = current;
    setMatches(raw);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    getUpcomingMarkets().then(raw => { applyData(Array.isArray(raw) ? raw : []); setLoading(false); });
    const t = setInterval(() => { getUpcomingMarkets().then(raw => { if (Array.isArray(raw)) applyData(raw); }); }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-400 text-sm">Analizando partidos...</p>
    </div>
  );

  // Construir picks y filtrar
  const picksCache = new Map<number, Pick>();
  for (const m of matches) {
    if (m.markets) picksCache.set(m.id, buildPick(m));
  }

  const visibleMatches = matches.filter(m => {
    const p = picksCache.get(m.id);
    return p && filterConf.has(p.confidence);
  });

  const byDate: Record<string, MatchData[]> = {};
  for (const m of visibleMatches) {
    const d = new Date(m.match_date).toLocaleDateString("en-CA");
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  }
  const days    = Object.keys(byDate).sort();
  const hasOdds = matches.some(m => m.odds_available);
  const combinadas  = buildCombinadas(matches);
  const activeComb  = combinadas[tabComb] ?? null;
  const montoNum    = parseFloat(monto) || 0;

  const MKT_LABELS = (m: MatchData): Record<string, string> => ({
    home: `Gana ${teamName(m.home_team.name)}`, draw: "Empate",
    away: `Gana ${teamName(m.away_team.name)}`, over25: "Más de 2.5 goles",
    under25: "Menos de 2.5 goles", btts: "Ambos anotan",
  });

  function toggleFilter(c: Confidence) {
    setFilterConf(prev => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  }

  return (
    <div className="max-w-2xl mx-auto">

      {/* Encabezado */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Apostá hoy</h1>
          <p className="text-sm text-gray-400 mt-1">
            {visibleMatches.length} de {matches.length} partidos
            {hasOdds && <span className="ml-2 text-green-400">· odds en tiempo real</span>}
          </p>
        </div>
        <div className="text-right flex-none">
          {newVBCount > 0 && (
            <div className="mb-1 bg-green-500 text-black text-xs font-bold px-2.5 py-1 rounded-full cursor-pointer" onClick={() => setNewVBCount(0)}>
              🔔 {newVBCount} nuevo{newVBCount !== 1 ? "s" : ""} value bet{newVBCount !== 1 ? "s" : ""}
            </div>
          )}
          {lastUpdated && (
            <p className="text-xs text-gray-600">
              Actualizado {lastUpdated.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
      </div>

      {/* Filtro de confianza */}
      <div className="mb-4 bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Mostrar confianza</p>
        <div className="flex flex-wrap gap-2">
          {(["muy-alta", "alta", "media", "baja"] as Confidence[]).map(c => {
            const active = filterConf.has(c);
            return (
              <button
                key={c}
                onClick={() => toggleFilter(c)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  active
                    ? CONF[c].badge + " border-transparent"
                    : "bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-500"
                }`}
              >
                {active ? "☑" : "☐"} {CONF[c].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Calculadora global */}
      <div className="mb-5 bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center gap-3">
        <p className="text-sm text-gray-400 flex-none">Monto por apuesta:</p>
        <div className="flex items-center gap-1">
          <span className="text-gray-500 text-sm">$</span>
          <input
            type="number" min="0" placeholder="Ingresá tu monto"
            value={monto}
            onChange={e => setMonto(e.target.value)}
            className="w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        {montoNum > 0
          ? <p className="text-xs text-gray-600">Las ganancias se calculan automáticamente en cada tarjeta</p>
          : <p className="text-xs text-gray-600">Ingresá el monto para ver la ganancia estimada</p>
        }
      </div>

      {/* Combinadas */}
      {combinadas.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-300 uppercase tracking-widest">Combinadas recomendadas</h2>
            <p className="text-xs text-gray-600">Mayor probabilidad del día</p>
          </div>
          {combinadas.length > 1 && (
            <div className="flex gap-2 mb-3">
              {combinadas.map((c, i) => (
                <button key={i} onClick={() => setTabComb(i)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${tabComb === i ? "bg-white text-black" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  {SIZE_LABEL[c.size]} · {Math.round(c.combinedProb * 100)}%
                </button>
              ))}
            </div>
          )}
          {activeComb && (
            <div className={`rounded-2xl border p-5 ${SIZE_COLOR[activeComb.size]}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-base font-black text-white">{SIZE_LABEL[activeComb.size]}</span>
                  <span className="ml-2 text-xs text-gray-500">{SIZE_RISK[activeComb.size]}</span>
                </div>
                {activeComb.ev !== null && activeComb.ev > 0 && (
                  <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">con valor</span>
                )}
              </div>
              <div className="space-y-3 mb-4">
                {activeComb.legs.map((leg, i) => (
                  <Link key={i} href={`/matches/${leg.matchId}`} className="flex items-center justify-between gap-3 group">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">{leg.matchLabel}</p>
                      <p className="text-sm font-bold text-white">{leg.bet}</p>
                    </div>
                    <div className="text-right flex-none">
                      <p className="text-lg font-black text-white">{Math.round(leg.prob * 100)}%</p>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Probabilidad combinada</span>
                  <span className="font-bold text-white">{Math.round(activeComb.combinedProb * 100)}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(activeComb.combinedProb * 100)}%` }} />
                </div>
              </div>
              <div className="border-t border-gray-700 pt-3 flex items-end justify-between">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">{activeComb.marketOdd ? "Cuota del mercado" : "Cuota justa mínima"}</p>
                  <p className="text-2xl font-black text-gray-200">{(activeComb.marketOdd ?? activeComb.fairOdd).toFixed(2)}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{activeComb.marketOdd ? "Multiplicá las cuotas individuales en Betsson" : "Buscá al menos esta cuota"}</p>
                </div>
                {montoNum > 0 && (
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Si apostás ${montoNum.toLocaleString("es-AR")}</p>
                    <p className="text-xl font-black text-white">${Math.round(montoNum * (activeComb.marketOdd ?? activeComb.fairOdd)).toLocaleString("es-AR")}</p>
                    <p className="text-xs text-green-400">+${Math.round(montoNum * (activeComb.marketOdd ?? activeComb.fairOdd) - montoNum).toLocaleString("es-AR")} ganancia</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {days.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-2">
            {matches.length === 0
              ? "No hay partidos próximos."
              : "No hay partidos con el nivel de confianza seleccionado."}
          </p>
          {matches.length > 0 && filterConf.size < 4 && (
            <button
              onClick={() => setFilterConf(new Set(["muy-alta", "alta", "media", "baja"]))}
              className="text-blue-400 text-sm hover:underline"
            >
              Mostrar todos los partidos
            </button>
          )}
        </div>
      )}

      {/* Partidos */}
      <div className="space-y-8">
        {days.map(day => (
          <div key={day}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
              {new Date(day + "T12:00:00-03:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <div className="space-y-3">
              {byDate[day].map(m => {
                const pick      = picksCache.get(m.id)!;
                const matchTime = new Date(m.match_date).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                const labels    = MKT_LABELS(m);
                const conf      = CONF[pick.confidence];
                const isBaja    = pick.confidence === "baja";

                const allVB  = m.value_bets ? Object.entries(m.value_bets).filter(([, v]) => v.value) : [];
                const pickVB = m.value_bets ? m.value_bets[pick.marketKey] : null;
                const pickOdd = pickVB?.odd ?? 0;
                const pickEv  = pickVB?.ev ?? null;
                const otherVB = allVB.filter(([k]) => k !== pick.marketKey);

                const payout = montoNum > 0 && pickOdd > 1 ? calcPayout(montoNum, pickOdd) : null;
                const isAdvExpanded = expandedAdv.has(m.id);

                return (
                  <div key={m.id} className="rounded-2xl border overflow-hidden border-gray-800 bg-gray-900">

                    {/* Cabecera */}
                    <div className="px-4 pt-3 pb-2 flex items-start justify-between">
                      <div>
                        <p className="font-bold text-white text-base">
                          {teamName(m.home_team.name)} <span className="text-gray-500 font-normal">vs</span> {teamName(m.away_team.name)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {matchTime} hs
                          {m.odds_available && <span className="ml-2 text-gray-600">· {m.bookmakers_count} casas</span>}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-none ${conf.badge}`}>
                        {conf.label}
                      </span>
                    </div>

                    {/* Contenido */}
                    <div className="px-4 pb-4">
                      {/* Label */}
                      <p className="text-xs uppercase tracking-wider mb-1 font-semibold text-gray-500">
                        Apuesta recomendada
                      </p>

                      {/* Apuesta */}
                      <p className={`text-xl font-black mb-1 ${conf.color}`}>{pick.bet}</p>

                      {/* Motivo */}
                      <p className="text-sm text-gray-400 mb-3">{pick.why}</p>

                      {/* Advertencia partido parejo */}
                      {isBaja && (
                        <div className="flex items-start gap-2 bg-yellow-950/40 border border-yellow-800/50 rounded-xl px-3 py-2 mb-3">
                          <span className="text-yellow-400 flex-none mt-0.5">⚠️</span>
                          <p className="text-xs text-yellow-300 leading-relaxed">
                            <span className="font-semibold">Partido parejo.</span> El modelo detecta una ligera ventaja para el equipo recomendado, pero no es una apuesta de alta confianza.
                          </p>
                        </div>
                      )}

                      {/* Barra de probabilidad */}
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Probabilidad estimada</span>
                          <span className={`font-bold ${conf.color}`}>{Math.round(pick.prob * 100)}%</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${conf.bar}`} style={{ width: `${Math.round(pick.prob * 100)}%` }} />
                        </div>
                      </div>

                      {/* Cuota + ganancia (solo si hay odds) */}
                      {pickOdd > 1 && (
                        <div className="bg-gray-800 rounded-xl p-3 mb-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Cuota disponible</p>
                              <p className="text-2xl font-black text-white">{pickOdd.toFixed(2)}</p>
                            </div>
                            {payout ? (
                              <div className="text-right">
                                <p className="text-xs text-gray-500 mb-0.5">Si apostás ${montoNum.toLocaleString("es-AR")}</p>
                                <p className="text-lg font-black text-white">${payout.cobras.toLocaleString("es-AR")}</p>
                                <p className={`text-sm font-semibold ${payout.ganancia >= 0 ? "text-green-400" : "text-red-400"}`}>
                                  +${payout.ganancia.toLocaleString("es-AR")} ganancia
                                </p>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-600 text-right max-w-[110px] leading-relaxed">
                                Ingresá el monto arriba para ver la ganancia
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Análisis avanzado (colapsable) */}
                      <div className="border-t border-gray-800 pt-3">
                        <button
                          onClick={() => setExpandedAdv(prev => {
                            const next = new Set(prev);
                            next.has(m.id) ? next.delete(m.id) : next.add(m.id);
                            return next;
                          })}
                          className="text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1"
                        >
                          {isAdvExpanded ? "▲ Ocultar análisis avanzado" : "▼ Ver análisis avanzado"}
                        </button>

                        {isAdvExpanded && (
                          <div className="mt-3 space-y-2">
                            {/* Cuota justa (cuando no hay odds disponibles) */}
                            {pickOdd <= 1 && (
                              <div className="flex items-center justify-between text-xs py-1">
                                <span className="text-gray-500">Cuota justa (modelo)</span>
                                <span className="text-gray-300 font-bold">{pick.fairOdd.toFixed(2)} — buscá esta cuota o más en Betsson</span>
                              </div>
                            )}

                            {/* EV del pick */}
                            {pickEv !== null && (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-gray-500">Valor esperado (EV)</span>
                                <span className={pickEv > 0 ? "text-green-400 font-bold" : "text-red-400"}>
                                  {pickEv > 0 ? `+${(pickEv * 100).toFixed(1)}%` : `${(pickEv * 100).toFixed(1)}%`}
                                  {pickEv > 0 ? " ✅ VALUE BET" : " ❌ Sin valor"}
                                </span>
                              </div>
                            )}

                            {/* Alternativas */}
                            {pick.alternatives.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Otras opciones:</p>
                                {pick.alternatives.map(alt => (
                                  <div key={alt.marketKey} className="flex justify-between text-xs text-gray-600">
                                    <span>{alt.label}</span>
                                    <span>{Math.round(alt.prob * 100)}%</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Value bets en otros mercados */}
                            {otherVB.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Value bets en otros mercados:</p>
                                {otherVB.map(([k, v]) => (
                                  <div key={k} className="flex justify-between text-xs">
                                    <span className="text-green-600">{labels[k] ?? k}</span>
                                    <span className="text-green-600">cuota {v.odd.toFixed(2)} · +{(v.ev * 100).toFixed(1)}%</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex justify-end mt-2">
                          <Link href={`/matches/${m.id}`} className="text-xs text-blue-400 hover:underline">Ver análisis completo →</Link>
                        </div>
                      </div>
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
