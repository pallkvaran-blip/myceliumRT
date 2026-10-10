"""THE DEEP MINE — CAREER MODEL (finishing plan, numbers model; committed in M14).

The design-time model (lead designer, 25 Sep 2026) with its inputs made REPLACEABLE, so M14 can re-run it
on what the bots measured and compare its runs-per-leg with the bot careers (plan F, G12: within +-25%).

  python3 tests/bots/econ-model.py [seed]                       one career, every run printed
  python3 tests/bots/econ-model.py --sweep [--inputs m.json]    40 careers, the plan's summary
  python3 tests/bots/econ-model.py --compare a.json b.json ...  --inputs m.json   model vs bot careers
      (a.json ... = tests/bots/journey.cjs logs; prints runs per leg, bot median vs model median, and
       whether each leg is within +-25%; exits 1 on a miss)

--inputs is a JSON object; any of these keys replaces the design value:
  band_digs   descent digs per 42 m band at grow 2           (design: 13, 11, 10, 8)
  lat_digs    lateral digs per 24 m chunk at grow 2, by band (design: 7.5, 9, 9, 9)
  oh_first / oh_step / oh_floor   the overhead on navigator digs: first attempt, fall per attempt, floor
              (design 2.0 / 0.15 / 1.4 — a HUMAN; a bot replaying a known route measures nearer 1)
  legs        the leg table rows (name, E, crossing m, taproot m, worm mult, mould mult, safeDepth, bonus)
  store       {track: [[cur, amount], ...]} overrides
  start_water, water_step, heat_step, pocket, p_seam, reach_m_per_p, east_m_per_p, min_pay
"""
import math, random, sys, json, statistics

BAND_DIGS = [13, 11, 10, 8]
LAT_DIGS = [7.5, 9, 9, 9]
SEC_PER_DIG = 1.7          # human drag pace incl. thinking
RUN_OVERHEAD_S = 15        # end screen + store + descend
# ---------------------------------------------------------------- DESIGN
START_WATER = 60
WATER_STEP = 12
POCKET = 10
P_SEAM = 3
PILE_MULT = [1, 1, 0.6, 1]   # band-2 seams per chunk 2 -> 1.2 (tuning knob pilesPerBand by band)
MAT_AVG = 3                # 2 a seam, 1 in 4 rich x3 = 6 -> mean 3
REACH_M_PER_P = 5
EAST_M_PER_P = 10
MIN_PAY = 5
HEAT_STEP = 14
GROW_EXP = 0.8
# leg: (name, E chunks east, crossing depth m, taproot depth m, worm mult, mould chunks mult, safeDepth, bonus)
LEGS = [
  ('First Light',       4,  21,  24, 0,   0,   42, 20),
  ('The Coal Road',     5,  57,  58, 1,   0,   42, 30),
  ('Dry Ground',        8,  66,  72, 1.5, 0,   42, 40),
  ('Mould Country',     9,  66,  92, 1,   1.5, 42, 50),
  ('Rich Veins',       11,  75, 104, 1,   1,   42, 60),
  ('Hot Rock',         10,  78, 112, 1,   1,   36, 70),
  ('The Swarm',        13,  93, 126, 2,   1,   42, 85),
  ('The Promised Land',15,  96, 140, 1.5, 1.5, 42, 150),
]
STORE = {
  'water':   [('P', 5), ('P', 12), ('P', 25), ('P', 45), ('P', 80), ('A', 30), ('G', 24), ('H', 16)],
  'grow':    [('P', 12), ('P', 35), ('A', 20), ('G', 24)],
  'heat':    [('P', 15), ('A', 14), ('A', 24), ('G', 20)],
  'flask':   [('P', 10), ('P', 40), ('A', 14)],
  'enzyme':  [('P', 15), ('P', 50), ('G', 14)],
  'vial':    [('P', 50), ('G', 12), ('H', 12)],
  'cIsland': [('P', 12), ('P', 40)],
  'cA':      [('P', 20), ('P', 60), ('A', 12)],
  'cG':      [('P', 40), ('P', 100), ('G', 12)],
  'cH':      [('P', 60), ('P', 140), ('H', 12)],
}
REVEAL = {
  'water': lambda s: True, 'grow': lambda s: True,
  'heat': lambda s: s['deepest'] > 42,
  'flask': lambda s: s['leg'] >= 2 or s['deepest'] > 50,
  'enzyme': lambda s: s['leg'] >= 4 or s['deepest'] > 90,
  'vial': lambda s: s['leg'] >= 3,
  'cIsland': lambda s: s['runs'] >= 2,
  'cA': lambda s: s['everMat']['A'], 'cG': lambda s: s['everMat']['G'], 'cH': lambda s: s['everMat']['H'],
}
PRIORITY = ['water1', 'grow', 'heat', 'water', 'flask', 'enzyme', 'cIsland', 'cA', 'cG', 'vial', 'cH']

def apply_inputs(inp):
    """Replace the design inputs with measured ones (see the module docstring)."""
    g = globals()
    for k, name in [('band_digs', 'BAND_DIGS'), ('lat_digs', 'LAT_DIGS'), ('start_water', 'START_WATER'),
                    ('water_step', 'WATER_STEP'), ('pocket', 'POCKET'), ('p_seam', 'P_SEAM'),
                    ('reach_m_per_p', 'REACH_M_PER_P'), ('east_m_per_p', 'EAST_M_PER_P'), ('min_pay', 'MIN_PAY'),
                    ('oh_first', 'OH_FIRST'), ('oh_step', 'OH_STEP'), ('oh_floor', 'OH_FLOOR'),
                    ('heat_step', 'HEAT_STEP'), ('pocket_detour', 'POCKET_DETOUR')]:
        if k in inp: g[name] = inp[k]
    if 'legs' in inp: g['LEGS'] = [tuple(r) for r in inp['legs']]
    if 'store' in inp:
        for k, v in inp['store'].items(): STORE[k] = [tuple(x) for x in v]

OH_FIRST, OH_STEP, OH_FLOOR = 2.0, 0.15, 1.4
POCKET_DETOUR = 2

def price(depth, heat_lvl, safe=42):
    first = safe + HEAT_STEP * heat_lvl
    if depth <= first: return 2
    return 2 * min(8, 2 ** math.ceil((depth - first) / 42))

def band_of(m): return max(0, min(3, int(m // 42)))
def gfac(steps): return (2 / steps) ** GROW_EXP

def overhead(att, compass):
    o = max(OH_FLOOR, OH_FIRST - OH_STEP * att)
    return max(min(1.3, OH_FLOOR), o - 0.08 * min(2, compass))

def vertical(m0, m1, heat, gf, oh, safe):
    """water and digs to go from m0 down to m1"""
    w = d = 0.0; m = m0
    while m < m1 - 1e-9:
        b = band_of(m); per = 42 / BAND_DIGS[b]; st = min(per, m1 - m); f = st / per
        w += f * price(m, heat, safe) * gf * oh; d += f * gf * oh; m += st
    return w, d

def simulate(seed=1, jitter=0.10, verbose=False):
    rnd = random.Random(seed)
    s = dict(lv={k: 0 for k in STORE}, P=0, mats={'A': 0, 'G': 0, 'H': 0}, leg=1, att=0, t=0.0, runs=0,
             deepest=0, everMat={'A': False, 'G': False, 'H': False}, dived=False)
    rows = []; legs = {}
    for run in range(1, 400):
        L = s['leg']; name, E, C, D, wm, mm, safe, bonus = LEGS[L - 1]
        steps = 2 + s['lv']['grow']; gf = gfac(steps); heat = s['lv']['heat']
        start = START_WATER + WATER_STEP * s['lv']['water']
        oh = overhead(s['att'], s['lv']['cIsland']) * (1 + rnd.uniform(-jitter, jitter))
        mode = 'leg'
        # dive when the next power rung is blocked on a material this leg's route does not pay
        if s['att'] >= 2 and not s['dived']:
            for k in ['grow', 'heat', 'water']:
                if not REVEAL[k](s) or s['lv'][k] >= len(STORE[k]): continue
                cur, amt = STORE[k][s['lv'][k]]
                if cur != 'P' and s['mats'][cur] < amt and band_of(C) != 'xAGH'.index(cur):
                    mode = 'dive:' + cur
                break
        s['dived'] = mode != 'leg'
        water = float(start)
        digs = 0.0; depth_m = 0.0; east_m = 0.0; reached = False; mats = {'A': 0, 'G': 0, 'H': 0}; pseams = 1.0
        # a band-0 pocket near the hill
        water += POCKET - POCKET_DETOUR * 2 * gf; digs += POCKET_DETOUR * gf
        items_f = s['lv']['flask']; items_e = s['lv']['enzyme']
        if mode == 'leg':
            tgt_c = C
            w1, d1 = vertical(0, C, heat, gf, oh, safe)
            # worms met on the way down through band 1+
            drain_per_chunk = (5.0 if items_f == 0 else (1.5 if items_f == 1 else 0.8)) * wm
            if water >= w1:
                water -= w1; digs += d1; depth_m = C
                if C < 42: pseams += 0.3 * 1
                pc = price(C, heat, safe)
                lat = LAT_DIGS[band_of(C)] * gf * oh
                pk = 0.5 * max(0.0, POCKET - 2.5 * pc * gf)
                mould_on = band_of(C) >= 2 or (mm > 0 and band_of(C) >= 1 and L >= 4)
                breach_rate = 0.18 * mm if mould_on else 0.0
                chunks_to_end = (items_e + 1) / breach_rate if breach_rate > 0 else 1e9
                done = 0.0
                while done < E:
                    step = min(0.25, E - done)
                    c = (lat * pc + drain_per_chunk * (1 if C >= 42 else 0) - pk) * step
                    if done + step > chunks_to_end:
                        # rot: 20 s ~ 12 digs more, then the colony fruits
                        extra = 12 / (lat / 1) if lat > 0 else 0
                        done = min(E, done + extra * step)
                        break
                    if water >= c:
                        water -= c; done += step; digs += lat * step
                    else:
                        f = max(0.0, water / c) if c > 0 else 1; done += f * step; digs += lat * step * f; water = 0; break
                east_m = 24 * done
                if C < 42: pseams += 0.6 * done
                else:
                    k = 'xAGH'[band_of(C)]
                    rate = (0.45 + 0.15 * min(2, s['lv'].get('c' + k, 0))) * PILE_MULT[band_of(C)]
                    mats[k] += MAT_AVG * rate * done
                # descend band crossings on the way down
                for b in range(1, band_of(C) + 1):
                    if C >= b * 42 + 8: mats['xAGH'[b]] += MAT_AVG * 0.4
                if done >= E - 1e-6:
                    w2, d2 = vertical(C, D, heat, gf, oh, safe)
                    if water >= w2:
                        water -= w2; digs += d2; depth_m = D; reached = True
                    else:
                        # partial
                        m = C
                        while m < D:
                            c = price(m, heat, safe) * gf * oh
                            if water < c: break
                            water -= c; m += 42 / BAND_DIGS[band_of(m)]; digs += gf * oh
                        depth_m = min(D, m)
                    if D > C and band_of(D) > band_of(C) and depth_m >= band_of(D) * 42 + 4:
                        mats['xAGH'[band_of(D)]] += MAT_AVG * 0.5
            else:
                m = 0.0
                while m < 168:
                    c = price(m, heat, safe) * gf * oh
                    if water < c: break
                    water -= c; m += 42 / BAND_DIGS[band_of(m)]; digs += gf * oh
                depth_m = m; east_m = 6
        else:
            k = mode[-1]; b = 'xAGH'.index(k)
            m = 0.0
            target = b * 42 + 20
            while m < target:
                c = price(m, heat, safe) * gf * oh
                if water < c: break
                water -= c; m += 42 / BAND_DIGS[band_of(m)]; digs += gf * oh
            depth_m = m
            for bb in range(1, b):
                mats['xAGH'[bb]] += MAT_AVG * 0.4
            if m >= b * 42:
                sc = 3.5 * price(m, heat, safe) * gf * oh * (0.7 if s['lv'].get('c' + k, 0) else 1.0)
                n = min(6, int(water // sc)) if sc > 0 else 0
                mats[k] += MAT_AVG * n; digs += 3.5 * gf * oh * n; east_m = 5 * n
        mats = {k: int(round(v)) for k, v in mats.items()}
        reachP = max(MIN_PAY, int(depth_m // REACH_M_PER_P) + int(east_m // EAST_M_PER_P))
        pP = P_SEAM * int(round(pseams))
        b_ = bonus if reached else 0
        gotP = reachP + pP + b_
        s['P'] += gotP
        for k in mats:
            s['mats'][k] += mats[k]
            if mats[k]: s['everMat'][k] = True
        s['deepest'] = max(s['deepest'], depth_m)
        secs = digs * SEC_PER_DIG
        s['t'] += secs + RUN_OVERHEAD_S
        s['runs'] += 1
        bought = []
        while True:
            pick = None
            for k in PRIORITY:
                kk = 'water' if k == 'water1' else k
                if k == 'water1' and s['lv']['water'] > 0: continue
                if not REVEAL[kk](s): continue
                lv = s['lv'][kk]
                if lv >= len(STORE[kk]): continue
                cur, amt = STORE[kk][lv]
                if (s['P'] if cur == 'P' else s['mats'][cur]) >= amt: pick = kk; break
            if not pick: break
            cur, amt = STORE[pick][s['lv'][pick]]
            if cur == 'P': s['P'] -= amt
            else: s['mats'][cur] -= amt
            s['lv'][pick] += 1; bought.append(pick + str(s['lv'][pick]))
        rows.append(dict(run=run, leg=L, att=s['att'] + 1, mode=mode, secs=round(secs), start=start, steps=steps,
                         heat=heat, depth=round(depth_m), east=round(east_m), reached=reached, P=gotP, reachP=reachP,
                         bonus=b_, mats=mats, bought=bought, wallet=s['P'], wm=dict(s['mats']), tmin=s['t'] / 60,
                         oh=round(oh, 2)))
        if reached:
            legs[L] = (run, round(s['t'] / 60, 1)); s['leg'] += 1; s['att'] = 0; s['dived'] = False
            if s['leg'] > len(LEGS): break
        else:
            s['att'] += 1
    return rows, legs, s

def summary(rows, legs, s, show=True):
    dead = sum(1 for r in rows if not r['bought'])
    dead10 = sum(1 for r in rows[:10] if not r['bought'])
    if show:
        for r in rows:
            m = {k: v for k, v in r['mats'].items() if v}
            print(f"R{r['run']:>3} L{r['leg']}.{r['att']:<2} {r['mode']:<6} {r['secs']:>4}s W{r['start']:>4} g{r['steps']} h{r['heat']} oh{r['oh']} "
                  f"d{r['depth']:>4} e{r['east']:>4} {'ISLE' if r['reached'] else '    '} +{r['P']:>3}P(r{r['reachP']:>3} b{r['bonus']:>3}) "
                  f"{str(m):<18} buy {','.join(r['bought']) or '-':<26} P={r['wallet']:>4} {r['wm']} t={r['tmin']:.1f}m")
    tot = {c: sum(a for v in STORE.values() for cc, a in v if cc == c) for c in 'PAGH'}
    nr = sum(len(v) for v in STORE.values())
    bought = sum(s['lv'].values())
    left = {k: len(STORE[k]) - s['lv'][k] for k in STORE if len(STORE[k]) - s['lv'][k]}
    print('legs (run, min):', legs)
    print(f"runs {len(rows)}  dead {dead} ({100*dead/len(rows):.0f}%), first10 {dead10}  rungs {bought}/{nr} ({100*bought/nr:.0f}%) "
          f"store {tot} unbought {left} wallet P={s['P']} {s['mats']}")
    return dead, legs

def sweep(seeds=range(1, 41), quiet=False):
    res = []
    for sd in seeds:
        rows, legs, st = simulate(sd)
        per = [legs[l][0] - (legs[l - 1][0] if l > 1 else 0) for l in sorted(legs)]
        res.append(dict(done=len(legs) == len(LEGS), runs=len(rows), mins=rows[-1]['tmin'], per=per,
                        dead=sum(1 for r in rows if not r['bought']), dead10=sum(1 for r in rows[:10] if not r['bought'])))
    ok = [r for r in res if r['done']]
    if not quiet:
        print('finished', len(ok), '/', len(res))
        if ok:
            print('runs median', statistics.median(r['runs'] for r in ok), 'minutes median', round(statistics.median(r['mins'] for r in ok)))
            print('dead% median', round(100 * statistics.median(r['dead'] / r['runs'] for r in ok)), 'dead in first 10 max', max(r['dead10'] for r in ok))
            for l in range(len(LEGS)): print(' leg', l + 1, 'runs median', statistics.median(r['per'][l] for r in ok), 'max', max(r['per'][l] for r in ok))
    return res

def compare(paths):
    """Runs per leg: the bot careers (journey.cjs logs) against the model's median. G12: within +-25%."""
    bot = {}
    for pth in paths:
        log = json.load(open(pth)); prev = 0
        for r in log:
            if r.get('cause') in ('island', 'promised'):
                bot.setdefault(r['leg'], []).append(r['run'] - prev); prev = r['run']
    res = sweep(quiet=True); ok = [r for r in res if r['done']] or res
    miss = 0
    print('leg | bot runs (each career) | bot median | model median | within 25%')
    for l in range(1, len(LEGS) + 1):
        b = bot.get(l, [])
        m = statistics.median(r['per'][l - 1] for r in ok if len(r['per']) >= l) if any(len(r['per']) >= l for r in ok) else None
        if not b or m is None: print(f'{l} | {b} | - | {m} | n/a'); continue
        bm = statistics.median(b); w = abs(m - bm) <= 0.25 * bm + 1e-9
        miss += 0 if w else 1
        print(f'{l} | {b} | {bm} | {m} | {"yes" if w else "NO"}')
    tb = sum(statistics.median(v) for v in bot.values()) if bot else 0
    tm = statistics.median(r['runs'] for r in ok)
    print(f'total | bot {tb} | model {tm} | {"yes" if abs(tm - tb) <= 0.25 * tb else "NO"}')
    return miss

if __name__ == '__main__':
    a = sys.argv[1:]
    if '--inputs' in a:
        i = a.index('--inputs'); apply_inputs(json.load(open(a[i + 1]))); del a[i:i + 2]
    if a and a[0] == '--sweep': sweep()
    elif a and a[0] == '--compare': sys.exit(1 if compare(a[1:]) else 0)
    else:
        seed = int(a[0]) if a else 1
        rows, legs, s = simulate(seed)
        summary(rows, legs, s, show=True)
