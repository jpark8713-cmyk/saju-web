// AI 출력 형식: 구조화 출력(output_config.format)용 JSON 스키마 + 응답 검사용 zod 스키마.
// 구조화 출력은 문장 수·글자 수 제약을 지원하지 않으므로 그 검사는 validate.ts가 한다.
// 키 이름은 Docs/decisions.md D-015에 기록한다.
import { z } from 'zod';
import type { BaseDraft, ChildPeriodDraft, PeriodDraft, TopicDraft } from './types';

const sentenceJson = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    evidenceIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'evidenceIds'],
  additionalProperties: false,
} as const;

const sentencesJson = { type: 'array', items: sentenceJson } as const;

export const BASE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: sentencesJson,
    traits: sentencesJson,
    daewoonNotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { daewoonIndex: { type: 'integer' }, sentences: sentencesJson },
        required: ['daewoonIndex', 'sentences'],
        additionalProperties: false,
      },
    },
    yearly: {
      type: 'object',
      properties: { thisYear: sentencesJson, nextYear: sentencesJson },
      required: ['thisYear', 'nextYear'],
      additionalProperties: false,
    },
  },
  required: ['summary', 'traits', 'daewoonNotes', 'yearly'],
  additionalProperties: false,
} as const;

export const TOPIC_JSON_SCHEMA = {
  type: 'object',
  properties: { sentences: sentencesJson },
  required: ['sentences'],
  additionalProperties: false,
} as const;

const periodNotesJson = {
  type: 'array',
  items: {
    type: 'object',
    properties: { index: { type: 'integer' }, sentences: sentencesJson },
    required: ['index', 'sentences'],
    additionalProperties: false,
  },
} as const;

/** 월별 흐름·10년 흐름(D-052) */
export const PERIOD_JSON_SCHEMA = {
  type: 'object',
  properties: { periods: periodNotesJson },
  required: ['periods'],
  additionalProperties: false,
} as const;

/** 아이 리포트의 부모 관점 요약(D-052) */
export const CHILD_PERIOD_JSON_SCHEMA = {
  type: 'object',
  properties: { seasons: periodNotesJson, years: periodNotesJson },
  required: ['seasons', 'years'],
  additionalProperties: false,
} as const;

const sentenceZ = z.object({ text: z.string(), evidenceIds: z.array(z.string()) }).strict();
const sentencesZ = z.array(sentenceZ);

export const baseDraftZ = z
  .object({
    summary: sentencesZ,
    traits: sentencesZ,
    daewoonNotes: z.array(z.object({ daewoonIndex: z.number().int(), sentences: sentencesZ }).strict()),
    yearly: z.object({ thisYear: sentencesZ, nextYear: sentencesZ }).strict(),
  })
  .strict();

export const topicDraftZ = z.object({ sentences: sentencesZ }).strict();

const periodNotesZ = z.array(z.object({ index: z.number().int(), sentences: sentencesZ }).strict());
export const periodDraftZ = z.object({ periods: periodNotesZ }).strict();
export const childPeriodDraftZ = z.object({ seasons: periodNotesZ, years: periodNotesZ }).strict();

export type ParseResult<T> = { ok: true; value: T } | { ok: false; detail: string };

function parseWith<T>(schema: z.ZodType<T>, text: string): ParseResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, detail: 'JSON이 아님' };
  }
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, detail: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

export function parseBaseDraft(text: string): ParseResult<BaseDraft> {
  return parseWith(baseDraftZ, text);
}

export function parseTopicDraft(text: string): ParseResult<TopicDraft> {
  return parseWith(topicDraftZ, text);
}

export function parsePeriodDraft(text: string): ParseResult<PeriodDraft> {
  return parseWith(periodDraftZ, text);
}

export function parseChildPeriodDraft(text: string): ParseResult<ChildPeriodDraft> {
  return parseWith(childPeriodDraftZ, text);
}
