import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import {
  CalendarPlus,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  useCalendarReminderMutation,
  useEvaluateJobMutation,
  useJobDetailQuery,
  useSaveEmailDraftMutation,
  useTailorJobMutation,
  useTriageMutation,
} from '@/api/queries';
import { describeAiError, describeGoogleError } from '@/api/client';
import { formatHydrogenScore } from '@/api/jobs';
import { Badge, Button, Card } from '@/components/ui';
import { CommuteBadge } from '@/components/CommuteBadge';
import { cn } from '@/lib/cn';

/** The tailor backend isn't built yet (separate issue); only the demo can run it. */
const tailorAvailable = () => import.meta.env.VITE_DEMO_MODE === 'true';

export function RoleDetailDrawer({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useJobDetailQuery(jobId);
  const TAILOR_AVAILABLE = tailorAvailable();
  const evaluateMutation = useEvaluateJobMutation();
  const tailorMutation = useTailorJobMutation();
  const triageMutation = useTriageMutation();
  const saveDraftMutation = useSaveEmailDraftMutation();
  const calendarMutation = useCalendarReminderMutation();

  const job = detailQuery.data;

  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [confirmReady, setConfirmReady] = useState(false);

  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderStartsAt, setReminderStartsAt] = useState('');
  const [reminderNotes, setReminderNotes] = useState('');

  useEffect(() => {
    if (!job) return;
    setEmailTo(job.gmailDraft?.to ?? 'recruiting@example.com');
    setEmailSubject(job.gmailDraft?.subject ?? `Application: ${job.title}`);
    setEmailBody(
      job.gmailDraft?.body ??
        `Hello ${job.company} team,\n\nI am writing to follow up regarding the ${job.title} role.\n\nBest regards,`,
    );
    setConfirmReady(Boolean(job.gmailDraft?.confirmed));
    setReminderTitle(`${job.company} — Follow-up / Interview Prep`);
    setReminderStartsAt(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
    setReminderNotes('Grounded talking points from Experience List.md');
  }, [job]);

  return (
    <Dialog.Root open={Boolean(jobId)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs" />
        <Dialog.Popup
          aria-label="Role detail drawer"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-border bg-background text-foreground shadow-2xl outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold">
                {job ? job.title : 'Loading role…'}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {job ? (
                  <>
                    <span className="font-medium text-foreground">{job.company}</span>
                    <span>•</span>
                    <span>{job.location}</span>
                    {job.compensation ? (
                      <>
                        <span>•</span>
                        <span>{job.compensation}</span>
                      </>
                    ) : null}
                    <CommuteBadge jobId={job.id} remotePolicy={job.remotePolicy} />
                  </>
                ) : (
                  'Fetching role evaluation & artifacts'
                )}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close role detail"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          {detailQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading job details…</div>
          ) : !job ? (
            <div className="p-6 text-sm text-destructive">Unable to load selected role.</div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Quick Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/40 px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="brand">hydrogen {formatHydrogenScore(job.hydrogenScore)}</Badge>
                  <Badge variant={job.triageStatus === 'approved' ? 'success' : 'neutral'}>
                    {job.triageStatus}
                  </Badge>
                  <Badge variant="neutral">stage: {job.stage}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={triageMutation.isPending}
                    onClick={() =>
                      triageMutation.mutate({ id: job.id, payload: { action: 'approve' } })
                    }
                  >
                    Approve
                  </Button>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent"
                  >
                    <span>Posting</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <Tabs.Root defaultValue="jd" className="flex min-h-0 flex-1 flex-col">
                <Tabs.List className="flex gap-1 border-b border-border px-5 pt-2">
                  {[
                    { value: 'jd', label: 'JD & Score' },
                    { value: 'eval', label: 'Neon Eval (A–G)' },
                    { value: 'tailor', label: 'Tailor Docs' },
                    { value: 'comms', label: 'Gmail & Calendar' },
                  ].map((tab) => (
                    <Tabs.Tab
                      key={tab.value}
                      value={tab.value}
                      className="rounded-t-lg border-b-2 border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors data-[selected]:border-accent-brand data-[selected]:text-foreground"
                    >
                      {tab.label}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>

                <div className="flex-1 overflow-y-auto p-5">
                  <Tabs.Panel value="jd" className="space-y-4">
                    <Card className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Hydrogen Triage Summary
                        </div>
                        {job.dealbreakerReason ? (
                          <Badge variant="danger">Dealbreaker: {job.dealbreakerReason}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-sm">
                        {job.hydrogenSummary || (
                          <span className="text-muted-foreground">Not scored yet.</span>
                        )}
                      </p>
                      {job.scoreBreakdown ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {(
                            [
                              ['Role & Stack', job.scoreBreakdown.roleStack, 35],
                              ['Level', job.scoreBreakdown.levelReachability, 25],
                              ['Vibe & Culture', job.scoreBreakdown.vibeCulture, 25],
                              ['Logistics', job.scoreBreakdown.logisticsComp, 15],
                            ] as const
                          ).map(([label, val, max]) => (
                            <div key={label} className="rounded-lg bg-secondary/70 p-2">
                              <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
                              <div className="text-sm font-semibold tabular-nums">
                                {val}/{max}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </Card>

                    <Card className="p-4">
                      <h3 className="text-sm font-semibold">Job Description</h3>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                        {job.descriptionText || 'No description captured for this posting.'}
                      </p>
                      {job.requirements.length > 0 ? (
                        <>
                          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Key Requirements
                          </h4>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                            {job.requirements.map((req) => (
                              <li key={req}>{req}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </Card>
                  </Tabs.Panel>

                  <Tabs.Panel value="eval" className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold">Neon Deep Evaluation (Blocks A–G)</h3>
                        <p className="text-xs text-muted-foreground">
                          Structured rubric + Block G posting integrity check.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={evaluateMutation.isPending}
                        onClick={() => evaluateMutation.mutate(job.id)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>
                          {evaluateMutation.isPending
                            ? 'Evaluating…'
                            : job.neonEval
                              ? 'Re-run Neon Eval'
                              : 'Run Neon Deep Eval'}
                        </span>
                      </Button>
                    </div>

                    {evaluateMutation.isError ? (
                      <p
                        role="alert"
                        className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400"
                      >
                        {describeAiError(evaluateMutation.error)}
                      </p>
                    ) : null}

                    {job.neonEval ? (
                      <div className="space-y-3">
                        <Card className="border-accent-brand/40 bg-accent-brand/5 p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold">{job.neonEval.overallVerdict}</span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {job.neonEval.confidence ? (
                                <Badge variant="brand">Confidence: {job.neonEval.confidence}</Badge>
                              ) : null}
                              {job.neonEval.provider ? (
                                <Badge variant="neutral">
                                  {job.neonEval.provider}
                                  {job.neonEval.model ? ` · ${job.neonEval.model}` : ''}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        </Card>
                        {job.neonEval.blocks.map((block) => (
                          <Card key={block.block} className="p-3.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold">
                                Block {block.block}: {block.title}
                              </div>
                              {block.rating ? (
                                <Badge variant={block.block === 'G' ? 'success' : 'neutral'}>
                                  {block.rating}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1.5 text-sm text-muted-foreground">{block.summary}</p>
                            {block.highlights.length > 0 ? (
                              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-foreground/90">
                                {block.highlights.map((h) => (
                                  <li key={h}>{h}</li>
                                ))}
                              </ul>
                            ) : null}
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Card className="p-6 text-center text-sm text-muted-foreground">
                        No neon A–G evaluation yet. Click <strong>Run Neon Deep Eval</strong> to generate.
                      </Card>
                    )}
                  </Tabs.Panel>

                  <Tabs.Panel value="tailor" className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold">
                          Tailor Resume & Cover Letter (Google Docs)
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Strictly grounded in <code className="rounded bg-secondary px-1">Experience List.md</code> — zero fabricated claims.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!TAILOR_AVAILABLE || tailorMutation.isPending}
                        title={TAILOR_AVAILABLE ? undefined : 'Not available yet'}
                        onClick={() => tailorMutation.mutate(job.id)}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>
                          {!TAILOR_AVAILABLE
                            ? 'Tailoring: not available yet'
                            : tailorMutation.isPending
                              ? 'Generating Docs…'
                              : 'Tailor to Google Docs'}
                        </span>
                      </Button>
                    </div>

                    <Card className="p-4 space-y-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        <span>Google Docs Artifacts</span>
                      </div>
                      {job.tailor.resumeDocUrl || job.tailor.coverLetterDocUrl ? (
                        <div className="flex flex-wrap gap-2">
                          {job.tailor.resumeDocUrl ? (
                            <a
                              href={job.tailor.resumeDocUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-accent"
                            >
                              <FileText className="h-3.5 w-3.5 text-accent-brand" />
                              <span>Open Tailored Resume Doc</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                          {job.tailor.coverLetterDocUrl ? (
                            <a
                              href={job.tailor.coverLetterDocUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-accent"
                            >
                              <FileText className="h-3.5 w-3.5 text-emerald-500" />
                              <span>Open Tailored Cover Letter Doc</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Not yet tailored. Generate Google Docs drafts grounded in Experience List.md.
                        </p>
                      )}
                    </Card>

                    <Card className="p-4 space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Grounded Evidence from Experience List.md
                      </div>
                      {job.tailor.groundedBullets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Click &ldquo;Tailor to Google Docs&rdquo; to map matching bullets from Experience List.md.
                        </p>
                      ) : (
                        job.tailor.groundedBullets.map((b) => (
                          <div key={b.id} className="rounded-lg border border-border p-3 text-sm">
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>
                                {b.sourceFile} → {b.section}
                              </span>
                            </div>
                            <p className="mt-1 font-medium">{b.text}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{b.relevanceNote}</p>
                          </div>
                        ))
                      )}
                    </Card>
                  </Tabs.Panel>

                  <Tabs.Panel value="comms" className="space-y-4">
                    <Card className="p-4 space-y-2.5">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Mail className="h-4 w-4 text-accent-brand" />
                        <span>Linked Gmail threads</span>
                      </div>
                      {job.gmailThreads.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No Gmail threads linked to this role yet. Sync runs twice daily; use
                          Settings → Sync now for an immediate check.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {job.gmailThreads.map((t) => (
                            <li key={t.id} className="rounded-lg border border-border p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <a
                                  href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(t.threadId)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate text-sm font-medium hover:text-accent-brand"
                                >
                                  {t.subject}
                                </a>
                                {t.needsReply ? <Badge variant="warning">Needs reply</Badge> : null}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {t.from}
                                {t.lastMessageAt
                                  ? ` · ${new Date(t.lastMessageAt).toLocaleString()}`
                                  : ''}
                              </div>
                              {t.snippet ? (
                                <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{t.snippet}</p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>

                    <Card className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Mail className="h-4 w-4 text-accent-brand" />
                          <span>Gmail Draft & Confirmation Gate</span>
                        </div>
                        <Badge variant={job.gmailDraft?.confirmed ? 'success' : 'warning'}>
                          {job.gmailDraft?.confirmed ? 'In Gmail Drafts' : 'Draft here only'}
                        </Badge>
                      </div>

                      <div className="space-y-2 text-sm">
                        <label className="block">
                          <span className="text-xs text-muted-foreground">To</span>
                          <input
                            type="email"
                            value={emailTo}
                            onChange={(e) => setEmailTo(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted-foreground">Subject</span>
                          <input
                            type="text"
                            value={emailSubject}
                            onChange={(e) => setEmailSubject(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted-foreground">Body</span>
                          <textarea
                            rows={5}
                            value={emailBody}
                            onChange={(e) => setEmailBody(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={confirmReady}
                            onChange={(e) => setConfirmReady(e.target.checked)}
                          />
                          <span>
                            I have reviewed the recipient, subject and claims. Career OS only saves
                            it to Gmail Drafts; you send it from Gmail.
                          </span>
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={saveDraftMutation.isPending}
                          onClick={() =>
                            saveDraftMutation.mutate({
                              id: job.id,
                              payload: {
                                to: emailTo,
                                subject: emailSubject,
                                body: emailBody,
                                confirmed: false,
                              },
                            })
                          }
                        >
                          Save draft here
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!confirmReady || saveDraftMutation.isPending}
                          onClick={() =>
                            saveDraftMutation.mutate({
                              id: job.id,
                              payload: {
                                to: emailTo,
                                subject: emailSubject,
                                body: emailBody,
                                confirmed: true,
                              },
                            })
                          }
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Save to Gmail Drafts (you send it)</span>
                        </Button>
                      </div>
                      {saveDraftMutation.isError ? (
                        <p role="alert" className="text-xs text-destructive">
                          {describeGoogleError(saveDraftMutation.error)} Your draft text is saved
                          here.
                        </p>
                      ) : null}
                    </Card>

                    <Card className="p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <CalendarPlus className="h-4 w-4 text-accent-brand" />
                        <span>Calendar Reminder</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          value={reminderTitle}
                          onChange={(e) => setReminderTitle(e.target.value)}
                          placeholder="Reminder title"
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                        />
                        <input
                          type="datetime-local"
                          value={reminderStartsAt}
                          onChange={(e) => setReminderStartsAt(e.target.value)}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                        />
                      </div>
                      <input
                        type="text"
                        value={reminderNotes}
                        onChange={(e) => setReminderNotes(e.target.value)}
                        placeholder="Prep notes"
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={calendarMutation.isPending || !reminderTitle.trim()}
                        onClick={() =>
                          calendarMutation.mutate({
                            id: job.id,
                            payload: {
                              title: reminderTitle.trim(),
                              startsAt: new Date(reminderStartsAt || Date.now() + 86_400_000).toISOString(),
                              notes: reminderNotes,
                            },
                          })
                        }
                      >
                        Add Calendar Reminder
                      </Button>
                      {calendarMutation.isError ? (
                        <p role="alert" className="text-xs text-destructive">
                          {describeGoogleError(calendarMutation.error)}
                        </p>
                      ) : null}

                      {job.calendarReminders.length > 0 ? (
                        <div className="space-y-1.5 pt-2">
                          {job.calendarReminders.map((rem) => (
                            <div
                              key={rem.id}
                              className={cn(
                                'rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs',
                              )}
                            >
                              <div className="font-medium">{rem.title}</div>
                              <div className="text-muted-foreground">
                                {new Date(rem.startsAt).toLocaleString()} — {rem.notes}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </Card>
                  </Tabs.Panel>
                </div>
              </Tabs.Root>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
