/**
 * Strands-backed AiClient.
 *
 * Broadens the Strands Agents SDK beyond the Genie: the two product AI calls —
 * template matching (offer letter/title -> template + stack + cost) and brief
 * drafting (granted tools -> welcome blurbs) — run through a small Strands
 * `Agent` instead of the deterministic `MockAiClient`.
 *
 * Why an agent and not a bare completion: the matcher is grounded in the real
 * app catalog via a `lookupAppCatalog` tool, so the model can only ever suggest
 * seats that actually exist (and price them from live cost-per-seat data)
 * rather than hallucinate app ids. That's the same "tools bind the model to the
 * real data model" discipline the Genie uses.
 *
 * Model: Amazon Bedrock (Strands' default provider). This client is only
 * constructed when Bedrock creds are present (see `store.ts`); with no creds
 * the app uses `MockAiClient`, so the demo and tests still run offline.
 *
 * Each call rebuilds a fresh single-purpose agent and asks for a strict JSON
 * reply, which we parse and validate. Any model/parse failure throws, and the
 * callers (routes + the Genie's brief step) already treat the AI output as a
 * bonus or fall back, so a hiccup never dead-ends a flow.
 */

import {Agent, tool} from '@strands-agents/sdk';
import {z} from 'zod';
import type {AiClient, BriefBlurb, TemplateMatch} from './ai';
import type {AppCatalogItem} from './types';
import type {Repository} from './repository';

/** Default Bedrock model id (shared default with the Genie). */
const MODEL_ID =
  process.env.GENIE_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6';

const MATCH_SYSTEM_PROMPT = `You are a staffing assistant that maps a job title (and optional offer-letter text) to a standard onboarding template and software stack.

RULES
- Call lookupAppCatalog first to see the only app ids you are allowed to suggest. Never invent an app id — use only ids returned by that tool.
- Choose a concise roleName template, e.g. "Software Engineer", "Designer", "Operations", or "Team Member" when nothing fits.
- Pick the smallest sensible stack for the role from the catalog.
- Estimate monthly cost by summing the monthly-equivalent cost of the seats you chose (annual billing divided by 12), using the catalog costs.
- Reply with ONLY a JSON object, no prose, no code fences:
  {"roleName": string, "suggestedAppIds": string[], "estimatedMonthlyCost": number, "confidence": number between 0 and 1}`;

const BRIEF_SYSTEM_PROMPT = `You write short, warm welcome blurbs for a new hire's access brief — one per tool they've been granted.

RULES
- One blurb per tool name provided, in the same order.
- Keep each body to one or two friendly sentences telling the hire they have access and how to get started.
- Reply with ONLY a JSON array, no prose, no code fences:
  [{"appId": string, "heading": string, "body": string}]
  Use a lowercased, hyphenated version of the tool name as appId (e.g. "Google Workspace" -> "google-workspace").`;

const templateMatchSchema = z.object({
  roleName: z.string(),
  suggestedAppIds: z.array(z.string()),
  estimatedMonthlyCost: z.number(),
  confidence: z.number(),
});

const briefBlurbsSchema = z.array(
  z.object({
    appId: z.string(),
    heading: z.string(),
    body: z.string(),
  }),
);

export class StrandsAiClient implements AiClient {
  constructor(private readonly repo: Repository) {}

  async matchTemplate(input: {
    title: string;
    offerText?: string;
  }): Promise<TemplateMatch> {
    const lookupAppCatalog = tool({
      name: 'lookupAppCatalog',
      description:
        'Return the software catalog: the only app ids that may be suggested, each with name, category, cost per seat, and billing period (monthly/annual). Call this before choosing a stack.',
      inputSchema: z.object({}),
      callback: async () => {
        const apps = await this.repo.appCatalog.list();
        return {
          apps: apps.map((a: AppCatalogItem) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            costPerSeat: a.costPerSeat,
            billing: a.billing,
          })),
        };
      },
    });

    const agent = new Agent({
      model: MODEL_ID,
      systemPrompt: MATCH_SYSTEM_PROMPT,
      tools: [lookupAppCatalog],
    });

    const prompt = input.offerText
      ? `Title: ${input.title}\n\nOffer letter / notes:\n${input.offerText}`
      : `Title: ${input.title}`;

    const result = await agent.invoke([
      {role: 'user', content: [{text: prompt}]},
    ]);
    const parsed = templateMatchSchema.parse(
      parseJson(extractText(result.lastMessage)),
    );

    // Guard against stray ids: keep only app ids that exist in the catalog.
    const apps = await this.repo.appCatalog.list();
    const valid = new Set(apps.map((a) => a.id));
    const suggestedAppIds = parsed.suggestedAppIds.filter((id) =>
      valid.has(id),
    );

    return {
      roleName: parsed.roleName,
      suggestedAppIds,
      estimatedMonthlyCost: Math.round(parsed.estimatedMonthlyCost),
      confidence: clamp01(parsed.confidence),
    };
  }

  async draftBrief(input: {
    hireName: string;
    appNames: string[];
  }): Promise<BriefBlurb[]> {
    if (input.appNames.length === 0) return [];

    const agent = new Agent({
      model: MODEL_ID,
      systemPrompt: BRIEF_SYSTEM_PROMPT,
    });

    const prompt = [
      `Hire: ${input.hireName}`,
      `Tools granted (in order): ${input.appNames.join(', ')}`,
    ].join('\n');

    const result = await agent.invoke([
      {role: 'user', content: [{text: prompt}]},
    ]);
    return briefBlurbsSchema.parse(parseJson(extractText(result.lastMessage)));
  }
}

/** Pull the concatenated text blocks out of a Strands last message. */
function extractText(message: unknown): string {
  const content = (message as {content?: Array<{text?: string}>})?.content;
  if (Array.isArray(content)) {
    const text = content
      .map((b) => (typeof b?.text === 'string' ? b.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  if (typeof message === 'string') return message;
  return '';
}

/** Parse a JSON reply, tolerating a ```json code fence if the model adds one. */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text)!.trim();
  return JSON.parse(raw);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
