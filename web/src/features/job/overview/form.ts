import type { JobPatch, JobRow } from './api';

export interface DetailsForm {
  title: string;
  company: string;
  url: string;
  location: string;
  workplace_type: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  yoe_label: string;
}

/** The picker's value for "no workplace type". */
export const NO_WORKPLACE = 'none';

export const WORKPLACE_OPTIONS = [
  { value: NO_WORKPLACE, label: 'Not set' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
  { value: 'unknown', label: 'Unknown' },
];

export function toForm(job: JobRow): DetailsForm {
  return {
    title: job.title,
    company: job.company,
    url: job.url,
    location: job.location ?? '',
    workplace_type: job.workplace_type ?? NO_WORKPLACE,
    salary_min: job.salary_min?.toString() ?? '',
    salary_max: job.salary_max?.toString() ?? '',
    salary_currency: job.salary_currency ?? '',
    yoe_label: job.yoe_label ?? '',
  };
}

/** `150000`, `150,000` or `150k`; blank is `null`, anything else `undefined`. */
export function parseSalary(raw: string): number | null | undefined {
  const text = raw.replace(/[,\s]/g, '');
  if (!text) return null;
  const match = /^(\d+(?:\.\d+)?)(k?)$/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]) * (match[2] ? 1000 : 1);
  return Number.isSafeInteger(Math.round(value)) ? Math.round(value) : undefined;
}

/**
 * The fields the user changed since the form opened, so a value that changed
 * elsewhere in the meantime is not put back.
 */
export function buildPatch(
  opened: DetailsForm,
  form: DetailsForm,
): { patch: JobPatch } | { error: string } {
  const changed = (key: keyof DetailsForm) => form[key].trim() !== opened[key].trim();
  const patch: JobPatch = {};

  for (const key of ['title', 'company'] as const) {
    if (!changed(key)) continue;
    if (!form[key].trim()) return { error: `${key === 'title' ? 'Title' : 'Company'} cannot be empty.` };
    patch[key] = form[key].trim();
  }
  if (changed('url')) {
    if (!/^https?:\/\/\S+$/i.test(form.url.trim())) {
      return { error: 'The posting URL must start with http:// or https://.' };
    }
    patch.url = form.url.trim();
  }
  for (const key of ['location', 'salary_currency', 'yoe_label'] as const) {
    if (changed(key)) patch[key] = form[key].trim() || null;
  }
  if (changed('workplace_type')) {
    patch.workplace_type = form.workplace_type === NO_WORKPLACE ? null : form.workplace_type;
  }
  for (const key of ['salary_min', 'salary_max'] as const) {
    if (!changed(key)) continue;
    const value = parseSalary(form[key]);
    if (value === undefined) return { error: 'Enter salaries as numbers, such as 150000 or 150k.' };
    patch[key] = value;
  }
  return { patch };
}
