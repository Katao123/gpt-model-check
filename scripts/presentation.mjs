import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decisionDetails } from './fingerprint.mjs';
import { STAR_MESSAGE } from './community.mjs';

export const STATES = Object.freeze({
  match: { alt: '指纹匹配：对上啦！', title: '✅ 对上啦！这次指纹检测通过。', detail: '本次检测未发现被路由到其他模型的迹象。' },
  mismatch: { alt: '指纹明显不符：有点不对劲', title: '⚠️ 有点不对劲，模型指纹没对上。', detail: '本次指纹更接近另一候选模型，建议复测核对。' },
  inconclusive: { alt: '证据不足：还得再看看', title: '🔎 这次还看不准，先别急着下结论。', detail: '证据不足，暂时无法判断是否发生模型切换。' },
  unsupported: { alt: '模型不支持：这个还不认识', title: '🧩 这个模型暂时还认不出来。', detail: '当前版本暂不支持检测所选模型，未发送探针。' },
  error: { alt: '执行失败：这次没测成', title: '🔧 这次没测成。', detail: '请根据失败原因处理后再试。' },
});
const validNumber = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const count = n => validNumber(n) ? Math.round(n).toLocaleString('en-US') : '未返回';
const inline = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>!]/g, '\\$&');
const target = file => String(file).replaceAll('\\', '/').replaceAll('<', '%3C').replaceAll('>', '%3E');

function decisionFor(report) {
  return report.decision || decisionDetails(report.analysis, report.source?.model,
    report.validSamples ?? report.analysis?.used_outputs, report.gates);
}

function inconclusiveDetail(report, decision) {
  if (report.error) return report.error.code === 'SOURCE_CHANGED'
    ? '检测期间所选模型发生了变化，请按现在的选择重新检测。' : STATES.inconclusive.detail;
  if (decision.status !== 'inconclusive') return STATES.inconclusive.detail;
  switch (decision.reason) {
    case 'INSUFFICIENT_SAMPLES': {
      if (!validNumber(decision.validSamples)) return STATES.inconclusive.detail;
      const rejected = Array.isArray(report.rejected) ? report.rejected : [];
      const timeouts = rejected.filter(s => s.reason === 'PROBE_TIMEOUT').length;
      const top = report.analysis?.results?.[0]?.model;
      return `${timeouts ? `有 ${timeouts} 组请求超时，` : ''}本次只有 ${decision.validSamples}/${decision.requiredSamples} 组有效样本。${top ? `已取得的样本偏向 ${inline(top)}，但样本不完整，暂时不能判定。` : '需要取得完整样本后再判定。'}`;
    }
    case 'LOW_WEIGHT':
      return `${inline(decision.topModel)} 为 ${formatWeight(decision.relativeWeight)}，第二名 ${inline(decision.runnerUp)} 为 ${formatWeight(decision.runnerUpWeight)}；第一名尚未达到当前 ${formatWeight(decision.minRelativeWeight)} 的权重门槛，暂时无法明确区分。`;
    case 'LOW_MARGIN': {
      const threshold = decision.minScoreGap.toFixed(3);
      const roundedGap = decision.scoreGap.toFixed(3);
      const gap = decision.scoreGap < decision.minScoreGap && Number(roundedGap) >= Number(threshold)
        ? `不足 ${threshold}` : roundedGap;
      return `${inline(decision.topModel)} 排名第一，第二名是 ${inline(decision.runnerUp)}。本次领先 ${gap} 分，当前规则要求至少领先 ${threshold} 分，因此暂不能确认匹配。`;
    }
    case 'WEAK_MISMATCH':
      return '最接近的候选与所选模型不同，但证据尚不足以判定指纹不符。';
    default: return STATES.inconclusive.detail;
  }
}

// ModelTrace softmax is a relative weight inside its closed candidate bank.
// Never label this as a verified identity probability or round it to 100%.
export function formatWeight(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  if (value > 0.999) return '>99.9%';
  if (value > 0 && value < 0.001) return '<0.1%';
  return `${Number((value * 100).toFixed(1))}%`;
}

export function usageFor(report) {
  if (report.usage && (validNumber(report.usage.input) || validNumber(report.usage.output))) {
    return { input: report.usage.input, output: report.usage.output, samples: report.usage.samples };
  }
  // Compatibility with early saved receipts that only recorded per-probe usage.
  const items = (Array.isArray(report.samples) ? report.samples : []).filter(s => validNumber(s?.usage?.input) && validNumber(s?.usage?.output));
  if (items.length) return {
    input: items.reduce((sum, s) => sum + s.usage.input, 0),
    output: items.reduce((sum, s) => sum + s.usage.output, 0), samples: items.length,
  };
  if (report.status === 'unsupported' && Array.isArray(report.samples) && report.samples.length === 0)
    return { input: 0, output: 0, samples: 0 };
  return { input: null, output: null, samples: null };
}

export function presentationFor(report) {
  const status = Object.hasOwn(STATES, report.status) ? report.status : 'error';
  const state = STATES[status];
  const imagePath = fileURLToPath(new URL(`../assets/states/${status}.png`, import.meta.url));
  const imageMarkdown = existsSync(imagePath) ? `![${state.alt}](<${target(imagePath)}>)` : null;
  // Use the top candidate's actual weight; don't infer it from the selected model.
  const scored = ['match', 'mismatch', 'inconclusive'].includes(status);
  const top = scored ? report.analysis?.results?.[0] : null;
  const decision = status === 'inconclusive' ? decisionFor(report) : null;
  // Don't place a near-100% ranking beside an incomplete/ambiguous verdict.
  // LOW_WEIGHT uses the same percentage scale for both ranking and its gate.
  // LOW_MARGIN explains its actual score threshold, without a second % scale.
  // All original statistics stay intact in the saved analysis/decision.
  const showWeight = status !== 'inconclusive' || (!report.error && decision?.reason === 'LOW_WEIGHT');
  const weight = showWeight ? formatWeight(top?.probability) : null;
  const hasActions = status === 'inconclusive' && /desktop/i.test(report.source?.originator || '') && typeof report.retryArtifact === 'string';
  const actionsMarkdown = hasActions
    ? `visualize${JSON.stringify({ path: report.retryArtifact.replaceAll('\\', '/') })}` : null;
  const retryMarkdown = status !== 'inconclusive' ? null
    : actionsMarkdown || '建议重新检测一次，可发送「重新检测」。';
  const receiptInActions = false;
  return { status, ...state, detail: status === 'inconclusive' ? inconclusiveDetail(report, decision) : state.detail,
    imagePath, imageMarkdown, actionsMarkdown, retryMarkdown, receiptInActions,
    starMarkdown: !report.replay && scored && report.community?.showStar === true ? STAR_MESSAGE : null,
    candidate: top?.model || (scored ? report.analysis?.prediction : null) || null,
    relativeWeight: weight, weightMeaning: '库内匹配权重', usage: usageFor(report) };
}

export function resultMarkdown(report) {
  const view = presentationFor(report);
  const rows = [];
  if (report.replay) rows.push('**历史检测结果回放 · 未发起新的模型请求**');
  if (view.imageMarkdown) rows.push(view.imageMarkdown);
  rows.push(`**${view.title}**`, view.detail);
  const facts = [];
  if (report.source?.model) facts.push(`所选模型：**${inline(report.source.model)}**${report.source.effort ? `（${inline(report.source.effort)}）` : ''}`);
  if (view.candidate) facts.push(`最接近指纹：**${inline(view.candidate)}**${view.relativeWeight ? ` · 库内匹配权重 **${view.relativeWeight}**` : ''}`);
  if (facts.length) rows.push(facts.join('  \n'));
  const valid = report.validSamples ?? report.analysis?.used_outputs;
  // elapsedMs measures this script, not the complete Codex turn displayed by the UI.
  // Keep it in the receipt, but don't show a second, conflicting duration.
  rows.push(`${validNumber(valid) ? `有效样本 ${valid}/3  \n` : ''}输入 Token **${count(view.usage.input)}** · 输出 Token **${count(view.usage.output)}**${validNumber(view.usage.samples) && view.usage.samples > 0 && view.usage.samples < 3 ? `（仅 ${view.usage.samples}/3 组返回用量）` : ''}`);
  const error = report.error || (report.status === 'error' && Array.isArray(report.samples) ? report.samples.find(s => s?.error)?.error : null);
  if (error?.message) rows.push(`原因：${inline(error.message)}`);
  if (typeof report.receipt === 'string' && (path.isAbsolute(report.receipt) || /^[A-Za-z]:[\\/]/.test(report.receipt)))
    rows.push(`[查看检测记录](<${target(report.receipt)}>)`);
  if (view.actionsMarkdown || view.retryMarkdown) rows.push(view.actionsMarkdown || view.retryMarkdown);
  if (view.starMarkdown) rows.push(view.starMarkdown);
  return rows.join('\n\n');
}
