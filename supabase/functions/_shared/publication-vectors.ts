export const PUBLICATION_VECTOR_KIND = 'published_knowledge';
const ASTRA_BATCH_SIZE = 20;

export type AstraPublicationConfig = {
  astraEndpoint: string;
  astraToken: string;
  astraKeyspace: string;
  astraCollection: string;
};

export type PublicationVectorItem = {
  id: string;
  source_knowledge_item_id: string;
  knowledge_type: string;
  title: string;
  content: string;
};

async function astraCommand(config: AstraPublicationConfig, command: Record<string, unknown>) {
  const response = await fetch(
    `${config.astraEndpoint}/api/json/v1/${encodeURIComponent(config.astraKeyspace)}/${encodeURIComponent(config.astraCollection)}`,
    {
      method: 'POST',
      headers: { Token: config.astraToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(body?.errors) && body.errors.length)) {
    throw new Error('Astra publication knowledge request failed.');
  }
  return body;
}

export function publicationVectorText(item: Pick<PublicationVectorItem, 'title' | 'content'>) {
  return `${item.title.trim()}\n\n${item.content.trim()}`;
}

export function publicationVectorDocument({
  publicationId,
  organizationId,
  handoffId,
  item,
}: {
  publicationId: string;
  organizationId: string;
  handoffId: string;
  item: PublicationVectorItem;
}) {
  return {
    _id: `publication:${publicationId}:${item.id}`,
    $vectorize: publicationVectorText(item),
    record_kind: PUBLICATION_VECTOR_KIND,
    publication_id: publicationId,
    publication_item_id: item.id,
    source_knowledge_item_id: item.source_knowledge_item_id,
    organization_id: organizationId,
    handoff_id: handoffId,
    knowledge_type: item.knowledge_type,
    title: item.title,
    content: item.content,
  };
}

export async function replacePublicationKnowledgeIndex({
  config,
  publicationId,
  organizationId,
  handoffId,
  items,
}: {
  config: AstraPublicationConfig;
  publicationId: string;
  organizationId: string;
  handoffId: string;
  items: PublicationVectorItem[];
}) {
  await astraCommand(config, {
    deleteMany: {
      filter: { record_kind: PUBLICATION_VECTOR_KIND, publication_id: publicationId },
    },
  });
  const documents = items.map((item) => publicationVectorDocument({
    publicationId, organizationId, handoffId, item,
  }));
  for (let start = 0; start < documents.length; start += ASTRA_BATCH_SIZE) {
    await astraCommand(config, {
      insertMany: {
        documents: documents.slice(start, start + ASTRA_BATCH_SIZE),
        options: { ordered: true },
      },
    });
  }
  return documents.length;
}

export async function searchPublicationKnowledge({
  config,
  publicationId,
  question,
  limit,
}: {
  config: AstraPublicationConfig;
  publicationId: string;
  question: string;
  limit: number;
}) {
  const result = await astraCommand(config, {
    find: {
      filter: { record_kind: PUBLICATION_VECTOR_KIND, publication_id: publicationId },
      sort: { $vectorize: question },
      projection: { publication_item_id: 1 },
      options: { limit, includeSimilarity: true },
    },
  });
  const documents = Array.isArray(result?.data?.documents) ? result.data.documents : [];
  return documents.flatMap((document: Record<string, unknown>) => (
    typeof document.publication_item_id === 'string' ? [document.publication_item_id] : []
  ));
}
