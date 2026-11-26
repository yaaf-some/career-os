/**
 * filter.mjs — Strict US-Remote / LA-OC + Junior-Mid (0-4 YOE) filter.
 *
 * Enforces:
 *   1. Target role match (Platform / DevOps / SRE / Cloud / Infrastructure / Kubernetes / CI/CD / Release / DevSecOps)
 *      and rejects out-of-band seniority titles (Staff / Principal / Manager / Director / VP / Head of / Intern)
 *      plus irrelevant engineering/facilities domains.
 *   2. Location policy: (Remote US OR Los Angeles / Orange County metro).
 *      Rejects non-US locations and non-LA/OC onsite/hybrid roles.
 *   3. Experience band: junior-mid (0-4 YOE). Rejects explicit 5+ years requirements.
 *
 * Every rejection returns a structured `reasonCode` + `reasonDetail`.
 */

export const FILTER_REASON_CODES = Object.freeze({
  TITLE_MISSING: 'TITLE_MISSING',
  TITLE_NOT_TARGET: 'TITLE_NOT_TARGET',
  TITLE_EXCLUDED_SENIORITY: 'TITLE_EXCLUDED_SENIORITY',
  TITLE_EXCLUDED_DOMAIN: 'TITLE_EXCLUDED_DOMAIN',
  LOCATION_MISSING_STRICT: 'LOCATION_MISSING_STRICT',
  LOCATION_NON_US: 'LOCATION_NON_US',
  LOCATION_NOT_REMOTE_OR_LA_OC: 'LOCATION_NOT_REMOTE_OR_LA_OC',
  YOE_ABOVE_MAX: 'YOE_ABOVE_MAX',
  SOCIAL_FOR_HIRE: 'SOCIAL_FOR_HIRE',
  SOCIAL_NOT_HIRING: 'SOCIAL_NOT_HIRING',
});

export const DEFAULT_MAX_YOE = 4;

// Target role patterns (Platform, DevOps, SRE, Cloud, Infrastructure, K8s, CI/CD, Release, DevSecOps)
const TARGET_TITLE_PATTERNS = [
  /\bplatform\s+engineer(?:ing)?\b/i,
  /\bdevops\b/i,
  /\bdevsecops\b/i,
  /\bsite\s+reliability\b/i,
  /\bsre\b/i,
  /\bcloud\s+(?:engineer|infrastructure|operations|ops|platform|systems)\b/i,
  /\binfrastructure\s+(?:engineer|specialist|developer|sre)\b/i,
  /\bkubernetes\b/i,
  /\bk8s\b/i,
  /\bbuild\s+(?:and|&)\s+release\b/i,
  /\brelease\s+engineer(?:ing)?\b/i,
  /\bci\s*\/\s*cd\b/i,
  /\bcloud\s+reliability\b/i,
  /\bproduction\s+engineer(?:ing)?\b/i,
  /\bsystems\s+engineer(?:ing)?\b/i,
  /\bdeveloper\s+(?:infrastructure|platform|productivity)\b/i,
];

// Out-of-band seniority titles rejected unconditionally for 0-4 YOE target
const EXCLUDED_SENIORITY_PATTERNS = [
  { re: /\bstaff\b/i, label: 'Staff' },
  { re: /\bprincipal\b/i, label: 'Principal' },
  { re: /\bdistinguished\b/i, label: 'Distinguished' },
  { re: /\bfellow\b/i, label: 'Fellow' },
  { re: /\bmanager\b/i, label: 'Manager' },
  { re: /\bdirector\b/i, label: 'Director' },
  { re: /\bhead\s+of\b/i, label: 'Head of' },
  { re: /\bvp\b/i, label: 'VP' },
  { re: /\bvice\s+president\b/i, label: 'Vice President' },
  { re: /\bchief\s+\w+\s+officer\b|\bcto\b|\bcio\b/i, label: 'Executive' },
  { re: /\bteam\s+lead\b|\btech(?:nical)?\s+lead\b|\bengineering\s+lead\b/i, label: 'Lead' },
  { re: /\binterns?\b|\binternship\b|\bco-op\b/i, label: 'Intern' },
];

// Non-software / wrong-domain exclusions
const EXCLUDED_DOMAIN_PATTERNS = [
  { re: /\bmechanical\b/i, label: 'Mechanical' },
  { re: /\belectrical\b/i, label: 'Electrical' },
  { re: /\bphysical\s+infrastructure\b/i, label: 'Physical Infrastructure' },
  { re: /\bnetwork\s+infrastructure\b/i, label: 'Network Infrastructure' },
  { re: /\bdata\s*center\s+infrastructure\b/i, label: 'Data Center Infrastructure' },
  { re: /\bfacilities\b/i, label: 'Facilities' },
  { re: /\bdocumentation\b|\btechnical\s+writer\b/i, label: 'Documentation' },
  { re: /\baccount\s+executive\b|\bsales\s+engineer\b|\brecruiter\b/i, label: 'Sales/Recruiting' },
  { re: /\bembedded\b|\bfirmware\b|\bfpga\b|\basic\b/i, label: 'Embedded/Hardware' },
  { re: /\bios\b|\bandroid\b/i, label: 'Mobile' },
  { re: /\bblockchain\b|\bweb3\b|\bcrypto\b/i, label: 'Web3/Crypto' },
  { re: /\bsalesforce\s+admin\b|\bsap\b|\boracle\s+ebs\b|\bmainframe\b|\bcobol\b/i, label: 'Legacy ERP/Mainframe' },
];

// Los Angeles & Orange County metro cities/regions
const LA_OC_PATTERNS = [
  /\blos\s+angeles\b/i,
  /\bla,\s*ca\b/i,
  /\bsanta\s+monica\b/i,
  /\bculver\s+city\b/i,
  /\bel\s+segundo\b/i,
  /\bhawthorne\b/i,
  /\bpasadena\b/i,
  /\bburbank\b/i,
  /\bglendale,\s*ca\b/i,
  /\bplaya\s+vista\b/i,
  /\bvenice,\s*ca\b/i,
  /\bmarina\s+del\s+rey\b/i,
  /\btorrance\b/i,
  /\blong\s+beach,\s*ca\b/i,
  /\binglewood\b/i,
  /\bwest\s+hollywood\b/i,
  /\bbeverly\s+hills\b/i,
  /\bcentury\s+city\b/i,
  /\bmanhattan\s+beach\b/i,
  /\bredondo\s+beach\b/i,
  /\bwoodland\s+hills\b/i,
  /\bcalabasas\b/i,
  /\bthousand\s+oaks\b/i,
  /\borange\s+county\b/i,
  /\birvine\b/i,
  /\bcosta\s+mesa\b/i,
  /\bnewport\s+beach\b/i,
  /\banaheim\b/i,
  /\bsanta\s+ana\b/i,
  /\bhuntington\s+beach\b/i,
  /\bfullerton\b/i,
  /\btustin\b/i,
  /\baliso\s+viejo\b/i,
  /\blaguna\b/i,
  /\blake\s+forest,\s*ca\b/i,
  /\bmission\s+viejo\b/i,
  /\bsocal\b|\bsouthern\s+california\b/i,
];

// Explicit US markers
const US_PATTERNS = [
  /\bunited\s+states\b/i,
  /\bu\.s\.a?\.?\b/i,
  /\busa\b/i,
  /\bremote[\s,(\/-]+us\b/i,
  /\bus[\s,(\/-]+remote\b/i,
  /\bremote\s*\(?(?:united\s+states|us|usa|north\s+america)\)?/i,
  /\b(?:pst|pdt|mst|mdt|cst|cdt|est|edt)\b/i,
  /\bcalifornia\b/i,
  /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/,
];

// Explicit non-US countries / hubs / regions
const NON_US_PATTERNS = [
  /\bunited\s+kingdom\b|\buk\b|\blondon\b|\bmanchester\b|\bedinburgh\b|\bbristol\b/i,
  /\bcanada\b|\btoronto\b|\bvancouver\b|\bmontreal\b|\bottawa\b|\bcalgary\b|\bwaterloo\b/i,
  /\bgermany\b|\bberlin\b|\bmunich\b|\bmünchen\b|\bhamburg\b|\bfrankfurt\b|\bdach\b/i,
  /\bfrance\b|\bparis\b|\blyon\b/i,
  /\bspain\b|\bmadrid\b|\bbarcelona\b/i,
  /\bnetherlands\b|\bamsterdam\b|\brotterdam\b/i,
  /\bireland\b|\bdublin\b/i,
  /\bpoland\b|\bwarsaw\b|\bkrakow\b|\bkraków\b|\bwroclaw\b/i,
  /\bindia\b|\bbengaluru\b|\bbangalore\b|\bhyderabad\b|\bmumbai\b|\bpune\b|\bchennai\b|\bdelhi\b|\bnoida\b|\bgurugram\b/i,
  /\baustralia\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b|\bperth\b/i,
  /\bsingapore\b/i,
  /\bjapan\b|\btokyo\b|\bosaka\b/i,
  /\bchina\b|\bbeijing\b|\bshanghai\b|\bshenzhen\b|\bhong\s+kong\b/i,
  /\bbrazil\b|\bs[aã]o\s+paulo\b/i,
  /\bmexico\b|\bmexico\s+city\b|\bguadalajara\b/i,
  /\bargentina\b|\bbuenos\s+aires\b/i,
  /\bcolombia\b|\bbogot[aá]\b|\bmedell[ií]n\b/i,
  /\bisrael\b|\btel\s+aviv\b/i,
  /\bswitzerland\b|\bzurich\b|\bzürich\b|\bgeneva\b/i,
  /\bsweden\b|\bstockholm\b|\bnorway\b|\boslo\b|\bdenmark\b|\bcopenhagen\b|\bfinland\b|\bhelsinki\b/i,
  /\bitaly\b|\bmilan\b|\brome\b|\bportugal\b|\blisbon\b|\bporto\b/i,
  /\beurope\b|\beu\s+only\b|\bemea\b|\bapac\b|\blatam\b|\bnew\s+zealand\b|\bauckland\b/i,
  /\bkorea\b|\bseoul\b|\btaiwan\b|\btaipei\b|\bvietnam\b|\bphilippines\b|\bmanila\b/i,
];

const REMOTE_SIGNAL_RE = /\b(?:remote|work\s+from\s+home|wfh|distributed|telecommute|anywhere\s+in\s+(?:the\s+)?(?:us|usa|united\s+states))\b/i;

/**
 * Evaluate job title against target Platform/DevOps/SRE/Cloud keywords and
 * seniority/domain exclusion rules.
 *
 * @param {string} title
 * @returns {{ ok: boolean, reasonCode: string | null, reasonDetail: string | null }}
 */
export function evaluateTitle(title) {
  const raw = typeof title === 'string' ? title.trim() : '';
  if (!raw) {
    return {
      ok: false,
      reasonCode: FILTER_REASON_CODES.TITLE_MISSING,
      reasonDetail: 'Missing job title',
    };
  }

  for (const { re, label } of EXCLUDED_SENIORITY_PATTERNS) {
    if (re.test(raw)) {
      return {
        ok: false,
        reasonCode: FILTER_REASON_CODES.TITLE_EXCLUDED_SENIORITY,
        reasonDetail: `Title seniority excluded (${label}): "${raw}"`,
      };
    }
  }

  for (const { re, label } of EXCLUDED_DOMAIN_PATTERNS) {
    if (re.test(raw)) {
      return {
        ok: false,
        reasonCode: FILTER_REASON_CODES.TITLE_EXCLUDED_DOMAIN,
        reasonDetail: `Title domain excluded (${label}): "${raw}"`,
      };
    }
  }

  const matched = TARGET_TITLE_PATTERNS.some((re) => re.test(raw));
  if (!matched) {
    return {
      ok: false,
      reasonCode: FILTER_REASON_CODES.TITLE_NOT_TARGET,
      reasonDetail: `Title outside Platform/DevOps/SRE/Cloud target: "${raw}"`,
    };
  }

  return { ok: true, reasonCode: null, reasonDetail: null };
}

/**
 * Infer normalized workplace type ('remote' | 'hybrid' | 'onsite' | 'unknown').
 *
 * @param {{ location?: string | null, title?: string | null, workplaceType?: string | null }} input
 * @returns {'remote' | 'hybrid' | 'onsite' | 'unknown'}
 */
export function inferWorkplaceType({ location, title, workplaceType } = {}) {
  const explicit = typeof workplaceType === 'string' ? workplaceType.trim().toLowerCase() : '';
  if (explicit === 'remote' || explicit === 'hybrid' || explicit === 'onsite') {
    return explicit;
  }
  const combined = `${location ?? ''} ${title ?? ''}`;
  if (/\bhybrid\b/i.test(combined)) return 'hybrid';
  if (REMOTE_SIGNAL_RE.test(combined)) return 'remote';
  if (/\b(?:on-?site|in-?office)\b/i.test(combined)) return 'onsite';
  return 'unknown';
}

/**
 * Evaluate location against strict policy: (Remote US OR Los Angeles / OC metro).
 *
 * @param {string | null | undefined} location
 * @param {{ title?: string, workplaceType?: string | null, jdText?: string | null, strict?: boolean }} [opts]
 * @returns {{ ok: boolean, reasonCode: string | null, reasonDetail: string | null, workplaceType: 'remote' | 'hybrid' | 'onsite' | 'unknown' }}
 */
export function evaluateLocation(location, opts = {}) {
  const loc = typeof location === 'string' ? location.trim() : '';
  const title = typeof opts.title === 'string' ? opts.title.trim() : '';
  const strict = opts.strict !== false;
  const workplaceType = inferWorkplaceType({
    location: loc,
    title,
    workplaceType: opts.workplaceType,
  });

  const isLaOc = LA_OC_PATTERNS.some((re) => re.test(loc) || re.test(title));
  const isRemote = workplaceType === 'remote' || REMOTE_SIGNAL_RE.test(loc) || REMOTE_SIGNAL_RE.test(title);
  const mentionsUs = US_PATTERNS.some((re) => re.test(loc) || re.test(title));
  const nonUsMatch = NON_US_PATTERNS.find((re) => re.test(loc));

  if (!loc) {
    if (isLaOc) {
      return { ok: true, reasonCode: null, reasonDetail: null, workplaceType };
    }
    if (isRemote && mentionsUs) {
      return { ok: true, reasonCode: null, reasonDetail: null, workplaceType: 'remote' };
    }
    if (strict) {
      return {
        ok: false,
        reasonCode: FILTER_REASON_CODES.LOCATION_MISSING_STRICT,
        reasonDetail: 'Location missing under strict US-Remote/LA-OC policy',
        workplaceType,
      };
    }
    return { ok: true, reasonCode: null, reasonDetail: null, workplaceType };
  }

  if (isLaOc) {
    return { ok: true, reasonCode: null, reasonDetail: null, workplaceType };
  }

  if (nonUsMatch && !mentionsUs) {
    return {
      ok: false,
      reasonCode: FILTER_REASON_CODES.LOCATION_NON_US,
      reasonDetail: `Non-US location rejected: "${loc}"`,
      workplaceType,
    };
  }

  if (isRemote) {
    if (mentionsUs || !nonUsMatch) {
      return { ok: true, reasonCode: null, reasonDetail: null, workplaceType: 'remote' };
    }
    return {
      ok: false,
      reasonCode: FILTER_REASON_CODES.LOCATION_NON_US,
      reasonDetail: `Non-US remote location rejected: "${loc}"`,
      workplaceType: 'remote',
    };
  }

  return {
    ok: false,
    reasonCode: FILTER_REASON_CODES.LOCATION_NOT_REMOTE_OR_LA_OC,
    reasonDetail: `Location is neither Remote US nor LA/OC metro: "${loc}"`,
    workplaceType,
  };
}

const YOE_PATTERNS = [
  /\b(?:at\s+least\s+|minimum\s+(?:of\s+)?)?(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+(?:relevant|professional|industry|hands-on|production|work|software|engineering|devops|sre|cloud|platform|infrastructure|related|technical)){0,3}\s+(?:experience|exp\b)/gi,
  /\b(?:at\s+least\s+|minimum\s+(?:of\s+)?|min\.?\s+)?(\d{1,2})\s*(?:\+|plus|\s+or\s+more)?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+(?:relevant|professional|industry|hands-on|production|work|software|engineering|devops|sre|cloud|platform|infrastructure|related|technical)){0,3}\s+(?:experience|exp\b)/gi,
  /\b(?:at\s+least\s+|minimum\s+(?:of\s+)?)?(\d{1,2})\s*(?:\+|plus|\s+or\s+more)?\s*(?:years?|yrs?)\s+(?:in|working\s+(?:in|with|on))\s+(?:software|platform|devops|sre|site\s+reliability|cloud|infrastructure|systems|production)\b/gi,
];

const PREFERRED_LINE_RE = /\b(?:preferred|nice\s+to\s+have|bonus|plus\s*:|desired)\b/i;
const DEGREE_OR_COMPANY_RE = /\b(?:degree|bachelor|master|founded|in\s+business|history|vesting|cliff)\b/i;

/**
 * Extract required years-of-experience bounds from JD text.
 * Uses the lowest required floor when multiple mentions exist.
 *
 * @param {string | null | undefined} text
 * @returns {{ yoeMin: number | null, yoeMax: number | null, yoeLabel: string | null }}
 */
export function extractYoe(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { yoeMin: null, yoeMax: null, yoeLabel: null };
  }

  const lines = text.split(/\r?\n|(?<=[.!?])\s+/);
  const requiredMentions = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (PREFERRED_LINE_RE.test(trimmed)) continue;
    if (DEGREE_OR_COMPANY_RE.test(trimmed) && !/\bexperience\b/i.test(trimmed)) continue;

    for (const pattern of YOE_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(trimmed)) !== null) {
        const min = Number.parseInt(m[1], 10);
        const max = m[2] ? Number.parseInt(m[2], 10) : null;
        if (!Number.isInteger(min) || min < 0 || min > 30) continue;
        if (max !== null && (max < min || max > 40)) continue;
        const label = max !== null ? `${min}-${max} yrs` : `${min}+ yrs`;
        requiredMentions.push({ min, max, label });
      }
    }
  }

  if (requiredMentions.length === 0) {
    return { yoeMin: null, yoeMax: null, yoeLabel: null };
  }

  requiredMentions.sort((a, b) => a.min - b.min);
  const lowest = requiredMentions[0];
  return {
    yoeMin: lowest.min,
    yoeMax: lowest.max,
    yoeLabel: lowest.label,
  };
}

/**
 * Evaluate YOE against junior-mid target band (0-4 YOE by default; reject 5+ yr).
 *
 * @param {string | null | undefined} jdText
 * @param {{ maxYoe?: number, yoeMin?: number | null, yoeMax?: number | null }} [opts]
 * @returns {{ ok: boolean, reasonCode: string | null, reasonDetail: string | null, yoeMin: number | null, yoeMax: number | null, yoeLabel: string | null }}
 */
export function evaluateYoe(jdText, opts = {}) {
  const maxYoe = Number.isInteger(opts.maxYoe) ? opts.maxYoe : DEFAULT_MAX_YOE;
  const extracted = extractYoe(jdText);
  const yoeMin = typeof opts.yoeMin === 'number' ? opts.yoeMin : extracted.yoeMin;
  const yoeMax = typeof opts.yoeMax === 'number' ? opts.yoeMax : extracted.yoeMax;
  const yoeLabel =
    extracted.yoeLabel ??
    (yoeMin !== null ? (yoeMax !== null ? `${yoeMin}-${yoeMax} yrs` : `${yoeMin}+ yrs`) : null);

  if (yoeMin !== null && yoeMin > maxYoe) {
    return {
      ok: false,
      reasonCode: FILTER_REASON_CODES.YOE_ABOVE_MAX,
      reasonDetail: `Requires ${yoeLabel} (exceeds max ${maxYoe} YOE)`,
      yoeMin,
      yoeMax,
      yoeLabel,
    };
  }

  return {
    ok: true,
    reasonCode: null,
    reasonDetail: null,
    yoeMin,
    yoeMax,
    yoeLabel,
  };
}

/**
 * Run the full strict filter pipeline on a candidate job posting.
 *
 * @param {{
 *   title: string,
 *   location?: string | null,
 *   workplaceType?: string | null,
 *   jdText?: string | null,
 *   description?: string | null,
 *   yoeMin?: number | null,
 *   yoeMax?: number | null,
 * }} job
 * @param {{ maxYoe?: number, strictLocation?: boolean, skipTitleCheck?: boolean }} [opts]
 * @returns {{
 *   accepted: boolean,
 *   reasonCode: string | null,
 *   reasonDetail: string | null,
 *   normalized: {
 *     workplaceType: 'remote' | 'hybrid' | 'onsite' | 'unknown',
 *     yoeMin: number | null,
 *     yoeMax: number | null,
 *     yoeLabel: string | null,
 *   },
 * }}
 */
export function filterJob(job, opts = {}) {
  const jdText = job.jdText ?? job.description ?? '';
  const workplaceType = inferWorkplaceType({
    location: job.location,
    title: job.title,
    workplaceType: job.workplaceType,
  });

  if (!opts.skipTitleCheck) {
    const titleResult = evaluateTitle(job.title);
    if (!titleResult.ok) {
      return {
        accepted: false,
        reasonCode: titleResult.reasonCode,
        reasonDetail: titleResult.reasonDetail,
        normalized: { workplaceType, yoeMin: null, yoeMax: null, yoeLabel: null },
      };
    }
  }

  const locResult = evaluateLocation(job.location, {
    title: job.title,
    workplaceType: job.workplaceType,
    jdText,
    strict: opts.strictLocation !== false,
  });
  if (!locResult.ok) {
    return {
      accepted: false,
      reasonCode: locResult.reasonCode,
      reasonDetail: locResult.reasonDetail,
      normalized: { workplaceType: locResult.workplaceType, yoeMin: null, yoeMax: null, yoeLabel: null },
    };
  }

  const yoeResult = evaluateYoe(jdText, {
    maxYoe: opts.maxYoe ?? DEFAULT_MAX_YOE,
    yoeMin: job.yoeMin,
    yoeMax: job.yoeMax,
  });
  if (!yoeResult.ok) {
    return {
      accepted: false,
      reasonCode: yoeResult.reasonCode,
      reasonDetail: yoeResult.reasonDetail,
      normalized: {
        workplaceType: locResult.workplaceType,
        yoeMin: yoeResult.yoeMin,
        yoeMax: yoeResult.yoeMax,
        yoeLabel: yoeResult.yoeLabel,
      },
    };
  }

  return {
    accepted: true,
    reasonCode: null,
    reasonDetail: null,
    normalized: {
      workplaceType: locResult.workplaceType,
      yoeMin: yoeResult.yoeMin,
      yoeMax: yoeResult.yoeMax,
      yoeLabel: yoeResult.yoeLabel,
    },
  };
}
