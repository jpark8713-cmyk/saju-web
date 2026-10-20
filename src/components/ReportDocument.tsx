'use client';
// 리포트 템플릿 하나로 화면과 PDF를 함께 만든다(SPEC Phase 3). 미리보기도 같은 틀을 쓰고 잠긴 섹션은 제목만 보인다.
// 화면: 문장 끝 [근거 n] 버튼 → 차트의 해당 글자에 테두리 강조 + 근거 설명. 다른 버튼을 누르면 강조가 옮겨 간다.
// PDF: 버튼 대신 문장 끝 번호(①②…)와 끝의 "풀이 근거 목록". 번호는 화면과 같다(같은 데이터에서 만든다).
import { useMemo, useState } from 'react';
import { SERVICE } from '../config/business';
import type { EvidenceItem, PreviewView, ReportView, SentenceView } from '../report/view';
import { ChartGrid, ElementBars, LuckTable } from './ChartGrid';

export type DocMode = 'screen' | 'pdf';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export function circled(n: number): string {
  return n >= 1 && n <= CIRCLED.length ? CIRCLED[n - 1]! : `(${n})`;
}

function Sentence({ s, mode, selected, onSelect }: { s: SentenceView; mode: DocMode; selected: number | null; onSelect: (n: number) => void }) {
  return (
    <li>
      {s.text}
      {mode === 'screen'
        ? s.refs.map((n) => (
            <button key={n} type="button" className="ref-button" aria-pressed={selected === n} onClick={() => onSelect(n)} data-ref-n={n}>
              근거 {n}
            </button>
          ))
        : s.refs.map((n) => (
            <span key={n} className="ref-num" data-ref-n={n}>
              {circled(n)}
            </span>
          ))}
    </li>
  );
}

function Sentences(props: { list: readonly SentenceView[]; mode: DocMode; selected: number | null; onSelect: (n: number) => void }) {
  return (
    <ul className="sentences">
      {props.list.map((s, i) => (
        <Sentence key={i} s={s} mode={props.mode} selected={props.selected} onSelect={props.onSelect} />
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

function EvidenceList({ items, mode }: { items: readonly EvidenceItem[]; mode: DocMode }) {
  return (
    <section className="section" data-testid="evidence-list" aria-label="풀이 근거 목록">
      <SectionHead title="풀이 근거 목록" />
      <ol className="evidence-list">
        {items.map((e) => (
          <li key={e.id} data-evidence-n={e.n}>
            {mode === 'pdf' ? circled(e.n) : `근거 ${e.n}`} · {e.content}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ReportDocument({ view, mode, afterPreview }: { view: ReportView | PreviewView; mode: DocMode; afterPreview?: React.ReactNode }) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = (n: number) => setSelected((cur) => (cur === n ? null : n));
  const selectedItem = view.evidence.find((e) => e.n === selected) ?? null;
  const highlighted = useMemo(() => new Set<string>(selectedItem?.chartRefs ?? []), [selectedItem]);
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
        {mode === 'screen' && selectedItem && (
          <div className="selected-evidence" role="status" aria-live="polite" data-testid="selected-evidence">
            근거 {selectedItem.n} 선택됨 · {selectedItem.content}
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
            <Sentences list={view.summary} mode={mode} selected={selected} onSelect={select} />
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
          <section key={sec.id} className="section" data-section={sec.id}>
            <SectionHead title={sec.title} />
            {sec.groups.map((g, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {g.subtitle && <h3 className="h3">{g.subtitle}</h3>}
                <Sentences list={g.sentences} mode={mode} selected={selected} onSelect={select} />
              </div>
            ))}
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
        </ul>
      </section>
    </article>
  );
}
