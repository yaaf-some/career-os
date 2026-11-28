import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTER_REASON_CODES,
  evaluateTitle,
  evaluateLocation,
  evaluateYoe,
  filterJob,
} from '../src/filter.mjs';

test('evaluateTitle accepts target Platform/DevOps/SRE/Cloud roles and rejects seniority/domain mismatches', () => {
  for (const title of [
    'Platform Engineer',
    'Junior DevOps Engineer',
    'Site Reliability Engineer II',
    'Cloud Infrastructure Engineer',
    'Kubernetes Engineer',
    'Release Engineer',
    'DevSecOps Engineer',
  ]) {
    assert.equal(evaluateTitle(title).ok, true, `expected target title to pass: ${title}`);
  }

  assert.equal(evaluateTitle('').reasonCode, FILTER_REASON_CODES.TITLE_MISSING);
  assert.equal(evaluateTitle('Staff Platform Engineer').reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_SENIORITY);
  assert.equal(evaluateTitle('Principal SRE').reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_SENIORITY);
  assert.equal(evaluateTitle('Engineering Manager, DevOps').reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_SENIORITY);
  assert.equal(evaluateTitle('DevOps Intern').reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_SENIORITY);
  assert.equal(evaluateTitle('Network Infrastructure Engineer').reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_DOMAIN);
  assert.equal(evaluateTitle('iOS Platform Engineer').reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_DOMAIN);
  assert.equal(evaluateTitle('Account Executive').reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_DOMAIN);
  assert.equal(evaluateTitle('Frontend React Developer').reasonCode, FILTER_REASON_CODES.TITLE_NOT_TARGET);
});

test('evaluateLocation enforces strict Remote US OR LA/OC metro policy', () => {
  for (const loc of [
    'Remote - US',
    'Remote (United States)',
    'Remote',
    'Los Angeles, CA',
    'El Segundo, CA (Hybrid)',
    'Irvine, CA',
    'Santa Monica, CA',
    'Orange County, CA',
  ]) {
    assert.equal(evaluateLocation(loc).ok, true, `expected location to pass: ${loc}`);
  }

  assert.equal(evaluateLocation('').reasonCode, FILTER_REASON_CODES.LOCATION_MISSING_STRICT);
  assert.equal(evaluateLocation('London, UK').reasonCode, FILTER_REASON_CODES.LOCATION_NON_US);
  assert.equal(evaluateLocation('Remote - Canada').reasonCode, FILTER_REASON_CODES.LOCATION_NON_US);
  assert.equal(evaluateLocation('Bengaluru, India').reasonCode, FILTER_REASON_CODES.LOCATION_NON_US);
  assert.equal(evaluateLocation('New York, NY').reasonCode, FILTER_REASON_CODES.LOCATION_NOT_REMOTE_OR_LA_OC);
  assert.equal(evaluateLocation('Austin, TX (Hybrid)').reasonCode, FILTER_REASON_CODES.LOCATION_NOT_REMOTE_OR_LA_OC);
});

test('evaluateYoe accepts 0-4 YOE and rejects 5+ required years', () => {
  assert.equal(evaluateYoe('Requires 2-4 years of experience with Kubernetes.').ok, true);
  assert.equal(evaluateYoe('Minimum 3+ years experience in DevOps.').ok, true);
  assert.equal(evaluateYoe('No years mentioned, just Terraform and AWS.').ok, true);
  assert.equal(evaluateYoe('2+ years of experience required. Preferred: 6+ years in SRE.').ok, true);

  const tooSenior = evaluateYoe('At least 5+ years of experience in cloud infrastructure.');
  assert.equal(tooSenior.ok, false);
  assert.equal(tooSenior.reasonCode, FILTER_REASON_CODES.YOE_ABOVE_MAX);
  assert.equal(tooSenior.yoeMin, 5);

  const rangeTooHigh = evaluateYoe('5-8 years of DevOps experience required.');
  assert.equal(rangeTooHigh.ok, false);
  assert.equal(rangeTooHigh.reasonCode, FILTER_REASON_CODES.YOE_ABOVE_MAX);
});

test('filterJob applies full title + location + YOE pipeline', () => {
  const ok = filterJob({
    title: 'Platform Engineer II',
    location: 'Remote - US',
    jdText: '1-3 years of experience managing AWS and Kubernetes.',
  });
  assert.equal(ok.accepted, true);
  assert.equal(ok.normalized.workplaceType, 'remote');
  assert.equal(ok.normalized.yoeMin, 1);
  assert.equal(ok.normalized.yoeMax, 3);

  const rejected = filterJob({
    title: 'Platform Engineer',
    location: 'San Francisco, CA',
    jdText: '2 years of experience.',
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reasonCode, FILTER_REASON_CODES.LOCATION_NOT_REMOTE_OR_LA_OC);
});

test('filterJob rejects aerospace/hardware Systems Engineer and applies custom scanner_filters', () => {
  const aeroTitle = filterJob({
    title: 'Aerospace Systems Engineer',
    location: 'El Segundo, CA',
    jdText: '2 years of experience.',
  });
  assert.equal(aeroTitle.accepted, false);
  assert.equal(aeroTitle.reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_DOMAIN);

  const aeroJd = filterJob({
    title: 'Systems Engineer',
    location: 'El Segundo, CA',
    jdText: 'Support MBSE, SysML, and spacecraft propulsion integration. 2 years of experience.',
  });
  assert.equal(aeroJd.accepted, false);
  assert.equal(aeroJd.reasonCode, FILTER_REASON_CODES.TITLE_EXCLUDED_DOMAIN);

  const cloudSystems = filterJob({
    title: 'Systems Engineer',
    location: 'Remote - US',
    jdText: 'Manage Linux, Kubernetes clusters, and CI/CD pipelines. 2 years of experience.',
  });
  assert.equal(cloudSystems.accepted, true);

  const customAccepted = filterJob(
    {
      title: 'Developer Experience Engineer',
      location: 'Remote - US',
      jdText: '2 years of experience.',
    },
    {
      targetTitleKeywords: ['Developer Experience Engineer'],
      excludedDomains: ['Avionics'],
    },
  );
  assert.equal(customAccepted.accepted, true);
});
