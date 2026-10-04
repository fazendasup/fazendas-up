#!/usr/bin/env python3
"""Análise estatística da apuração parcial 2026 (Flávio Bolsonaro × Lula)
comparada ao histórico das 8 eleições presidenciais (1994–2022).

Fonte da parcial: arquivos oficiais TSE EA20 (-u.json), eleição 6257.
Snapshot: 04/10/2026 ~18:44 (Brasília), ~47,26% das seções.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DADOS = ROOT / "dados"
UFS_DIR = DADOS / "ufs"
OUT_HTML = ROOT / "relatorio.html"
OUT_JSON = DADOS / "analise_completa.json"


def pct(s) -> float:
    if s is None:
        return 0.0
    s = str(s).strip()
    if not s:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "")
    return float(s.replace(",", "."))


def num(s) -> int:
    if s is None:
        return 0
    return int(str(s).replace(".", "").replace(",", ""))


def extract_cands(d: dict) -> list[dict]:
    cands = []
    for cargo in d.get("carg", []):
        pools = list(cargo.get("agr", []) or []) + list(cargo.get("fed", []) or [])
        for agr in pools:
            for par in agr.get("par") or []:
                for c in par.get("cand", []):
                    cands.append(
                        {
                            "numero": c.get("n"),
                            "nome": c.get("nmu") or c.get("nm"),
                            "partido": par.get("sg") or agr.get("com") or agr.get("sg"),
                            "votos": num(c.get("vap", "0")),
                            "pct": pct(c.get("pvap", "0")),
                        }
                    )
    by = {c["numero"]: c for c in cands}
    return sorted(by.values(), key=lambda x: -x["votos"])


def parse_file(path: Path) -> dict:
    d = json.loads(path.read_text())
    cands = extract_cands(d)
    flavio = next((c for c in cands if c["numero"] == "22"), None)
    lula = next((c for c in cands if c["numero"] == "13"), None)
    return {
        "uf": d["cdabr"].upper(),
        "atualizado": f"{d.get('dt')} {d.get('ht')}",
        "pct_secoes": pct(d["s"]["pst"]),
        "secoes_totalizadas": num(d["s"]["st"]),
        "secoes_total": num(d["s"]["ts"]),
        "pct_eleitorado": pct(d["e"]["pest"]),
        "comparecimento": pct(d["e"]["pc"]),
        "abstencao": pct(d["e"]["pa"]),
        "votos_validos": num(d["v"]["vv"]),
        "votos_total": num(d["v"]["tv"]),
        "flavio_pct": flavio["pct"] if flavio else None,
        "flavio_votos": flavio["votos"] if flavio else 0,
        "lula_pct": lula["pct"] if lula else None,
        "lula_votos": lula["votos"] if lula else 0,
        "lider": "Flávio"
        if flavio and lula and flavio["votos"] >= lula["votos"]
        else "Lula",
        "margem": (flavio["pct"] - lula["pct"]) if flavio and lula else None,
        "cands": cands,
    }


# 1º turno 2022 (TSE / Wikipedia) — Lula × Bolsonaro
HIST_2022_1T = {
    "AC": (29.26, 62.50),
    "AL": (56.50, 36.05),
    "AP": (45.67, 43.41),
    "AM": (49.58, 42.80),
    "BA": (69.73, 24.31),
    "CE": (65.91, 25.38),
    "DF": (36.85, 51.65),
    "ES": (40.40, 52.23),
    "GO": (39.51, 52.16),
    "MA": (68.84, 26.02),
    "MT": (34.39, 59.84),
    "MS": (39.04, 52.70),
    "MG": (48.29, 43.60),
    "PA": (52.22, 40.27),
    "PB": (64.21, 29.62),
    "PR": (35.99, 55.26),
    "PE": (65.27, 29.91),
    "PI": (74.25, 19.90),
    "RJ": (40.68, 51.09),
    "RN": (62.98, 31.02),
    "RS": (42.28, 48.89),
    "RO": (28.98, 64.36),
    "RR": (23.05, 69.57),
    "SC": (29.54, 62.21),
    "SP": (40.89, 47.71),
    "SE": (63.82, 29.16),
    "TO": (50.40, 44.00),
}

# 2º turno 2018 (Bolsonaro × Haddad) — lado direita × PT
HIST_2018_2T = {
    "AC": (77.22, 22.78),
    "AL": (40.08, 59.92),
    "AP": (50.21, 49.79),
    "AM": (50.27, 49.73),
    "BA": (27.31, 72.69),
    "CE": (28.89, 71.11),
    "DF": (69.99, 30.01),
    "ES": (63.06, 36.94),
    "GO": (65.52, 34.48),
    "MA": (26.74, 73.26),
    "MT": (66.42, 33.58),
    "MS": (65.22, 34.78),
    "MG": (58.19, 41.81),
    "PA": (45.19, 54.81),
    "PB": (35.04, 64.96),
    "PR": (68.43, 31.57),
    "PE": (33.50, 66.50),
    "PI": (22.95, 77.05),
    "RJ": (67.95, 32.05),
    "RN": (36.59, 63.41),
    "RS": (63.24, 36.76),
    "RO": (72.18, 27.82),
    "RR": (71.55, 28.45),
    "SC": (75.92, 24.08),
    "SP": (67.97, 32.03),
    "SE": (32.46, 67.54),
    "TO": (48.98, 51.02),
}

# Histórico nacional 1º turno (8 eleições)
HISTORICO_NACIONAL = [
    {
        "ano": 1994,
        "turno": 1,
        "primeiro": "FHC",
        "partido1": "PSDB",
        "pct1": 54.28,
        "segundo": "Lula",
        "partido2": "PT",
        "pct2": 27.04,
        "decisao": "1º turno",
        "nota": "Única vitória direta do ciclo moderno (com 1998).",
    },
    {
        "ano": 1998,
        "turno": 1,
        "primeiro": "FHC",
        "partido1": "PSDB",
        "pct1": 53.06,
        "segundo": "Lula",
        "partido2": "PT",
        "pct2": 31.71,
        "decisao": "1º turno",
        "nota": "Reeleição de FHC ainda no 1º turno.",
    },
    {
        "ano": 2002,
        "turno": 1,
        "primeiro": "Lula",
        "partido1": "PT",
        "pct1": 46.44,
        "segundo": "Serra",
        "partido2": "PSDB",
        "pct2": 23.20,
        "decisao": "2º turno",
        "nota": "Lula eleito no 2º com 61,27%.",
    },
    {
        "ano": 2006,
        "turno": 1,
        "primeiro": "Lula",
        "partido1": "PT",
        "pct1": 48.61,
        "segundo": "Alckmin",
        "partido2": "PSDB",
        "pct2": 41.64,
        "decisao": "2º turno",
        "nota": "Lula perto do 50% no 1º; fecha 60,83% no 2º.",
    },
    {
        "ano": 2010,
        "turno": 1,
        "primeiro": "Dilma",
        "partido1": "PT",
        "pct1": 46.91,
        "segundo": "Serra",
        "partido2": "PSDB",
        "pct2": 32.61,
        "decisao": "2º turno",
        "nota": "Consolidação do ciclo petista.",
    },
    {
        "ano": 2014,
        "turno": 1,
        "primeiro": "Dilma",
        "partido1": "PT",
        "pct1": 41.59,
        "segundo": "Aécio",
        "partido2": "PSDB",
        "pct2": 33.55,
        "decisao": "2º turno",
        "nota": "2º turno mais apertado até então (51,64% × 48,36%).",
    },
    {
        "ano": 2018,
        "turno": 1,
        "primeiro": "Bolsonaro",
        "partido1": "PSL",
        "pct1": 46.03,
        "segundo": "Haddad",
        "partido2": "PT",
        "pct2": 29.28,
        "decisao": "2º turno",
        "nota": "Ruptura PSDB×PT; polarização direita×PT.",
    },
    {
        "ano": 2022,
        "turno": 1,
        "primeiro": "Lula",
        "partido1": "PT",
        "pct1": 48.43,
        "segundo": "Bolsonaro",
        "partido2": "PL",
        "pct2": 43.20,
        "decisao": "2º turno",
        "nota": "Eleição mais apertada da história no 2º (50,90% × 49,10%).",
    },
]

REGIOES = {
    "Norte": ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
    "Nordeste": ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "Centro-Oeste": ["DF", "GO", "MT", "MS"],
    "Sudeste": ["ES", "MG", "RJ", "SP"],
    "Sul": ["PR", "RS", "SC"],
}

UF_NOME = {
    "AC": "Acre",
    "AL": "Alagoas",
    "AP": "Amapá",
    "AM": "Amazonas",
    "BA": "Bahia",
    "CE": "Ceará",
    "DF": "Distrito Federal",
    "ES": "Espírito Santo",
    "GO": "Goiás",
    "MA": "Maranhão",
    "MT": "Mato Grosso",
    "MS": "Mato Grosso do Sul",
    "MG": "Minas Gerais",
    "PA": "Pará",
    "PB": "Paraíba",
    "PR": "Paraná",
    "PE": "Pernambuco",
    "PI": "Piauí",
    "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul",
    "RO": "Rondônia",
    "RR": "Roraima",
    "SC": "Santa Catarina",
    "SP": "São Paulo",
    "SE": "Sergipe",
    "TO": "Tocantins",
}


def corr(xs, ys):
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    nume = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    deny = math.sqrt(sum((y - my) ** 2 for y in ys))
    return nume / (denx * deny) if denx and deny else 0.0


def analyze():
    rows = [parse_file(p) for p in sorted(UFS_DIR.glob("*-c0001-e006257-u.json"))]
    br = next(r for r in rows if r["uf"] == "BR")
    ufs = sorted([r for r in rows if r["uf"] != "BR"], key=lambda r: -r["pct_secoes"])
    byuf = {r["uf"]: r for r in ufs}

    # Correlação apuração × margem
    correlacao = corr(
        [r["pct_secoes"] for r in ufs],
        [r["margem"] for r in ufs],
    )

    # Projeção linear por UF
    proj_f = proj_l = proj_v = 0.0
    for r in ufs:
        if r["pct_secoes"] <= 0:
            continue
        scale = 100.0 / r["pct_secoes"]
        proj_f += r["flavio_votos"] * scale
        proj_l += r["lula_votos"] * scale
        proj_v += r["votos_validos"] * scale
    proj = {
        "flavio_pct": 100 * proj_f / proj_v,
        "lula_pct": 100 * proj_l / proj_v,
        "margem": 100 * (proj_f - proj_l) / proj_v,
        "ajuste_margem": 100 * (proj_f - proj_l) / proj_v - br["margem"],
    }

    # Regiões
    regioes = []
    for nome, lista in REGIOES.items():
        fv = sum(byuf[u]["flavio_votos"] for u in lista)
        lv = sum(byuf[u]["lula_votos"] for u in lista)
        vv = sum(byuf[u]["votos_validos"] for u in lista)
        ap = sum(byuf[u]["secoes_totalizadas"] for u in lista)
        tot = sum(byuf[u]["secoes_total"] for u in lista)
        regioes.append(
            {
                "regiao": nome,
                "pct_secoes": 100 * ap / tot,
                "flavio_pct": 100 * fv / vv,
                "lula_pct": 100 * lv / vv,
                "margem": 100 * (fv - lv) / vv,
                "validos": vv,
            }
        )

    # Comparação com 2022 1T (direita = Bolsonaro 2022 / Flávio 2026)
    comp_2022 = []
    for uf, (l22, b22) in HIST_2022_1T.items():
        r = byuf[uf]
        delta_lula = r["lula_pct"] - l22
        delta_dir = r["flavio_pct"] - b22
        # margem direita-esquerda
        margem_22 = b22 - l22
        margem_26 = r["margem"]
        comp_2022.append(
            {
                "uf": uf,
                "nome": UF_NOME[uf],
                "pct_secoes": r["pct_secoes"],
                "lula_2022": l22,
                "bolso_2022": b22,
                "lula_2026": r["lula_pct"],
                "flavio_2026": r["flavio_pct"],
                "delta_lula": delta_lula,
                "delta_direita": delta_dir,
                "margem_2022": margem_22,
                "margem_2026": margem_26,
                "shift_margem": margem_26 - margem_22,
                "lider_2026": r["lider"],
            }
        )
    comp_2022.sort(key=lambda x: -x["pct_secoes"])

    # Estados com apuração alta (>80%) vs baixa (<50%)
    alta = [r for r in ufs if r["pct_secoes"] >= 80]
    baixa = [r for r in ufs if r["pct_secoes"] < 55]
    media_alta = sum(r["margem"] for r in alta) / len(alta) if alta else 0
    media_baixa = sum(r["margem"] for r in baixa) / len(baixa) if baixa else 0

    # Contagem de UFs lideradas
    n_flavio = sum(1 for r in ufs if r["lider"] == "Flávio")
    n_lula = sum(1 for r in ufs if r["lider"] == "Lula")

    resultado = {
        "meta": {
            "fonte": "TSE resultados oficiais EA20 (eleição 6257)",
            "snapshot": br["atualizado"],
            "pct_secoes_nacional": br["pct_secoes"],
            "aviso": (
                "Apuração parcial. Percentuais por UF ainda podem variar "
                "conforme seções restantes — especialmente no Nordeste."
            ),
        },
        "nacional": {k: v for k, v in br.items() if k != "cands"},
        "nacional_top": br["cands"][:8],
        "ufs": [{k: v for k, v in r.items() if k != "cands"} for r in ufs],
        "regioes": regioes,
        "correlacao_apuracao_margem": correlacao,
        "projecao_linear": proj,
        "blocos_apuracao": {
            "alta_ge80": {
                "n": len(alta),
                "ufs": [r["uf"] for r in alta],
                "margem_media": media_alta,
            },
            "baixa_lt55": {
                "n": len(baixa),
                "ufs": [r["uf"] for r in baixa],
                "margem_media": media_baixa,
            },
        },
        "uf_lideranca": {"flavio": n_flavio, "lula": n_lula},
        "comparacao_2022_1t": comp_2022,
        "historico_nacional": HISTORICO_NACIONAL,
    }
    OUT_JSON.write_text(json.dumps(resultado, ensure_ascii=False, indent=2))
    return resultado


def fmt(n, digits=2):
    return f"{n:.{digits}f}".replace(".", ",")


def fmt_int(n):
    return f"{int(n):,}".replace(",", ".")


def render_html(a: dict) -> str:
    br = a["nacional"]
    proj = a["projecao_linear"]
    rows_uf = []
    for r in a["ufs"]:
        cls = "flavio" if r["lider"] == "Flávio" else "lula"
        rows_uf.append(
            f"<tr class='{cls}'>"
            f"<td>{r['uf']}</td><td>{UF_NOME[r['uf']]}</td>"
            f"<td class='num'>{fmt(r['pct_secoes'])}%</td>"
            f"<td class='num flavio'>{fmt(r['flavio_pct'])}%</td>"
            f"<td class='num'>{fmt_int(r['flavio_votos'])}</td>"
            f"<td class='num lula'>{fmt(r['lula_pct'])}%</td>"
            f"<td class='num'>{fmt_int(r['lula_votos'])}</td>"
            f"<td class='num'>{r['margem']:+.2f} pp</td>"
            f"<td>{r['lider']}</td></tr>"
        )

    rows_reg = []
    for r in a["regioes"]:
        rows_reg.append(
            f"<tr><td>{r['regiao']}</td>"
            f"<td class='num'>{fmt(r['pct_secoes'])}%</td>"
            f"<td class='num flavio'>{fmt(r['flavio_pct'])}%</td>"
            f"<td class='num lula'>{fmt(r['lula_pct'])}%</td>"
            f"<td class='num'>{r['margem']:+.1f} pp</td>"
            f"<td class='num'>{fmt_int(r['validos'])}</td></tr>"
        )

    rows_hist = []
    for h in a["historico_nacional"]:
        rows_hist.append(
            f"<tr><td>{h['ano']}</td><td>{h['primeiro']} ({h['partido1']})</td>"
            f"<td class='num'>{fmt(h['pct1'])}%</td>"
            f"<td>{h['segundo']} ({h['partido2']})</td>"
            f"<td class='num'>{fmt(h['pct2'])}%</td>"
            f"<td>{h['decisao']}</td><td>{h['nota']}</td></tr>"
        )

    rows_comp = []
    for c in sorted(a["comparacao_2022_1t"], key=lambda x: x["shift_margem"]):
        rows_comp.append(
            f"<tr><td>{c['uf']}</td>"
            f"<td class='num'>{fmt(c['pct_secoes'])}%</td>"
            f"<td class='num'>{fmt(c['bolso_2022'])}% × {fmt(c['lula_2022'])}%</td>"
            f"<td class='num'>{fmt(c['flavio_2026'])}% × {fmt(c['lula_2026'])}%</td>"
            f"<td class='num'>{c['margem_2022']:+.1f}</td>"
            f"<td class='num'>{c['margem_2026']:+.1f}</td>"
            f"<td class='num'>{c['shift_margem']:+.1f}</td></tr>"
        )

    # Barras horizontais simples por UF
    bars = []
    for r in sorted(a["ufs"], key=lambda x: -x["margem"]):
        # scale margem -50..+50 to width
        m = max(-50, min(50, r["margem"]))
        if m >= 0:
            left = 50
            width = m
            color = "#1f4e8c"
        else:
            left = 50 + m
            width = -m
            color = "#c0392b"
        bars.append(
            f"<div class='bar-row'><span class='bar-label'>{r['uf']} "
            f"<small>{fmt(r['pct_secoes'])}% ap.</small></span>"
            f"<div class='bar-track'><div class='bar-fill' style='left:{left}%;width:{width}%;background:{color}'></div>"
            f"<div class='bar-zero'></div></div>"
            f"<span class='bar-val'>{r['margem']:+.1f} pp</span></div>"
        )

    top = a["nacional_top"]
    top_rows = "".join(
        f"<tr><td>{i}</td><td>{c['nome']}</td><td>{c['partido']}</td>"
        f"<td class='num'>{fmt(c['pct'])}%</td><td class='num'>{fmt_int(c['votos'])}</td></tr>"
        for i, c in enumerate(top, 1)
    )

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Análise apuração parcial 2026 — Flávio × Lula</title>
<style>
:root {{
  --bg: #f6f1e8;
  --ink: #1a1a1a;
  --muted: #5c5c5c;
  --flavio: #1f4e8c;
  --lula: #c0392b;
  --line: #d9d0c3;
  --card: #fffdf8;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; font-family: "Source Serif 4", "Libre Baskerville", Georgia, serif;
  color: var(--ink); background:
    radial-gradient(1200px 600px at 10% -10%, #e7eef8 0%, transparent 55%),
    radial-gradient(900px 500px at 100% 0%, #f8e6e2 0%, transparent 50%),
    var(--bg);
  line-height: 1.45;
}}
.wrap {{ max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }}
h1 {{ font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0 0 .4rem; letter-spacing: -0.02em; }}
h2 {{ font-size: 1.35rem; margin: 2.2rem 0 .8rem; border-bottom: 2px solid var(--ink); padding-bottom: .35rem; }}
h3 {{ font-size: 1.05rem; margin: 1.4rem 0 .5rem; }}
.lead {{ font-size: 1.1rem; color: var(--muted); max-width: 65ch; }}
.meta {{ font-size: .9rem; color: var(--muted); margin: .8rem 0 1.5rem; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .8rem; margin: 1rem 0 1.5rem; }}
.kpi {{ background: var(--card); border: 1px solid var(--line); padding: 1rem 1.1rem; }}
.kpi .label {{ font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }}
.kpi .value {{ font-size: 1.7rem; font-weight: 700; margin-top: .2rem; }}
.kpi .sub {{ font-size: .85rem; color: var(--muted); }}
.flavio {{ color: var(--flavio); }}
.lula {{ color: var(--lula); }}
.note, .aviso {{
  background: #fff8e7; border-left: 4px solid #c48a1a; padding: .9rem 1rem; margin: 1rem 0;
  font-size: .95rem;
}}
table {{ width: 100%; border-collapse: collapse; font-size: .88rem; background: var(--card); }}
th, td {{ border-bottom: 1px solid var(--line); padding: .45rem .5rem; text-align: left; }}
th {{ font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }}
td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
tr.flavio td:last-child {{ color: var(--flavio); font-weight: 600; }}
tr.lula td:last-child {{ color: var(--lula); font-weight: 600; }}
.bar-row {{ display: grid; grid-template-columns: 90px 1fr 70px; gap: .5rem; align-items: center; margin: .25rem 0; font-size: .85rem; }}
.bar-track {{ position: relative; height: 14px; background: #efe8dc; }}
.bar-fill {{ position: absolute; top: 0; bottom: 0; }}
.bar-zero {{ position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: #333; }}
.bar-label small {{ color: var(--muted); }}
.bar-val {{ text-align: right; font-variant-numeric: tabular-nums; }}
ul.keypoints {{ padding-left: 1.1rem; }}
ul.keypoints li {{ margin: .45rem 0; }}
footer {{ margin-top: 2.5rem; font-size: .8rem; color: var(--muted); }}
.scroll {{ overflow-x: auto; }}
</style>
</head>
<body>
<main class="wrap">
  <h1>Apuração parcial 2026: Flávio × Lula</h1>
  <p class="lead">Análise estatística do 1º turno presidencial com percentual apurado por estado e comparação com as oito eleições de 1994 a 2022.</p>
  <p class="meta">Fonte: TSE (EA20, eleição 6257) · Snapshot {br['atualizado']} · {fmt(br['pct_secoes'])}% das seções totalizadas · Gerado automaticamente</p>

  <div class="aviso"><strong>Parcial em andamento.</strong> {a['meta']['aviso']} A correlação entre ritmo de apuração e margem é estrutural no Brasil desde ao menos 2014–2022: Sul/Centro-Oeste fecham antes; Nordeste entra depois.</div>

  <div class="grid">
    <div class="kpi"><div class="label">Flávio Bolsonaro</div><div class="value flavio">{fmt(br['flavio_pct'])}%</div><div class="sub">{fmt_int(br['flavio_votos'])} votos</div></div>
    <div class="kpi"><div class="label">Lula</div><div class="value lula">{fmt(br['lula_pct'])}%</div><div class="sub">{fmt_int(br['lula_votos'])} votos</div></div>
    <div class="kpi"><div class="label">Margem atual</div><div class="value">{br['margem']:+.2f} pp</div><div class="sub">Flávio à frente</div></div>
    <div class="kpi"><div class="label">Projeção linear*</div><div class="value">{fmt(proj['flavio_pct'])}% × {fmt(proj['lula_pct'])}%</div><div class="sub">ajuste margem {proj['ajuste_margem']:+.2f} pp</div></div>
  </div>
  <p class="meta">*Extrapolação simples: assume que as seções restantes de cada UF votam como as já apuradas naquela UF. Não é modelo demográfico completo; serve para corrigir o viés geográfico da ordem de totalização.</p>

  <h2>1. Achados principais</h2>
  <ul class="keypoints">
    <li><strong>Flávio lidera com {fmt(br['flavio_pct'])}%</strong> dos válidos e {a['uf_lideranca']['flavio']} UFs; Lula tem {fmt(br['lula_pct'])}% e lidera {a['uf_lideranca']['lula']} UFs (quase todo o Nordeste).</li>
    <li><strong>Viés clássico de apuração:</strong> correlação de <strong>{a['correlacao_apuracao_margem']:.2f}</strong> entre % de seções apuradas e margem Flávio−Lula. UFs com ≥80% apurado têm margem média de <strong>{a['blocos_apuracao']['alta_ge80']['margem_media']:+.1f} pp</strong> para Flávio; UFs com &lt;55% apurado têm <strong>{a['blocos_apuracao']['baixa_lt55']['margem_media']:+.1f} pp</strong> (favoráveis a Lula).</li>
    <li><strong>A projeção por UF reduz a vantagem de Flávio de {br['margem']:+.2f} para {proj['margem']:+.2f} pp</strong> e coloca-o abaixo de 50% — padrão compatível com segundo turno, como em 6 das 8 eleições desde 1994.</li>
    <li><strong>Mapa parece 2018/2022 “congelado”:</strong> direita forte no Sul, Centro-Oeste, interior/agro; PT dominante no Nordeste. SP e RJ acompanham Flávio; MG apertado; PA/AP/AM/TO competitivos.</li>
    <li>Terceiros (Cury, Caiado, Renan, Zema) somam pouco (~8%) — polarização alta, próximo do duelo 2022.</li>
  </ul>

  <h2>2. Nacional — top candidatos</h2>
  <div class="scroll"><table>
    <thead><tr><th>#</th><th>Candidato</th><th>Partido</th><th class="num">%</th><th class="num">Votos</th></tr></thead>
    <tbody>{top_rows}</tbody>
  </table></div>
  <p class="meta">Comparecimento no eleitorado já apurado: {fmt(br['comparecimento'],1)}% · Abstenção {fmt(br['abstencao'],1)}% · Válidos {fmt_int(br['votos_validos'])}</p>

  <h2>3. Percentual apurado × votação por estado</h2>
  <p>Estados ordenados do mais ao menos apurado. O padrão histórico se confirma: DF, MS, PR, Sul e Centro-Oeste à frente na totalização; AL, CE, BA, RJ e PE mais lentos.</p>
  <div class="scroll"><table>
    <thead><tr>
      <th>UF</th><th>Estado</th><th class="num">Apurado</th>
      <th class="num">Flávio</th><th class="num">Votos F</th>
      <th class="num">Lula</th><th class="num">Votos L</th>
      <th class="num">Δ F−L</th><th>Líder</th>
    </tr></thead>
    <tbody>
      {''.join(rows_uf)}
    </tbody>
  </table></div>

  <h3>Margem Flávio − Lula por UF</h3>
  <div>{''.join(bars)}</div>

  <h2>4. Agregado regional</h2>
  <div class="scroll"><table>
    <thead><tr><th>Região</th><th class="num">Seções</th><th class="num">Flávio</th><th class="num">Lula</th><th class="num">Δ</th><th class="num">Válidos parciais</th></tr></thead>
    <tbody>{''.join(rows_reg)}</tbody>
  </table></div>
  <div class="note">Nordeste está ~{fmt(next(r['pct_secoes'] for r in a['regioes'] if r['regiao']=='Nordeste'))}% apurado e vota ~{fmt(next(r['lula_pct'] for r in a['regioes'] if r['regiao']=='Nordeste'))}% em Lula. Sul já está ~{fmt(next(r['pct_secoes'] for r in a['regioes'] if r['regiao']=='Sul'))}% e vota ~{fmt(next(r['flavio_pct'] for r in a['regioes'] if r['regiao']=='Sul'))}% em Flávio. Isso explica por que a parcial nacional “parece” mais favorável a Flávio do que a projeção final.</div>

  <h2>5. Comparação com 2022 (1º turno: Lula × Jair Bolsonaro)</h2>
  <p>Colunas de margem = (direita − Lula). <em>Shift</em> positivo = Flávio melhora o desempenho da direita frente a 2022; negativo = Lula melhora ou a direita recua.</p>
  <div class="scroll"><table>
    <thead><tr>
      <th>UF</th><th class="num">Ap. 2026</th><th class="num">2022 Dir×Lula</th><th class="num">2026 F×Lula</th>
      <th class="num">Marg. 22</th><th class="num">Marg. 26</th><th class="num">Shift</th>
    </tr></thead>
    <tbody>{''.join(rows_comp)}</tbody>
  </table></div>
  <p class="meta">Leitura cautelosa: UFs pouco apuradas (AL, BA, CE…) ainda podem mudar o shift. Em UFs quase fechadas (DF, MS, PR, SC, RO, RR, MT), a comparação com 2022 já é mais estável.</p>

  <h2>6. Histórico das 8 eleições (1994–2022), 1º turno</h2>
  <div class="scroll"><table>
    <thead><tr><th>Ano</th><th>1º</th><th class="num">%</th><th>2º</th><th class="num">%</th><th>Decisão</th><th>Contexto</th></tr></thead>
    <tbody>{''.join(rows_hist)}</tbody>
  </table></div>
  <ul class="keypoints">
    <li><strong>Só 2/8 eleições acabaram no 1º turno</strong> (FHC 1994 e 1998, ambas &gt;53%).</li>
    <li>Desde 2002, o líder do 1º turno ficou entre <strong>41,6% e 48,6%</strong> — a parcial atual de Flávio ({fmt(br['flavio_pct'])}%) está <em>acima</em> dessa faixa, mas a projeção ajustada ({fmt(proj['flavio_pct'])}%) cai de volta para dentro dela.</li>
    <li>O teto petista no 1º turno recente foi Lula 2022 (48,43%) e Lula 2006 (48,61%). A parcial de Lula hoje ({fmt(br['lula_pct'])}%) está abaixo; a projeção sobe para ~{fmt(proj['lula_pct'])}% conforme o Nordeste completa.</li>
    <li>A polarização 2018–2022 (direita × PT) permanece o eixo dominante em 2026; terceiros não repetem o peso de Ciro/Marina/Tebet de ciclos anteriores.</li>
  </ul>

  <h2>7. Método e limites</h2>
  <ul class="keypoints">
    <li>Dados oficiais do TSE via JSON unificado (sufixo <code>-u.json</code>), cargo Presidente, abrangência BR e 27 UFs.</li>
    <li>Projeção linear por UF corrige ordem de totalização, mas <strong>não</strong> modela diferença rural/urbano dentro do estado nem abstenção residual.</li>
    <li>Histórico estadual detalhado foca 2018/2022 (anos da polarização atual); o quadro nacional cobre as 8 eleições 1994–2022.</li>
    <li>Esta é fotografia de um momento da apuração ({fmt(br['pct_secoes'])}% nacional), não resultado final.</li>
  </ul>

  <footer>
    Arquivos em <code>analise-eleitoral-2026/dados/</code> · Script <code>gerar_analise.py</code> ·
    Não substitui a totalização oficial do TSE.
  </footer>
</main>
</body>
</html>
"""


def main():
    a = analyze()
    OUT_HTML.write_text(render_html(a), encoding="utf-8")
    print(f"JSON -> {OUT_JSON}")
    print(f"HTML -> {OUT_HTML}")
    print(
        f"Nacional: Flávio {a['nacional']['flavio_pct']:.2f}% | "
        f"Lula {a['nacional']['lula_pct']:.2f}% | "
        f"proj {a['projecao_linear']['flavio_pct']:.2f}% × {a['projecao_linear']['lula_pct']:.2f}%"
    )


if __name__ == "__main__":
    main()
