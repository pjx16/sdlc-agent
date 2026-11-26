'use client';

import { TICKET_KINDS, TicketDraftSchema, buildTicketMarkdown, zodFields, type TicketDraft, type TicketKind } from '@sdlc/shared';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { KbDocPicker } from '@/components/kb-doc-picker';
import { Markdown } from '@/components/markdown';
import { Modal } from '@/components/modal';
import { githubTarget } from '@/lib/github-repo';
import { useDebounced } from '@/lib/use-debounced';
import type { TicketFormData } from '@/lib/ticket-form-data';
import { CriteriaList } from './criteria-list';
import { DuplicatePrompt, GithubConfirm, PolicyLine } from './github-footer';

export interface CreateTicketModalProps extends TicketFormData {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const KIND_LABEL: Record<TicketKind, string> = { feature: 'Feature', bug: 'Bug', chore: 'Chore' };
const inputClass = 'mt-1 w-full rounded-md border bg-bg px-3 py-2 text-sm outline-none focus:border-accent';

function Field({ id, label, required, hint, error, children }: { id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden className="ml-1 text-red">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Where a ticket is written: the fields on the left, and on the right the ticket exactly as it will be stored (the same function that the API
 * calls writes it). The window is only mounted while it is open, so every ticket starts from an empty form.
 */
export function CreateTicketModal(props: CreateTicketModalProps) {
  return props.open ? <TicketEditor {...props} /> : null;
}

function TicketEditor({ onClose, onCreated, projects, template, githubIssueOnCreate }: CreateTicketModalProps) {
  const uid = useId();
  const usable = projects.filter((p) => p.enabled && (p.onboardingStatus ?? 'confirmed') === 'confirmed');
  const [projectId, setProjectId] = useState(usable[0]?.id ?? '');
  const [kind, setKind] = useState<TicketKind>('feature');
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [expected, setExpected] = useState('');
  const [steps, setSteps] = useState('');
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [notes, setNotes] = useState('');
  const [featureKey, setFeatureKey] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  // The GitHub question: what to do with the choice (ask, always, never), and where the ticket is while a question is open.
  const [policy, setPolicy] = useState(githubIssueOnCreate);
  const [stage, setStage] = useState<'form' | 'confirm' | 'duplicate'>('form');
  const [pending, setPending] = useState<TicketDraft | null>(null);
  const [duplicate, setDuplicate] = useState<{ number: number; title: string; url: string } | null>(null);
  // The docs belong to a project: choosing another one starts the choice again.
  useEffect(() => setAttached([]), [projectId]);

  const dirty = [title, problem, expected, steps, notes, featureKey].some((v) => v.trim() !== '') || criteria.some((c) => c.trim() !== '') || attached.length > 0;
  const markdown = useDebounced(useMemo(() => buildTicketMarkdown({ kind, problem, expected, steps, criteria, notes }, template), [kind, problem, expected, steps, criteria, notes, template]), 150);

  const clear = (...keys: string[]) => setErrors((e) => (keys.some((k) => k in e) ? Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))) : e));
  const criterionErrors = Object.fromEntries(Object.entries(errors).flatMap(([k, v]) => (/^criteria\.\d+$/.test(k) ? [[Number(k.split('.')[1]), v]] : [])));

  const target = (() => {
    const project = usable.find((p) => p.id === projectId);
    return project ? githubTarget(project) : null;
  })();

  /** The fields as a valid ticket, or null with each problem shown at its field. */
  function prepare(): TicketDraft | null {
    const draft = {
      projectId, kind, title, problem,
      expected: expected.trim() || undefined,
      steps: steps.trim() || undefined,
      criteria: criteria.map((c) => c.trim()).filter(Boolean),
      notes: notes.trim() || undefined,
      featureKey: featureKey.trim() || undefined,
      kbAttachments: attached,
    };
    const parsed = TicketDraftSchema.safeParse(draft);
    if (parsed.success) return parsed.data;
    setErrors(zodFields(parsed.error));
    setMessage('Some fields need attention.');
    setTab('write');
    return null;
  }

  /** Create ticket: validate, then (when the project uses GitHub) settle the GitHub question before anything is sent. */
  async function start() {
    const draft = prepare();
    if (!draft) return;
    setMessage(null);
    if (!target || policy === 'never') return send(draft);
    if (policy === 'always') return checkDuplicate(draft);
    setPending(draft);
    setStage('confirm');
  }

  /** The answer to "also create it on GitHub?". Remembering it is saved in the database, and if that fails nothing goes on until it is fixed or unticked. */
  async function choose(createIssue: boolean, remember: boolean) {
    if (!pending) return;
    if (remember) {
      setBusy(true);
      const saved = await rememberChoice(createIssue ? 'always' : 'never');
      setBusy(false);
      if (!saved) return;
    }
    setStage('form');
    if (createIssue) await checkDuplicate(pending);
    else await send(pending);
  }

  async function rememberChoice(value: 'always' | 'never'): Promise<boolean> {
    try {
      const res = await fetch('/api/system/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ githubIssueOnCreate: value }) });
      if (res.ok) {
        setPolicy(value);
        return true;
      }
      setMessage(`Could not remember your choice: ${((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'the settings were not saved.'}`);
    } catch {
      setMessage('Could not remember your choice: cannot reach the server.');
    }
    return false;
  }

  /** Before making an issue, look for an open one with the same title: linking it beats a duplicate. A search that fails does not stop the ticket. */
  async function checkDuplicate(draft: TicketDraft) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(draft.projectId)}/github/issues/search?title=${encodeURIComponent(draft.title)}`);
      const found = res.ok ? ((await res.json().catch(() => [])) as { number: number; title: string; url: string }[]) : [];
      if (found[0]) {
        setPending(draft);
        setDuplicate(found[0]);
        setStage('duplicate');
        setBusy(false);
        return;
      }
    } catch {
      // Not being able to look is not a reason to refuse the ticket.
    }
    await send(draft, { create: true });
  }

  async function send(draft: TicketDraft, github?: { create: boolean; link?: number }) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(github ? { ...draft, github } : draft) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return onCreated(body.id);
      setStage('form');
      if (res.status === 400 && body.fields) {
        setErrors(body.fields);
        setMessage('Some fields need attention.');
        setTab('write');
      } else setMessage(body.message ?? 'Could not create the ticket.');
    } catch {
      setStage('form');
      setMessage('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  // Cancel asks the same question as the close button and Esc.
  const cancel = () => {
    if (dirty && !window.confirm('Discard your changes?')) return;
    onClose();
  };

  const error = message && (
    <p role="alert" className="mt-2 text-sm text-red">
      {message}
    </p>
  );
  const footer =
    stage === 'confirm' && target ? (
      <div>
        <GithubConfirm target={target} busy={busy} onChoose={(createIssue, remember) => void choose(createIssue, remember)} onBack={() => setStage('form')} />
        {error}
      </div>
    ) : stage === 'duplicate' && duplicate && pending ? (
      <div>
        <DuplicatePrompt issue={duplicate} busy={busy} onLink={() => void send(pending, { create: false, link: duplicate.number })} onCreateAnyway={() => void send(pending, { create: true })} onCancel={() => setStage('form')} />
        {error}
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1 text-sm">
          {target && policy !== 'ask' && <PolicyLine policy={policy} target={target} />}
          {message && (
            <p role="alert" className="text-red">
              {message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={cancel} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button type="button" onClick={() => void start()} disabled={busy || usable.length === 0} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-60">
            {busy ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </div>
    );

  return (
    <Modal open onClose={onClose} title="New ticket" description="Write it in fields. The ticket on the right is exactly what the agents will read." size="full" dirty={dirty} flush footer={footer}>
      {usable.length === 0 ? (
        <p className="p-5 text-sm text-muted">There is no enabled project yet. Create a project first.</p>
      ) : (
        <div className="flex h-full flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div role="tablist" aria-label="Write or preview" className="flex border-b border-border lg:hidden">
            {(['write', 'preview'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 px-4 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-accent text-text' : 'text-muted'}`}>
                {t}
              </button>
            ))}
          </div>

          <form
            aria-label="Ticket fields"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
            noValidate
            className={`min-h-0 flex-1 space-y-5 overflow-y-auto p-5 ${tab === 'write' ? '' : 'hidden'} lg:block`}
          >
           <fieldset disabled={stage !== 'form'} className="contents">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${uid}-project`} label="Project" error={errors.projectId}>
                <select id={`${uid}-project`} value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${inputClass} border-border`}>
                  {usable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.mirrorStatus === 'ok' ? p.name : `${p.name} (mirror ${p.mirrorStatus})`}
                    </option>
                  ))}
                </select>
              </Field>
              <div>
                <span id={`${uid}-kind`} className="block text-sm font-medium">
                  Kind
                </span>
                <div role="radiogroup" aria-labelledby={`${uid}-kind`} className="mt-1 inline-flex rounded-md border border-border text-sm">
                  {TICKET_KINDS.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); clear('expected'); }} className={`px-3 py-2 first:rounded-l-md last:rounded-r-md ${kind === k ? 'bg-accent text-accent-text' : 'text-muted hover:text-text'}`}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Field id={`${uid}-title`} label="Title" required error={errors.title}>
              <input id={`${uid}-title`} value={title} onChange={(e) => { setTitle(e.target.value); clear('title'); }} aria-invalid={errors.title ? true : undefined} className={`${inputClass} ${errors.title ? 'border-red' : 'border-border'}`} />
            </Field>
            <Field id={`${uid}-problem`} label="Problem" required hint="What is wrong, or what is needed, and for whom?" error={errors.problem}>
              <textarea id={`${uid}-problem`} rows={4} value={problem} onChange={(e) => { setProblem(e.target.value); clear('problem'); }} aria-invalid={errors.problem ? true : undefined} className={`${inputClass} ${errors.problem ? 'border-red' : 'border-border'}`} />
            </Field>
            <Field id={`${uid}-expected`} label="Expected behaviour" required={kind === 'bug'} hint="What should happen instead?" error={errors.expected}>
              <textarea id={`${uid}-expected`} rows={3} value={expected} onChange={(e) => { setExpected(e.target.value); clear('expected'); }} aria-invalid={errors.expected ? true : undefined} className={`${inputClass} ${errors.expected ? 'border-red' : 'border-border'}`} />
            </Field>
            {kind === 'bug' && (
              <Field id={`${uid}-steps`} label="Steps to reproduce" hint="How can someone see it happen?" error={errors.steps}>
                <textarea id={`${uid}-steps`} rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} className={`${inputClass} border-border`} />
              </Field>
            )}
            <div>
              <span className="block text-sm font-medium">
                Acceptance criteria
                <span aria-hidden className="ml-1 text-red">
                  *
                </span>
              </span>
              <p className="mb-2 mt-1 text-xs text-muted">Each one becomes a checkbox in the ticket.</p>
              <CriteriaList items={criteria} onChange={(c) => { setCriteria(c); clear('criteria'); }} errors={criterionErrors} />
              {errors.criteria && (
                <p role="alert" className="mt-1 text-xs text-red">
                  {errors.criteria}
                </p>
              )}
            </div>
            <Field id={`${uid}-notes`} label="Notes" hint="Links, examples, constraints.">
              <textarea id={`${uid}-notes`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} border-border`} />
            </Field>
            <KbDocPicker key={projectId} projectId={projectId} selected={attached} onChange={setAttached} error={errors.kbAttachments} />
            <details>
              <summary className="cursor-pointer text-sm text-muted">More options</summary>
              <div className="mt-3">
                <Field id={`${uid}-feature`} label="Feature key (optional)" hint="Names the KB doc for this feature, e.g. billing-export." error={errors.featureKey}>
                  <input id={`${uid}-feature`} value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} className={`${inputClass} ${errors.featureKey ? 'border-red' : 'border-border'}`} />
                </Field>
              </div>
            </details>
           </fieldset>
          </form>

          <section aria-label="Preview of the ticket" className={`min-h-0 flex-1 overflow-y-auto border-border bg-surface-2/40 p-5 lg:border-l ${tab === 'preview' ? '' : 'hidden'} lg:block`}>
            <p className="eyebrow">Preview · read only</p>
            <h3 className="mt-2 text-lg font-semibold">{title.trim() || <span className="text-muted">Untitled</span>}</h3>
            <p className="mt-1 text-xs text-muted">
              {KIND_LABEL[kind]} · {usable.find((p) => p.id === projectId)?.name}
            </p>
            <div className="mt-4">{markdown ? <Markdown source={markdown} toggle={false} /> : <p className="text-sm text-muted">The ticket appears here as you write it.</p>}</div>
            {attached.length > 0 && (
              <div className="mt-6">
                <p className="eyebrow">Attached docs</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {attached.map((p) => (
                    <li key={p} className="font-mono text-xs">
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
