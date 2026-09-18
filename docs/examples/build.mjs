// Documentation fixtures only. This module never connects to a model or reads user records.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { decisionDetails } from '../../scripts/fingerprint.mjs';
import { presentationFor } from '../../scripts/presentation.mjs';

const source = model => ({ model, effort: 'max', originator: 'Codex Desktop' });
function scored(expectedStatus, model, scores, input, output) {
  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const weights = ordered.map(([, score]) => Math.exp(12 * (score - ordered[0][1])));
  const total = weights.reduce((a, b) => a + b, 0);
  const analysis = { used_outputs: 3, results: ordered.map(([model, score], i) => ({
    model, score, probability: weights[i] / total,
  })) };
  const decision = decisionDetails(analysis, model, 3);
  assert.equal(decision.status, expectedStatus);
  return {
    simulated: true, status: decision.status, source: source(model),
    analysis, decision, validSamples: 3, usage: { input, output, samples: 3 },
    retryArtifact: expectedStatus === 'inconclusive' ? '/demo/retry.html' : null,
  };
}

const reports = [
  scored('match', 'gpt-6-astra', { 'gpt-6-astra': 1.8, 'gpt-5.6-sol': 1.1, 'gpt-5.6-luna': 0.7 }, 84200, 6300),
  scored('mismatch', 'gpt-6-astra', { 'gpt-5.6-luna': 1.8, 'gpt-5.6-sol': 1.15, 'gpt-6-astra': 0.6 }, 82600, 7200),
  scored('inconclusive', 'gpt-5.6-sol', { 'gpt-5.6-sol': 1.35, 'gpt-5.6-terra': 1.18, 'gpt-6-astra': 0.8 }, 81000, 14400),
  { simulated: true, status: 'unsupported', source: source('deepseek/deepseek-v4-pro'), validSamples: 0, samples: [] },
  { simulated: true, status: 'error', source: source('gpt-6-astra'), validSamples: 0,
    error: { code: 'PROBE_TIMEOUT', message: '探针请求超时，未取得可用样本。' } },
];

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const count = value => typeof value === 'number' ? value.toLocaleString('en-US') : '未返回';
const sections = reports.map((report, index) => {
  const view = presentationFor(report);
  const candidate = view.candidate ? `<div>最接近指纹：<strong>${esc(view.candidate)}</strong>${view.relativeWeight ? ` · 库内匹配权重 <strong>${esc(view.relativeWeight)}</strong>` : ''}</div>` : '';
  return `<article class="result" data-state="${report.status}">
    <header><span>GPT 模型检测</span><span>效果演示 ${index + 1}/5 · SIMULATED</span></header>
    <img class="state-image" src="../../assets/states/${report.status}.png" alt="${esc(view.alt)}">
    <h2>${esc(view.title)}</h2>
    <p class="detail">${esc(view.detail)}</p>
    <div class="facts"><div>所选模型：<strong>${esc(report.source.model)}</strong>（${report.source.effort}）</div>${candidate}</div>
    <div class="usage"><div>有效样本 ${report.validSamples}/3</div><div>输入 Token <strong>${count(view.usage.input)}</strong> · 输出 Token <strong>${count(view.usage.output)}</strong></div></div>
    ${report.error ? `<p class="reason">原因：${esc(report.error.message)}</p>` : ''}
    <div class="action"><span class="record-icon" aria-hidden="true">{}</span> 查看检测记录</div>
    ${report.status === 'inconclusive' ? '<div class="action retry"><span aria-hidden="true">↻</span> 重新检测</div>' : ''}
    <footer>示例数据 · 未发起检测 / Sample data · No model requests</footer>
  </article>`;
}).join('\n');

const template = await readFile(new URL('./template.html', import.meta.url), 'utf8');
assert.equal(template.split('<!-- RESULTS -->').length, 2);
await writeFile(new URL('./gallery.html', import.meta.url), template.replace('<!-- RESULTS -->', sections));
console.log('Built five simulated results using the production presentation and decision rules. No model requests.');
