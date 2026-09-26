import { assessRelease } from './release';
import type { ChecklistItem, ChecklistProject, ValidationIssue } from './types';

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

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
    const releaseAssessment = item.release ? assessRelease(project.stages, item) : null;
    if (!item.response.trim()) {
      if (releaseAssessment?.valid) {
        add({
          id: `${item.id}-release-cover`,
          type: 'release',
          level: 'info',
          stageId: item.stageId,
          itemId: item.id,
          title: '关键项临时放行中',
          detail: `${item.challenge || '未命名检查项'} 暂缓核查：责任人 ${releaseAssessment.release.responsible.trim()}，恢复阶段 ${releaseAssessment.recoveryStage?.name ?? '未知'}。冻结前放行失效（过期或责任人被清除）将重新阻断。`
        });
      } else {
        add({ id: `${item.id}-missing-response`, type: 'missing-response', level: 'error', stageId: item.stageId, itemId: item.id, title: '缺少预期回应', detail: `${item.challenge || '未命名检查项'} 没有填写机组应确认的回应。` });
      }
    }
    if (item.release && releaseAssessment) {
      if (!item.critical) {
        add({ id: `${item.id}-release-not-critical`, type: 'release', level: 'error', stageId: item.stageId, itemId: item.id, title: '普通检查项不能临时放行', detail: '仅关键检查项可以登记临时放行，请取消放行或将该检查项标记为关键项。' });
      }
      if (!releaseAssessment.hasResponsible) {
        add({ id: `${item.id}-release-responsible`, type: 'release', level: 'error', stageId: item.stageId, itemId: item.id, title: '临时放行缺少责任人', detail: '责任人被清除后放行失效，缺少预期回应的检查项将重新阻断提交与冻结。' });
      }
      if (releaseAssessment.stageMissing) {
        add({ id: `${item.id}-release-stage-missing`, type: 'release', level: 'error', stageId: item.stageId, itemId: item.id, title: '放行恢复阶段已删除', detail: '恢复阶段不存在，放行已过期，请重新指定恢复阶段或取消放行。' });
      } else if (releaseAssessment.expired) {
        add({ id: `${item.id}-release-expired`, type: 'release', level: 'error', stageId: item.stageId, itemId: item.id, title: '临时放行已过期', detail: `检查项已到达恢复阶段（${releaseAssessment.recoveryStage?.name ?? '未知'}），冻结前必须恢复核查或更新放行。` });
      }
      if (releaseAssessment.stale) {
        add({ id: `${item.id}-release-stale`, type: 'release', level: 'warning', stageId: item.stageId, itemId: item.id, title: '放行后检查项内容已修改', detail: '该放行不会随新修订携带；如需延续放行，请在检查项详情中按当前内容重新确认。' });
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
