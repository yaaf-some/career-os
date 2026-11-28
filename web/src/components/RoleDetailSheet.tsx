import {
  CalendarPlus,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { describeAiError, describeGoogleError, describeTailorError } from '@/api/client';
import {
  useCalendarReminderMutation,
  useEvaluateJobMutation,
  useJobDetailQuery,
  useSaveEmailDraftMutation,
  useTailorJobMutation,
  useTriageMutation,
} from '@/api/queries';
import { CommuteBadge } from '@/components/CommuteBadge';
import { DescriptionSection } from '@/components/DescriptionSection';
import { FitHorizon } from '@/components/FitHorizon';
import {
  Badge,
  Button,
  Input,
  PaperSheet,
  Sheet,
  SheetClose,
  SheetDescription,
  SheetTitle,
  TabsList,
  TabsPanel,
  TabsRoot,
  TabsTab,
  Textarea,
  useToast,
} from '@/components/ui';

/** `datetime-local` inputs hold local time; `toISOString` would shift it to UTC. */
export function toLocalInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function RoleDetailSheet({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useJobDetailQuery(jobId);
  const evaluateMutation = useEvaluateJobMutation();
  const tailorMutation = useTailorJobMutation();
  const triageMutation = useTriageMutation();
  const saveDraftMutation = useSaveEmailDraftMutation();
  const calendarMutation = useCalendarReminderMutation();
  const { showToast } = useToast();

  const job = detailQuery.data;

  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [confirmReady, setConfirmReady] = useState(false);

  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderStartsAt, setReminderStartsAt] = useState('');
  const [reminderNotes, setReminderNotes] = useState('');

  // The sheet stays mounted, so clear results that belong to the previous job.
  const resetEvaluate = evaluateMutation.reset;
  const resetTailor = tailorMutation.reset;
  const resetTriage = triageMutation.reset;
  const resetDraft = saveDraftMutation.reset;
  const resetCalendar = calendarMutation.reset;
  useEffect(() => {
    resetEvaluate();
    resetTailor();
    resetTriage();
    resetDraft();
    resetCalendar();
  }, [jobId, resetCalendar, resetDraft, resetEvaluate, resetTailor, resetTriage]);

  useEffect(() => {
    if (!job) return;
    setEmailTo(job.gmailDraft?.to ?? '');
    setEmailSubject(job.gmailDraft?.subject ?? `Application: ${job.title}`);
    setEmailBody(
      job.gmailDraft?.body ??
        `Hello ${job.company} team,\n\nI am writing to follow up regarding the ${job.title} role.\n\nBest regards,`,
    );
    setConfirmReady(Boolean(job.gmailDraft?.confirmed));
    setReminderTitle(`${job.company} — Follow-up / Interview Prep`);
    setReminderStartsAt(toLocalInputValue(new Date(Date.now() + 86_400_000)));
    setReminderNotes('');
    // Seed once per job: a background refetch must not discard unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  return (
    <Sheet
      open={Boolean(jobId)}
      onOpenChange={(open) => !open && onClose()}
      ariaLabel="Role detail sheet"
      maxWidthClass="md:max-w-2xl"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--wp-hairline)] px-6 py-4">
        <div className="min-w-0">
          <SheetDescription className="flex flex-wrap items-center gap-2 text-xs text-[var(--wp-muted)]">
            {job ? (
              <>
                <span className="font-medium text-[var(--wp-secondary)]">{job.company}</span>
                <span>·</span>
                <span>{job.location}</span>
                {job.compensation ? (
                  <>
                    <span>·</span>
                    <span className="font-mono-meta">{job.compensation}</span>
                  </>
                ) : null}
                <CommuteBadge jobId={job.id} remotePolicy={job.remotePolicy} compact />
              </>
            ) : (
              'Fetching role evaluation & artifacts'
            )}
          </SheetDescription>
          <SheetTitle className="font-serif-title mt-1 truncate text-xl text-[var(--wp-ink)]">
            {job ? job.title : 'Loading role…'}
          </SheetTitle>
        </div>

        <SheetClose
          aria-label="Close role detail"
          className="tap-control shrink-0 rounded-[10px] bg-[var(--wp-raised)] px-3 py-1.5 text-xs font-medium text-[var(--wp-ink)]"
        >
          Done
        </SheetClose>
      </div>

      {detailQuery.isLoading ? (
        <div className="p-6 text-sm text-[var(--wp-muted)]">Loading job details…</div>
      ) : !job ? (
        <div className="p-6 text-sm text-[var(--wp-bad)]">Unable to load selected role.</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Quick Status & Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--wp-hairline)] bg-[var(--wp-canvas)]/60 px-6 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={job.triageStatus === 'shortlisted' ? 'success' : 'neutral'}>
                {job.triageStatus}
              </Badge>
              <Badge variant="neutral">stage: {job.stage}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={triageMutation.isPending || job.triageStatus === 'shortlisted'}
                onClick={() =>
                  triageMutation.mutate(
                    { id: job.id, payload: { action: 'shortlist' } },
                    {
                      onSuccess: () =>
                        showToast({ tone: 'success', message: `Saved ${job.company}` }),
                      onError: (err) => showToast({ message: `Could not save: ${err.message}` }),
                    },
                  )
                }
              >
                {job.triageStatus === 'shortlisted' ? 'Saved' : 'Save'}
              </Button>
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tap-control inline-flex h-8 items-center gap-1 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-surface)] px-3 text-xs font-medium text-[var(--wp-ink)] hover:bg-[var(--wp-raised)]"
              >
                <span>Posting</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <TabsRoot defaultValue="posting" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="px-6 pt-3">
              <TabsTab value="posting">Posting details</TabsTab>
              <TabsTab value="eval">Deep analysis</TabsTab>
              <TabsTab value="comms">Comms &amp; reminders</TabsTab>
              <TabsTab value="tailor">Tailor docs</TabsTab>
            </TabsList>

            <div className="flex-1 overflow-y-auto p-6">
              <TabsPanel value="posting" className="space-y-4">
                <PaperSheet className="space-y-3 bg-[var(--wp-raised)]/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--wp-muted)]">
                      Fit breakdown
                    </span>
                    {job.dealbreakerReason ? (
                      <Badge variant="danger">Dealbreaker: {job.dealbreakerReason}</Badge>
                    ) : null}
                  </div>
                  <FitHorizon
                    score={job.matchScore}
                    breakdown={job.scoreBreakdown}
                    source={job.source}
                    compact
                  />
                  {job.matchSummary ? (
                    <p className="text-sm leading-relaxed text-[var(--wp-secondary)]">
                      {job.matchSummary}
                    </p>
                  ) : null}
                </PaperSheet>

                <DescriptionSection key={job.id} jobId={job.id} text={job.descriptionText} />

                {job.requirements.length > 0 ? (
                  <PaperSheet className="space-y-2 p-4">
                    <h4 className="text-xs font-medium text-[var(--wp-muted)]">Key requirements</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--wp-secondary)]">
                      {job.requirements.map((req) => (
                        <li key={req}>{req}</li>
                      ))}
                    </ul>
                  </PaperSheet>
                ) : null}
              </TabsPanel>

              <TabsPanel value="eval" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Deep Analysis (Blocks A–G)</h3>
                    <p className="text-xs text-[var(--wp-muted)]">
                      Balanced tier by default · auto-escalates to Deep when match score &ge; 75.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={evaluateMutation.isPending}
                    onClick={() =>
                      evaluateMutation.mutate(job.id, {
                        onSuccess: () =>
                          showToast({
                            tone: 'success',
                            message: `Deep analysis complete for ${job.company}`,
                          }),
                      })
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      {evaluateMutation.isPending
                        ? 'Evaluating…'
                        : job.deepEval
                          ? 'Re-run Deep Analysis'
                          : 'Run Deep Analysis'}
                    </span>
                  </Button>
                </div>

                {evaluateMutation.isError ? (
                  <p
                    role="alert"
                    className="rounded-[10px] bg-[var(--wp-bad-soft)] px-3 py-2 text-xs text-[var(--wp-bad)]"
                  >
                    {describeAiError(evaluateMutation.error)}
                  </p>
                ) : null}

                {job.deepEval ? (
                  <div className="space-y-3">
                    <PaperSheet className="flex flex-wrap items-center justify-between gap-2 bg-[var(--wp-accent-soft)] p-4">
                      <span className="text-sm font-medium text-[var(--wp-ink)]">
                        {job.deepEval.overallVerdict}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {job.deepEval.confidence ? (
                          <Badge variant="brand">{job.deepEval.confidence}</Badge>
                        ) : null}
                        {job.deepEval.provider ? (
                          <Badge variant="neutral">
                            {job.deepEval.provider}
                            {job.deepEval.model ? ` · ${job.deepEval.model}` : ''}
                          </Badge>
                        ) : null}
                      </div>
                    </PaperSheet>

                    {job.deepEval.blocks.map((block) => (
                      <PaperSheet key={block.block} className="space-y-1.5 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium text-[var(--wp-ink)]">
                            Block {block.block}: {block.title}
                          </div>
                          {block.rating ? (
                            <Badge variant={block.block === 'G' ? 'success' : 'neutral'}>
                              {block.rating}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm leading-relaxed text-[var(--wp-secondary)]">
                          {block.summary}
                        </p>
                        {block.highlights.length > 0 ? (
                          <ul className="list-disc space-y-0.5 pt-1 pl-4 text-xs text-[var(--wp-muted)]">
                            {block.highlights.map((h) => (
                              <li key={h}>{h}</li>
                            ))}
                          </ul>
                        ) : null}
                      </PaperSheet>
                    ))}
                  </div>
                ) : (
                  <PaperSheet className="p-6 text-center text-sm text-[var(--wp-muted)]">
                    No A–G deep analysis yet. Run Deep Analysis to evaluate this role.
                  </PaperSheet>
                )}
              </TabsPanel>

              <TabsPanel value="comms" className="space-y-4">
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
              </TabsPanel>

              <TabsPanel value="tailor" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Tailor Resume &amp; Cover Letter</h3>
                    <p className="text-xs text-[var(--wp-muted)]">
                      Strictly grounded in <code className="font-mono-meta">profile/</code> &amp;
                      synced project docs.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={tailorMutation.isPending}
                    onClick={() =>
                      tailorMutation.mutate(job.id, {
                        onSuccess: () =>
                          showToast({
                            tone: 'success',
                            message: `Tailored Google Docs ready for ${job.company}`,
                          }),
                      })
                    }
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>
                      {tailorMutation.isPending
                        ? 'Generating Docs…'
                        : job.tailor.resumeDocUrl || job.tailor.coverLetterDocUrl
                          ? 'Regenerate Docs'
                          : 'Tailor to Google Docs'}
                    </span>
                  </Button>
                </div>

                {tailorMutation.isError ? (
                  <p
                    role="alert"
                    className="rounded-[10px] bg-[var(--wp-bad-soft)] px-3 py-2 text-xs text-[var(--wp-bad)]"
                  >
                    {describeTailorError(tailorMutation.error)}
                  </p>
                ) : null}

                <PaperSheet className="space-y-2 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--wp-muted)]">
                    <ShieldCheck className="h-4 w-4 text-[var(--wp-good)]" />
                    <span>Google Docs Artifacts</span>
                  </div>
                  {job.tailor.resumeDocUrl || job.tailor.coverLetterDocUrl ? (
                    <div className="flex flex-wrap gap-2">
                      {job.tailor.resumeDocUrl ? (
                        <a
                          href={job.tailor.resumeDocUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-raised)] px-3 py-1.5 text-xs font-medium hover:opacity-90"
                        >
                          <FileText className="h-3.5 w-3.5 text-[var(--wp-accent)]" />
                          <span>Open Tailored Resume Doc</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                      {job.tailor.coverLetterDocUrl ? (
                        <a
                          href={job.tailor.coverLetterDocUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-raised)] px-3 py-1.5 text-xs font-medium hover:opacity-90"
                        >
                          <FileText className="h-3.5 w-3.5 text-[var(--wp-good)]" />
                          <span>Open Tailored Cover Letter Doc</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--wp-muted)]">
                      Not yet tailored. Generate Google Docs drafts grounded in your profile &amp;
                      synced project docs.
                    </p>
                  )}
                </PaperSheet>

                <PaperSheet className="space-y-2.5 p-4">
                  <div className="text-xs font-medium text-[var(--wp-muted)]">
                    Grounded Evidence
                  </div>
                  {job.tailor.groundedBullets.length === 0 ? (
                    <p className="text-sm text-[var(--wp-muted)]">
                      Tailor to map matching bullets from your profile &amp; synced project docs.
                    </p>
                  ) : (
                    job.tailor.groundedBullets.map((b) => (
                      <div
                        key={b.id}
                        className="rounded-[12px] border border-[var(--wp-hairline)] p-3 text-sm"
                      >
                        <div className="text-xs text-[var(--wp-muted)]">
                          {b.sourceFile} → {b.section}
                        </div>
                        <p className="mt-1 font-medium text-[var(--wp-ink)]">{b.text}</p>
                        <p className="mt-1 text-xs text-[var(--wp-secondary)]">
                          {b.relevanceNote}
                        </p>
                      </div>
                    ))
                  )}
                </PaperSheet>
              </TabsPanel>
            </div>
          </TabsRoot>
        </div>
      )}
    </Sheet>
  );
}
