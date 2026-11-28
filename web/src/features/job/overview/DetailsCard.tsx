import { Pencil } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { formatCompensation } from '@/api/jobs';
import { Button, Input, Notice, PaperSheet, Select, Skeleton, useToast } from '@/components/ui';
import { errorText, useRawJobQuery, useUpdateJobMutation, type JobRow } from './api';
import { WORKPLACE_OPTIONS, buildPatch, toForm, type DetailsForm } from './form';

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-xs font-medium text-[var(--wp-muted)]">{label}</span>
      {children}
    </label>
  );
}

function EditForm({ job, onDone }: { job: JobRow; onDone: () => void }) {
  const [opened] = useState(() => toForm(job));
  const [form, setForm] = useState(opened);
  const [invalid, setInvalid] = useState<string | null>(null);
  const update = useUpdateJobMutation(job.id);
  const { showToast } = useToast();

  const set = (key: keyof DetailsForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const text = (
    key: keyof DetailsForm,
    label: string,
    extra?: { className?: string; inputMode?: 'numeric' | 'url'; placeholder?: string },
  ) => (
    <Field label={label} className={extra?.className}>
      {/* 16px on phones stops iOS from zooming into the focused field. */}
      <Input
        className="min-h-11 max-sm:!text-base"
        value={form[key]}
        inputMode={extra?.inputMode}
        placeholder={extra?.placeholder}
        autoCapitalize={key === 'url' ? 'none' : undefined}
        onChange={(e) => set(key)(e.target.value)}
      />
    </Field>
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = buildPatch(opened, form);
    if ('error' in result) {
      setInvalid(result.error);
      return;
    }
    setInvalid(null);
    if (Object.keys(result.patch).length === 0) {
      onDone();
      return;
    }
    update.mutate(result.patch, {
      onSuccess: () => {
        showToast({ tone: 'success', message: 'Job details saved' });
        onDone();
      },
    });
  };

  const failure = invalid ?? (update.isError ? errorText(update.error) : null);

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
      {text('title', 'Title', { className: 'col-span-2' })}
      {text('company', 'Company', { className: 'col-span-2 sm:col-span-1' })}
      {text('location', 'Location', { className: 'col-span-2 sm:col-span-1' })}
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <span className="block text-xs font-medium text-[var(--wp-muted)]">Workplace type</span>
        <Select
          ariaLabel="Workplace type"
          className="min-h-11 w-full"
          value={form.workplace_type}
          onValueChange={set('workplace_type')}
          options={WORKPLACE_OPTIONS}
        />
      </div>
      {text('yoe_label', 'Years of experience', {
        className: 'col-span-2 sm:col-span-1',
        placeholder: '3-5 years',
      })}
      {text('salary_min', 'Salary from', { inputMode: 'numeric', placeholder: '150000' })}
      {text('salary_max', 'Salary to', { inputMode: 'numeric', placeholder: '180000' })}
      {text('salary_currency', 'Currency', { placeholder: 'USD' })}
      {text('url', 'Posting URL', { className: 'col-span-2', inputMode: 'url' })}
      {failure ? (
        <div className="col-span-2">
          <Notice tone="danger">{failure}</Notice>
        </div>
      ) : null}
      <div className="col-span-2 flex flex-wrap gap-2">
        <Button type="submit" variant="primary" className="min-h-11" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save details'}
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Details({ job }: { job: JobRow }) {
  const workplace = WORKPLACE_OPTIONS.find((o) => o.value === job.workplace_type)?.label;
  const rows: [string, string | null | undefined][] = [
    ['Title', job.title],
    ['Company', job.company],
    ['Location', job.location],
    ['Workplace', workplace],
    ['Salary', formatCompensation(job)],
    ['Experience', job.yoe_label],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-[var(--wp-muted)]">{label}</dt>
          <dd className="break-words text-[var(--wp-ink)]">{value || '—'}</dd>
        </div>
      ))}
      <div className="col-span-2 min-w-0">
        <dt className="text-xs text-[var(--wp-muted)]">Posting URL</dt>
        <dd className="break-all">
          <a
            href={/^https?:/i.test(job.url) ? job.url : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--wp-accent)] underline-offset-2 hover:underline"
          >
            {job.url}
          </a>
        </dd>
      </div>
    </dl>
  );
}

export function DetailsCard({ jobId }: { jobId: string }) {
  const query = useRawJobQuery(jobId);
  const [editing, setEditing] = useState(false);
  const job = query.data?.job;

  return (
    <PaperSheet className="space-y-3 p-4">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-[var(--wp-ink)]">Details</h3>
        {job && !editing ? (
          <Button variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            <span>Edit details</span>
          </Button>
        ) : null}
      </div>
      {job ? (
        editing ? (
          <EditForm job={job} onDone={() => setEditing(false)} />
        ) : (
          <Details job={job} />
        )
      ) : query.isError ? (
        <Notice tone="danger">
          Could not load the details: {errorText(query.error)}{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </Notice>
      ) : (
        <Skeleton className="h-28 w-full" />
      )}
    </PaperSheet>
  );
}
