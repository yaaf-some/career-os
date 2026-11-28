import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluationViews, guardFlagLines, triageDetail } from '@/features/job/fit/api';
import { ReportMarkdown, parseMarkdown } from '@/features/job/fit/ReportMarkdown';
import { annotationRequest, errorText, type JobRow } from '@/features/job/overview/api';
import { buildPatch, parseSalary, toForm } from '@/features/job/overview/form';
import { ApiError } from '@/api/core';

afterEach(cleanup);

const row = {
  title: 'Platform Engineer',
  company: 'Example Co',
  url: 'https://jobs.example.com/1',
  location: 'Remote',
  workplace_type: null,
  salary_min: 150000,
  salary_max: null,
  salary_currency: null,
  yoe_label: null,
  tier1_json: '{"archetype":" Platform ","scored_without_description":true}',
} as JobRow;

describe('job details form', () => {
  it('sends only what changed, with blank fields cleared', () => {
    const opened = toForm(row);
    expect(buildPatch(opened, opened)).toEqual({ patch: {} });
    expect(
      buildPatch(opened, {
        ...opened,
        title: ' Staff Engineer ',
        location: '',
        workplace_type: 'hybrid',
        salary_min: '',
        salary_max: '180k',
      }),
    ).toEqual({
      patch: {
        title: 'Staff Engineer',
        location: null,
        workplace_type: 'hybrid',
        salary_min: null,
        salary_max: 180000,
      },
    });
  });

  it('explains values it cannot send', () => {
    const opened = toForm(row);
    for (const change of [{ title: ' ' }, { url: 'javascript:alert(1)' }, { salary_max: 'lots' }]) {
      expect(buildPatch(opened, { ...opened, ...change })).toHaveProperty('error');
    }
    expect(parseSalary('150,000')).toBe(150000);
    expect(parseSalary('92.5k')).toBe(92500);
    expect(parseSalary('-1')).toBeUndefined();
  });

  it('drops the error kind from API messages', () => {
    expect(errorText(new ApiError('bad request: title cannot be empty', 400, 'BAD_REQUEST'))).toBe(
      'title cannot be empty',
    );
  });

  it('keeps ids and tags out of the path structure', () => {
    expect(annotationRequest('job 1', { type: 'removeTag', tag: 'a/b & c' })[0]).toBe(
      '/api/jobs/job%201/tags?tag=a%2Fb+%26+c',
    );
  });
});

describe('fit details', () => {
  it('lists every tier of evaluation, newest first', () => {
    const base = {
      model: 'm',
      provider: 'mock',
      overall_score: 4,
      archetype: null,
      blocks_json: null,
      report_md: '  ',
    };
    const views = evaluationViews([
      { ...base, id: 'old', tier: 'balanced', created_at: '2026-01-01T00:00:00Z' },
      { ...base, id: 'new', tier: 'fast', created_at: '2026-01-02T00:00:00Z' },
    ]);
    expect(views.map((v) => v.id)).toEqual(['new', 'old']);
    expect(views[0]).toMatchObject({ verdict: '4.0 / 5', ranBy: 'mock · m', reportMd: null });
  });

  it('reads the archetype and guard flags without trusting their shape', () => {
    expect(triageDetail(row)).toEqual({ archetype: 'Platform', scoredWithoutDescription: true });
    expect(guardFlagLines(null)).toEqual([]);
    expect(guardFlagLines('not json')).toEqual([]);
    expect(guardFlagLines('{"flagged":false,"hiddenBlocks":3}')).toEqual([]);
    expect(guardFlagLines('{"flagged":true,"verdict":"flagged","instructionCount":2}')).toEqual([
      'flagged',
      'Text written as instructions to an AI: 2',
    ]);
  });

  it('parses the report structure', () => {
    expect(
      parseMarkdown('## Title\n\n- one\n  - nested\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext\nmore'),
    ).toEqual([
      { type: 'heading', level: 2, text: 'Title' },
      {
        type: 'list',
        ordered: false,
        items: [
          { text: 'one', depth: 0 },
          { text: 'nested', depth: 1 },
        ],
      },
      { type: 'table', rows: [['a', 'b'], ['1', '2']] },
      { type: 'paragraph', text: 'text more' },
    ]);
  });

  it('never turns report text into HTML or links', () => {
    const { container } = render(
      <ReportMarkdown
        source={
          '<img src=x onerror=alert(1)>\n\n**bold** [click](javascript:alert(1)) ![pic](https://tracker.example.com/p.png) snake_case_name\n\n```\n<script>x</script>'
        }
      />,
    );
    expect(container.querySelector('img, a, script')).toBeNull();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(container.textContent).toContain('click (javascript:alert(1)');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('snake_case_name');
  });
});
