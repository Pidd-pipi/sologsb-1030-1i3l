import { deferralRecoverStageName, inspectDeferral, isDeferralActive } from './deferral';
import type { DeferralProblem } from './deferral';
import type { ChecklistItem, ChecklistProject, ValidationIssue } from './types';

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

const deferralProblemCopy: Record<DeferralProblem, { title: string; detail: string }> = {
  'not-critical': { title: '普通检查项不能使用放行', detail: '临时放行仅适用于关键检查项，请移除放行或恢复关键标记。' },
  'no-owner': { title: '临时放行缺少责任人', detail: '责任人被清除后放行立即失效，缺少预期回应会重新阻断提交复核与冻结。' },
  'stage-missing': { title: '临时放行已过期', detail: '恢复阶段未设置或已被删除，放行失效，请补做检查项或重新选择恢复阶段。' },
  'stage-passed': { title: '临时放行已过期', detail: '恢复阶段已到达或排在检查项所在阶段之前，放行失效，请补做检查项后再发布。' }
};

export function validateProject(project: ChecklistProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stageById = new Map(project.stages.map((stage) => [stage.id, stage]));
  const itemById = new Map(project.items.map((item) => [item.id, item]));

  const add = (issue: ValidationIssue) => issues.push(issue);

  const challenges = new Map<string, ChecklistItem[]>();
  const responses = new Map<string, ChecklistItem[]>();
  project.items.forEach((item) => {
    if (normalize(item.challenge)) challenges.set(normalize(item.challenge), [...(challenges.get(normalize(item.challenge)) ?? []), item]);
    if (normalize(item.response)) responses.set(normalize(item.response), [...(responses.get(normalize(item.response)) ?? []), item]);
    if (!item.challenge.trim()) {
      add({ id: `${item.id}-empty-challenge`, type: 'missing-response', level: 'error', stageId: item.stageId, itemId: item.id, title: '检查项缺少挑战语', detail: '每项必须有可供机组读取的挑战语。' });
    }
    if (!item.response.trim()) {
      if (isDeferralActive(item, project.stages)) {
        add({
          id: `${item.id}-deferred-response`,
          type: 'deferral',
          level: 'info',
          stageId: item.stageId,
          itemId: item.id,
          title: '关键项临时放行生效中',
          detail: `责任人 ${item.deferral?.owner.trim()}，须在「${deferralRecoverStageName(item, project.stages)}」阶段前恢复；冻结前放行必须保持有效。`
        });
      } else {
        add({ id: `${item.id}-missing-response`, type: 'missing-response', level: 'error', stageId: item.stageId, itemId: item.id, title: '缺少预期回应', detail: `${item.challenge || '未命名检查项'} 没有填写机组应确认的回应；关键检查项可在责任人与恢复阶段齐备时临时放行。` });
      }
    }
    if (item.deferral) {
      const { valid, problem } = inspectDeferral(item, project.stages);
      if (!valid && problem) {
        const copy = deferralProblemCopy[problem];
        add({ id: `${item.id}-deferral-${problem}`, type: 'deferral', level: 'error', stageId: item.stageId, itemId: item.id, title: copy.title, detail: copy.detail });
      }
    }
    item.preconditionIds.forEach((preconditionId) => {
      if (preconditionId === item.id) {
        add({ id: `${item.id}-self-precondition`, type: 'unreachable-precondition', level: 'error', stageId: item.stageId, itemId: item.id, title: '前置条件形成自引用', detail: '检查项不能依赖自身。' });
        return;
      }
      const precondition = itemById.get(preconditionId);
      if (!precondition) {
        add({ id: `${item.id}-${preconditionId}-missing`, type: 'unreachable-precondition', level: 'error', stageId: item.stageId, itemId: item.id, title: '前置条件已不存在', detail: `${item.challenge} 引用了已删除的检查项。` });
        return;
      }
      const currentStage = stageById.get(item.stageId);
      const preconditionStage = stageById.get(precondition.stageId);
      if (!currentStage || !preconditionStage) return;
      const unreachable = preconditionStage.order > currentStage.order
        || (preconditionStage.order === currentStage.order && precondition.order > item.order);
      if (unreachable) {
        add({ id: `${item.id}-${preconditionId}-unreachable`, type: 'unreachable-precondition', level: 'error', stageId: item.stageId, itemId: item.id, title: '前置条件不可达', detail: `${precondition.challenge} 排在当前检查项之后，正常执行时无法先满足。` });
      }
    });
  });

  for (const [challenge, entries] of challenges) {
    if (challenge && entries.length > 1) {
      add({ id: `duplicate-challenge-${challenge}`, type: 'duplicate', level: 'warning', stageId: entries[0].stageId, itemId: entries[0].id, title: '挑战语重复', detail: `“${entries[0].challenge}”在检查单中出现 ${entries.length} 次。` });
    }
  }
  for (const [response, entries] of responses) {
    if (response && entries.length > 4) {
      add({ id: `duplicate-response-${response}`, type: 'duplicate', level: 'info', stageId: entries[0].stageId, itemId: entries[0].id, title: '回应高度重复', detail: `“${entries[0].response}”出现 ${entries.length} 次，请确认是否为通用回应。` });
    }
  }

  const canonical = ['飞行前检查', '发动机启动', '滑行', '起飞', '爬升', '进近', '着陆'];
  const positions = project.stages.map((stage) => ({ stage, canonical: canonical.indexOf(stage.name) })).filter((item) => item.canonical >= 0);
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index - 1].canonical > positions[index].canonical) {
      add({
        id: `stage-order-${positions[index - 1].stage.id}`,
        type: 'stage-order',
        level: 'warning',
        stageId: positions[index].stage.id,
        title: '飞行阶段顺序异常',
        detail: `${positions[index - 1].stage.name} 排在 ${positions[index].stage.name} 之后，请确认是否符合该机型流程。`
      });
    }
  }

  project.stages.forEach((stage) => {
    if (!project.items.some((item) => item.stageId === stage.id)) {
      add({ id: `${stage.id}-empty`, type: 'orphan-stage', level: 'info', stageId: stage.id, title: '阶段尚未配置检查项', detail: `${stage.name} 当前为空。` });
    }
  });

  return issues;
}
