/**
 * pipeline.mjs — Shared normalization, posting-guard sanitization, deduplication,
 * and strict filtering pipeline for ATS and social-hiring scanners.
 */

import { DEFAULT_MAX_YOE, filterJob } from './filter.mjs';
import { guardPosting } from './posting-guard.mjs';
import { canonicalJobKey } from './url-key.mjs';

export const MAX_JD_TEXT_LENGTH = 20_000;

/**
 * Normalize a timestamp into ISO-8601 or null.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function toIsoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Validate non-negative salary integer or return null.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function toNonNegativeIntOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/**
 * Derive a stable canonical key for a posting URL.
 *
 * @param {string} url
 * @returns {string}
 */
export function deriveCanonicalKey(url) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return '';
  const key = canonicalJobKey(trimmed);
  if (key) return key;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Sanitize untrusted posting fields through `guardPosting`.
 *
 * @param {{ title?: string, company?: string, location?: string, description?: string, jdText?: string }} raw
 */
export function sanitizePostingWithGuard(raw) {
  const titleGuard = guardPosting(String(raw.title ?? ''), 'text');
  const companyGuard = guardPosting(String(raw.company ?? ''), 'text');
  const locationGuard = raw.location ? guardPosting(String(raw.location), 'text') : null;
  const rawJd = raw.jdText ?? raw.description ?? '';
  const jdGuard = rawJd ? guardPosting(String(rawJd)) : null;

  const flagged =
    titleGuard.integrity === 'flagged' ||
    companyGuard.integrity === 'flagged' ||
    locationGuard?.integrity === 'flagged' ||
    jdGuard?.integrity === 'flagged';

  const jdClean = jdGuard?.cleanText ? jdGuard.cleanText.slice(0, MAX_JD_TEXT_LENGTH) : null;

  return {
    title: titleGuard.cleanText.trim(),
    company: companyGuard.cleanText.trim() || 'Unknown',
    location: locationGuard?.cleanText.trim() || null,
    jdText: jdClean,
    guard: {
      integrity: flagged ? 'flagged' : 'clean',
      flags: {
        flagged,
        verdict: jdGuard?.flags.verdict ?? titleGuard.flags.verdict,
        instructionCount:
          (titleGuard.flags.instructionShaped?.length ?? 0) +
          (jdGuard?.flags.instructionShaped?.length ?? 0),
        hiddenBlocks: jdGuard?.flags.hiddenBlocks?.length ?? 0,
        tamperingCount:
          (titleGuard.flags.invisible?.tampering?.length ?? 0) +
          (jdGuard?.flags.invisible?.tampering?.length ?? 0),
        mixedScriptCount:
          (titleGuard.flags.mixedScript?.length ?? 0) +
          (jdGuard?.flags.mixedScript?.length ?? 0),
      },
    },
  };
}

/**
 * Extract optional filter overrides from a `portalsConfig` object.
 *
 * @param {Record<string, any> | null | undefined} portalsConfig
 * @returns {{
 *   maxYoe: number,
 *   strictLocation: boolean,
 *   sinceDays: number | null,
 *   targetTitleKeywords?: string[],
 *   excludedSeniority?: string[],
 *   excludedDomains?: string[],
 * }}
 */
export function resolveFilterOptions(portalsConfig) {
  const cfg = portalsConfig && typeof portalsConfig === 'object' ? portalsConfig : {};
  const sf = cfg.scanner_filters && typeof cfg.scanner_filters === 'object'
    ? cfg.scanner_filters
    : {};
  const expCfg = cfg.experience_filter && typeof cfg.experience_filter === 'object'
    ? cfg.experience_filter
    : {};
  const maxYoe = Number.isInteger(sf.max_yoe)
    ? sf.max_yoe
    : Number.isInteger(expCfg.max_yoe)
      ? expCfg.max_yoe
      : Number.isInteger(cfg.max_yoe)
        ? cfg.max_yoe
        : DEFAULT_MAX_YOE;
  const strictLocation =
    sf.strict_location !== undefined
      ? sf.strict_location !== false
      : cfg.strict_location !== false;
  const sinceDaysRaw = sf.max_posting_age_days ?? cfg.max_posting_age_days;
  const sinceDays = Number.isInteger(sinceDaysRaw) && sinceDaysRaw > 0 ? sinceDaysRaw : null;
  const strArray = (v) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : undefined;
  return {
    maxYoe,
    strictLocation,
    sinceDays,
    targetTitleKeywords: strArray(sf.target_title_keywords ?? cfg.target_title_keywords),
    excludedSeniority: strArray(sf.excluded_seniority ?? cfg.excluded_seniority),
    excludedDomains: strArray(sf.excluded_domains ?? cfg.excluded_domains),
  };
}

/**
 * Run deduplication, age-cutoff, `guardPosting`, and `filterJob` across raw postings.
 *
 * @param {Array<Record<string, any>>} rawJobs
 * @param {{
 *   sourceType?: string,
 *   sinceDays?: number | null,
 *   maxYoe?: number,
 *   strictLocation?: boolean,
 *   now?: number,
 * }} [opts]
 * @returns {{ accepted: Array<Record<string, any>>, rejected: Array<Record<string, any>>, skippedInvalid: number, skippedOld: number, duplicates: number }}
 */
export function processRawJobs(rawJobs, opts = {}) {
  const defaultSourceType = opts.sourceType ?? 'ats_board';
  const sinceDays =
    typeof opts.sinceDays === 'number' && Number.isFinite(opts.sinceDays) && opts.sinceDays > 0
      ? opts.sinceDays
      : null;
  const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
  const cutoffMs = sinceDays !== null ? nowMs - sinceDays * 24 * 60 * 60 * 1000 : null;

  const seenKeys = new Set();
  const accepted = [];
  const rejected = [];
  let skippedInvalid = 0;
  let skippedOld = 0;
  let duplicates = 0;

  for (const raw of rawJobs) {
    const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      skippedInvalid += 1;
      continue;
    }

    const canonicalKey = deriveCanonicalKey(url);
    if (!canonicalKey) {
      skippedInvalid += 1;
      continue;
    }
    if (seenKeys.has(canonicalKey)) {
      duplicates += 1;
      continue;
    }
    seenKeys.add(canonicalKey);

    const postedAt = toIsoOrNull(raw.postedAt ?? raw.publishedAt ?? raw.updatedAt);
    if (cutoffMs !== null && postedAt) {
      const postedMs = Date.parse(postedAt);
      if (Number.isFinite(postedMs) && postedMs < cutoffMs) {
        skippedOld += 1;
        continue;
      }
    }

    const sanitized = sanitizePostingWithGuard(raw);
    const sourceType = raw.sourceType ?? defaultSourceType;

    if (raw.preFilterReasonCode) {
      rejected.push({
        canonicalKey,
        url,
        company: sanitized.company,
        title: sanitized.title || '(untitled)',
        location: sanitized.location,
        reasonCode: raw.preFilterReasonCode,
        reasonDetail: raw.preFilterReasonDetail ?? null,
        sourceType,
        guard: sanitized.guard,
      });
      continue;
    }

    const decision = filterJob(
      {
        title: sanitized.title,
        location: sanitized.location,
        workplaceType: raw.workplaceType ?? null,
        jdText: sanitized.jdText,
        yoeMin: typeof raw.yoeMin === 'number' ? raw.yoeMin : null,
        yoeMax: typeof raw.yoeMax === 'number' ? raw.yoeMax : null,
      },
      {
        maxYoe: opts.maxYoe,
        strictLocation: opts.strictLocation,
        targetTitleKeywords: opts.targetTitleKeywords,
        excludedSeniority: opts.excludedSeniority,
        excludedDomains: opts.excludedDomains,
      },
    );

    if (!decision.accepted) {
      rejected.push({
        canonicalKey,
        url,
        company: sanitized.company,
        title: sanitized.title || '(untitled)',
        location: sanitized.location,
        reasonCode: decision.reasonCode,
        reasonDetail: decision.reasonDetail,
        sourceType,
        guard: sanitized.guard,
      });
      continue;
    }

    accepted.push({
      canonicalKey,
      url,
      company: sanitized.company,
      title: sanitized.title,
      location: sanitized.location,
      workplaceType: decision.normalized.workplaceType,
      yoeMin: decision.normalized.yoeMin,
      yoeMax: decision.normalized.yoeMax,
      yoeLabel: decision.normalized.yoeLabel,
      salaryMin: toNonNegativeIntOrNull(raw.salaryMin),
      salaryMax: toNonNegativeIntOrNull(raw.salaryMax),
      salaryCurrency: typeof raw.salaryCurrency === 'string' ? raw.salaryCurrency.trim().slice(0, 10) || null : null,
      postedAt,
      sourceType,
      sourceId: typeof raw.sourceId === 'string' && raw.sourceId.trim() ? raw.sourceId.trim() : null,
      jdText: sanitized.jdText,
      guard: sanitized.guard,
    });
  }

  return {
    accepted,
    rejected,
    skippedInvalid,
    skippedOld,
    duplicates,
  };
}
