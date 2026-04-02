import { useState } from 'react';

export default function LinkedInImport() {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);

  async function handleImport() {
    const urls = text.split('\n').map(u => u.trim()).filter(u => u.includes('linkedin.com/in/'));
    if (!urls.length) return;

    setRunning(true);
    setResults(urls.map(url => ({ url, status: 'importing' })));

    try {
      const res = await fetch('/api/linkedin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const { results: data } = await res.json();
      setResults(data.map(r => ({
        url: r.url,
        status: r.success ? 'done' : 'error',
        name: r.name,
        company: r.company,
        title: r.title,
        notionUrl: r.notionUrl,
        error: r.error,
      })));
    } catch (err) {
      setResults(prev => prev.map(r => ({ ...r, status: 'error', error: err.message })));
    } finally {
      setRunning(false);
    }
  }

  const urls = text.split('\n').filter(u => u.trim().includes('linkedin.com/in/')).length;

  return (
    <div style={s.wrap}>
      <textarea
        style={s.textarea}
        placeholder={'Paste LinkedIn profile URLs, one per line:\nhttps://linkedin.com/in/johndoe\nhttps://linkedin.com/in/janedoe'}
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={running}
        rows={8}
      />
      <button style={{ ...s.btn, opacity: (!urls || running) ? 0.4 : 1 }} onClick={handleImport} disabled={!urls || running}>
        {running ? 'Importing...' : `Import ${urls || ''} profile${urls !== 1 ? 's' : ''}`}
      </button>

      {results.length > 0 && (
        <div style={s.list}>
          {results.map((r, i) => (
            <div key={i} style={s.row}>
              <span style={{ color: r.status === 'done' ? '#5cb85c' : r.status === 'error' ? '#e05555' : '#888', fontSize: 14, width: 16 }}>
                {r.status === 'done' ? '✓' : r.status === 'error' ? '✗' : '○'}
              </span>
              <div style={s.info}>
                <span style={s.name}>{r.name || r.url}</span>
                {r.company && <span style={s.sub}>{[r.title, r.company].filter(Boolean).join(' · ')}</span>}
                {r.error && <span style={{ ...s.sub, color: '#e05555' }}>{r.error}</span>}
              </div>
              {r.notionUrl && (
                <a href={r.notionUrl} target="_blank" rel="noreferrer" style={s.link}>Notion →</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  textarea: {
    background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12,
    color: '#e8e8e8', padding: '14px 16px', fontSize: 13, fontFamily: 'inherit',
    resize: 'vertical', outline: 'none', lineHeight: 1.6,
  },
  btn: {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    color: '#ccc', fontSize: 14, padding: '10px 20px', cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 0', borderBottom: '1px solid #1a1a1a',
  },
  info: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  name: { fontSize: 13, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sub: { fontSize: 11, color: '#666' },
  link: { fontSize: 12, color: '#888', textDecoration: 'none', flexShrink: 0 },
};
