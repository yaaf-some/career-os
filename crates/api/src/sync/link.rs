//! Deterministic linking of synced Gmail threads and Calendar events to
//! applications (JOB-6). Email and event text is untrusted: it is only
//! compared as plain strings here, never interpreted or sent to a model.

use sqlx::SqlitePool;

use crate::error::AppError;

/// Senders that send mail on behalf of many companies (ATS platforms).
const ATS_SENDER_DOMAINS: &[&str] = &[
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "myworkdayjobs.com",
    "workday.com",
    "smartrecruiters.com",
    "icims.com",
    "jobvite.com",
];

const COMPANY_SUFFIXES: &[&str] = &[
    "inc",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "co",
    "company",
    "gmbh",
    "plc",
    "the",
];

/// (id, from_email, subject, snippet) of a synced thread.
type ThreadRow = (String, Option<String>, Option<String>, Option<String>);

/// An application the sync can link mail and events to.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LinkCandidate {
    pub application_id: String,
    pub company: String,
    pub job_url: String,
    pub updated_at: String,
}

/// Lowercase, ASCII words only, separated by single spaces.
fn words(text: &str) -> String {
    let mapped: String = text
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect();
    mapped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Company name reduced to its distinctive words ("Example Co, Inc." → "example").
/// Returns `None` when nothing distinctive is left (too short to match safely).
pub fn normalize_company(name: &str) -> Option<String> {
    let kept: Vec<String> = words(name)
        .split(' ')
        .filter(|w| !w.is_empty() && !COMPANY_SUFFIXES.contains(w))
        .map(str::to_string)
        .collect();
    let joined = kept.join(" ");
    (joined.len() >= 3).then_some(joined)
}

/// True when `company` (normalized) appears in `text` as whole words.
pub fn mentions_company(text: &str, company: &str) -> bool {
    format!(" {} ", words(text)).contains(&format!(" {company} "))
}

/// Host part of a URL, lowercased, without port or `www.`.
fn url_host(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let host = rest
        .split(['/', '?', '#'])
        .next()?
        .rsplit('@')
        .next()?
        .split(':')
        .next()?
        .to_ascii_lowercase();
    (!host.is_empty()).then(|| host.trim_start_matches("www.").to_string())
}

/// Domain of an address like `Name <user@mail.example.com>`.
fn email_domain(from: &str) -> Option<String> {
    let addr = match (from.find('<'), from.rfind('>')) {
        (Some(s), Some(e)) if s < e => &from[s + 1..e],
        _ => from,
    };
    let domain = addr.trim().rsplit_once('@')?.1.trim().to_ascii_lowercase();
    (!domain.is_empty()).then_some(domain)
}

/// `mail.jobs.example.co.uk` → `example.co.uk`; `careers.example.com` → `example.com`.
pub fn registrable_domain(host: &str) -> String {
    let labels: Vec<&str> = host.trim_matches('.').split('.').collect();
    if labels.len() <= 2 {
        return labels.join(".");
    }
    let second_level = labels[labels.len() - 2];
    let take = if matches!(second_level, "co" | "com" | "org" | "net" | "ac" | "gov")
        && labels[labels.len() - 1].len() == 2
    {
        3
    } else {
        2
    };
    labels[labels.len() - take..].join(".")
}

fn sender_matches(sender: &str, company: &str, job_url: &str) -> bool {
    let sender = registrable_domain(sender);
    if ATS_SENDER_DOMAINS.contains(&sender.as_str()) {
        return true;
    }
    if url_host(job_url).is_some_and(|h| registrable_domain(&h) == sender) {
        return true;
    }
    // recruiter@examplecorp.com for "Example Corp"
    let compact = company.replace(' ', "");
    sender.split('.').next() == Some(compact.as_str())
}

/// Picks the application a thread belongs to. A thread links when the company
/// is named in the subject, or when the sender is the company / its job board /
/// an ATS and the company is named in the subject or snippet. Ties go to the
/// most recently updated application.
pub fn match_thread<'a>(
    from_email: &str,
    subject: &str,
    snippet: &str,
    candidates: &'a [LinkCandidate],
) -> Option<&'a LinkCandidate> {
    let sender = email_domain(from_email);
    candidates
        .iter()
        .filter(|c| {
            let Some(company) = normalize_company(&c.company) else {
                return false;
            };
            if mentions_company(subject, &company) {
                return true;
            }
            sender
                .as_deref()
                .is_some_and(|s| sender_matches(s, &company, &c.job_url))
                && mentions_company(snippet, &company)
        })
        .max_by(|a, b| a.updated_at.cmp(&b.updated_at))
}

/// Picks the application an event belongs to: the company is named in the title.
pub fn match_event<'a>(title: &str, candidates: &'a [LinkCandidate]) -> Option<&'a LinkCandidate> {
    candidates
        .iter()
        .filter(|c| normalize_company(&c.company).is_some_and(|co| mentions_company(title, &co)))
        .max_by(|a, b| a.updated_at.cmp(&b.updated_at))
}

/// Re-links every auto-linked thread and every unlinked event. Manual links are
/// never touched. Returns (threads linked, events linked).
pub async fn relink_all(pool: &SqlitePool) -> Result<(i64, i64), AppError> {
    let candidates: Vec<LinkCandidate> = sqlx::query_as(
        r#"
        SELECT a.id AS application_id, j.company, j.url AS job_url, a.updated_at
        FROM applications a JOIN jobs j ON j.id = a.job_id
        "#,
    )
    .fetch_all(pool)
    .await?;

    let threads: Vec<ThreadRow> = sqlx::query_as(
        "SELECT id, from_email, subject, snippet FROM gmail_threads WHERE link_source = 'auto'",
    )
    .fetch_all(pool)
    .await?;
    let mut thread_links = 0_i64;
    for (id, from, subject, snippet) in threads {
        let app = match_thread(
            from.as_deref().unwrap_or(""),
            subject.as_deref().unwrap_or(""),
            snippet.as_deref().unwrap_or(""),
            &candidates,
        )
        .map(|c| c.application_id.clone());
        if app.is_some() {
            thread_links += 1;
        }
        sqlx::query("UPDATE gmail_threads SET application_id = ?1 WHERE id = ?2")
            .bind(app)
            .bind(&id)
            .execute(pool)
            .await?;
    }

    let events: Vec<(String, String)> =
        sqlx::query_as("SELECT id, title FROM calendar_events WHERE application_id IS NULL")
            .fetch_all(pool)
            .await?;
    let mut event_links = 0_i64;
    for (id, title) in events {
        if let Some(c) = match_event(&title, &candidates) {
            sqlx::query("UPDATE calendar_events SET application_id = ?1 WHERE id = ?2")
                .bind(&c.application_id)
                .bind(&id)
                .execute(pool)
                .await?;
            event_links += 1;
        }
    }
    Ok((thread_links, event_links))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: &str, company: &str, url: &str, updated: &str) -> LinkCandidate {
        LinkCandidate {
            application_id: id.into(),
            company: company.into(),
            job_url: url.into(),
            updated_at: updated.into(),
        }
    }

    #[test]
    fn normalizes_company_names() {
        assert_eq!(
            normalize_company("Example Co, Inc.").as_deref(),
            Some("example")
        );
        assert_eq!(
            normalize_company("The Acme Corporation").as_deref(),
            Some("acme")
        );
        assert_eq!(normalize_company("Inc."), None);
        assert_eq!(normalize_company("AB"), None);
    }

    #[test]
    fn domains() {
        assert_eq!(
            registrable_domain("mail.jobs.example.co.uk"),
            "example.co.uk"
        );
        assert_eq!(registrable_domain("careers.example.com"), "example.com");
        assert_eq!(
            email_domain("Pat <pat@Mail.Example.com>").as_deref(),
            Some("mail.example.com")
        );
        assert_eq!(
            url_host("https://www.example.com:443/jobs?x=1").as_deref(),
            Some("example.com")
        );
    }

    #[test]
    fn whole_word_mentions_only() {
        assert!(mentions_company("Re: Your application to Acme!", "acme"));
        assert!(!mentions_company("Acmetron weekly digest", "acme"));
    }

    #[test]
    fn links_by_subject() {
        let c = [cand(
            "a1",
            "Acme Corp",
            "https://jobs.example.com/1",
            "2026-01-01",
        )];
        let hit = match_thread("noreply@somewhere.com", "Interview with Acme", "", &c);
        assert_eq!(hit.map(|c| c.application_id.as_str()), Some("a1"));
    }

    #[test]
    fn links_by_sender_domain_and_snippet() {
        let c = [
            cand(
                "ats",
                "Globex",
                "https://boards.greenhouse.io/globex/1",
                "2026-01-01",
            ),
            cand(
                "own",
                "Initech",
                "https://initech.com/careers/2",
                "2026-01-01",
            ),
            cand("named", "Hooli", "https://jobs.example.com/3", "2026-01-01"),
        ];
        let via_ats = match_thread(
            "no-reply@greenhouse.io",
            "Next steps",
            "Thanks for applying to Globex",
            &c,
        );
        assert_eq!(via_ats.map(|c| c.application_id.as_str()), Some("ats"));
        let via_job_domain = match_thread(
            "Recruiter <r@mail.initech.com>",
            "Next steps",
            "Initech team here",
            &c,
        );
        assert_eq!(
            via_job_domain.map(|c| c.application_id.as_str()),
            Some("own")
        );
        let via_company_domain =
            match_thread("r@hooli.com", "Hello", "From the Hooli recruiting team", &c);
        assert_eq!(
            via_company_domain.map(|c| c.application_id.as_str()),
            Some("named")
        );
    }

    #[test]
    fn no_link_without_a_company_mention() {
        let c = [cand(
            "a1",
            "Globex",
            "https://boards.greenhouse.io/globex/1",
            "2026-01-01",
        )];
        assert!(match_thread(
            "no-reply@greenhouse.io",
            "Next steps",
            "Thanks for applying",
            &c
        )
        .is_none());
        assert!(match_thread("friend@example.org", "Lunch?", "Globex is hiring", &c).is_none());
    }

    #[test]
    fn ties_go_to_most_recent_application() {
        let c = [
            cand("old", "Acme", "https://a.example/1", "2026-01-01"),
            cand("new", "Acme", "https://a.example/2", "2026-02-01"),
        ];
        let hit = match_thread("x@y.com", "Acme interview", "", &c);
        assert_eq!(hit.map(|c| c.application_id.as_str()), Some("new"));
        let evt = match_event("Acme onsite", &c);
        assert_eq!(evt.map(|c| c.application_id.as_str()), Some("new"));
    }

    #[tokio::test]
    async fn relink_keeps_manual_links() {
        let pool = crate::db::init_pool("sqlite::memory:").await.unwrap();
        sqlx::query(
            "INSERT INTO jobs (id, canonical_key, url, company, title, source_type) VALUES
             ('j1','k1','https://acme.example/1','Acme','Eng','manual'),
             ('j2','k2','https://globex.example/2','Globex','Eng','manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO applications (id, job_id) VALUES ('a1','j1'), ('a2','j2')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO gmail_threads (id, thread_id, subject, from_email, link_source, application_id) VALUES
             ('t1','g1','Acme interview','r@x.com','auto',NULL),
             ('t2','g2','Acme interview','r@x.com','manual','a2'),
             ('t3','g3','Newsletter','n@x.com','auto','a1')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO calendar_events (id, gcal_event_id, kind, title, starts_at, ends_at) VALUES
             ('e1','c1','interview','Globex onsite','2026-01-01T10:00:00Z','2026-01-01T11:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(relink_all(&pool).await.unwrap(), (1, 1));
        let links: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT id, application_id FROM gmail_threads ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            links,
            vec![
                ("t1".into(), Some("a1".into())),
                ("t2".into(), Some("a2".into())), // manual link kept
                ("t3".into(), None),              // stale auto link cleared
            ]
        );
        let evt: Option<String> =
            sqlx::query_scalar("SELECT application_id FROM calendar_events WHERE id = 'e1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(evt.as_deref(), Some("a2"));
    }
}
