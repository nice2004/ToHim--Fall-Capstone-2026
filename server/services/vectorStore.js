const OpenAI = require('openai');

let pineconeClient = null;
let pineconeIndex = null;

function isEnabled() {
  return !!(
    process.env.USE_VECTOR_SEARCH === 'true' &&
    process.env.OPENAI_API_KEY &&
    process.env.PINECONE_API_KEY &&
    process.env.PINECONE_INDEX
  );
}

async function getPineconeIndex() {
  if (!isEnabled()) {
    throw new Error('Vector search is not enabled. Set USE_VECTOR_SEARCH=true and configure PINECONE_* env vars.');
  }

  if (!pineconeClient) {
    // Lazy-load Pinecone client so the app can still start without the dependency installed
    // User must run: npm install @pinecone-database/pinecone
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { Pinecone } = require('@pinecone-database/pinecone');

    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
  }

  if (!pineconeIndex) {
    pineconeIndex = pineconeClient.index(process.env.PINECONE_INDEX);
  }

  return pineconeIndex;
}

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 60000,
    });
  }
  return openaiClient;
}

async function embedText(text) {
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

function buildPineconeFilter(userId, options = {}) {
  // Ensure numeric type so filter matches upserted metadata (Pinecone is type-strict)
  const filter = { userId: Number(userId) };

  if (options.personId != null) {
    filter.personId = Number(options.personId);
  }

  if (options.personIds && Array.isArray(options.personIds) && options.personIds.length > 0) {
    filter.personId = { $in: options.personIds.map((id) => Number(id)) };
  }

  if (options.dateRange) {
    const { start, end } = options.dateRange;
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = start;
      if (end) filter.date.$lte = end;
    }
  }

  if (options.chunkTypes && options.chunkTypes.length > 0) {
    filter.chunkType = { $in: options.chunkTypes };
  } else if (options.chunkType) {
    filter.chunkType = options.chunkType;
  }

  return filter;
}

function buildChunkId(userId, sessionId, kind, index = 0) {
  if (sessionId) {
    return `u:${userId}:s:${sessionId}:k:${kind}:${index}`;
  }
  return `u:${userId}:k:${kind}:${index}:${Date.now()}`;
}

async function upsertChunks(userId, chunks) {
  if (!isEnabled()) return;
  if (!chunks || chunks.length === 0) return;

  const index = await getPineconeIndex();

  const records = [];
  let counter = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (const chunk of chunks) {
    if (!chunk || !chunk.text || !chunk.text.trim()) continue;

    // eslint-disable-next-line no-await-in-loop
    const embedding = await embedText(chunk.text);

    const indexValue = typeof chunk.localIndex === 'number' ? chunk.localIndex : counter;
    const id = chunk.id || buildChunkId(userId, chunk.sessionId, chunk.chunkType || 'generic', indexValue);
    counter += 1;

    const metadata = {
      userId: Number(userId),
      personId: chunk.personId != null ? Number(chunk.personId) : null,
      sessionId: chunk.sessionId != null ? Number(chunk.sessionId) : null,
      chunkType: chunk.chunkType || 'generic',
      date: chunk.date || null,
      text: chunk.text,
      ...chunk.extraMetadata,
    };

    records.push({
      id,
      values: embedding,
      metadata,
    });
  }

  if (records.length === 0) return;

  try {
    console.log('[VectorStore] Upserting chunks to Pinecone:', {
      userId: Number(userId),
      chunkCount: records.length,
      sample: records[0]?.metadata
        ? {
            personId: records[0].metadata.personId,
            sessionId: records[0].metadata.sessionId,
            chunkType: records[0].metadata.chunkType,
            date: records[0].metadata.date,
          }
        : null,
    });

    await index.upsert({ records });
    console.log('[VectorStore] Upsert complete for userId:', Number(userId), 'chunks:', records.length);
  } catch (err) {
    console.error('[VectorStore] Error upserting chunks to Pinecone:', err.message);
    throw err;
  }
}

async function deleteChunksBySession(userId, sessionId) {
  if (!isEnabled()) return;
  const index = await getPineconeIndex();

  await index.deleteMany({
    filter: {
      userId: Number(userId),
      sessionId: sessionId != null ? Number(sessionId) : null,
    },
  });
}

/** Removes all vector chunks for a user (e.g. account deletion). No-op if vector search is disabled. */
async function deleteChunksByUser(userId) {
  if (!isEnabled()) return;
  const index = await getPineconeIndex();
  await index.deleteMany({
    filter: { userId: Number(userId) },
  });
}

async function search(userId, query, options = {}) {
  if (!isEnabled()) {
    throw new Error('Vector search is not enabled.');
  }

  const index = await getPineconeIndex();
  const embedding = await embedText(query);
  const topK = options.topK || 20;
  const filter = buildPineconeFilter(userId, options);

  const result = await index.query({
    topK,
    vector: embedding,
    filter,
    includeMetadata: true,
  });

  return (result.matches || []).map((match) => ({
    id: match.id,
    score: match.score,
    metadata: match.metadata || {},
  }));
}

module.exports = {
  isEnabled,
  upsertChunks,
  deleteChunksBySession,
  deleteChunksByUser,
  search,
};

