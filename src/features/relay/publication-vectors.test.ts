import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PUBLICATION_VECTOR_KIND,
  publicationVectorDocument,
  publicationVectorText,
  replacePublicationKnowledgeIndex,
  searchPublicationKnowledge,
} from '../../../supabase/functions/_shared/publication-vectors';

const config = {
  astraEndpoint: 'https://astra.example.test',
  astraToken: 'token',
  astraKeyspace: 'relay',
  astraCollection: 'documents',
};

afterEach(() => vi.restoreAllMocks());

describe('published Knowledge Item vector records', () => {
  const item = {
    id: 'item-1',
    source_knowledge_item_id: 'knowledge-1',
    knowledge_type: 'warning_lesson',
    title: 'Check AV equipment before RoboFest',
    content: 'Test the projector and microphones before attendees arrive because a prior failure delayed opening.',
  };

  it('embeds the published entry title and content together', () => {
    expect(publicationVectorText(item)).toBe(`${item.title}\n\n${item.content}`);
  });

  it('stores category only as metadata and scopes the vector to one immutable publication', () => {
    const document = publicationVectorDocument({
      publicationId: 'publication-1',
      organizationId: 'organization-1',
      handoffId: 'handoff-1',
      item,
    });

    expect(document).toMatchObject({
      record_kind: PUBLICATION_VECTOR_KIND,
      publication_id: 'publication-1',
      publication_item_id: 'item-1',
      knowledge_type: 'warning_lesson',
      $vectorize: `${item.title}\n\n${item.content}`,
    });
  });

  it('replaces only the selected publication vector records', async () => {
    const requestBodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ status: { insertedIds: ['item-1'] } }), { status: 200 });
    });

    await replacePublicationKnowledgeIndex({
      config,
      publicationId: 'publication-1',
      organizationId: 'organization-1',
      handoffId: 'handoff-1',
      items: [item],
    });

    expect(requestBodies[0]).toEqual({
      deleteMany: { filter: { record_kind: PUBLICATION_VECTOR_KIND, publication_id: 'publication-1' } },
    });
    expect(requestBodies[1]).toMatchObject({
      insertMany: { documents: [{ publication_id: 'publication-1', publication_item_id: 'item-1' }] },
    });
  });

  it('searches vectors only inside the requested publication and across every category', async () => {
    let requestBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        data: { documents: [{ publication_item_id: 'item-1', $similarity: 0.91 }] },
      }), { status: 200 });
    });

    await expect(searchPublicationKnowledge({
      config,
      publicationId: 'publication-1',
      question: 'How do I check the event equipment?',
      limit: 24,
    })).resolves.toEqual(['item-1']);
    expect(requestBody.find.filter).toEqual({
      record_kind: PUBLICATION_VECTOR_KIND,
      publication_id: 'publication-1',
    });
    expect(requestBody.find.filter).not.toHaveProperty('knowledge_type');
    expect(requestBody.find.sort).toEqual({ $vectorize: 'How do I check the event equipment?' });
  });
});
