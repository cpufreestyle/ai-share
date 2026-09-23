'use strict';
const http = require('http');
const https = require('https');

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const SIMILARITY_THRESHOLD = 0.35;

function request(url, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Ollama 地址无效: ' + url)); }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(body || {}), 'utf8');
    const req = lib.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode < 500) return resolve(data);
          throw new Error((data && (data.error || 'Ollama 请求失败')) || 'Ollama 请求失败');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function ollamaEmbed(text) {
  const base = (process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const model = process.env.OLLAMA_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const r = await request(base + '/api/embed', {
    model,
    prompt: String(text || '').slice(0, 4000),
    options: { keep_alive: '10m' },
  });
  const emb = r && (r.embedding || r.embeddings);
  if (!Array.isArray(emb) || emb.length === 0) throw new Error('embedding 返回为空');
  return emb;
}

function cosine(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] || 0, bv = b[i] || 0;
    ab += av * bv;
    aa += av * av;
    bb += bv * bv;
  }
  const denom = Math.sqrt(aa) * Math.sqrt(bb);
  return denom === 0 ? 0 : ab / denom;
}

function textOf(it, schema) {
  const parts = [it[schema.titleField], it[schema.descField === '_desc' ? '_desc' : schema.descField], (it[schema.tagsField] || []).join(' ')];
  if (schema.idField === 'name' && it.name) parts.push(it.name);
  return parts.filter(Boolean).join(' ');
}

async function semanticSearch(items, schema, query, threshold) {
  const qVec = await ollamaEmbed(query);
  const scored = [];
  for (const it of items) {
    const hay = textOf(it, schema);
    const vec = await ollamaEmbed(hay);
    const sim = cosine(qVec, vec);
    if (sim >= (typeof threshold === 'number' ? threshold : SIMILARITY_THRESHOLD)) scored.push({ item: it, score: sim });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 50);
}

module.exports = { cosine, textOf, semanticSearch, SIMILARITY_THRESHOLD };