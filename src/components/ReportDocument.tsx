'use client';
// 리포트 템플릿 하나로 화면과 PDF를 함께 만든다(SPEC Phase 3). 미리보기도 같은 틀을 쓰고 잠긴 섹션은 제목만 보인다.
// 화면(D-042 시안 A): 문장 끝 [근거] 버튼 → 그 문장 바로 아래에 사실 한두 줄 + 8글자 미니 차트(해당 글자 강조)가 펼쳐진다.
//   위쪽 큰 차트도 같은 글자를 강조한다. 전체 사실 목록은 "전체 근거 보기"로 접어 두고, 사실마다 그 사실을 쓴 문장(↳)을 보여 준다.
// PDF: 버튼 대신 문장 끝 각주 번호(①②…)와 끝의 사실 목록(접힘 없음, 쉬운 문구만). 번호는 화면 목록 순서와 같다.
import { useMemo, useState } from 'react';
import { SERVICE } from '../config/business';
import { ELEMENT_PLAIN, POSITION_PLAIN } from '../engine/constants';
import type { ChartView } from '../report/chartView';
import { EVIDENCE_GROUP_ORDER, EVIDENCE_GROUP_TITLES } from '../report/evidenceTerms';
import type { EvidenceItem, PreviewView, ReportView, SentenceView } from '../report/view';
import { ChartGrid, ElementBars, LuckTable } from './ChartGrid';

export type DocMode = 'screen' | 'pdf';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export function circled(n: number): string {
  return n >= 1 && n <= CIRCLED.length ? CIRCLED[n - 1]! : `(${n})`;
}

const PILLAR_REF = /^(year|month|day|hour)\.(stem|branch)$/;

/** 근거 카드 안의 8글자 미니 차트. 문장을 읽는 자리에서는 위쪽 큰 차트가 안 보여서 둔다 */
function MiniChart({ chart, highlighted }: { chart: ChartView; highlighted: ReadonlySet<string> }) {
  return (
    <div className="mini-chart" aria-hidden="true" data-testid="mini-chart">
      {chart.pillars.map((p) => (
        <div key={p.position} className="mini-col">
          <span className="mini-title">{POSITION_PLAIN[p.position]}</span>
          {p.stem && p.branch ? (
            [p.stem, p.branch].map((g) => (
              <span key={g.ref} className={highlighted.has(g.ref) ? 'mini-glyph is-on' : 'mini-glyph'} data-ref={g.ref}>
                <span className={`el-${g.element}`}>{g.hanja}</span>
                <small>
                  {g.ko} · {ELEMENT_PLAIN[g.element]}
                </small>
              </span>
            ))
          ) : (
            <span className="mini-glyph">모름</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** 사실 하나: 미니 차트(글자에 대한 사실만) + 쉬운 문장 + 자세히(용어 풀이·전문 표기) */
function FactCard({ item, chart, cardId, note }: { item: EvidenceItem; chart: ChartView; cardId: string; note?: string }) {
  const [open, setOpen] = useState(false);
  const glyphRefs = new Set(item.chartRefs.filter((r) => PILLAR_REF.test(r)));
  const detailId = `${cardId}-detail-${item.n}`;
  return (
    <div className="fact" data-fact-id={item.id}>
      {glyphRefs.size > 0 && <MiniChart chart={chart} highlighted={glyphRefs} />}
      <p className="fact-text">{item.content}</p>
      <button type="button" className="link-button" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setOpen((o) => !o)}>
        {open ? '자세히 닫기' : '자세히(용어·전문 표기)'}
      </button>
      {open && (
        <ul id={detailId} className="evidence-detail" data-testid="evidence-detail">
          {/* 풀이 각도(D-047): 그 기운·묶음의 뜻 전체와 이 문장이 풀린 쪽 */}
          {(item.meanings ?? []).map((m) => (
            <li key={m} data-testid="fact-meaning">{m}</li>
          ))}
          {note && <li data-testid="fact-angle-note">{note}</li>}
          {item.detail.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SentenceCtx {
  mode: DocMode;
  open: string | null;
  onToggle: (id: string) => void;
  evidence: readonly EvidenceItem[];
  chart: ChartView;
}

function Sentence({ s, ctx }: { s: SentenceView; ctx: SentenceCtx }) {
  if (ctx.mode === 'pdf') {
    return (
      <li>
        {s.text}
        {s.refs.map((n) => (
          <span key={n} className="ref-num" data-ref-n={n}>
            {circled(n)}
          </span>
        ))}
      </li>
    );
  }
  const isOpen = ctx.open === s.id;
  const cardId = `evidence-card-${s.id}`;
  const facts = s.refs.flatMap((n) => ctx.evidence.filter((e) => e.n === n));
  return (
    <li id={`sentence-${s.id}`} data-sentence-id={s.id}>
      {s.text}
      {facts.length > 0 && (
        <button
          type="button"
          className="ref-button"
          aria-expanded={isOpen}
          aria-controls={isOpen ? cardId : undefined}
          onClick={() => ctx.onToggle(s.id)}
          data-refs={s.refs.join(',')}
        >
          근거{facts.length > 1 ? ` ${facts.length}` : ''}
        </button>
      )}
      {isOpen && (
        <div id={cardId} className="evidence-card" data-testid="evidence-card">
          {facts.map((f) => (
            <FactCard key={f.n} item={f} chart={ctx.chart} cardId={cardId} note={s.angleNotes?.[f.n]} />
          ))}
        </div>
      )}
    </li>
  );
}

function Sentences({ list, ctx }: { list: readonly SentenceView[]; ctx: SentenceCtx }) {
  return (
    <ul className="sentences">
      {list.map((s) => (
        <Sentence key={s.id} s={s} ctx={ctx} />
      ))}
    </ul>
  );
}

function SectionHead({ title, badge }: { title: string; badge?: 'free' | 'lock' }) {
  return (
    <div className="section-head">
      <h2 className="h2">{title}</h2>
      {badge === 'free' && <span className="badge-free">무료 공개</span>}
      {badge === 'lock' && <span className="badge-lock">🔒 결제 후 공개</span>}
    </div>
  );
}

/** 전체 사실 목록. 화면은 접어 두고, PDF는 번호와 함께 모두 보여 준다 */
function EvidenceList({ items, mode }: { items: readonly EvidenceItem[]; mode: DocMode }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const groups = EVIDENCE_GROUP_ORDER.map((g) => ({ g, list: items.filter((e) => e.group === g) })).filter((x) => x.list.length > 0);
  const shown = mode === 'pdf' || open;
  return (
    <section className="section" data-testid="evidence-list" aria-label="풀이 근거 목록">
      <SectionHead title="풀이 근거 목록" />
      {mode === 'screen' && (
        <button
          type="button"
          className="fold-button"
          aria-expanded={open}
          aria-controls={open ? 'evidence-groups' : undefined}
          onClick={() => setOpen((o) => !o)}
          data-testid="evidence-list-toggle"
        >
          <span>
            {open ? '전체 근거 접기' : '전체 근거 보기'} (사실 {items.length}개)
          </span>
          <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button>
      )}
      {shown && (
        <div id="evidence-groups" className="evidence-groups">
          {mode === 'screen' && (
            <div className="evidence-tools">
              <span className="hint">↳ 줄을 누르면 그 사실을 쓴 풀이 문장으로 이동해요.</span>
              <button type="button" className="link-button" aria-pressed={detail} onClick={() => setDetail((d) => !d)} data-testid="evidence-detail-toggle">
                {detail ? '전문 표기 숨기기' : '전문 표기 보기'}
              </button>
            </div>
          )}
          {groups.map(({ g, list }) => (
            <div key={g} className="evidence-group" data-evidence-group={g}>
              <h3 className="h3">{EVIDENCE_GROUP_TITLES[g]}</h3>
              <ol className="evidence-list">
                {list.map((e) => (
                  <li key={e.id} data-evidence-n={e.n}>
                    {mode === 'pdf' && <span className="fact-num">{circled(e.n)} </span>}
                    <span data-testid="fact-text">{e.content}</span>
                    {/* PDF에는 "이 문장은…" 줄 없이 뜻 전체만 남긴다(사업자 결정, D-047) */}
                    {mode === 'pdf' && (e.meanings ?? []).map((m) => (
                      <span key={m} className="fact-meaning" data-testid="fact-meaning">{m}</span>
                    ))}
                    {mode === 'screen' && detail && (
                      <ul className="evidence-detail" data-testid="evidence-detail">
                        {(e.meanings ?? []).map((m) => (
                          <li key={m} data-testid="fact-meaning">{m}</li>
                        ))}
                        {e.detail.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    )}
                    {mode === 'screen' && e.usedBy.length > 0 && (
                      <div className="used-by">
                        {e.usedBy.map((u) => (
                          <a key={u.sentenceId} href={`#sentence-${u.sentenceId}`} data-testid="used-by">
                            ↳ <span className="used-where">{u.where}</span> · {u.text}
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ReportDocument({ view, mode, afterPreview }: { view: ReportView | PreviewView; mode: DocMode; afterPreview?: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const sentences = view.kind === 'preview' ? view.summary : view.sections.flatMap((x) => x.groups.flatMap((g) => g.sentences));
  const openRefs = sentences.find((s) => s.id === open)?.refs;
  // 근거를 펼친 문장의 사실이 가리키는 칸을 위쪽 큰 차트에서도 강조한다
  const highlighted = useMemo(
    () => new Set<string>(view.evidence.filter((e) => openRefs?.includes(e.n)).flatMap((e) => e.chartRefs)),
    [view.evidence, openRefs],
  );
  const ctx: SentenceCtx = { mode, open, onToggle: (id) => setOpen((cur) => (cur === id ? null : id)), evidence: view.evidence, chart: view.chart };
  const isPreview = view.kind === 'preview';
  const name = view.cover.name;

  return (
    <article data-testid={isPreview ? 'preview-document' : 'report-document'} data-mode={mode} style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <header className="masthead">
        <div className="masthead-row">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="service-name">{SERVICE.name}</div>
            <h1 className="h1">{name ? `${name}님의 ${isPreview ? '사주' : '리포트'}` : isPreview ? '나의 사주' : '사주 리포트'}</h1>
          </div>
          <div className="seal" aria-hidden="true">
            命
          </div>
        </div>
        <div className="meta">{view.cover.birthLabel}</div>
      </header>

      <section className="section" aria-label="사주 차트">
        <SectionHead title="사주 차트" badge={isPreview ? 'free' : undefined} />
        <ChartGrid chart={view.chart} highlighted={highlighted} />
        {!isPreview && <LuckTable chart={view.chart} highlighted={highlighted} />}
        {view.basis.notices.length > 0 && (
          <div className="box" role="note" data-testid="chart-notices" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {view.basis.notices.map((n) => (
              <div key={n.code} data-notice={n.code}>
                <p className="meta" style={{ margin: 0 }}>{n.message}</p>
                {n.details.length > 0 && (
                  <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
                    {n.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-label="오행 분포">
        <SectionHead title="오행 분포" badge={isPreview ? 'free' : undefined} />
        <ElementBars chart={view.chart} highlighted={highlighted} />
      </section>

      {view.kind === 'preview' ? (
        <>
          <section className="section" data-section="summary">
            <SectionHead title="총평" badge="free" />
            <Sentences list={view.summary} ctx={ctx} />
          </section>
          {view.locked.map((l) => (
            <section key={l.id} className="section" data-section={l.id} data-locked="true">
              <SectionHead title={l.title} badge="lock" />
              <div className="locked">결제 후 이 칸의 풀이가 열려요.</div>
            </section>
          ))}
          {afterPreview}
        </>
      ) : (
        view.sections.map((sec) => (
          <section key={sec.id} id={`section-${sec.id}`} className="section" data-section={sec.id}>
            <SectionHead title={sec.title} />
            {sec.groups.map((g, i) => (
              <div key={i} className={g.cluster || g.flow ? 'period-group' : undefined} data-period-group={g.cluster || g.flow ? i : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* 월별 흐름의 계절 묶음 머리(D-052): 묶음이 바뀔 때만 */}
                {g.cluster && g.cluster !== sec.groups[i - 1]?.cluster && <p className="period-cluster" data-testid="period-cluster">{g.cluster}</p>}
                {g.subtitle && <h3 className="h3">{g.subtitle}</h3>}
                {g.flow && (
                  <p className="period-flow" data-testid="period-flow">
                    큰 흐름: {g.flow.label}
                    {g.flow.turning && <span className="period-turn">큰 흐름이 바뀌는 해</span>}
                  </p>
                )}
                {g.chips && g.chips.length > 0 && (
                  <div className="period-chips" data-testid="period-chips">
                    {g.chips.map((c) => (
                      <span key={c.text} className={`period-chip is-${c.kind}`}>{c.text}</span>
                    ))}
                  </div>
                )}
                {/* 코드 사실 줄(D-052 3단계): 어른 월별·10년은 AI 문장 앞에, 10년 흐름의 올해·내년은 AI 문장 대신. PDF에는 링크 대신 문구만 */}
                {g.fact && (
                  <p className="period-fact" data-testid="period-fact">
                    {g.fact.text}
                    {g.fact.link && ' '}
                    {g.fact.link && (mode === 'screen' ? (
                      <a href={g.fact.link.href} className="period-link">{g.fact.link.label} →</a>
                    ) : (
                      <span>({g.fact.link.label})</span>
                    ))}
                  </p>
                )}
                <Sentences list={g.sentences} ctx={ctx} />
              </div>
            ))}
            {sec.note && (
              <p className="hint period-note" data-testid="section-note">
                {sec.note.text}
                {mode === 'screen' &&
                  sec.note.links.map((l) => (
                    <a key={l.href} href={l.href} className="period-link">
                      {l.label} →
                    </a>
                  ))}
              </p>
            )}
          </section>
        ))
      )}

      <EvidenceList items={view.evidence} mode={mode} />

      <section className="section" data-section="disclaimer" aria-label="면책·계산 기준">
        <SectionHead title="면책·계산 기준" />
        <p className="hint" style={{ margin: 0 }}>
          이 리포트는 오락·참고용이며 의료·투자·법률 판단을 대신하지 않습니다.
        </p>
        <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
          <li>자시 처리: {view.basis.jasi}</li>
          <li>시간 보정: {view.basis.timeCorrection}</li>
          <li>달력: {view.basis.calendar}</li>
          <li data-testid="basis-counting">{view.basis.counting}</li>
        </ul>
      </section>
    </article>
  );
}
