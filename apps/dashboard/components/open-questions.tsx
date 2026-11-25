'use client';

import type { OpenQuestionView } from '@/lib/types';

/** The answer a question has now: what the person typed, or what was answered before. */
export const answerOf = (q: OpenQuestionView, typed: Record<string, string>): string => (typed[q.id] ?? q.response ?? '').trim();

/** How many questions still have no answer. A plan can be approved only when this is 0. */
export const unanswered = (questions: OpenQuestionView[], typed: Record<string, string>): number => questions.filter((q) => answerOf(q, typed) === '').length;

/** The answers to send with the approval: the ones typed in, or changed. */
export const answersToSend = (questions: OpenQuestionView[], typed: Record<string, string>): { id: string; answer: string }[] =>
  questions.map((q) => ({ id: q.id, answer: answerOf(q, typed) })).filter((a) => a.answer !== '');

/**
 * The open questions of a plan. They are part of its approval: each needs an answer (or the plan's own assumption accepted) before the
 * plan can be approved.
 */
export function OpenQuestions({ id, questions, typed, onChange }: { id: string; questions: OpenQuestionView[]; typed: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const left = unanswered(questions, typed);
  return (
    <fieldset className="mt-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">
        Open questions <span className="font-normal text-muted">({questions.length - left} of {questions.length} answered)</span>
      </legend>
      <p className="text-xs text-muted">Answer every question to approve the plan. The answers become part of the approved plan.</p>
      <ol className="mt-2 space-y-3">
        {questions.map((q, i) => (
          <li key={q.id}>
            <label htmlFor={`oq-${id}-${q.id}`} className="block text-sm">
              {i + 1}. {q.body || q.title}
            </label>
            <textarea
              id={`oq-${id}-${q.id}`}
              rows={2}
              value={typed[q.id] ?? q.response ?? ''}
              onChange={(e) => onChange({ ...typed, [q.id]: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {q.defaultAnswer && (
              <button type="button" onClick={() => onChange({ ...typed, [q.id]: q.defaultAnswer ?? '' })} className="mt-1 text-xs text-accent underline">
                Use the plan’s assumption: {q.defaultAnswer}
              </button>
            )}
          </li>
        ))}
      </ol>
    </fieldset>
  );
}
