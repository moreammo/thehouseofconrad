// Pure tendency math. Used by the page and by the PDF build.
(function (root) {
  const distBucket = d => { d = +d; return !d ? '' : d <= 3 ? 'short (1-3)' : d <= 6 ? 'medium (4-6)' : 'long (7+)'; };
  const situation = p => p.down ? `${p.down}${{1:'st',2:'nd',3:'rd',4:'th'}[p.down]||''} & ${distBucket(p.dist) || '?'}` : '';
  const isRun = p => p.ptype === 'Run';
  const isPass = p => ['Pass', 'Screen'].includes(p.ptype);

  function avg(xs) { xs = xs.filter(x => x !== '' && x != null && !isNaN(x)).map(Number); return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null; }
  function top(xs) {
    const m = {}; xs.filter(Boolean).forEach(x => m[x] = (m[x] || 0) + 1);
    const best = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    return best ? `${best[0]} (${best[1]})` : '';
  }
  function group(plays, keyFn) {
    const m = new Map();
    plays.forEach(p => { const k = keyFn(p); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(p); } });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }
  const offRow = ([k, ps]) => {
    const tagged = ps.filter(p => p.ptype).length;
    return { key: k, n: ps.length, runPct: tagged ? Math.round(100 * ps.filter(isRun).length / tagged) : null,
      passPct: tagged ? Math.round(100 * ps.filter(isPass).length / tagged) : null,
      top: top(ps.map(p => p.concept)), dir: top(ps.map(p => p.dir)), yds: avg(ps.map(p => p.result)) };
  };
  const defRow = ([k, ps]) => {
    const tagged = ps.filter(p => p.blitz).length;
    return { key: k, n: ps.length, front: top(ps.map(p => p.front)), coverage: top(ps.map(p => p.coverage)),
      blitzPct: tagged ? Math.round(100 * ps.filter(p => p.blitz !== 'None').length / tagged) : null, yds: avg(ps.map(p => p.result)) };
  };
  function tendencies(plays) {
    const O = plays.filter(p => p.side === 'O'), D = plays.filter(p => p.side === 'D');
    const hash = p => p.hash || '';
    return {
      offense: { total: O.length, overall: offRow(['All', O]),
        byFormation: group(O, p => p.formation).map(offRow), bySituation: group(O, situation).map(offRow),
        byHash: group(O, hash).map(offRow), byConcept: group(O, p => p.concept).map(offRow), byCarrier: group(O, p => p.key && '#' + p.key).map(offRow) },
      defense: { total: D.length, overall: defRow(['All', D]),
        byFront: group(D, p => p.front).map(defRow), bySituation: group(D, situation).map(defRow),
        byOurFormation: group(D, p => p.formation).map(defRow) },
    };
  }
  // per jersey number: who gets the ball and what they do with it
  function carriers(plays) {
    const O = plays.filter(p => p.side === 'O' && p.key), total = O.length;
    return group(O, p => '#' + p.key).map(([k, ps]) => {
      const y = ps.map(p => p.result).filter(v => v !== '' && v != null && !isNaN(v)).map(Number), sum = y.reduce((a, b) => a + b, 0);
      return { key: k, n: ps.length, share: Math.round(100 * ps.length / total), runs: ps.filter(isRun).length, passes: ps.filter(isPass).length,
        yds: y.length ? sum : null, ypt: y.length ? +(sum / y.length).toFixed(1) : null, long: y.length ? Math.max(...y) : null,
        top: top(ps.map(p => p.concept)), dir: top(ps.map(p => p.dir)) };
    });
  }
  root.tendencies = tendencies; root.carriers = carriers;
  if (typeof module !== 'undefined') module.exports = { tendencies, situation, carriers };
})(typeof window !== 'undefined' ? window : globalThis);
