const crypto = require('crypto');
const dbManager = require('../databaseManager');

const now = () => Date.now();

const safeParseArray = (v) => (Array.isArray(v) ? v : []);

const defaultPolicy = () => ({
  mode: 'strict',
  autoApprove: {
    netFetchAllowlisted: false,
    fsWriteArtifacts: false,
    projectIntelRun: false
  },
  grantTtlMs: 6 * 60 * 60 * 1000,
  approvalTtlMs: 24 * 60 * 60 * 1000,
  maxQueue: 500
});

const normalizeHost = (h) => String(h || '').toLowerCase().trim();

const isHostAllowed = (hostname, allowlist) => {
  const host = normalizeHost(hostname);
  const list = safeParseArray(allowlist).map(normalizeHost).filter(Boolean);
  if (!host) return false;
  if (list.includes(host)) return true;
  for (const d of list) {
    if (d.startsWith('*.') && host.endsWith(d.slice(1))) return true;
  }
  return false;
};

const makeId = (prefix) => {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch (e) {
    return `${prefix}-${now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
};

class AgentApprovalService {
  async getPolicy() {
    const stored = await dbManager.getSetting('agent_policy');
    const base = defaultPolicy();
    if (!stored || typeof stored !== 'object') return base;
    const merged = {
      ...base,
      ...stored,
      autoApprove: { ...base.autoApprove, ...(stored.autoApprove || {}) }
    };
    return merged;
  }

  async setPolicy(next) {
    const base = defaultPolicy();
    const candidate = next && typeof next === 'object' ? next : {};
    const merged = {
      ...base,
      ...candidate,
      autoApprove: { ...base.autoApprove, ...(candidate.autoApprove || {}) }
    };
    await dbManager.saveSetting('agent_policy', merged);
    return merged;
  }

  async _getQueueRaw() {
    const v = await dbManager.getSetting('agent_approvals');
    return safeParseArray(v);
  }

  async listApprovals({ status } = {}) {
    const q = await this._getQueueRaw();
    const s = typeof status === 'string' ? status.trim() : '';
    const out = s ? q.filter((x) => x && x.status === s) : q;
    return out.sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
  }

  async getApproval(id) {
    if (!id) return null;
    const q = await this._getQueueRaw();
    return q.find((x) => x && x.id === id) || null;
  }

  async _setQueue(q) {
    await dbManager.saveSetting('agent_approvals', safeParseArray(q));
  }

  async enqueue({ action, request, summary, scopeKey, ttlMs } = {}) {
    const policy = await this.getPolicy();
    const q = await this._getQueueRaw();
    const createdAt = now();
    const expiresAt = createdAt + Math.max(60_000, Math.min(Number(ttlMs) || policy.approvalTtlMs, 14 * 24 * 60 * 60 * 1000));
    const entry = {
      id: makeId('apr'),
      status: 'pending',
      action: String(action || '').trim(),
      summary: String(summary || '').trim().slice(0, 400),
      scopeKey: String(scopeKey || '').trim(),
      request: request && typeof request === 'object' ? request : { value: request },
      createdAt,
      expiresAt
    };
    const next = [entry, ...q].slice(0, Math.max(50, Math.min(Number(policy.maxQueue) || 500, 5000)));
    await this._setQueue(next);
    return entry;
  }

  async _getGrantsRaw() {
    const v = await dbManager.getSetting('agent_grants');
    return safeParseArray(v);
  }

  async _setGrants(g) {
    await dbManager.saveSetting('agent_grants', safeParseArray(g));
  }

  async isGranted({ action, scopeKey }) {
    const a = String(action || '').trim();
    const s = String(scopeKey || '').trim();
    if (!a) return false;
    const grants = await this._getGrantsRaw();
    const t = now();
    return grants.some((g) => g && g.action === a && (!s || g.scopeKey === s) && (!g.expiresAt || Number(g.expiresAt) > t));
  }

  async grant({ action, scopeKey, ttlMs }) {
    const policy = await this.getPolicy();
    const a = String(action || '').trim();
    const s = String(scopeKey || '').trim();
    if (!a) return null;
    const grants = await this._getGrantsRaw();
    const createdAt = now();
    const expiresAt = createdAt + Math.max(60_000, Math.min(Number(ttlMs) || policy.grantTtlMs, 30 * 24 * 60 * 60 * 1000));
    const entry = { id: makeId('gr'), action: a, scopeKey: s, createdAt, expiresAt };
    const next = [entry, ...grants].slice(0, 2000);
    await this._setGrants(next);
    return entry;
  }

  async decide({ id, decision, grantScopeKey, grantTtlMs } = {}) {
    const d = String(decision || '').trim();
    if (!['approved', 'denied'].includes(d)) return { success: false, error: 'invalid decision' };
    const q = await this._getQueueRaw();
    const idx = q.findIndex((x) => x && x.id === id);
    if (idx < 0) return { success: false, error: 'not_found' };
    const t = now();
    const item = q[idx];
    if (item.status !== 'pending') return { success: false, error: 'already_decided' };
    const nextItem = { ...item, status: d, decidedAt: t };
    q[idx] = nextItem;
    await this._setQueue(q);
    let grantEntry = null;
    if (d === 'approved') {
      grantEntry = await this.grant({ action: nextItem.action, scopeKey: grantScopeKey || nextItem.scopeKey, ttlMs: grantTtlMs });
    }
    return { success: true, approval: nextItem, grant: grantEntry };
  }

  async evaluateNetFetch({ url, hostname }) {
    const policy = await this.getPolicy();
    const allowRaw = await dbManager.getSetting('network_allowlist');
    const isAllowed = isHostAllowed(hostname, allowRaw);
    if (isAllowed && policy.autoApprove?.netFetchAllowlisted) return { decision: 'allow', reason: 'allowlisted' };
    return { decision: 'queue', reason: isAllowed ? 'requires_policy_approval' : 'domain_not_allowlisted' };
  }
}

module.exports = new AgentApprovalService();
