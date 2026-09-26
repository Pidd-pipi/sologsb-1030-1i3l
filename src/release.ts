import type { ChecklistItem, FlightStage, ItemRelease } from './types';

/** 计算放行登记时检查项内容的指纹；不包含顺序，仅代表检查项本身的内容。 */
export function releaseFingerprint(item: ChecklistItem): string {
  return JSON.stringify({
    stageId: item.stageId,
    challenge: item.challenge.trim(),
    response: item.response.trim(),
    critical: item.critical,
    abnormalProcedure: item.abnormalProcedure.trim(),
    preconditionIds: [...item.preconditionIds].sort()
  });
}

export interface ReleaseAssessment {
  release: ItemRelease;
  recoveryStage?: FlightStage;
  hasResponsible: boolean;
  /** 恢复阶段已被删除。 */
  stageMissing: boolean;
  /** 检查项已到达或越过恢复阶段（恢复阶段被删也视为过期）。 */
  expired: boolean;
  /** 放行登记后检查项内容发生变化，创建新修订时不携带。 */
  stale: boolean;
  /** 可豁免“缺少预期回应”的阻断：关键项 + 有责任人 + 未到恢复阶段。 */
  valid: boolean;
}

export function assessRelease(stages: FlightStage[], item: ChecklistItem): ReleaseAssessment | null {
  const release = item.release;
  if (!release) return null;
  const recoveryStage = stages.find((stage) => stage.id === release.recoveryStageId);
  const itemStage = stages.find((stage) => stage.id === item.stageId);
  const stageMissing = !recoveryStage;
  const expired = stageMissing || (!!itemStage && !!recoveryStage && itemStage.order >= recoveryStage.order);
  const hasResponsible = release.responsible.trim().length > 0;
  const stale = release.fingerprint !== releaseFingerprint(item);
  const valid = item.critical && hasResponsible && !expired;
  return { release, recoveryStage, hasResponsible, stageMissing, expired, stale, valid };
}
