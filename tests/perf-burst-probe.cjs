/* PERF BURST PROBE (M15 verify round 2) — a tool, prints and never fails. Rebuilds release-check's perf state (leg 4,
 * 3,000 strands, 16 worms on screen, 390x844, dsf 2, raster forced per frame with a 1 px readback), times BLOCKS
 * of 100 synchronous frames like the gate does, and records a Chrome trace over them: every timed frame is a
 * `performance.measure`, so each slow frame can be read against the GC events and the CPU samples that fall
 * inside it. Prints per block p50/p95/p99, the runs of consecutive frames over 25 ms, and for the slow frames vs
 * the rest: GC milliseconds per frame (by kind) and the top self-time functions.
 *   node tests/perf-burst-probe.cjs [blocks] [--dsf 2] [--no-trace]
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BLOCKS = +(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 8);
const DSF = +arg('--dsf', 2), TRACE = !process.argv.includes('--no-trace');
// `--fixed-t`: every frame drawn at ONE clock (dt 0), i.e. the same picture each time — a burst that survives this
// is the raster or the host, not anything the frame draws differently. `--ctl`: a fixed CPU workload timed between
// frames (a host-contention control: if it slows in the same frames, the machine did).
const FIXED = process.argv.includes('--fixed-t'), CTL = process.argv.includes('--ctl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };

(async () => {
  const E = await H.start();
  const b = await LP.openLeg(E, 4, 0, 390, 844, undefined, { dsf: DSF });
  await LP.measure(b.page);
  await LP.perfState(b.page, { want: 3000, threats: true });
  await b.page.evaluate(() => { window.__game.state.active.water = 9999; });
  await sleep(3000);
  const W = await b.page.evaluate(() => {
    const g = window.__game, s = g.state, cam = g.camera, net = s.active;
    const halfW = cam.viewW / (2 * cam.zoom), halfH = cam.viewH / (2 * cam.zoom);
    const inView = net.nodes.filter((n) => !n.infected && Math.abs(n.x - cam.x) < halfW * 0.9 && Math.abs(n.y - cam.y) < halfH * 0.9);
    const proto = s.nematodes[0] || (window.__perfKeep && window.__perfKeep.worms[0]);
    if (!proto || !inView.length) return { ok: false };
    const worms = s.nematodes.slice(0, 16);
    while (worms.length < 16) worms.push(JSON.parse(JSON.stringify(proto)));
    worms.forEach((w, i) => { const n = inView[Math.floor((i + 0.5) * inView.length / 16)]; w.x = n.x + 6; w.y = n.y + 6; w.tx = n.x; w.ty = n.y; });
    s.nematodes.length = 0; s.nematodes.push(...worms);
    if (s.config.mine && s.config.mine.worms) s.config.mine.worms.breedPerSec = 0;
    if (s.config.nematodes) s.config.nematodes.respawnChance = 0;
    return { ok: true, nodes: net.nodes.length, clouds: s.clouds.length };
  });
  console.log('state', JSON.stringify(W));
  await sleep(1500);
  if (TRACE) await E.browser.startTracing(b.page, { categories: ['devtools.timeline', 'blink.user_timing', 'v8', 'disabled-by-default-v8.gc',
    'disabled-by-default-v8.cpu_profiler', 'disabled-by-default-devtools.timeline'] });
  const blocks = [];
  for (let k = 0; k < BLOCKS; k++) {
    blocks.push(await b.page.evaluate(([k, FIXED, CTL]) => {
      const g = window.__game, c = document.getElementById('game').getContext('2d'), out = [], ctl = [];
      if (g.state.nematodes.length > 16) g.state.nematodes.length = 16;
      let t = performance.now();
      const work = () => { const a = performance.now(); let x = 0; for (let j = 0; j < 400000; j++) x += Math.sqrt(j * 1.0001); ctl.push(performance.now() - a); return x; };
      for (let i = 0; i < 104; i++) {
        if (!FIXED) t += 16.7;
        if (CTL) work();
        const a = performance.now();
        performance.mark('f' + k + '_' + i + '_s');
        g.renderFrame(t, FIXED ? 0 : 1); c.getImageData(0, 0, 1, 1);
        performance.mark('f' + k + '_' + i + '_e');
        performance.measure('frame:' + k + ':' + i, 'f' + k + '_' + i + '_s', 'f' + k + '_' + i + '_e');
        out.push(performance.now() - a); (window.__fe = window.__fe || []).push([performance.timeOrigin + a, performance.now() - a]);
      }
      performance.clearMarks();
      return { ms: out.slice(4), ctl: ctl.slice(4), mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
    }, [k, FIXED, CTL]));
    await sleep(300);
  }
  // `--epoch <file>`: every timed frame as [epoch ms, ms], to line up against a host sampler (tests' /proc/stat).
  if (arg('--epoch', null)) fs.writeFileSync(arg('--epoch'), JSON.stringify(await b.page.evaluate(() => window.__fe || [])));
  let trace = null;
  if (TRACE) { const buf = await E.browser.stopTracing(); trace = JSON.parse(buf.toString()); }
  // per block
  const all = [];
  blocks.forEach((B, k) => {
    const runs = []; let r = 0, maxRun = 0, starts = [];
    B.ms.forEach((v, i) => { if (v > 25) { if (!r) starts.push(i + 4); r++; maxRun = Math.max(maxRun, r); } else { if (r) runs.push(r); r = 0; } all.push(v); });
    if (r) runs.push(r);
    if (CTL && B.ctl.length) { const sl = B.ms.map((v, i) => [v, B.ctl[i]]); const cs = sl.filter((x) => x[0] > 25).map((x) => x[1]), cf = sl.filter((x) => x[0] <= 25).map((x) => x[1]);
      console.log(`  control work: median ${pct(B.ctl, 0.5).toFixed(2)} ms; beside slow frames ${cs.length ? pct(cs, 0.5).toFixed(2) : '-'} ms, beside fast ${pct(cf, 0.5).toFixed(2)} ms`); }
    console.log(`block ${k}: p50 ${pct(B.ms, 0.5).toFixed(1)} p95 ${pct(B.ms, 0.95).toFixed(1)} p99 ${pct(B.ms, 0.99).toFixed(1)} max ${Math.max(...B.ms).toFixed(1)}; frames > 25 ms ${B.ms.filter((v) => v > 25).length}, longest run ${maxRun} (runs start at ${starts.join(',') || '-'}); heap ${B.mem} MB`);
  });
  console.log(`POOLED over ${all.length}: p50 ${pct(all, 0.5).toFixed(1)} p95 ${pct(all, 0.95).toFixed(1)} p99 ${pct(all, 0.99).toFixed(1)}`);
  if (trace) {
    const ev = trace.traceEvents || trace;
    const frames = ev.filter((e) => e.cat && e.cat.includes('blink.user_timing') && /^frame:/.test(e.name) && (e.ph === 'b' || e.ph === 'e'));
    // async begin/end pairs by id
    const open = new Map(), F = [];
    for (const e of frames) { const key = e.name + ':' + e.id2?.local + e.id; if (e.ph === 'b') open.set(e.name, e.ts); else if (open.has(e.name)) { F.push({ name: e.name, t0: open.get(e.name), t1: e.ts }); open.delete(e.name); } }
    const ms = new Map(); blocks.forEach((B, k) => B.ms.forEach((v, i) => ms.set(`frame:${k}:${i + 4}`, v)));
    const fr = F.filter((f) => ms.has(f.name)).map((f) => ({ ...f, ms: ms.get(f.name) }));
    const gcEv = ev.filter((e) => e.ph === 'X' && /GC|Scavenge|MarkCompact|Mark|Sweep/.test(e.name) && e.dur);
    const gcIn = (f) => { const by = {}; for (const g of gcEv) { const a = Math.max(f.t0, g.ts), z = Math.min(f.t1, g.ts + g.dur); if (z > a) by[g.name] = (by[g.name] || 0) + (z - a) / 1000; } return by; };
    const slow = fr.filter((f) => f.ms > 25), fast = fr.filter((f) => f.ms <= 25);
    const sumBy = (L) => { const o = {}; for (const f of L) { const g = gcIn(f); for (const k in g) o[k] = (o[k] || 0) + g[k]; } for (const k in o) o[k] = +(o[k] / Math.max(1, L.length)).toFixed(2); return o; };
    console.log(`frames matched in the trace: ${fr.length} (slow ${slow.length}, fast ${fast.length})`);
    console.log('GC ms per SLOW frame by event:', JSON.stringify(Object.entries(sumBy(slow)).sort((a, b) => b[1] - a[1]).slice(0, 8)));
    console.log('GC ms per fast frame by event:', JSON.stringify(Object.entries(sumBy(fast)).sort((a, b) => b[1] - a[1]).slice(0, 8)));
    // CPU samples: ProfileChunk events carry nodes + samples + timeDeltas (ts accumulate from Profile.startTime)
    const prof = ev.filter((e) => e.name === 'Profile'), chunks = ev.filter((e) => e.name === 'ProfileChunk');
    const nodes = new Map(); let tcur = null; const samples = [];
    if (prof.length) tcur = prof[0].args.data.startTime;
    for (const c of chunks) {
      const d = c.args.data || {}, cp = d.cpuProfile || {};
      for (const n of cp.nodes || []) nodes.set(n.id, n.callFrame);
      const sm = cp.samples || [], td = d.timeDeltas || [];
      for (let i = 0; i < sm.length; i++) { tcur += td[i] || 0; samples.push({ t: tcur, id: sm[i] }); }
    }
    const selfBy = (L) => { const o = {}; let n = 0; for (const s of samples) { if (!L.some((f) => s.t >= f.t0 && s.t <= f.t1)) continue; const cf = nodes.get(s.id) || {}; const k = (cf.functionName || '(anon)') + (cf.url ? '' : ''); o[k] = (o[k] || 0) + 1; n++; }
      return { n, top: Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${(100 * v / Math.max(1, n)).toFixed(1)}%`) }; };
    const S = selfBy(slow), Q = selfBy(fast.slice(0, 400));
    console.log(`CPU self samples in SLOW frames (${S.n}): ${S.top.join(' | ')}`);
    console.log(`CPU self samples in fast frames (${Q.n}): ${Q.top.join(' | ')}`);
    // EVERY THREAD, not only the main one: getImageData WAITS for the raster, which runs elsewhere (the GPU process
    // under SwiftShader, raster workers). Complete events overlapping the slow frames, by name and thread, per frame,
    // against the same in the fast ones — what is the main thread waiting FOR?
    const tn = new Map(); for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name);
    const X = ev.filter((e) => e.ph === 'X' && e.dur > 200);
    const over = (L) => { const o = {}; for (const e of X) { for (const f of L) { const a = Math.max(f.t0, e.ts), z = Math.min(f.t1, e.ts + e.dur); if (z > a) { const k = (tn.get(e.pid + ':' + e.tid) || e.tid) + ' / ' + e.name; o[k] = (o[k] || 0) + (z - a) / 1000; } } }
      for (const k in o) o[k] = +(o[k] / Math.max(1, L.length)).toFixed(2); return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 16); };
    console.log('ms per SLOW frame, by thread / event:', JSON.stringify(over(slow)));
    console.log('ms per fast frame, by thread / event:', JSON.stringify(over(fast.slice(0, 300))));
    fs.writeFileSync(path.join(__dirname, '.artifacts', 'perf-burst-trace.json'), JSON.stringify({ frames: fr, gc: gcEv.slice(0, 5000) }));
  }
  await b.ctx.close(); await E.close();
})().catch((e) => { console.error(e); process.exit(1); });
