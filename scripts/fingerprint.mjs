import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyzeGlobalOutputs } from './fingerprint-core.mjs';
import { CheckError } from './errors.mjs';

export const GATES = Object.freeze({ validSamples: 3, relativeWeight: 0.8, expectedWeightMax: 0.2, scoreGap: 0.5 });
export const LABELS = {
  match: '指纹与所选 GPT 相符', mismatch: '指纹不符，疑似模型变化',
  inconclusive: '证据不足，暂时无法判断', unsupported: '暂不支持此模型', error: '检测未完成',
};
export async function loadBank() {
  const provenance = JSON.parse(await readFile(new URL('../assets/provenance.json', import.meta.url), 'utf8'));
  const bankBytes = await readFile(new URL('../assets/bank.json', import.meta.url));
  const scorerBytes = await readFile(new URL('./fingerprint-core.mjs', import.meta.url));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  if (sha(bankBytes) !== provenance.bankSha256 || sha(scorerBytes) !== provenance.scorerSha256)
    throw new CheckError('ASSET_INTEGRITY', '指纹库或判分脚本与发布版本不一致，请重新安装完整包。');
  return { bank: JSON.parse(bankBytes), provenance };
}
export const supportedModel = (id, bank) => /^gpt-/.test(id) && bank.models.some(m => m.id === id);

// Reject non-numerical answers before the upstream permissive parser. A short,
// malformed, tool-generated or failed answer must never become a "match".
export function validArray(text, expectedCount) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  let values; try { values = JSON.parse(cleaned); } catch { return false; }
  return Array.isArray(values) && values.length >= Math.max(80, Math.ceil(expectedCount * 0.55))
    && values.length <= expectedCount * 2
    && values.every(v => Number.isInteger(v) && v >= 1 && v <= 355);
}
export function decisionDetails(analysis, expected, validCount, gates = GATES) {
  const limits = { ...GATES, ...gates };
  const values = { validSamples: validCount, requiredSamples: limits.validSamples };
  const result = (status, reason) => ({ status, reason, ...values });
  if (validCount !== limits.validSamples) return result('inconclusive', 'INSUFFICIENT_SAMPLES');
  const results = Array.isArray(analysis?.results) ? analysis.results : [];
  const [top, second] = results;
  const wanted = results.find(x => x?.model === expected);
  if (!top || !second || !wanted || results.some(x => !Number.isFinite(x?.score) || !Number.isFinite(x?.probability)))
    return result('inconclusive', 'INVALID_ANALYSIS');
  Object.assign(values, {
    topModel: top.model, runnerUp: second.model, runnerUpWeight: second.probability,
    relativeWeight: top.probability, minRelativeWeight: limits.relativeWeight,
    scoreGap: top.score - second.score, minScoreGap: limits.scoreGap,
    expectedWeight: wanted.probability, expectedWeightMax: limits.expectedWeightMax,
  });
  if (top.probability < limits.relativeWeight) return result('inconclusive', 'LOW_WEIGHT');
  if (values.scoreGap < limits.scoreGap) return result('inconclusive', 'LOW_MARGIN');
  if (top.model === expected) return result('match', 'MATCH');
  if (wanted.probability <= limits.expectedWeightMax && top.score - wanted.score >= limits.scoreGap)
    return result('mismatch', 'MISMATCH');
  return result('inconclusive', 'WEAK_MISMATCH');
}
export function decide(analysis, expected, validCount) {
  return decisionDetails(analysis, expected, validCount).status;
}
export function scoreSamples(samples, expected, bank) {
  if (!supportedModel(expected, bank)) return { status: 'unsupported', validSamples: 0, analysis: null, rejected: [] };
  const good = []; const rejected = [];
  samples.forEach((s, i) => {
    if (s.error || !validArray(s.text, s.count)) rejected.push({ sample: i + 1, reason: s.error?.code || 'INVALID_ARRAY' });
    else good.push({ text: s.text, expected_count: s.count });
  });
  const analysis = good.length ? analyzeGlobalOutputs(good, bank) : null;
  const decision = decisionDetails(analysis, expected, good.length);
  return { status: decision.status, decision, validSamples: good.length, analysis, rejected };
}
