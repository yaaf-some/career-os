import {
  ArrowRight,
  Calendar,
  Clock,
  Link2,
  MailOpen,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatHydrogenScore } from '@/api/jobs';
import { useQuickAddJobMutation, useTodayQuery } from '@/api/queries';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';

export function TodayView({
  onSelectRole,
}: {
  onSelectRole: (jobId: string) => void;
}) {
  const todayQuery = useTodayQuery();
  const quickAddMutation = useQuickAddJobMutation();

  const [quickUrl, setQuickUrl] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickCompany, setQuickCompany] = useState('');
  const [quickFeedback, setQuickFeedback] = useState<string | null>(null);

  const handleQuickAdd = (e: FormEvent) => {
    e.preventDefault();
    const trimmedUrl = quickUrl.trim();
    if (!trimmedUrl) return;
    quickAddMutation.mutate(
      {
        url: trimmedUrl,
        title: quickTitle.trim() || undefined,
        company: quickCompany.trim() || undefined,
      },
      {
        onSuccess: (created) => {
          setQuickUrl('');
          setQuickTitle('');
          setQuickCompany('');
          setQuickFeedback(`Added "${created.title}" to Triage (hydrogen ${formatHydrogenScore(created.hydrogenScore)}).`);
        },
      },
    );
  };

  const data = todayQuery.data;

  return (
    <div className="space-y-6" data-testid="today-view">
      <SectionHeader
        title="Today"
        subtitle={
          data
            ? `Action queue for ${data.dateLabel} — replies, agenda, follow-ups, and top hydrogen matches.`
            : 'Loading daily action queue…'
        }
      />

      {/* Quick-Add Job URL */}
      <Card className="p-4">
        <form onSubmit={handleQuickAdd} className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-accent-brand" />
            <span>Quick-Add Job URL</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <input
              type="url"
              required
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/company/jobs/123"
              aria-label="Job posting URL"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="Role title (optional)"
              aria-label="Role title"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={quickCompany}
              onChange={(e) => setQuickCompany(e.target.value)}
              placeholder="Company (optional)"
              aria-label="Company name"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={quickAddMutation.isPending || !quickUrl.trim()}
            >
              <Plus className="h-4 w-4" />
              <span>{quickAddMutation.isPending ? 'Adding…' : 'Add & Score'}</span>
            </Button>
          </div>
          {quickFeedback ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">{quickFeedback}</p>
          ) : null}
        </form>
      </Card>

      {todayQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading Today queue…</Card>
      ) : !data ? (
        <Card className="p-6 text-sm text-destructive">Failed to load Today data.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Unread Replies */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MailOpen className="h-4 w-4 text-accent-brand" />
                <span>Unread Recruiter Replies</span>
              </div>
              <Badge variant={data.unreadReplies.length > 0 ? 'brand' : 'neutral'}>
                {data.unreadReplies.length}
              </Badge>
            </div>
            {data.unreadReplies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unread replies right now.</p>
            ) : (
              <div className="space-y-2">
                {data.unreadReplies.map((reply) => (
                  <div
                    key={reply.jobId}
                    className="rounded-lg border border-border bg-secondary/40 p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">
                          {reply.company} — {reply.role}
                        </div>
                        <div className="text-xs text-muted-foreground">{reply.sender}</div>
                      </div>
                      <Button size="sm" onClick={() => onSelectRole(reply.jobId)}>
                        Open Draft
                      </Button>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{reply.snippet}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Calendar Agenda */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Calendar className="h-4 w-4 text-accent-brand" />
                <span>Calendar Agenda</span>
              </div>
              <Badge variant="neutral">{data.agenda.length}</Badge>
            </div>
            {data.agenda.length === 0 ? (
              <p className="text-sm text-muted-foreground">Clear calendar today.</p>
            ) : (
              <div className="space-y-2">
                {data.agenda.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(item.startsAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        • {item.locationOrLink}
                      </div>
                    </div>
                    {item.jobId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onSelectRole(item.jobId as string)}
                      >
                        Role
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Follow-ups Due */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4 text-amber-500" />
                <span>Follow-ups Due</span>
              </div>
              <Badge variant={data.followUpsDue.some((f) => f.overdue) ? 'warning' : 'neutral'}>
                {data.followUpsDue.length}
              </Badge>
            </div>
            {data.followUpsDue.length === 0 ? (
              <p className="text-sm text-muted-foreground">No follow-ups due.</p>
            ) : (
              <div className="space-y-2">
                {data.followUpsDue.map((f) => (
                  <div
                    key={f.jobId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {f.company} — {f.role}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Stage: {f.stage}</span>
                        <Badge variant={f.overdue ? 'danger' : 'warning'}>
                          {f.overdue ? 'Overdue' : 'Due soon'}
                        </Badge>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => onSelectRole(f.jobId)}>
                      Compose
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Top Hydrogen Matches */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                <span>Top Scored Matches</span>
              </div>
              <Badge variant="success">{data.topMatches.length}</Badge>
            </div>
            {data.topMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Triage queue is empty.</p>
            ) : (
              <div className="space-y-2">
                {data.topMatches.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{job.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {job.company} • {job.location}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="brand">{formatHydrogenScore(job.hydrogenScore)}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => onSelectRole(job.id)}>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
