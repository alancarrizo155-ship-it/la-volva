"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getMatch, getMatchMarkets, getOddsComparison } from "@/lib/api";
import { saveBet, type Pred } from "@/lib/predictions";
import { teamName } from "@/lib/teamNames";

// ── Confidence system ─────────────────────────────────────────
type Confidence = "muy-alta" | "alta" | "media" | "baja" | "impredecible";

const CONF: Record<Confidence, { label: string; color: string; bar: string; badge: string }> = {
  "muy-alta":     { label: "Muy alta",     color: "text-emerald-400", bar: "bg-emerald-400", badge: "bg-emerald-900 text-emerald-300 border-emerald-700" },
  "alta":         { label: "Alta",         color: "text-green-400",   bar: "bg-green-400",   badge: "bg-green-900 text-green-300 border-green-700" },
  "media":        { label: "Media",        color: "text-yellow-400",  bar: "bg-yellow-400",  badge: "bg-yellow-900 text-yellow-300 border-yellow-700" },
  "baja":         { label: "Baja",         color: "text-orange-400",  bar: "bg-orange-400",  badge: "bg-orange-900 text-orange-300 border-orange-700" },
  "impredecible": { label: "Impredecible", color: "text-gray-500",    bar: "bg-gray-600",    badge: "bg-gray-800 text-gray-500 border-gray-700" },
};

function getConfidence(prob: number): Confidence {
  if (prob >= 0.80) return "muy-alta";
  if (prob >= 0.70) return "alta";
  if (prob >= 0.60) return "media";
  if (prob >= 0.45) return "baja";
  return "impredecible";
}

function calcPayout(amount: number, odd: number) {
  const cobras   = +(amount * odd).toFixed(0);
  const ganancia = cobras - amount;
  return { cobras, ganancia };
}

// ── Textos de por qué apostar ─────────────────────────────────
function buildWhy(market: string, pred: Pred, homeName: string, awayName: string): string {
  const homeElo   = pred.home_elo_used ?? 1500;
  const awayElo   = pred.away_elo_used ?? 1500;
  const eloDiff   = Math.abs(homeElo - awayElo);
  const homeGoals = pred.predicted_home_goals?.toFixed(1);
  const awayGoals = pred.predicted_away_goals?.toFixed(1);

  switch (market) {
    case "home":
      if (eloDiff > 300 && homeElo > awayElo)
        return `${homeName} es muy superior: ${eloDiff.toFixed(0)} puntos ELO de diferencia. Suele dominar partidos así y el modelo lo ve como gran favorito.`;
      if (eloDiff > 150 && homeElo > awayElo)
        return `${homeName} tiene clara ventaja en calidad. El modelo lo proyecta como favorito sólido jugando de local.`;
      return `${homeName} tiene una pequeña ventaja como local, aunque el partido puede ir para cualquier lado.`;

    case "away":
      if (eloDiff > 300 && awayElo > homeElo)
        return `${awayName} es muy superior incluso jugando de visitante: ${eloDiff.toFixed(0)} puntos ELO de diferencia. Alta probabilidad de victoria.`;
      if (eloDiff > 150 && awayElo > homeElo)
        return `${awayName} tiene clara ventaja en calidad a pesar de ser visitante.`;
      if (eloDiff > 150 && homeElo > awayElo)
        return `${awayName} es el visitante pero el modelo lo proyecta con chances — ${homeName} es más fuerte en ELO.`;
      return `${awayName} tiene una leve ventaja, aunque es un partido parejo.`;

    case "over25":
      return `El modelo predice ${homeGoals} goles de ${homeName} y ${awayGoals} de ${awayName} en promedio. Buen partido para apostar a los goles.`;

    case "under25":
      return `Se espera un partido cerrado y defensivo — el modelo predice ${homeGoals} - ${awayGoals} en promedio. Alta probabilidad de que caigan 2 goles o menos.`;

    case "btts":
      return `Ambos equipos tienen ataque efectivo. Alta probabilidad de que los dos conviertan al menos un gol cada uno.`;

    case "draw":
      return `El modelo no ve un favorito claro. Empate es una posibilidad real en este partido.`;

    default:
      return "Esto es lo más probable según el modelo estadístico.";
  }
}

// ── Obtener la mejor apuesta y alternativas ───────────────────
function getTopBets(pred: Pred, homeName: string, awayName: string) {
  const LABEL: Record<string, string> = {
    home:    `Gana ${homeName}`,
    away:    `Gana ${awayName}`,
    draw:    "Empate",
    over25:  "Over 2.5 goles",
    under25: "Under 2.5 goles",
    btts:    "Ambos anotan",
  };

  return [
    { market: "home",    prob: pred.home_win_prob },
    { market: "away",    prob: pred.away_win_prob },
    { market: "draw",    prob: pred.draw_prob },
    { market: "over25",  prob: pred.over25_prob },
    { market: "under25", prob: pred.under25_prob },
    { market: "btts",    prob: pred.btts_prob },
  ]
    .filter((c) => c.prob >= 0.20)
    .sort((a, b) => b.prob - a.prob)
    .map((c) => ({ ...c, label: LABEL[c.market] }));
}

function calcEV(prob: number, odds: number) {
  return (prob * odds) - 1;
}

// ── Página principal ──────────────────────────────────────────
export default function MatchPage() {
  const { id } = useParams();
  const [match, setMatch]         = useState<any>(null);
  const [markets, setMarkets]     = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [oddsComp, setOddsComp]   = useState<any>(null);
  const [showAdv, setShowAdv]     = useState(false);

  const [monto, setMonto]         = useState("");
  const [quickOdds, setQuickOdds] = useState("");
  const [ev, setEv]               = useState<number | null>(null);
  const [kelly, setKelly]         = useState<number | null>(null);
  const [bankroll, setBankroll]   = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("lavolva_bankroll") || "";
    return "";
  });

  const [betForm, setBetForm]     = useState({ show: false, selection: "", amount: "", odds: "" });
  const [betSaved, setBetSaved]   = useState(false);

  function load() {
    setLoading(true);
    const matchId = Number(id);
    Promise.all([getMatch(matchId), getMatchMarkets(matchId)]).then(([matchData, mktData]) => {
      setMatch(matchData);
      setMarkets(mktData);
      setLoading(false);
      const vb = mktData?.value_bets;
      if (vb) {
        const best = Object.entries(vb as Record<string, any>)
          .filter(([, v]) => v.value)
          .sort((a: any, b: any) => b[1].ev - a[1].ev)[0];
        if (best) getOddsComparison(matchId, best[0]).then(setOddsComp);
      }
    });
  }
  useEffect(load, [id]);

  if (loading) return <div className="text-center text-gray-400 py-20">Analizando partido...</div>;
  if (!match) return (
    <div className="text-center py-20">
      <p className="text-gray-400 mb-3">No se pudo conectar con el servidor.</p>
      <button onClick={load} className="text-blue-400 hover:underline text-sm">Reintentar</button>
    </div>
  );

  const pred     = match.predictions?.[0] as Pred | undefined;
  const homeName = teamName(match.home_team?.name ?? "Local");
  const awayName = teamName(match.away_team?.name ?? "Visitante");
  const homeCode = match.home_team?.country_code ?? "";
  const awayCode = match.away_team?.country_code ?? "";

  const bets     = pred ? getTopBets(pred, homeName, awayName) : [];

  const valueBets: Record<string, { odd: number; ev: number; value: boolean }> = markets?.value_bets ?? {};

  const MKT_LABEL: Record<string, string> = {
    home:    `Gana ${homeName}`,
    draw:    "Empate",
    away:    `Gana ${awayName}`,
    over25:  "Over 2.5 goles",
    under25: "Under 2.5 goles",
    btts:    "Ambos anotan",
  };

  const top            = bets[0];
  const topValueBet    = top ? valueBets[top.market] : undefined;
  const otherValueBets = Object.entries(valueBets).filter(([k, v]) => v.value && k !== top?.market);
  const rest           = bets.slice(1, 4);
  const topWhy         = top && pred ? buildWhy(top.market, pred, homeName, awayName) : "";
  const conf           = top ? getConfidence(top.prob) : "impredecible";

  // Kelly calculado desde cuota automática
  const autoKelly = (() => {
    if (!top || !topValueBet) return null;
    const b = topValueBet.odd - 1;
    const q = 1 - top.prob;
    return Math.max(0, (top.prob * b - q) / b);
  })();

  const displayKelly = topValueBet ? autoKelly : kelly;

  function handleQuickOdds(val: string) {
    setQuickOdds(val);
    const o = parseFloat(val);
    if (top && o > 1) {
      setEv(calcEV(top.prob, o));
      const b = o - 1;
      const q = 1 - top.prob;
      setKelly(Math.max(0, (top.prob * b - q) / b));
    } else {
      setEv(null);
      setKelly(null);
    }
  }

  function handleBankroll(val: string) {
    setBankroll(val);
    if (typeof window !== "undefined") localStorage.setItem("lavolva_bankroll", val);
  }

  function handleSaveBet() {
    if (!betForm.amount || !betForm.odds || !betForm.selection) return;
    const labels: Record<string, string> = {
      home: `Gana ${homeName}`, away: `Gana ${awayName}`,
      draw: "Empate", over25: "Over 2.5 goles",
      under25: "Under 2.5 goles", btts: "Ambos anotan",
    };
    saveBet({
      matchId:        Number(id),
      matchLabel:     `${homeName} vs ${awayName}`,
      matchDate:      match.match_date,
      selection:      betForm.selection,
      selectionLabel: labels[betForm.selection] || betForm.selection,
      amount:         parseFloat(betForm.amount),
      odds:           parseFloat(betForm.odds),
      potentialWin:   Math.round(parseFloat(betForm.amount) * parseFloat(betForm.odds) * 100) / 100,
    });
    setBetSaved(true);
    setBetForm({ show: false, selection: top?.market ?? "home", amount: "", odds: "" });
    setTimeout(() => setBetSaved(false), 3000);
  }

  const betSelection = betForm.selection || top?.market || "home";

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/" className="text-blue-400 text-sm hover:underline mb-5 inline-block">
        ← Volver
      </Link>

      {/* ── Encabezado ──────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-4 text-center">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
          {match.stage?.replace(/_/g, " ")} · {match.status === "finished" ? "Finalizado" : match.status === "live" ? "EN VIVO" : "Programado"}
        </p>
        <div className="flex items-center justify-center gap-6">
          <div className="flex-1 text-right">
            <p className="text-xl font-bold">{homeName}</p>
            <p className="text-xs text-gray-500">{homeCode}</p>
          </div>
          <div className="text-center flex-none">
            {match.status === "finished" ? (
              <p className="text-4xl font-black">{match.home_goals} — {match.away_goals}</p>
            ) : (
              <p className="text-3xl font-black text-gray-600">vs</p>
            )}
          </div>
          <div className="flex-1 text-left">
            <p className="text-xl font-bold">{awayName}</p>
            <p className="text-xs text-gray-500">{awayCode}</p>
          </div>
        </div>
      </div>

      {/* ── Sin predicción ──────────────────────────────────── */}
      {!pred && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center mb-4">
          <p className="text-gray-400">Este partido todavía no tiene predicción generada.</p>
        </div>
      )}

      {/* ── Recomendación principal ─────────────────────────── */}
      {pred && top && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Apuesta recomendada</p>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${CONF[conf].badge}`}>
              Confianza {CONF[conf].label}
            </span>
          </div>

          {/* Nombre de la apuesta */}
          <p className={`text-3xl font-black mb-3 leading-tight ${CONF[conf].color}`}>{top.label}</p>

          {/* Barra de probabilidad */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 bg-gray-800 rounded-full h-2.5">
              <div
                className={`${CONF[conf].bar} h-2.5 rounded-full transition-all`}
                style={{ width: `${top.prob * 100}%` }}
              />
            </div>
            <span className={`text-2xl font-black min-w-[4rem] text-right ${CONF[conf].color}`}>
              {(top.prob * 100).toFixed(0)}%
            </span>
          </div>

          {/* Motivo */}
          <p className="text-gray-300 text-sm leading-relaxed mb-5">{topWhy}</p>

          {/* Cuota y calculadora */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            {topValueBet ? (
              <>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Cuota del mercado</p>
                    <div className="flex items-center gap-2">
                      <p className={`text-3xl font-black ${topValueBet.value ? "text-green-400" : "text-white"}`}>
                        {topValueBet.odd.toFixed(2)}
                      </p>
                      {topValueBet.value && (
                        <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded font-bold">VALUE BET</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 mb-0.5">Cuota justa</p>
                    <p className="text-xl font-bold text-gray-400">{(1 / top.prob).toFixed(2)}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-2">Calculá tu ganancia</p>
                <div className="flex gap-3 items-center">
                  <div className="flex-1">
                    <input
                      type="number" min="0" placeholder="Apostá ($)"
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-blue-400 focus:outline-none text-sm"
                    />
                  </div>
                  {monto && parseFloat(monto) > 0 && (() => {
                    const { cobras, ganancia } = calcPayout(parseFloat(monto), topValueBet.odd);
                    return (
                      <div className="flex gap-3">
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Cobrás</p>
                          <p className="text-lg font-black text-white">${cobras}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Ganás</p>
                          <p className={`text-lg font-black ${ganancia >= 0 ? "text-green-400" : "text-red-400"}`}>${ganancia}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Cuota justa (modelo)</p>
                  <p className="text-2xl font-black text-gray-200">{(1 / top.prob).toFixed(2)}</p>
                </div>
                <p className="text-xs text-gray-500 text-right max-w-[150px] leading-relaxed">
                  Si Betsson paga más que esto, hay valor matemático en apostar.
                </p>
              </div>
            )}
          </div>

          {/* Análisis avanzado */}
          <button
            onClick={() => setShowAdv((v) => !v)}
            className="w-full text-xs text-gray-500 hover:text-gray-300 mt-4 py-2 transition-colors flex items-center justify-center gap-1.5"
          >
            {showAdv ? "▲ Ocultar análisis avanzado" : "▼ Ver análisis avanzado"}
          </button>

          {showAdv && (
            <div className="mt-3 border-t border-gray-800 pt-4 space-y-3">

              {/* EV */}
              {topValueBet ? (
                <div className="bg-gray-800/80 rounded-xl p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1.5">Valor esperado (EV)</p>
                  {topValueBet.value ? (
                    <p className="text-green-400 text-sm font-bold">¡Hay valor! Betsson paga más de lo que debería. EV: +{(topValueBet.ev * 100).toFixed(1)}%</p>
                  ) : topValueBet.ev > -0.05 ? (
                    <p className="text-yellow-400 text-sm">Odd justa — sin ventaja clara. EV: {(topValueBet.ev * 100).toFixed(1)}%</p>
                  ) : (
                    <p className="text-red-400 text-sm">Betsson tiene ventaja en este mercado. EV: {(topValueBet.ev * 100).toFixed(1)}%</p>
                  )}
                </div>
              ) : (
                <div className="bg-gray-800/80 rounded-xl p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1.5">Calcular valor con cuota de Betsson</p>
                  <input
                    type="number" step="0.01" min="1.01" placeholder="Ingresá la cuota de Betsson (ej: 1.80)"
                    value={quickOdds}
                    onChange={(e) => handleQuickOdds(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-blue-400 focus:outline-none text-sm"
                  />
                  {ev !== null && (
                    <div className="mt-2">
                      {ev > 0.05
                        ? <p className="text-green-400 text-sm font-bold">¡Hay valor! EV: +{(ev * 100).toFixed(1)}%</p>
                        : ev > -0.05
                        ? <p className="text-yellow-400 text-sm">Odd justa. EV: {(ev * 100).toFixed(1)}%</p>
                        : <p className="text-red-400 text-sm">Betsson tiene ventaja. EV: {(ev * 100).toFixed(1)}%</p>
                      }
                    </div>
                  )}
                </div>
              )}

              {/* Kelly */}
              {displayKelly !== null && (
                <div className="bg-gray-800/80 rounded-xl p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">Kelly Criterion</p>
                  <p className="text-xs text-gray-500 mb-2">Cuánto del bankroll apostar para maximizar a largo plazo.</p>
                  {displayKelly > 0 ? (
                    <>
                      <div className="mb-2">
                        <input
                          type="number" min="0" placeholder="Tu bankroll total ($)"
                          value={bankroll}
                          onChange={(e) => handleBankroll(e.target.value)}
                          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-white placeholder-gray-600 focus:border-blue-400 focus:outline-none text-sm"
                        />
                      </div>
                      <p className="text-white font-bold">Apostar {(displayKelly * 100).toFixed(1)}% del bankroll</p>
                      {bankroll && parseFloat(bankroll) > 0 && (
                        <p className="text-green-400 text-sm font-bold">= ${(parseFloat(bankroll) * displayKelly).toFixed(2)}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-red-400 text-sm">Kelly dice: no apostar — sin ventaja matemática.</p>
                  )}
                </div>
              )}

              {/* Value bets en otros mercados */}
              {otherValueBets.length > 0 && (
                <div className="bg-gray-800/80 rounded-xl p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Value bets en otros mercados</p>
                  <div className="space-y-1.5">
                    {otherValueBets.map(([k, v]) => (
                      <div key={k} className="flex justify-between items-center">
                        <span className="text-sm text-white">{MKT_LABEL[k] ?? k}</span>
                        <span className="text-green-400 text-sm font-bold">EV +{(v.ev * 100).toFixed(1)}% · {v.odd.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Comparar cuotas */}
              {oddsComp && oddsComp.bookmakers?.length > 0 && (
                <div className="bg-gray-800/80 rounded-xl p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">
                    Comparar cuotas — {MKT_LABEL[oddsComp.market] ?? oddsComp.market}
                  </p>
                  <div className="space-y-1.5">
                    {oddsComp.bookmakers.map((bm: any) => (
                      <div
                        key={bm.key}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 ${bm.is_best ? "bg-green-900/40 border border-green-700" : "bg-gray-700/60"}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-white">{bm.name}</span>
                          {bm.is_betsson && <span className="text-xs bg-blue-700 text-white px-1.5 py-0.5 rounded">Betsson</span>}
                          {bm.is_best && <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded font-bold">Mejor</span>}
                        </div>
                        <span className={`text-sm font-black ${bm.is_best ? "text-green-300" : "text-gray-200"}`}>
                          {bm.odd.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 mt-2 text-center">Cuotas actualizadas cada hora · Odds API</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Otras opciones ──────────────────────────────────── */}
      {pred && rest.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">Otras opciones</p>
          <div className="space-y-2">
            {rest.map((b) => (
              <div key={b.market} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                <p className="font-medium text-white text-sm flex-1">{b.label}</p>
                <div className="w-20 bg-gray-800 rounded-full h-1.5 flex-none">
                  <div className="bg-gray-600 h-1.5 rounded-full" style={{ width: `${b.prob * 100}%` }} />
                </div>
                <p className="text-base font-black text-gray-300 w-10 text-right flex-none">
                  {(b.prob * 100).toFixed(0)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Acierto del modelo (partidos terminados) ────────── */}
      {pred && match.status === "finished" && match.home_goals != null && (() => {
        const maxProb   = Math.max(pred.home_win_prob, pred.draw_prob, pred.away_win_prob);
        const predicted = pred.home_win_prob === maxProb ? "home" : pred.away_win_prob === maxProb ? "away" : "draw";
        const actual    = match.home_goals > match.away_goals ? "home" : match.away_goals > match.home_goals ? "away" : "draw";
        const correct   = predicted === actual;
        const labels: Record<string, string> = { home: `Ganaba ${homeName}`, draw: "Empataba", away: `Ganaba ${awayName}` };
        return (
          <div className={`border rounded-2xl p-4 mb-4 flex items-center gap-3 ${correct ? "bg-green-900/20 border-green-700" : "bg-red-900/20 border-red-700"}`}>
            <span className="text-2xl">{correct ? "✅" : "❌"}</span>
            <div>
              <p className="font-semibold text-sm">El modelo {correct ? "acertó" : "no acertó"} este partido</p>
              <p className="text-xs text-gray-400 mt-0.5">Predijo: {labels[predicted]} · Real: {labels[actual]}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Registrar apuesta ───────────────────────────────── */}
      {match.status !== "finished" && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">💰 Registrar esta apuesta</p>
            {betSaved && <span className="text-xs bg-green-600 text-white px-3 py-1 rounded-full">¡Guardada!</span>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">Guardala para ver tu historial y ganancias</p>

          {!betForm.show ? (
            <button
              onClick={() => setBetForm((f) => ({ ...f, show: true, selection: top?.market ?? "home" }))}
              className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              + Añadir apuesta
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">¿A qué apostás?</label>
                <select
                  value={betSelection}
                  onChange={(e) => setBetForm((f) => ({ ...f, selection: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  <option value="home">Gana {homeName}</option>
                  <option value="draw">Empate</option>
                  <option value="away">Gana {awayName}</option>
                  <option value="over25">Over 2.5 goles</option>
                  <option value="under25">Under 2.5 goles</option>
                  <option value="btts">Ambos anotan</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Monto ($)</label>
                  <input
                    type="number" min="0" placeholder="ej: 500"
                    value={betForm.amount}
                    onChange={(e) => setBetForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Odds de Betsson</label>
                  <input
                    type="number" min="1.01" step="0.01" placeholder="ej: 1.80"
                    value={betForm.odds}
                    onChange={(e) => setBetForm((f) => ({ ...f, odds: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none text-sm"
                  />
                </div>
              </div>
              {betForm.amount && betForm.odds && parseFloat(betForm.odds) > 1 && (
                <p className="text-sm text-gray-400 bg-gray-800 rounded-lg px-3 py-2">
                  Ganancia potencial: <span className="text-green-400 font-bold">${(parseFloat(betForm.amount) * parseFloat(betForm.odds)).toFixed(2)}</span>
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveBet}
                  disabled={!betForm.amount || !betForm.odds || parseFloat(betForm.odds) <= 1}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  Guardar apuesta
                </button>
                <button
                  onClick={() => setBetForm((f) => ({ ...f, show: false }))}
                  className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Estadísticas completas (colapsable) ─────────────── */}
      {pred && (
        <button
          onClick={() => setShowStats((v) => !v)}
          className="w-full text-center text-xs text-gray-500 hover:text-gray-300 py-2 transition-colors mb-2"
        >
          {showStats ? "▲ Ocultar estadísticas" : "▼ Ver estadísticas completas del modelo"}
        </button>
      )}

      {showStats && pred && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-4 text-sm">
          <h3 className="font-semibold text-gray-300 mb-4">Estadísticas del modelo</h3>

          <div className="mb-4">
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-1">
              <div className="bg-blue-500" style={{ width: `${pred.home_win_prob * 100}%` }} />
              <div className="bg-gray-500" style={{ width: `${pred.draw_prob * 100}%` }} />
              <div className="bg-red-500"  style={{ width: `${pred.away_win_prob * 100}%` }} />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span className="text-blue-400">{homeName} {(pred.home_win_prob * 100).toFixed(1)}%</span>
              <span>Empate {(pred.draw_prob * 100).toFixed(1)}%</span>
              <span className="text-red-400">{awayName} {(pred.away_win_prob * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Goles esperados", value: `${pred.predicted_home_goals} — ${pred.predicted_away_goals}` },
              { label: "Over 2.5",        value: `${(pred.over25_prob * 100).toFixed(1)}%` },
              { label: "Ambos anotan",    value: `${(pred.btts_prob * 100).toFixed(1)}%` },
              { label: "Under 2.5",       value: `${(pred.under25_prob * 100).toFixed(1)}%` },
              { label: "ELO Local",       value: pred.home_elo_used?.toFixed(0) ?? "—" },
              { label: "ELO Visitante",   value: pred.away_elo_used?.toFixed(0) ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className="font-bold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
