const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysis } = require('../lib/engine');
const { buildResearchTask, validateResearchTask } = require('../lib/research');

test('research task contains all traceability entities', () => {
  const task = buildResearchTask(buildAnalysis('宁德时代2025年盈利改善主要来自主营业务，而非非经常性损益。', '300750.SZ'));
  assert.equal(validateResearchTask(task).ok, true);
  assert.equal(task.schemaVersion, 2);
  assert.ok(task.thesis.original);
  assert.ok(task.subquestions.length >= 3);
  assert.ok(task.evidence.some(item => item.direction === 'support'));
  assert.ok(task.evidence.some(item => item.direction === 'oppose'));
  assert.ok(task.evidence.some(item => item.direction === 'unknown'));
  assert.ok(task.conflicts.length >= 1);
  assert.ok(task.changeConditions.every(item => item.thresholdBasis.includes('用户设定')));
  assert.ok(task.auditEvents.length >= 1);
});

test('calculated evidence exposes formula and source URL', () => {
  const task = buildResearchTask(buildAnalysis('宁德时代2025年盈利改善主要来自主营业务，而非非经常性损益。', '300750.SZ'));
  const marginEvidence = task.evidence.find(item => item.id === 'S3');
  assert.match(marginEvidence.formula, /主营收入/);
  assert.match(marginEvidence.sourceUrl, /^https:\/\//);
  assert.match(marginEvidence.reliability, /高/);
});

test('unsupported claim stays insufficient and has no supporting evidence', () => {
  const task = buildResearchTask(buildAnalysis('比亚迪估值回落但基本面未恶化。', '002594.SZ'));
  assert.equal(task.status, 'needs-clarification');
  assert.equal(task.evidence.filter(item => item.direction === 'support').length, 0);
  assert.equal(task.dataSnapshot.completeness, 'insufficient');
});
