// 사주 차트·오행 막대·대운/세운 표. 계산 데이터(ChartView)로만 그린다. 근거가 가리키는 칸은 테두리로 강조한다.
import type { ChartView, PillarCell } from '../report/chartView';

function cls(ref: string, highlighted: ReadonlySet<string>, base: string): string {
  return highlighted.has(ref) ? `${base} is-highlighted` : base;
}

function Glyph({ g, highlighted }: { g: NonNullable<PillarCell['stem']>; highlighted: ReadonlySet<string> }) {
  return (
    <div className={cls(g.ref, highlighted, 'glyph')} data-ref={g.ref} aria-label={`${g.ko}(${g.hanja}) ${g.elementKo} ${g.tenGod}`}>
      <span className={`glyph-hanja el-${g.element}`}>{g.hanja}</span>
      <span className="glyph-sub">
        {g.ko} · {g.elementKo}
      </span>
      {g.tenGod && <span className="glyph-sub">{g.tenGod}</span>}
    </div>
  );
}

export function ChartGrid({ chart, highlighted }: { chart: ChartView; highlighted: ReadonlySet<string> }) {
  return (
    <div className="chart" data-testid="saju-chart">
      {chart.pillars.map((p) => (
        <div key={p.position} className={p.position === 'day' ? 'pillar is-day' : 'pillar'}>
          <div className="pillar-title">{p.title}</div>
          {p.stem && p.branch ? (
            <>
              <Glyph g={p.stem} highlighted={highlighted} />
              <Glyph g={p.branch} highlighted={highlighted} />
            </>
          ) : (
            <div className="glyph-unknown">모름</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ElementBars({ chart, highlighted }: { chart: ChartView; highlighted: ReadonlySet<string> }) {
  const max = Math.max(chart.elementTotal, 1);
  return (
    <div className="bars" data-testid="element-bars">
      {chart.elements.map((e) => (
        <div key={e.element} className={cls(e.ref, highlighted, 'bar-row')} data-ref={e.ref}>
          <span style={{ fontWeight: 700 }}>
            {e.ko} {e.hanja}
          </span>
          <div className="bar-track">
            <div className={`bar-fill el-${e.element}`} style={{ width: `${(e.count / max) * 100}%` }} />
          </div>
          <span style={{ textAlign: 'right' }}>{e.count}</span>
        </div>
      ))}
    </div>
  );
}

export function LuckTable({ chart, highlighted }: { chart: ChartView; highlighted: ReadonlySet<string> }) {
  if (!chart.daewoon.length && !chart.seun.length) return null;
  return (
    <table className="table" data-testid="luck-table">
      <thead>
        <tr>
          <th scope="col">구분</th>
          <th scope="col">간지</th>
          <th scope="col">시작</th>
        </tr>
      </thead>
      <tbody>
        {chart.daewoon.map((d) => (
          <tr key={d.ref} className={highlighted.has(d.ref) ? 'is-highlighted' : undefined} data-ref={d.ref}>
            <td>{d.index + 1}번째 대운</td>
            <td>{d.label}</td>
            <td>{d.startLabel}</td>
          </tr>
        ))}
        {chart.seun.map((s) => (
          <tr key={s.ref} className={highlighted.has(s.ref) ? 'is-highlighted' : undefined} data-ref={s.ref}>
            <td>{s.year}년 세운</td>
            <td>{s.label}</td>
            <td>{s.year}년</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
