// TokenStats — SmartCache statistics display: hit rate, saved tokens, per-node breakdown

import React, { useEffect, useState } from 'react';
import { api, type TokenStatsResponse } from '../api.js';

interface Props {
  token: string;
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

const StatCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}> = ({ label, value, sub, accent }) => (
  <div className={`stat-card ${accent ? 'stat-card-accent' : ''}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {sub && <div className="stat-sub">{sub}</div>}
  </div>
);

export const TokenStats: React.FC<Props> = ({ token }) => {
  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await api.stats(token);
        if (!cancelled) { setStats(res); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token]);

  if (loading) {
    return (
      <div className="stats-grid">
        {[1, 2, 3, 4].map(i => <div key={i} className="stat-card skeleton" />)}
      </div>
    );
  }

  if (error || !stats) {
    return <div className="error-state">⚠ {error ?? '无数据'}</div>;
  }

  const nodeEntries = Object.entries(stats.byNode ?? {});

  return (
    <div className="token-stats">
      {/* Summary cards */}
      <div className="stats-grid">
        <StatCard
          label="缓存命中率"
          value={pct(stats.hitRate)}
          sub={`${fmt(stats.cacheHits)} 命中 / ${fmt(stats.cacheMisses)} 未命中`}
          accent
        />
        <StatCard
          label="节省 Token"
          value={fmt(stats.savedTokens)}
          sub="SmartCache 累计节省"
        />
        <StatCard
          label="总消耗 Token"
          value={fmt(stats.totalTokens)}
          sub="全节点累计"
        />
        <StatCard
          label="缓存命中次数"
          value={fmt(stats.cacheHits)}
          sub={`未命中 ${fmt(stats.cacheMisses)}`}
        />
      </div>

      {/* Hit-rate progress bar */}
      <div className="hit-rate-bar-wrap">
        <div className="hit-rate-label">
          <span>SmartCache 命中率</span>
          <span className="hit-rate-pct">{pct(stats.hitRate)}</span>
        </div>
        <div className="hit-rate-track">
          <div
            className="hit-rate-fill"
            style={{ width: `${Math.max(0, Math.min(1, stats.hitRate)) * 100}%` }}
          />
        </div>
      </div>

      {/* Per-node breakdown */}
      {nodeEntries.length > 0 && (
        <div className="node-stats-section">
          <div className="section-label">节点明细</div>
          <div className="node-stats-table">
            <div className="nst-header">
              <span>节点</span>
              <span>Token 用量</span>
              <span>缓存命中</span>
            </div>
            {nodeEntries.map(([nodeId, ns]) => (
              <div key={nodeId} className="nst-row">
                <span className="nst-id">{nodeId.slice(0, 12)}…</span>
                <span className="nst-val">{fmt(ns.tokens)}</span>
                <span className="nst-val nst-hits">{fmt(ns.cacheHits)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
