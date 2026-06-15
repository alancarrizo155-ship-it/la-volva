"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getMatch, getMatchMarkets, getOddsComparison } from "@/lib/api";
import { saveBet, type Pred } from "@/lib/predictions";

// ── Textos concretos de por qué apostar ─────────────────────
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

  const candidates = [
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

  return candidates;
}

// ── Calcular EV ───────────────────────────────────────────────
function calcEV(prob: number, odds: number) {
  return (prob * odds) - 1;
}

function EVMessage({ ev }: { ev: number }) {
  if (ev > 0.05)
    return <p className="text-green-400 font-bold text-sm">¡Hay valor! Betsson está pagando más de lo que debería. EV: +{(ev * 100).toFixed(1)}%</p>;
  if (ev > -0.05)
    return <p className="text-yellow-400 text-sm">Odd justa — sin ventaja clara. EV: {(ev * 100).toFixed(1)}%</p>;
  return <p className="text-red-400 text-sm">Betsson tiene ventaja en este mercado. EV: {(ev * 100).toFixed(1)}%</p>;
}

// ── Página principal ──────────────────────────────────────────
export default function MatchPage() {
  const { id } = useParams();
  const [match, setMatch]           = useState<any>(null);
  const [markets, setMarkets]       = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [showStats, setShowStats]   = useState(false);
  const [oddsComp, setOddsComp]     = useState<any>(null);
  const [showOddsComp, setShowOddsComp] = useState(false);

  // Odds rápidas para la apuesta principal
  const [quickOdds, setQuickOdds] = useState("");
  const [ev, setEv]               = useState<number | null>(null);
  const [kelly, setKelly]         = useState<number | null>(null);
  const [bankroll, setBankroll]   = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("lavolva_bankroll") || "";
    return "";
  });

  // Registrar apuesta
  const [betForm, setBetForm]   = useState({ show: false, selection: "", amount: "", odds: "" });
  const [betSaved, setBetSaved] = useState(false);

  function load() {
    setLoading(true);
    const matchId = Number(id);
    Promise.all([getMatch(matchId), getMatchMarkets(matchId)]).then(([matchData, mktData]) => {
      setMatch(matchData);
      setMarkets(mktData);
      setLoading(false);
      // Pre-cargar comparación para el mejor value bet
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
  if (!match)  return (
    <div className="text-center py-20">
      <p className="text-gray-400 mb-3">No se pudo conectar con el servidor.</p>
      <button onClick={load} className="text-blue-400 hover:underline text-sm">Reintentar</button>
    </div>
  );

  const pred      = match.predictions?.[0] as Pred | undefined;
  const homeName  = match.home_team?.name  ?? "Local";
  const awayName  = match.away_team?.name  ?? "Visitante";
  const homeCode  = match.home_team?.country_code ?? "";
  const awayCode  = match.away_team?.country_code ?? "";

  const bets      = pred ? getTopBets(pred, homeName, awayName) : [];

  // Value bets disponibles (prob >= 20% + EV > 0)
  const valueBets: Record<string, { odd: number; ev: number; value: boolean }> = markets?.value_bets ?? {};

  const MKT_LABEL: Record<string, string> = {
    home:    `Gana ${homeName}`,
    draw:    "Empate",
    away:    `Gana ${awayName}`,
    over25:  "Over 2.5 goles",
    under25: "Under 2.5 goles",
    btts:    "Ambos anotan",
  };

  // top = siempre la apuesta con mayor probabilidad del modelo
  const top        = bets[0];
  const topValueBet = top ? valueBets[top.market] : undefined;
  const hasAnyValue = Object.values(valueBets).some(v => v.value);
  // Value en mercados distintos al top recomendado
  const otherValueBets = Object.entries(valueBets)
    .filter(([k, v]) => v.value && k !== top?.market);
  const rest       = bets.slice(1, 4);
  const topWhy     = top && pred ? buildWhy(top.market, pred, homeName, awayName) : "";

  function handleQuickOdds(val: string) {
    setQuickOdds(val);
    const o = parseFloat(val);
    if (top && o > 1) {
      setEv(calcEV(top.prob, o));
      // Kelly: f = (p*b - q) / b  donde b = odds - 1
      const b = o - 1;
      const q = 1 - top.prob;
      const k = (top.prob * b - q) / b;
      setKelly(Math.max(0, k));
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

  // Inicializar selección del bet form con la mejor apuesta
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
        <div className={`border rounded-2xl p-6 mb-4 ${topValueBet?.value ? "bg-green-950 border-green-600" : hasAnyValue ? "bg-green-950/30 border-green-900" : "bg-blue-950 border-blue-700"}`}>
          {topValueBet?.value && (
            <div className="bg-green-500 text-black text-xs font-bold px-3 py-1 rounded-lg inline-block mb-3">
              VALUE BET · EV +{(topValueBet.ev * 100).toFixed(1)}%
            </div>
          )}
          {hasAnyValue && !topValueBet?.value && (
            <div className="bg-gray-700 text-gray-300 text-xs font-bold px-3 py-1 rounded-lg inline-block mb-3">
              VALUE BET disponible en otro mercado
            </div>
          )}
          <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${topValueBet?.value ? "text-green-400" : "text-blue-400"}`}>
            🎯 En este partido apostale a
          </p>

          <p className="text-3xl font-black text-white mb-1 leading-tight">{top.label}</p>

          <div className="flex items-end gap-3 mb-4">
            <p className={`text-5xl font-black ${topValueBet?.value ? "text-green-300" : "text-blue-300"}`}>{(top.prob * 100).toFixed(0)}%</p>
            <p className={`text-sm mb-2 ${topValueBet?.value ? "text-green-400" : "text-blue-400"}`}>de probabilidad</p>
          </div>

          <p className="text-gray-300 text-sm leading-relaxed mb-5">{topWhy}</p>

          {/* Odds automáticas o input manual */}
          <div className={`border rounded-xl p-4 ${topValueBet?.value ? "bg-green-900/30 border-green-800" : "bg-blue-900/40 border-blue-800"}`}>
            {topValueBet ? (
              <div>
                <p className="text-xs text-gray-400 mb-1">Cuota del mercado</p>
                <p className={`text-2xl font-black mb-1 ${topValueBet.value ? "text-green-400" : "text-gray-300"}`}>
                  {topValueBet.odd.toFixed(2)}
                </p>
                <EVMessage ev={topValueBet.ev} />
              </div>
            ) : (
              <>
                <p className="text-xs mb-2 font-medium text-blue-300">
                  ¿Cuánto paga Betsson por "{top.label}"?
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="1.01"
                    placeholder="ej: 1.80"
                    value={quickOdds}
                    onChange={(e) => handleQuickOdds(e.target.value)}
                    className="flex-1 bg-blue-900/60 border border-blue-700 rounded-lg px-3 py-2 text-white placeholder-blue-700 focus:border-blue-400 focus:outline-none text-sm"
                  />
                </div>
              </>
            )}
            {ev !== null && (
              <div className="mt-3 space-y-3">
                <EVMessage ev={ev} />

                {/* Kelly Criterion */}
                {kelly !== null && kelly > 0 && (
                  <div className="bg-blue-900/30 border border-blue-800 rounded-xl p-3">
                    <p className="text-xs text-blue-300 font-semibold mb-2">📐 Calculadora Kelly</p>
                    <p className="text-xs text-gray-400 mb-2">
                      El Kelly Criterion te dice cuánto de tu bankroll apostar para maximizar ganancias a largo plazo.
                    </p>
                    <div className="flex gap-2 items-center mb-2">
                      <input
                        type="number"
                        min="0"
                        placeholder="Tu bankroll total ($)"
                        value={bankroll}
                        onChange={(e) => handleBankroll(e.target.value)}
                        className="flex-1 bg-blue-900/60 border border-blue-700 rounded-lg px-3 py-1.5 text-white placeholder-blue-700 focus:border-blue-400 focus:outline-none text-sm"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-bold">
                          Apostar {(kelly * 100).toFixed(1)}% del bankroll
                        </p>
                        {bankroll && parseFloat(bankroll) > 0 && (
                          <p className="text-green-400 text-sm font-bold">
                            = ${(parseFloat(bankroll) * kelly).toFixed(2)}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 max-w-[140px] text-right">
                        {kelly > 0.25
                          ? "Señal muy fuerte — el Kelly sugiere una apuesta grande"
                          : kelly > 0.10
                          ? "Apuesta moderada"
                          : "Apuesta conservadora"}
                      </p>
                    </div>
                  </div>
                )}
                {kelly !== null && kelly <= 0 && (
                  <p className="text-xs text-red-400">Kelly dice: no apostar — sin ventaja matemática.</p>
                )}
              </div>
            )}
            {ev === null && (
              <p className="text-xs text-blue-600 mt-2">
                Ingresá la cuota de Betsson para saber si vale la pena apostar
              </p>
            )}
          </div>

          {/* Nota: hay valor en mercados distintos al top */}
          {otherValueBets.length > 0 && (
            <p className="text-xs text-green-600 mt-4">
              También hay valor en: {otherValueBets.map(([k, v]) => `${MKT_LABEL[k] ?? k} (${v.odd.toFixed(2)})`).join(", ")}
            </p>
          )}
        </div>
      )}

      {/* ── Comparador de cuotas ────────────────────────────── */}
      {oddsComp && oddsComp.bookmakers?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl mb-4 overflow-hidden">
          <button
            onClick={() => setShowOddsComp(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                🏦 Comparar cuotas — {MKT_LABEL[oddsComp.market] ?? oddsComp.market}
              </span>
              <span className="text-xs text-gray-500">{oddsComp.bookmakers.length} casas</span>
            </div>
            <span className="text-gray-500 text-xs">{showOddsComp ? "▲" : "▼"}</span>
          </button>

          {showOddsComp && (
            <div className="px-4 pb-4">
              <div className="space-y-1.5">
                {oddsComp.bookmakers.map((bm: any) => (
                  <div
                    key={bm.key}
                    className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                      bm.is_best ? "bg-green-900/40 border border-green-700" : "bg-gray-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{bm.name}</span>
                      {bm.is_betsson && (
                        <span className="text-xs bg-blue-700 text-white px-1.5 py-0.5 rounded">Betsson</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {bm.is_best && (
                        <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded font-bold">Mejor cuota</span>
                      )}
                      <span className={`text-lg font-black ${bm.is_best ? "text-green-300" : "text-gray-200"}`}>
                        {bm.odd.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-3 text-center">
                Cuotas actualizadas cada hora · Odds API
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Otras opciones ──────────────────────────────────── */}
      {pred && rest.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">
            Otras opciones
          </p>
          <div className="space-y-2">
            {rest.map((b) => (
              <div key={b.market} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                <div>
                  <p className="font-medium text-white text-sm">{b.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{buildWhy(b.market, pred, homeName, awayName).split(". ")[0]}.</p>
                </div>
                <p className="text-xl font-black text-gray-300 ml-4 flex-none">{(b.prob * 100).toFixed(0)}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Acierto del modelo (partidos terminados) ────────── */}
      {pred && match.status === "finished" && match.home_goals != null && (() => {
        const maxProb  = Math.max(pred.home_win_prob, pred.draw_prob, pred.away_win_prob);
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

          {/* Barra de probabilidades */}
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
              { label: "Over 2.5", value: `${(pred.over25_prob * 100).toFixed(1)}%` },
              { label: "Ambos anotan", value: `${(pred.btts_prob * 100).toFixed(1)}%` },
              { label: "Under 2.5", value: `${(pred.under25_prob * 100).toFixed(1)}%` },
              { label: "ELO Local", value: pred.home_elo_used?.toFixed(0) ?? "—" },
              { label: "ELO Visitante", value: pred.away_elo_used?.toFixed(0) ?? "—" },
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
