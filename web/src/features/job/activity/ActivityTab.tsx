import { CalendarPlus, CheckCircle2, Mail } from 'lucide-react';
import { useState } from 'react';
import { describeGoogleError } from '@/api/client';
import { useCalendarReminderMutation, useSaveEmailDraftMutation } from '@/api/queries';
import type { JobDetail } from '@/api/types';
import { Badge, Button, Input, PaperSheet, Textarea, useToast } from '@/components/ui';
import { toLocalInputValue } from '@/lib/datetime';

export function ActivityTab({ job }: { job: JobDetail }) {
  const saveDraftMutation = useSaveEmailDraftMutation();
  const calendarMutation = useCalendarReminderMutation();
  const { showToast } = useToast();

  // Seeded once per mount (the page keys tabs by job), so a background refetch
  // never discards unsaved edits.
  const [emailTo, setEmailTo] = useState(job.gmailDraft?.to ?? '');
  const [emailSubject, setEmailSubject] = useState(
    job.gmailDraft?.subject ?? `Application: ${job.title}`,
  );
  const [emailBody, setEmailBody] = useState(
    job.gmailDraft?.body ??
      `Hello ${job.company} team,\n\nI am writing to follow up regarding the ${job.title} role.\n\nBest regards,`,
  );
  const [confirmReady, setConfirmReady] = useState(Boolean(job.gmailDraft?.confirmed));
  const [reminderTitle, setReminderTitle] = useState(`${job.company} — Follow-up / Interview Prep`);
  const [reminderStartsAt, setReminderStartsAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 86_400_000)),
  );
  const [reminderNotes, setReminderNotes] = useState('');

  return (
    <div className="space-y-4">
      <PaperSheet className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--wp-muted)]">
          <Mail className="h-3.5 w-3.5 text-[var(--wp-accent)]" />
          <span>Linked Gmail threads</span>
        </div>
        {job.gmailThreads.length === 0 ? (
          <p className="text-xs text-[var(--wp-muted)]">
            No Gmail threads linked yet. Sync runs twice daily or via Settings.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--wp-hairline)]">
            {job.gmailThreads.map((t) => (
              <li key={t.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(t.threadId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-medium hover:text-[var(--wp-accent)]"
                  >
                    {t.subject}
                  </a>
                  {t.needsReply ? <Badge variant="warning">Needs reply</Badge> : null}
                </div>
                <div className="truncate text-xs text-[var(--wp-muted)]">
                  {t.from}
                  {t.lastMessageAt
                    ? ` · ${new Date(t.lastMessageAt).toLocaleString()}`
                    : ''}
                </div>
                {t.snippet ? (
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--wp-secondary)]">
                    {t.snippet}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PaperSheet>

      <PaperSheet className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--wp-muted)]">
            <Mail className="h-3.5 w-3.5 text-[var(--wp-accent)]" />
            <span>Gmail Draft &amp; Confirmation Gate</span>
          </div>
          <Badge variant={job.gmailDraft?.confirmed ? 'success' : 'warning'}>
            {job.gmailDraft?.confirmed ? 'In Gmail Drafts' : 'Draft here only'}
          </Badge>
        </div>

        <div className="space-y-2.5 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-[var(--wp-muted)]">To</span>
            <Input
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-[var(--wp-muted)]">Subject</span>
            <Input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-[var(--wp-muted)]">Body</span>
            <Textarea
              rows={4}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-xs text-[var(--wp-secondary)]">
            <input
              type="checkbox"
              checked={confirmReady}
              onChange={(e) => setConfirmReady(e.target.checked)}
              className="mt-0.5 accent-[var(--wp-accent)]"
            />
            <span>
              I have reviewed the recipient, subject and claims. Career OS only saves it
              to Gmail Drafts; you send it from Gmail.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={saveDraftMutation.isPending}
            onClick={() =>
              saveDraftMutation.mutate(
                {
                  id: job.id,
                  payload: {
                    to: emailTo,
                    subject: emailSubject,
                    body: emailBody,
                    confirmed: false,
                  },
                },
                {
                  onSuccess: () => showToast({ message: 'Saved draft locally' }),
                },
              )
            }
          >
            Save draft here
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!confirmReady || !emailTo.trim() || saveDraftMutation.isPending}
            onClick={() =>
              saveDraftMutation.mutate(
                {
                  id: job.id,
                  payload: {
                    to: emailTo,
                    subject: emailSubject,
                    body: emailBody,
                    confirmed: true,
                  },
                },
                {
                  onSuccess: () =>
                    showToast({ tone: 'success', message: 'Saved to Gmail Drafts' }),
                },
              )
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Save to Gmail Drafts (you send it)</span>
          </Button>
        </div>

        {saveDraftMutation.isError ? (
          <p role="alert" className="text-xs text-[var(--wp-bad)]">
            {describeGoogleError(saveDraftMutation.error)} Your draft text is saved here.
          </p>
        ) : null}
      </PaperSheet>

      <PaperSheet className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--wp-muted)]">
          <CalendarPlus className="h-3.5 w-3.5 text-[var(--wp-accent)]" />
          <span>Calendar Reminder</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            type="text"
            value={reminderTitle}
            onChange={(e) => setReminderTitle(e.target.value)}
            placeholder="Reminder title"
          />
          <Input
            type="datetime-local"
            value={reminderStartsAt}
            onChange={(e) => setReminderStartsAt(e.target.value)}
          />
        </div>
        <Input
          type="text"
          value={reminderNotes}
          onChange={(e) => setReminderNotes(e.target.value)}
          placeholder="Prep notes"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={calendarMutation.isPending || !reminderTitle.trim()}
          onClick={() =>
            calendarMutation.mutate(
              {
                id: job.id,
                payload: {
                  title: reminderTitle.trim(),
                  startsAt: new Date(
                    reminderStartsAt || Date.now() + 86_400_000,
                  ).toISOString(),
                  notes: reminderNotes,
                },
              },
              {
                onSuccess: () =>
                  showToast({ tone: 'success', message: 'Calendar reminder added' }),
              },
            )
          }
        >
          Add Calendar Reminder
        </Button>
        {calendarMutation.isError ? (
          <p role="alert" className="text-xs text-[var(--wp-bad)]">
            {describeGoogleError(calendarMutation.error)}
          </p>
        ) : null}
        {job.calendarReminders.length > 0 ? (
          <div className="space-y-1.5 pt-1">
            {job.calendarReminders.map((rem) => (
              <div
                key={rem.id}
                className="rounded-[10px] bg-[var(--wp-raised)] px-3 py-2 text-xs"
              >
                <div className="font-medium text-[var(--wp-ink)]">{rem.title}</div>
                <div className="font-mono-meta text-[var(--wp-muted)]">
                  {new Date(rem.startsAt).toLocaleString()} — {rem.notes}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </PaperSheet>
    </div>
  );
}
