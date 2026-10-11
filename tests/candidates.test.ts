import {createMemoryRepository} from '@/lib/memory-repository';
import {TemplateService} from '@/lib/templates';
import {
  CandidateService,
  classifyMatches,
  defaultChecklist,
  portalUrlFor,
  searchCandidates,
} from '@/lib/candidates';
import {sequentialIdGenerator, fixedClock} from '@/lib/ids';
import type {Repository} from '@/lib/repository';
import type {Candidate, Template, TemplateTask} from '@/lib/types';

const candidates: Candidate[] = [
  {
    id: 'cand_1',
    name: 'Nora Alvarez',
    title: 'Senior Software Engineer',
    roleName: 'Software Engineer',
    hiringManagerId: 'u_mgr',
    resumeFile: 'nora.pdf',
    startDate: '2026-03-02',
    status: 'new',
    hireId: null,
  },
  {
    id: 'cand_2',
    name: 'Marcus Lee',
    title: 'Product Designer',
    roleName: 'Designer',
    hiringManagerId: 'u_mgr',
    resumeFile: 'marcus.pdf',
    startDate: null,
    status: 'new',
    hireId: null,
  },
  {
    id: 'cand_3',
    name: 'Nora Patel',
    title: 'Ops Lead',
    roleName: null,
    hiringManagerId: null,
    resumeFile: null,
    startDate: null,
    status: 'new',
    hireId: null,
  },
];

describe('searchCandidates', () => {
  it('matches case-insensitively, best match first', () => {
    expect(searchCandidates(candidates, 'nora alvarez')[0]?.id).toBe('cand_1');
    expect(searchCandidates(candidates, 'MARCUS').map((c) => c.id)).toEqual([
      'cand_2',
    ]);
  });

  it('returns multiple matches on a shared first name', () => {
    const ids = searchCandidates(candidates, 'nora').map((c) => c.id);
    expect(ids).toContain('cand_1');
    expect(ids).toContain('cand_3');
  });

  it('returns everything for a blank query and nothing unrelated', () => {
    expect(searchCandidates(candidates, '   ')).toHaveLength(3);
    expect(searchCandidates(candidates, 'zzzzzz')).toHaveLength(0);
  });

  it('tolerates misspellings (fuzzy)', () => {
    expect(searchCandidates(candidates, 'nora alverez')[0]?.id).toBe('cand_1');
    expect(searchCandidates(candidates, 'marcas lee')[0]?.id).toBe('cand_2');
  });
});

describe('classifyMatches', () => {
  it('is confident on a clear full-name match', () => {
    const r = classifyMatches(candidates, 'Marcus Lee');
    expect(r.confidence).toBe('confident');
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]?.candidate.id).toBe('cand_2');
  });

  it('stays confident through a small typo in a unique name', () => {
    const r = classifyMatches(candidates, 'Marcas Lee');
    expect(r.confidence).toBe('confident');
    expect(r.matches[0]?.candidate.id).toBe('cand_2');
  });

  it('is ambiguous on a shared first name and offers options', () => {
    const r = classifyMatches(candidates, 'Nora');
    expect(r.confidence).toBe('ambiguous');
    expect(r.matches.length).toBeGreaterThan(1);
    expect(r.matches.map((m) => m.candidate.id)).toEqual(
      expect.arrayContaining(['cand_1', 'cand_3']),
    );
  });

  it('is none when nothing is close', () => {
    expect(classifyMatches(candidates, 'Zalathar').confidence).toBe('none');
  });
});

describe('defaultChecklist', () => {
  it('covers all three categories and tailors tools to the role', () => {
    const eng = defaultChecklist({
      name: 'Nora Alvarez',
      title: 'SWE',
      roleName: 'Software Engineer',
    });
    const cats = new Set(eng.map((i) => i.category));
    expect(cats).toEqual(
      new Set(['day_1_essentials', 'role_tool_access', '30_day_milestones']),
    );
    expect(eng.some((i) => /GitHub/.test(i.title))).toBe(true);

    const design = defaultChecklist({
      name: 'Marcus Lee',
      title: 'Product Designer',
      roleName: 'Designer',
    });
    expect(design.some((i) => /Figma/.test(i.title))).toBe(true);
    expect(design.some((i) => /GitHub/.test(i.title))).toBe(false);
  });
});

async function seedForPublish(): Promise<Repository> {
  const repo = createMemoryRepository();
  const templates: Template[] = [
    {id: 'tpl_swe', roleName: 'Software Engineer'},
  ];
  const templateTasks: TemplateTask[] = [
    {
      id: 'tt1',
      templateId: 'tpl_swe',
      title: 'Create email + SSO',
      ownerTeam: 'it',
      cost: 0,
      costType: 'none',
      appId: null,
    },
    {
      id: 'tt2',
      templateId: 'tpl_swe',
      title: 'Order laptop',
      ownerTeam: 'vendor',
      cost: 2800,
      costType: 'one_time',
      appId: null,
    },
  ];
  for (const t of templates) await repo.templates.insert(t);
  for (const t of templateTasks) await repo.templateTasks.insert(t);
  await repo.candidates.insert(candidates[0]!);
  return repo;
}

describe('CandidateService.publishPlan', () => {
  it('creates a hire with tasks + seats and links the candidate', async () => {
    const repo = await seedForPublish();
    const clock = fixedClock('2026-03-01T00:00:00.000Z');
    const svc = new CandidateService(
      repo,
      new TemplateService(repo, {
        idGenerator: sequentialIdGenerator('tt'),
        clock,
      }),
      {idGenerator: sequentialIdGenerator('hire'), clock},
    );

    const result = await svc.publishPlan({
      candidateId: 'cand_1',
      appIds: ['github'],
    });

    expect(result.hire.name).toBe('Nora Alvarez');
    expect(result.hire.roleName).toBe('Software Engineer');
    expect(result.tasks).toHaveLength(2);
    expect(result.licenses).toHaveLength(1);
    expect(result.portalUrl).toBe(portalUrlFor(result.hire.id));

    const candidate = await repo.candidates.get('cand_1');
    expect(candidate?.status).toBe('onboarding');
    expect(candidate?.hireId).toBe(result.hire.id);
  });

  it('is idempotent: re-publishing returns the same hire without duplicating', async () => {
    const repo = await seedForPublish();
    const svc = new CandidateService(repo, new TemplateService(repo));
    const first = await svc.publishPlan({candidateId: 'cand_1'});
    const second = await svc.publishPlan({candidateId: 'cand_1'});
    expect(second.hire.id).toBe(first.hire.id);
    expect(await repo.hires.list()).toHaveLength(1);
  });

  it('refuses to publish a candidate with no role and none supplied', async () => {
    const repo = await seedForPublish();
    await repo.candidates.insert(candidates[2]!); // Nora Patel, roleName null
    const svc = new CandidateService(repo, new TemplateService(repo));
    await expect(svc.publishPlan({candidateId: 'cand_3'})).rejects.toThrow(
      /role/i,
    );
  });
});
