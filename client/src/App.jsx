import { useState, useCallback } from 'react';
import FolderSelect from './components/FolderSelect';
import Progress from './components/Progress';
import LinkedInImport from './components/LinkedInImport';
import { resizeToBase64 } from './utils/imageResize';

const NOTION_DB_URL = 'https://www.notion.so/31b91a1ce62c805eb39afa8053d7828a';
const MAX_CONCURRENT = 1;

export default function App() {
  const [tab, setTab] = useState('namecard');
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(false);

  const updateItem = useCallback((index, patch) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, ...patch } : it));
  }, []);

  async function handleFiles(files) {
    const newItems = files.map(f => ({ filename: f.name, done: false, file: f }));
    setItems(newItems);
    setRunning(true);

    try {
      // Fetch existing contacts for cross-batch dedup
      let existingContacts = [];
      try {
        const r = await fetch('/api/notion/contacts');
        const d = await r.json();
        existingContacts = d.contacts || [];
      } catch { /* non-fatal */ }

      // Step 1: Extract all cards (MAX_CONCURRENT at a time)
      const extracted = new Array(newItems.length).fill(null);
      const queue = [...newItems.keys()];
      const running = new Set();

      await new Promise(resolve => {
        function next() {
          while (running.size < MAX_CONCURRENT && queue.length > 0) {
            const idx = queue.shift();
            const item = newItems[idx];
            running.add(idx);
            extractCard(item.file, idx).then(data => {
              extracted[idx] = data;
              updateItem(idx, { extracted: true, ...(data?._extractionError ? { status: 'error', error: data._extractionError, done: true } : {}) });
            }).catch(err => {
              extracted[idx] = { _extractionError: err.message };
              updateItem(idx, { status: 'error', error: err.message, done: true });
            }).finally(() => {
              running.delete(idx);
              if (queue.length === 0 && running.size === 0) resolve();
              else next();
            });
          }
        }
        next();
      });

      // Step 2: Push all to Notion in one batch
      const cards = extracted.map((data, i) => ({
        data: data || { _extractionError: 'extraction failed', flags: ['not_a_card'] },
        filename: newItems[i].filename,
      }));

      const pushRes = await fetch('/api/notion/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards, existingContacts }),
      });
      const { results } = await pushRes.json();

      results.forEach((r, i) => {
        updateItem(i, {
          done: true,
          status: r.success ? r.status.toLowerCase() : 'error',
          name: r.name,
          flags: r.flags,
          notionUrl: r.notionUrl,
          error: r.error,
        });
      });
    } catch (err) {
      console.error(err);
    } finally {
      setRunning(false);
    }
  }

  async function extractCard(file, idx) {
    updateItem(idx, { status: undefined, extracting: true });
    const base64 = await resizeToBase64(file);
    const form = new FormData();
    const blob = await fetch(`data:image/jpeg;base64,${base64}`).then(r => r.blob());
    form.append('image', blob, file.name);
    const res = await fetch('/api/extract', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Extraction failed');
    return json.data;
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Namecard Scanner</h1>
        <p style={styles.sub}>Scan → Dedup → Push to Notion. No review needed.</p>
      </header>

      <div style={styles.container}>
        <div style={styles.tabs}>
          <button style={{ ...styles.tab, ...(tab === 'namecard' ? styles.tabActive : {}) }} onClick={() => setTab('namecard')}>📇 Namecards</button>
          <button style={{ ...styles.tab, ...(tab === 'linkedin' ? styles.tabActive : {}) }} onClick={() => setTab('linkedin')}>in LinkedIn</button>
        </div>

        {tab === 'namecard' && (
          <>
            <FolderSelect onFiles={handleFiles} disabled={running} />
            {items.length > 0 && (
              <Progress items={items} onOpen={() => window.open(NOTION_DB_URL, '_blank')} />
            )}
          </>
        )}

        {tab === 'linkedin' && <LinkedInImport />}
      </div>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: '#0f0f0f', color: '#e8e8e8',
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '40px 20px',
  },
  header: { textAlign: 'center', marginBottom: 36 },
  h1: { fontSize: 26, fontWeight: 600, color: '#fff', margin: '0 0 6px' },
  sub: { fontSize: 13, color: '#555', margin: 0 },
  container: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 },
  tabs: { display: 'flex', gap: 8 },
  tab: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#666', fontSize: 13, padding: '8px 16px', cursor: 'pointer' },
  tabActive: { background: '#222', border: '1px solid #444', color: '#ccc' },
};
