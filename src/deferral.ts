import type { ChecklistItem, FlightStage } from './types';

/**
 * 放行建立时检查项内容的指纹。新建修订时只有内容指纹未变化的放行才允许继续沿用。
 */
export function deferralContentHash(item: ChecklistItem): string {
  return JSON.stringify({
    challenge: item.challenge.trim(),
    response: item.response.trim(),
    critical: item.critical,
    abnormalProcedure: item.abnormalProcedure.trim(),
    preconditionIds: [...item.preconditionIds].sort()
  });
}

export type DeferralProblem = 'not-critical' | 'no-owner' | 'stage-missing' | 'stage-passed';

/**
 * 判断放行当前是否仍然有效：
 * - 仅关键检查项可以持有放行；
 * - 责任人被清除立即失效；
 * - 恢复阶段被删除（过期）或已到达 / 早于检查项所在阶段（过期）即失效。
 */
export function inspectDeferral(
  item: ChecklistItem,
  stages: FlightStage[]
): { valid: boolean; problem: DeferralProblem | null } {
  if (!item.deferral) return { valid: false, problem: null };
  if (!item.critical) return { valid: false, problem: 'not-critical' };
  if (!item.deferral.owner.trim()) return { valid: false, problem: 'no-owner' };
  const itemStage = stages.find((stage) => stage.id === item.stageId);
  const recoverStage = stages.find((stage) => stage.id === item.deferral?.recoverByStageId);
  if (!recoverStage) return { valid: false, problem: 'stage-missing' };
  if (!itemStage || recoverStage.order <= itemStage.order) return { valid: false, problem: 'stage-passed' };
  return { valid: true, problem: null };
}

export function isDeferralActive(item: ChecklistItem, stages: FlightStage[]): boolean {
  return inspectDeferral(item, stages).valid;
}

export function deferralRecoverStageName(item: ChecklistItem, stages: FlightStage[]): string {
  if (!item.deferral) return '';
  return stages.find((stage) => stage.id === item.deferral?.recoverByStageId)?.name ?? '未指定阶段';
}

export function deferralSummary(item: ChecklistItem, stages: FlightStage[]): string {
  if (!item.deferral) return '';
  return `临时放行 · 责任人 ${item.deferral.owner.trim() || '未填写'} · 恢复阶段 ${deferralRecoverStageName(item, stages)}`;
}
