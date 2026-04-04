// MoltbookTab.tsx — Moltbook AI Agent social network integration dashboard tab

import React, { useEffect, useState, useCallback } from 'react';

const LS_MB_URL = 'moltbook_hub_url';

interface MoltbookPost {
  id: string;
  title: string;
  content: string;
  submolt: string;
  url?: string;
  author: string;
  score: number;
  commentCount: number;
  createdAt: string;
}

interface AgentStatus {
  connected: boolean;
  agent?: {
    name: string;
    karma: number;
    postCount: number;
    commentCount: number;
  };
  error?: string;
}

interface Props {
  token: string;
}

function getHubUrl(): string {
  return localStorage.getItem(LS_MB_URL) ?? localStorage.getItem('jackclaw_hub_url') ?? 'http://localhost:3100';
}

async function hubGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${getHubUrl()}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

async function hubPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${getHubUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `${res.status}`);
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

const AgentCard: React.FC<{ status: AgentStatus; loading: boolean }> = ({ status, loading }) => (
  <div style={{
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: '16px 20px', marginBottom: 16,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 18 }}>🦣</span>
      <span style={{ fontWeight: 600, color: '#e6edf3' }}>Moltbook Agent</span>
      {loading && <span style={{ color: '#8b949e', fontSize: 12 }}>loading…</span>}
      <span style={{
        marginLeft: 'auto', padding: '2px 8px', borderRadius: 12, fontSize: 11,
        background: status.connected ? '#1a4731' : '#3d1a1a',
        color: status.connected ? '#3fb950' : '#f85149',
      }}>
        {status.connected ? '● Connected' : '○ Not connected'}
      </span>
    </div>
    {status.agent && (
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Stat label="Agent" value={status.agent.name} color="#79c0ff" />
        <Stat label="Karma" value={String(status.agent.karma)} color="#3fb950" />
        <Stat label="Posts" value={String(status.agent.postCount)} color="#f97316" />
        <Stat label="Comments" value={String(status.agent.commentCount)} color="#d2a8ff" />
      </div>
    )}
    {status.error && !status.agent && (
      <div style={{ color: '#8b949e', fontSize: 13 }}>
        {status.connected ? `API error: ${status.error}` : 'Connect your Moltbook account to get started.'}
      </div>
    )}
  </div>
);

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div>
    <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 2 }}>{label}</div>
    <div style={{ color, fontWeight: 600, fontSize: 15 }}>{value}</div>
  </div>
);

const PostCard: React.FC<{
  post: MoltbookPost;
  onUpvote: (id: string) => void;
}> = ({ post, onUpvote }) => (
  <div style={{
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: '12px 16px', marginBottom: 8,
    transition: 'border-color 0.15s',
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <button
        onClick={() => onUpvote(post.id)}
        style={{
          background: 'none', border: '1px solid #30363d', borderRadius: 4,
          color: '#f97316', padding: '4px 8px', cursor: 'pointer', fontSize: 12,
          flexShrink: 0,
        }}
        title="Upvote"
      >
        ↑ {post.score}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#e6edf3', fontWeight: 500, marginBottom: 4, wordBreak: 'break-word' }}>
          {post.title}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: '#79c0ff', fontSize: 12 }}>m/{post.submolt}</span>
          <span style={{ color: '#8b949e', fontSize: 12 }}>by {post.author}</span>
          <span style={{ color: '#8b949e', fontSize: 12 }}>💬 {post.commentCount}</span>
          {post.url && (
            <span style={{ color: '#8b949e', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
              🔗 {post.url}
            </span>
          )}
        </div>
      </div>
    </div>
  </div>
);

const ConnectForm: React.FC<{ token: string; onConnected: () => void }> = ({ token, onConnected }) => {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError('');
    try {
      await hubPost('/api/moltbook/connect', token, { apiKey: apiKey.trim() });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, marginBottom: 16 }}>
      <div style={{ color: '#8b949e', marginBottom: 12, fontSize: 13 }}>
        Enter your Moltbook API key to connect your agent account.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          placeholder="Moltbook API key"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void connect()}
          style={{
            flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            padding: '8px 12px', color: '#e6edf3', fontSize: 13,
          }}
        />
        <button
          onClick={() => void connect()}
          disabled={loading || !apiKey.trim()}
          style={{
            background: '#f97316', color: '#fff', border: 'none', borderRadius: 6,
            padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '…' : 'Connect'}
        </button>
      </div>
      {error && <div style={{ color: '#f85149', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
};

const PostForm: React.FC<{ token: string; onPosted: () => void }> = ({ token, onPosted }) => {
  const [submolt, setSubmolt] = useState('general');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!submolt.trim() || !title.trim()) return;
    setLoading(true);
    setError('');
    try {
      await hubPost('/api/moltbook/post', token, {
        submolt: submolt.trim(),
        title: title.trim(),
        content: content.trim() || title.trim(),
      });
      setTitle('');
      setContent('');
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 10, fontWeight: 600 }}>QUICK POST</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          placeholder="submolt"
          value={submolt}
          onChange={e => setSubmolt(e.target.value)}
          style={{
            width: 120, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            padding: '7px 10px', color: '#79c0ff', fontSize: 12,
          }}
        />
        <input
          placeholder="Post title *"
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={{
            flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            padding: '7px 10px', color: '#e6edf3', fontSize: 13,
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          placeholder="Content (optional)"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={2}
          style={{
            flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            padding: '7px 10px', color: '#e6edf3', fontSize: 13, resize: 'vertical',
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={loading || !title.trim()}
          style={{
            background: '#f97316', color: '#fff', border: 'none', borderRadius: 6,
            padding: '0 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
            alignSelf: 'stretch', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '…' : 'Post'}
        </button>
      </div>
      {error && <div style={{ color: '#f85149', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
};

// ── Main MoltbookTab ──────────────────────────────────────────────────────────

export const MoltbookTab: React.FC<Props> = ({ token }) => {
  const [status, setStatus]   = useState<AgentStatus>({ connected: false });
  const [posts, setPosts]     = useState<MoltbookPost[]>([]);
  const [sort, setSort]       = useState<'hot' | 'new' | 'top' | 'rising'>('hot');
  const [search, setSearch]   = useState('');
  const [digest, setDigest]   = useState('');
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<'feed' | 'search' | 'digest'>('feed');

  const loadStatus = useCallback(async () => {
    try {
      const s = await hubGet<AgentStatus>('/api/moltbook/status', token);
      setStatus(s);
    } catch {
      setStatus({ connected: false });
    }
  }, [token]);

  const loadFeed = useCallback(async (s: string = sort) => {
    setLoading(true);
    try {
      const res = await hubGet<{ posts: MoltbookPost[] }>(`/api/moltbook/feed?sort=${s}&limit=30`, token);
      setPosts(res.posts ?? []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [token, sort]);

  useEffect(() => {
    void loadStatus();
    void loadFeed();
  }, [loadStatus, loadFeed]);

  const handleUpvote = async (postId: string) => {
    try {
      await hubPost('/api/moltbook/upvote', token, { postId });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, score: p.score + 1 } : p));
    } catch { /* best-effort */ }
  };

  const handleSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    setActiveView('search');
    try {
      const res = await hubGet<{ posts: MoltbookPost[] }>(`/api/moltbook/feed?q=${encodeURIComponent(search)}&sort=new`, token);
      setPosts(res.posts ?? []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDigest = async () => {
    setActiveView('digest');
    setLoading(true);
    try {
      const res = await hubGet<{ digest: string }>('/api/moltbook/digest', token);
      setDigest(res.digest ?? '');
    } catch (err) {
      setDigest(err instanceof Error ? `Error: ${err.message}` : 'Failed to load digest');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      await hubPost('/api/moltbook/sync', token, {});
      await loadFeed();
    } catch { /* best-effort */ }
  };

  const sortBtns: Array<typeof sort> = ['hot', 'new', 'top', 'rising'];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px' }}>
      {/* Agent status card */}
      <AgentCard status={status} loading={loading} />

      {/* Connect form if not connected */}
      {!status.connected && (
        <ConnectForm token={token} onConnected={() => void loadStatus()} />
      )}

      {/* Quick post form */}
      {status.connected && (
        <PostForm token={token} onPosted={() => void loadFeed()} />
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        {/* Sort buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {sortBtns.map(s => (
            <button
              key={s}
              onClick={() => { setSort(s); setActiveView('feed'); void loadFeed(s); }}
              style={{
                background: sort === s && activeView === 'feed' ? '#f97316' : '#161b22',
                color: sort === s && activeView === 'feed' ? '#fff' : '#8b949e',
                border: '1px solid #30363d', borderRadius: 6,
                padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 180 }}>
          <input
            placeholder="Search posts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleSearch()}
            style={{
              flex: 1, background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
              padding: '5px 10px', color: '#e6edf3', fontSize: 12,
            }}
          />
          <button
            onClick={() => void handleSearch()}
            style={{
              background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
              padding: '5px 10px', color: '#8b949e', cursor: 'pointer', fontSize: 12,
            }}
          >
            🔍
          </button>
        </div>

        {/* Digest & Sync */}
        <button
          onClick={() => void handleDigest()}
          style={{
            background: activeView === 'digest' ? '#1a4731' : '#161b22',
            border: '1px solid #30363d', borderRadius: 6,
            color: '#3fb950', padding: '5px 10px', cursor: 'pointer', fontSize: 12,
          }}
        >
          📰 Digest
        </button>
        <button
          onClick={() => void handleSync()}
          title="Sync feed"
          style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
            color: '#8b949e', padding: '5px 10px', cursor: 'pointer', fontSize: 12,
          }}
        >
          ↺
        </button>
      </div>

      {/* Content */}
      {loading && (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: 32 }}>Loading…</div>
      )}

      {!loading && activeView === 'digest' && digest && (
        <div style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
          padding: '16px 20px', whiteSpace: 'pre-wrap', color: '#e6edf3', fontSize: 13,
          lineHeight: 1.6,
        }}>
          {digest}
        </div>
      )}

      {!loading && (activeView === 'feed' || activeView === 'search') && (
        posts.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8b949e', padding: 48 }}>
            {activeView === 'search' ? `No results for "${search}"` : 'No posts yet — connect your Moltbook account to see your feed.'}
          </div>
        ) : (
          posts.map(post => (
            <PostCard key={post.id} post={post} onUpvote={id => void handleUpvote(id)} />
          ))
        )
      )}
    </div>
  );
};
