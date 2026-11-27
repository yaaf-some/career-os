import type {
  AiUsageResponse,
  CalendarReminder,
  CommuteInfo,
  CommutePreviewRequest,
  CreateSourceRequest,
  FilteredAuditEntry,
  GmailDraft,
  GoogleAuthStartResponse,
  GoogleAuthStatusResponse,
  JobDetail,
  JobSource,
  JobSummary,
  QuickAddJobRequest,
  ScanSourcesResponse,
  SettingsState,
  TailorResponse,
  TodayResponse,
  TrackerResponse,
  TriageActionRequest,
  UpdateSettingsRequest,
  UpdateTrackerRequest,
} from './types';

function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const DEMO_USAGE: AiUsageResponse = {
  configured: true,
  bridgeReachable: true,
  updatedAt: new Date().toISOString(),
  claude5h: {
    percentUsed: 42,
    resetAt: hoursFromNowIso(2.35),
  },
  claude7d: {
    percentUsed: 68,
    resetAt: hoursFromNowIso(54),
  },
  claudeStale: false,
  antigravity: {
    callsUsed: 14,
    callsLimit: 40,
    cooldownUntil: null,
    status: 'ready',
  },
  dbStatsByTier: [],
};

const INITIAL_JOBS: JobDetail[] = [
  {
    id: 'job-101',
    title: 'Staff Systems Engineer — Agent Runtime',
    company: 'Northstar Systems',
    location: 'Remote (US / EU overlap)',
    remotePolicy: 'Remote-first',
    compensation: '$195k–$230k + equity',
    source: 'Ashby · northstar-systems',
    url: 'https://jobs.ashbyhq.com/northstar-systems/staff-agent-runtime',
    triageStatus: 'pending',
    stage: 'saved',
    hydrogenScore: 93,
    scoreBreakdown: {
      skills: 95,
      level: 92,
      domain: 96,
      logistics: 88,
    },
    hydrogenSummary:
      'Strong overlap in Rust orchestration, deterministic tool-use sandboxing, and TypeScript control planes.',
    hasNeonEval: true,
    gmailStatus: 'none',
    nextFollowUpAt: null,
    discoveredAt: daysAgoIso(1),
    descriptionText:
      'Northstar Systems builds isolated execution environments and observable agent runtimes. You will architect low-latency Rust worker pools, OpenAPI-typed control planes, and deterministic policy gates.',
    requirements: [
      '6+ years building distributed backend systems in Rust or Go',
      'Experience designing API boundaries with OpenAPI / typed RPC contracts',
      'Strong security posture around untrusted workloads and sandboxing',
      'Hands-on frontend collaboration with React / TypeScript control surfaces',
    ],
    neonEval: {
      overallVerdict: 'Strong Apply — Priority Archetype Match (93/100)',
      confidence: 'High',
      evaluatedAt: daysAgoIso(0.5),
      blocks: [
        {
          block: 'A',
          title: 'Role & Archetype Fit',
          rating: '94/100',
          summary: 'Direct match for Staff Platform / AI Runtime Builder archetype.',
          highlights: [
            'Combines systems engineering with developer-facing workflow tooling',
            'High ownership from worker runtime to operator UI',
          ],
        },
        {
          block: 'B',
          title: 'Technical Stack Match',
          rating: '95/100',
          summary: 'Rust + SQLite/Postgres + TypeScript + OpenAPI matches target stack.',
          highlights: ['Rust async runtime', 'React/TypeScript control plane', 'Structured eval pipelines'],
        },
        {
          block: 'C',
          title: 'Scope & Leveling',
          rating: '92/100',
          summary: 'Staff IC scope without people-management overhead.',
          highlights: ['Cross-team RFC leadership', 'Architecture ownership'],
        },
        {
          block: 'D',
          title: 'Compensation & Logistics',
          rating: '88/100',
          summary: 'Published band meets target floor; async remote friendly.',
          highlights: ['Base band published', 'Flexible async timezone overlap'],
        },
        {
          block: 'E',
          title: 'Company & Signal',
          rating: '90/100',
          summary: 'Series B infrastructure team with active engineering blog.',
          highlights: ['Healthy hiring velocity', 'Clear technical product moat'],
        },
        {
          block: 'F',
          title: 'Risks & Gaps',
          rating: 'Low Risk',
          summary: 'May ask for deep Linux cgroups/seccomp production anecdotes.',
          highlights: ['Prepare concrete sandbox isolation walkthrough from Experience List.md'],
        },
        {
          block: 'G',
          title: 'Posting Integrity & Recommendation',
          rating: 'Verified Clean',
          summary: 'No prompt-injection markers or suspicious boilerplate detected.',
          highlights: ['Direct ATS canonical link', 'Action: Approve & tailor resume'],
        },
      ],
    },
    tailor: {
      resumeDocUrl: null,
      coverLetterDocUrl: null,
      generatedAt: null,
      groundedBullets: [
        {
          id: 'exp-1',
          sourceFile: 'Experience List.md',
          section: 'Distributed Systems & Automation',
          text: 'Designed typed API gateways and deterministic background worker queues with strict schema validation and retry isolation.',
          relevanceNote: 'Maps directly to agent runtime reliability and OpenAPI contracts.',
        },
        {
          id: 'exp-2',
          sourceFile: 'Experience List.md',
          section: 'Developer Tooling & Observability',
          text: 'Built local-first diagnostic dashboards using React and TypeScript to inspect pipeline state and surface audit logs.',
          relevanceNote: 'Supports full-stack operator control plane requirement.',
        },
      ],
    },
    gmailDraft: null,
    calendarReminders: [],
    gmailThreads: [],
  },
  {
    id: 'job-102',
    title: 'Senior Platform Engineer — Developer Infrastructure',
    company: 'Example Cloud',
    location: 'Remote',
    remotePolicy: 'Fully Remote',
    compensation: '$180k–$210k',
    source: 'Greenhouse · example-cloud',
    url: 'https://boards.greenhouse.io/example-cloud/jobs/40219',
    triageStatus: 'approved',
    stage: 'screen',
    hydrogenScore: 89,
    scoreBreakdown: {
      skills: 91,
      level: 88,
      domain: 86,
      logistics: 92,
    },
    hydrogenSummary: 'Clean platform infra scope with strong emphasis on CI/CD speed and edge deployments.',
    hasNeonEval: true,
    gmailStatus: 'reply_received',
    nextFollowUpAt: hoursFromNowIso(6),
    discoveredAt: daysAgoIso(5),
    descriptionText:
      'Own build pipelines, preview environments, and telemetry ingestion for high-throughput developer workflows at Example Cloud.',
    requirements: [
      '5+ years in platform or infrastructure engineering',
      'TypeScript, Rust, or Go service development',
      'Experience with SQLite/Postgres and observability pipelines',
    ],
    neonEval: {
      overallVerdict: 'Strong Fit (89/100)',
      confidence: 'High',
      evaluatedAt: daysAgoIso(4),
      blocks: [
        {
          block: 'A',
          title: 'Role & Archetype Fit',
          rating: '89/100',
          summary: 'Solid Developer Experience & Platform Infrastructure role.',
          highlights: ['Build/deploy ergonomics', 'Internal CLI & web tooling'],
        },
        {
          block: 'G',
          title: 'Posting Integrity & Recommendation',
          rating: 'Verified Clean',
          summary: 'Recruiter replied to schedule technical screen.',
          highlights: ['Active Gmail thread', 'Confirm interview slot in Calendar'],
        },
      ],
    },
    tailor: {
      resumeDocUrl: 'https://docs.google.com/document/d/demo-example-cloud-resume',
      coverLetterDocUrl: 'https://docs.google.com/document/d/demo-example-cloud-cover',
      generatedAt: daysAgoIso(4),
      groundedBullets: [
        {
          id: 'exp-3',
          sourceFile: 'Experience List.md',
          section: 'Platform & CI/CD',
          text: 'Reduced release verification latency by automating deterministic integration checks across multi-service workspaces.',
          relevanceNote: 'Aligns with developer build pipeline KPIs.',
        },
      ],
    },
    gmailDraft: {
      id: 'draft-102',
      to: 'recruiting@example.com',
      subject: 'Re: Senior Platform Engineer — Screen Availability',
      body: 'Hi Hiring Team,\n\nThank you for reaching out! I am available Thursday between 14:00 and 17:00 UTC or Friday morning for the 45-minute platform screen.\n\nBest regards,',
      confirmed: false,
      updatedAt: daysAgoIso(0.2),
    },
    calendarReminders: [
      {
        id: 'cal-102',
        title: 'Example Cloud — Prep Systems Architecture Notes',
        startsAt: hoursFromNowIso(4),
        notes: 'Review Experience List.md platform stories before screen.',
      },
    ],
    gmailThreads: [],
  },
  {
    id: 'job-103',
    title: 'Principal Full-Stack Engineer — AI Workflows',
    company: 'Gridline AI',
    location: 'Santa Monica, CA',
    remotePolicy: 'Hybrid (3d/wk)',
    compensation: '$200k–$240k',
    source: 'Lever · gridline-ai',
    url: 'https://jobs.lever.co/gridline-ai/principal-ai-workflows',
    triageStatus: 'pending',
    stage: 'saved',
    hydrogenScore: 84,
    scoreBreakdown: {
      skills: 87,
      level: 85,
      domain: 88,
      logistics: 76,
    },
    hydrogenSummary: 'Strong AI workflow product match; verify remote flexibility vs hybrid expectation.',
    hasNeonEval: false,
    gmailStatus: 'none',
    nextFollowUpAt: null,
    discoveredAt: daysAgoIso(2),
    descriptionText:
      'Lead architecture for human-in-the-loop review queues, structured document extraction, and React 19 operator interfaces.',
    requirements: [
      'Deep expertise in React, TypeScript, and resilient state management',
      'Backend API design in Rust or Node.js',
      'Human-in-the-loop workflow UX',
    ],
    neonEval: null,
    tailor: {
      resumeDocUrl: null,
      coverLetterDocUrl: null,
      generatedAt: null,
      groundedBullets: [
        {
          id: 'exp-4',
          sourceFile: 'Experience List.md',
          section: 'Human-in-the-Loop Interfaces',
          text: 'Shipped review-and-approval queues with audit trails and explicit confirmation gates before external side effects.',
          relevanceNote: 'Matches core product workflow at Gridline AI.',
        },
      ],
    },
    gmailDraft: null,
    calendarReminders: [],
    gmailThreads: [],
  },
  {
    id: 'job-104',
    title: 'Senior Backend Engineer — Search & Indexing',
    company: 'Vertex Data',
    location: 'Remote',
    remotePolicy: 'Remote',
    compensation: '$175k–$205k',
    source: 'Greenhouse · vertex-data',
    url: 'https://boards.greenhouse.io/vertex-data/jobs/8812',
    triageStatus: 'shortlisted',
    stage: 'applied',
    hydrogenScore: 81,
    scoreBreakdown: {
      skills: 84,
      level: 82,
      domain: 78,
      logistics: 84,
    },
    hydrogenSummary: 'Solid search/indexing backend role; awaiting initial recruiter response.',
    hasNeonEval: false,
    gmailStatus: 'awaiting_reply',
    nextFollowUpAt: daysAgoIso(1),
    discoveredAt: daysAgoIso(8),
    descriptionText: 'Build high-throughput ingestion pipelines and hybrid lexical/vector indexing services.',
    requirements: ['Rust or Go', 'Indexing & storage engines', 'Observability & benchmarking'],
    neonEval: null,
    tailor: {
      resumeDocUrl: 'https://docs.google.com/document/d/demo-vertex-resume',
      coverLetterDocUrl: null,
      generatedAt: daysAgoIso(6),
      groundedBullets: [],
    },
    gmailDraft: null,
    calendarReminders: [],
    gmailThreads: [],
  },
];

const INITIAL_SOURCES: JobSource[] = [
  {
    id: 'src-1',
    name: 'Northstar Systems',
    kind: 'ashby',
    boardUrl: 'https://jobs.ashbyhq.com/northstar-systems',
    enabled: true,
    lastScannedAt: daysAgoIso(0.1),
    matchedCount: 3,
  },
  {
    id: 'src-2',
    name: 'Example Cloud',
    kind: 'greenhouse',
    boardUrl: 'https://boards.greenhouse.io/example-cloud',
    enabled: true,
    lastScannedAt: daysAgoIso(0.1),
    matchedCount: 2,
  },
  {
    id: 'src-3',
    name: 'Gridline AI',
    kind: 'lever',
    boardUrl: 'https://jobs.lever.co/gridline-ai',
    enabled: true,
    lastScannedAt: daysAgoIso(0.2),
    matchedCount: 1,
  },
  {
    id: 'src-4',
    name: 'r/rust & r/forhire Hiring Threads',
    kind: 'reddit',
    boardUrl: 'https://www.reddit.com/r/rust/search/?q=who+is+hiring',
    enabled: true,
    lastScannedAt: daysAgoIso(0.4),
    matchedCount: 4,
  },
];

const INITIAL_FILTERED_AUDIT: FilteredAuditEntry[] = [
  {
    id: 'aud-1',
    title: 'Junior QA Automation Analyst (On-site)',
    company: 'Beacon Labs',
    sourceName: 'Example Cloud',
    rule: 'level_and_location_filter',
    reason: 'Rejected: on-site only & junior level mismatch',
    filteredAt: daysAgoIso(0.15),
  },
  {
    id: 'aud-2',
    title: 'Enterprise Account Executive',
    company: 'Gridline AI',
    sourceName: 'Gridline AI',
    rule: 'title_role_filter',
    reason: 'Rejected: non-engineering GTM role',
    filteredAt: daysAgoIso(0.2),
  },
  {
    id: 'aud-3',
    title: 'Blockchain Solidity Intern',
    company: 'Apex Protocol',
    sourceName: 'r/rust & r/forhire Hiring Threads',
    rule: 'domain_exclusion_filter',
    reason: 'Rejected: excluded domain keyword (Solidity / Intern)',
    filteredAt: daysAgoIso(0.4),
  },
];

const INITIAL_SETTINGS: SettingsState = {
  hydrogenPrimaryCli: 'claude',
  neonPrimaryCli: 'claude',
  autoFailover: true,
  googleOAuthConnected: true,
  googleScopes: ['gmail.compose', 'gmail.readonly', 'calendar.events', 'documents'],
  linearTeamKey: 'JOB',
  linearConnected: true,
  linearIssues: [
    { key: 'JOB-4', title: 'Phase 2: Google OAuth 7-day Testing-mode UX & LA Commute', state: 'In Progress', priority: 'Medium' },
    { key: 'JOB-5', title: 'Phase 3: Host ai-bridge daemon (claude -p / agy -p) & Usage Bar', state: 'Todo', priority: 'Medium' },
    { key: 'JOB-6', title: 'Phase 4: Live Google Workspace sync, Linear ops & scheduler', state: 'Todo', priority: 'Medium' },
  ],
  homeLocationArea: 'West Los Angeles, CA',
  defaultTravelMode: 'drive',
  mapsConfigured: true,
};

class DemoStore {
  private jobs: JobDetail[] = structuredClone(INITIAL_JOBS);
  private sources: JobSource[] = structuredClone(INITIAL_SOURCES);
  private filteredAudit: FilteredAuditEntry[] = structuredClone(INITIAL_FILTERED_AUDIT);
  private settings: SettingsState = structuredClone(INITIAL_SETTINGS);
  private usage: AiUsageResponse = structuredClone(DEMO_USAGE);
  private googleConnectedAtIso = hoursFromNowIso(-28);

  private toSummary(job: JobDetail): JobSummary {
    return {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      remotePolicy: job.remotePolicy,
      compensation: job.compensation,
      source: job.source,
      url: job.url,
      triageStatus: job.triageStatus,
      stage: job.stage,
      hydrogenScore: job.hydrogenScore,
      scoreBreakdown: job.scoreBreakdown,
      hydrogenSummary: job.hydrogenSummary,
      hasNeonEval: job.neonEval !== null,
      gmailStatus: job.gmailStatus,
      nextFollowUpAt: job.nextFollowUpAt,
      discoveredAt: job.discoveredAt,
    };
  }

  getUsage(): AiUsageResponse {
    return structuredClone(this.usage);
  }

  getToday(): TodayResponse {
    const unreadReplies = this.jobs
      .filter((j) => j.gmailStatus === 'reply_received')
      .map((j) => ({
        jobId: j.id,
        company: j.company,
        role: j.title,
        sender: 'recruiting@example.com',
        snippet: 'Thanks for applying! Would love to schedule a 45-minute technical screen this week.',
        receivedAt: daysAgoIso(0.25),
      }));

    const agenda = [
      {
        id: 'ag-1',
        jobId: 'job-102',
        title: 'Example Cloud — Platform Engineering Screen Prep',
        startsAt: hoursFromNowIso(4),
        endsAt: hoursFromNowIso(4.5),
        locationOrLink: 'Google Meet (Demo)',
      },
      {
        id: 'ag-2',
        jobId: null,
        title: 'Daily Triage & Follow-up Block',
        startsAt: hoursFromNowIso(7),
        endsAt: hoursFromNowIso(7.5),
        locationOrLink: 'Local Workspace',
      },
    ];

    const nowMs = Date.now();
    const followUpsDue = this.jobs
      .filter((j) => j.nextFollowUpAt !== null && j.stage !== 'archived')
      .map((j) => ({
        jobId: j.id,
        company: j.company,
        role: j.title,
        dueAt: j.nextFollowUpAt as string,
        overdue: Date.parse(j.nextFollowUpAt as string) < nowMs,
        stage: j.stage,
      }));

    const topMatches = this.jobs
      .filter((j) => j.triageStatus === 'pending' || j.triageStatus === 'shortlisted')
      .sort((a, b) => (b.hydrogenScore ?? -1) - (a.hydrogenScore ?? -1))
      .slice(0, 4)
      .map((j) => this.toSummary(j));

    return {
      dateLabel: new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      unreadReplies,
      agenda,
      followUpsDue,
      topMatches,
    };
  }

  listJobs(): JobSummary[] {
    return this.jobs.map((j) => this.toSummary(j));
  }

  getJob(id: string): JobDetail | null {
    const found = this.jobs.find((j) => j.id === id);
    return found ? structuredClone(found) : null;
  }

  quickAddJob(req: QuickAddJobRequest): JobSummary {
    const id = `job-${Date.now()}`;
    const host = (() => {
      try {
        return new URL(req.url).hostname.replace(/^www\./, '');
      } catch {
        return 'custom-url';
      }
    })();

    const created: JobDetail = {
      id,
      title: req.title?.trim() || 'Senior Software Engineer (Quick Added)',
      company: req.company?.trim() || 'Example Target Co',
      location: 'Remote',
      remotePolicy: 'Remote',
      compensation: null,
      source: `Quick Add · ${host}`,
      url: req.url,
      triageStatus: 'pending',
      stage: 'saved',
      hydrogenScore: 82,
      scoreBreakdown: { skills: 84, level: 82, domain: 80, logistics: 82 },
      hydrogenSummary: 'Queued via Quick Add URL and scored by hydrogen triage.',
      hasNeonEval: false,
      gmailStatus: 'none',
      nextFollowUpAt: null,
      discoveredAt: new Date().toISOString(),
      descriptionText: `Imported from ${req.url}. Run neon deep eval for full A–G analysis.`,
      requirements: ['Imported posting — run neon deep eval to extract full rubric'],
      neonEval: null,
      tailor: {
        resumeDocUrl: null,
        coverLetterDocUrl: null,
        generatedAt: null,
        groundedBullets: [],
      },
      gmailDraft: null,
      calendarReminders: [],
      gmailThreads: [],
    };
    this.jobs.unshift(created);
    return this.toSummary(created);
  }

  triageJob(id: string, req: TriageActionRequest): JobSummary {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);

    const map: Record<TriageActionRequest['action'], JobSummary['triageStatus']> = {
      approve: 'approved',
      shortlist: 'shortlisted',
      skip: 'skipped',
      reject: 'rejected',
    };
    job.triageStatus = map[req.action];
    if (req.action === 'reject') {
      job.stage = 'archived';
    }
    return this.toSummary(job);
  }

  evaluateJob(id: string): JobDetail {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);

    job.hasNeonEval = true;
    job.neonEval = {
      overallVerdict: `Evaluated by neon (${this.settings.neonPrimaryCli}) — ${job.hydrogenScore}/100`,
      confidence: 'High',
      evaluatedAt: new Date().toISOString(),
      blocks: [
        {
          block: 'A',
          title: 'Role & Archetype Fit',
          rating: `${job.scoreBreakdown?.domain ?? '–'}/100`,
          summary: `Strong alignment with target systems/platform engineering scope at ${job.company}.`,
          highlights: ['Core IC technical ownership', 'Clear architectural mandate'],
        },
        {
          block: 'B',
          title: 'Technical Stack Match',
          rating: `${job.scoreBreakdown?.skills ?? '–'}/100`,
          summary: 'Verified overlap with Experience List.md capabilities without unbacked claims.',
          highlights: ['Typed APIs & Rust/TS runtime', 'Automated testing & telemetry'],
        },
        {
          block: 'C',
          title: 'Scope & Leveling',
          rating: `${job.scoreBreakdown?.level ?? '–'}/100`,
          summary: 'Appropriate senior/staff autonomy and cross-functional impact.',
          highlights: ['Architecture ownership', 'Zero inflated leadership claims'],
        },
        {
          block: 'D',
          title: 'Compensation & Logistics',
          rating: `${job.scoreBreakdown?.logistics ?? '–'}/100`,
          summary: `Remote policy: ${job.remotePolicy}.`,
          highlights: [job.compensation ?? 'Compensation band pending confirmation'],
        },
        {
          block: 'E',
          title: 'Company & Signal',
          rating: '85/100',
          summary: 'Healthy engineering footprint and direct ATS listing.',
          highlights: [`Discovered via ${job.source}`],
        },
        {
          block: 'F',
          title: 'Risks & Gaps',
          rating: 'Moderate',
          summary: 'Confirm exact team topology and on-call rotation during recruiter screen.',
          highlights: ['Prepare clarifying questions for Block D & F'],
        },
        {
          block: 'G',
          title: 'Posting Integrity & Recommendation',
          rating: 'Verified Clean',
          summary: 'Posting text verified clean; safe for resume tailoring.',
          highlights: ['Proceed with Experience List.md grounded tailoring'],
        },
      ],
    };
    return structuredClone(job);
  }

  tailorJob(id: string): TailorResponse {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);

    job.tailor = {
      resumeDocUrl: `https://docs.google.com/document/d/demo-tailored-resume-${job.id}`,
      coverLetterDocUrl: `https://docs.google.com/document/d/demo-tailored-cover-${job.id}`,
      generatedAt: new Date().toISOString(),
      groundedBullets:
        job.tailor.groundedBullets.length > 0
          ? job.tailor.groundedBullets
          : [
              {
                id: `exp-${job.id}-1`,
                sourceFile: 'Experience List.md',
                section: 'Core Engineering Delivery',
                text: 'Delivered high-reliability backend services and typed operator interfaces with strict automated test coverage.',
                relevanceNote: `Tailored for ${job.title} at ${job.company}.`,
              },
            ],
    };
    return {
      jobId: job.id,
      tailor: structuredClone(job.tailor),
    };
  }

  saveEmailDraft(id: string, draft: Pick<GmailDraft, 'to' | 'subject' | 'body' | 'confirmed'>): JobDetail {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);
    job.gmailDraft = {
      id: `draft-${job.id}`,
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      confirmed: draft.confirmed,
      updatedAt: new Date().toISOString(),
    };
    job.gmailStatus = draft.confirmed ? 'awaiting_reply' : 'draft_ready';
    return structuredClone(job);
  }

  addCalendarReminder(id: string, reminder: Pick<CalendarReminder, 'title' | 'startsAt' | 'notes'>): JobDetail {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);
    job.calendarReminders.push({
      id: `cal-${Date.now()}`,
      title: reminder.title,
      startsAt: reminder.startsAt,
      notes: reminder.notes,
    });
    return structuredClone(job);
  }

  getTracker(): TrackerResponse {
    return {
      entries: this.jobs
        .filter((j) => j.triageStatus !== 'rejected')
        .map((j) => ({
          jobId: j.id,
          company: j.company,
          title: j.title,
          stage: j.stage,
          hydrogenScore: j.hydrogenScore,
          gmailStatus: j.gmailStatus,
          threadSubject: j.gmailDraft?.subject ?? (j.gmailStatus !== 'none' ? `Application: ${j.title}` : null),
          lastActivityAt: j.discoveredAt,
          nextFollowUpAt: j.nextFollowUpAt,
          notes: j.hydrogenSummary,
        })),
    };
  }

  updateTracker(req: UpdateTrackerRequest): TrackerResponse {
    const job = this.jobs.find((j) => j.id === req.jobId);
    if (job) {
      if (req.stage) job.stage = req.stage;
      if (req.nextFollowUpAt !== undefined) job.nextFollowUpAt = req.nextFollowUpAt;
      if (req.notes !== undefined) job.hydrogenSummary = req.notes;
    }
    return this.getTracker();
  }

  getSources() {
    return {
      sources: structuredClone(this.sources),
      filteredAudit: structuredClone(this.filteredAudit),
    };
  }

  addSource(req: CreateSourceRequest): JobSource {
    const created: JobSource = {
      id: `src-${Date.now()}`,
      name: req.name,
      kind: req.kind,
      boardUrl: req.boardUrl,
      enabled: true,
      lastScannedAt: null,
      matchedCount: 0,
    };
    this.sources.push(created);
    return structuredClone(created);
  }

  scanSources(): ScanSourcesResponse {
    const now = new Date().toISOString();
    for (const src of this.sources) {
      if (src.enabled) {
        src.lastScannedAt = now;
      }
    }
    return {
      scannedSources: this.sources.filter((s) => s.enabled).length,
      newMatches: 2,
      filteredOut: 5,
      ranAt: now,
    };
  }

  getSettings(): SettingsState {
    return structuredClone(this.settings);
  }

  updateSettings(req: UpdateSettingsRequest): SettingsState {
    if (req.hydrogenPrimaryCli) this.settings.hydrogenPrimaryCli = req.hydrogenPrimaryCli;
    if (req.neonPrimaryCli) this.settings.neonPrimaryCli = req.neonPrimaryCli;
    if (typeof req.autoFailover === 'boolean') this.settings.autoFailover = req.autoFailover;
    if (req.homeLocationArea !== undefined && req.homeLocationArea.trim()) {
      this.settings.homeLocationArea = req.homeLocationArea.trim();
    }
    if (req.defaultTravelMode) {
      this.settings.defaultTravelMode = req.defaultTravelMode;
    }
    return structuredClone(this.settings);
  }

  getGoogleAuthStatus(): GoogleAuthStatusResponse {
    const connectedAtMs = Date.parse(this.googleConnectedAtIso);
    const testingExpiresMs = connectedAtMs + 7 * 86_400_000;
    const hoursRemaining = Math.max(0, (testingExpiresMs - Date.now()) / 3_600_000);
    return {
      connected: this.settings.googleOAuthConnected,
      authMode: 'testing',
      accountEmail: 'demo@example.com',
      connectedAt: this.googleConnectedAtIso,
      testingExpiresAt: new Date(testingExpiresMs).toISOString(),
      hoursRemaining: Number(hoursRemaining.toFixed(1)),
      needsReconnect: !this.settings.googleOAuthConnected || hoursRemaining < 24,
      expiresAt: hoursFromNowIso(1),
      oauthConfigured: true,
      encryptionConfigured: true,
      missingScopes: [],
    };
  }

  startGoogleAuth(): GoogleAuthStartResponse {
    this.googleConnectedAtIso = new Date().toISOString();
    this.settings.googleOAuthConnected = true;
    return {
      authUrl:
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=demo-client&scope=gmail.compose+calendar.events+documents',
      state: 'demo-oauth-state',
    };
  }

  getJobCommute(id: string): CommuteInfo {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) {
      return this.previewCommute({ destination: 'Los Angeles, CA' });
    }
    const isRemote =
      job.remotePolicy.toLowerCase().includes('remote') ||
      job.location.toLowerCase().startsWith('remote');
    if (isRemote) {
      return {
        isRemote: true,
        configured: true,
        originArea: this.settings.homeLocationArea,
        destinationQuery: job.location,
        resolvedAddress: null,
        distanceMiles: null,
        durationMinutes: null,
        travelMode: this.settings.defaultTravelMode,
        estimateSource: 'remote',
        cached: false,
        mapsUrl: null,
      };
    }
    return this.previewCommute({
      originArea: this.settings.homeLocationArea,
      destination: job.location,
      travelMode: this.settings.defaultTravelMode,
    });
  }

  previewCommute(req: CommutePreviewRequest): CommuteInfo {
    const origin = (req.originArea || this.settings.homeLocationArea).trim();
    const dest = req.destination.trim();
    const mode = req.travelMode ?? this.settings.defaultTravelMode;
    const lowerDest = dest.toLowerCase();

    let miles = 11.4;
    let minutes = mode === 'transit' ? 38 : 24;
    let resolved = `${dest}, Los Angeles, CA`;

    if (lowerDest.includes('santa monica')) {
      miles = 4.6;
      minutes = mode === 'transit' ? 23 : 14;
      resolved = 'Santa Monica, CA';
    } else if (lowerDest.includes('culver')) {
      miles = 5.8;
      minutes = mode === 'transit' ? 27 : 17;
      resolved = 'Culver City, CA';
    } else if (lowerDest.includes('downtown') || lowerDest.includes('dtla')) {
      miles = 13.8;
      minutes = mode === 'transit' ? 42 : 31;
      resolved = 'Downtown Los Angeles, CA';
    } else if (lowerDest.includes('pasadena')) {
      miles = 21.5;
      minutes = mode === 'transit' ? 58 : 39;
      resolved = 'Pasadena, CA';
    }

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(resolved)}&travelmode=${mode === 'transit' ? 'transit' : 'driving'}`;

    return {
      isRemote: false,
      configured: true,
      originArea: origin,
      destinationQuery: dest,
      resolvedAddress: resolved,
      distanceMiles: miles,
      durationMinutes: minutes,
      travelMode: mode,
      estimateSource: 'routes_api',
      cached: false,
      mapsUrl,
    };
  }
}

export const demoStore = new DemoStore();
