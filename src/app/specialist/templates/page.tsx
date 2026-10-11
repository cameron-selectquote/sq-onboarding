import {getServices} from '@/server/store';
import type {TemplateWithTasks} from '@/lib/templates';
import type {AppCatalogItem, TemplateTask} from '@/lib/types';
import {PageHead, Shell} from '../../_components/Shell';
import {
  AddTemplateTaskForm,
  CreateTemplateForm,
  RemoveTemplateTaskButton,
} from '../../_components/actions';
import {costLabel, teamTag, teamLabel} from '../../_components/format';

export const dynamic = 'force-dynamic';

/**
 * Template editor (Specialist): list every role template, see its tasks, and
 * add templates / tasks. Each row shows owner team, cost, and whether the task
 * grants a software seat — the fields that drive onboarding instantiation.
 */
export default async function TemplatesPage() {
  const {templates: templateService, repo} = await getServices();
  const [templates, apps] = await Promise.all([
    templateService.listWithTasks(),
    repo.appCatalog.list(),
  ]);

  const appName = new Map(apps.map((a) => [a.id, a.name]));
  const totalTasks = templates.reduce((n, t) => n + t.tasks.length, 0);

  return (
    <Shell active='/specialist/templates'>
      <PageHead
        eyebrow={`${templates.length} templates · ${totalTasks} tasks`}
        title='Role templates'
      />
      <div className='panel'>
        <CreateTemplateForm />
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 20}}>
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            apps={apps}
            appName={appName}
          />
        ))}
        {templates.length === 0 && (
          <span className='empty'>No templates yet. Add one above.</span>
        )}
      </div>
    </Shell>
  );
}

function TemplateCard({
  template,
  apps,
  appName,
}: {
  template: TemplateWithTasks;
  apps: AppCatalogItem[];
  appName: Map<string, string>;
}) {
  return (
    <section className='panel' style={{gap: 12}}>
      <div className='head-text'>
        <span className='eyebrow'>
          {template.tasks.length} task{template.tasks.length === 1 ? '' : 's'}
        </span>
        <h2 className='title' style={{fontSize: 20}}>
          {template.roleName}
        </h2>
      </div>

      <div className='panel' style={{gap: 0, padding: 0}}>
        <div className='row row-tpl is-head' role='row'>
          <span>Task</span>
          <span>Owner</span>
          <span>Cost</span>
          <span>Grants seat</span>
          <span />
        </div>
        {template.tasks.map((task) => (
          <TaskRow
            key={task.id}
            templateId={template.id}
            task={task}
            appName={appName}
          />
        ))}
        {template.tasks.length === 0 && (
          <div className='row row-tpl'>
            <span className='muted'>No tasks on this template yet.</span>
          </div>
        )}
      </div>

      <AddTemplateTaskForm
        templateId={template.id}
        apps={apps.map((a) => ({id: a.id, name: a.name}))}
      />
    </section>
  );
}

function TaskRow({
  templateId,
  task,
  appName,
}: {
  templateId: string;
  task: TemplateTask;
  appName: Map<string, string>;
}) {
  return (
    <div
      className='row row-tpl'
      style={{borderTop: '1px solid var(--color-divider)'}}
    >
      <span style={{fontWeight: 500}}>{task.title}</span>
      <span>
        <span className={teamTag(task.ownerTeam)}>
          {teamLabel(task.ownerTeam)}
        </span>
      </span>
      <span>{costLabel(task.cost, task.costType)}</span>
      <span>
        {task.appId ? (
          <span className='pill pill-progress'>
            {appName.get(task.appId) ?? task.appId}
          </span>
        ) : (
          <span className='muted'>—</span>
        )}
      </span>
      <span style={{textAlign: 'right'}}>
        <RemoveTemplateTaskButton templateId={templateId} taskId={task.id} />
      </span>
    </div>
  );
}
