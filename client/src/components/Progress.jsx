const STATUS_COLOR = {
  queued:     '#444',
  extracting: '#888',
  pushing:    '#5b9bd5',
  clean:      '#5cb85c',
  duplicate:  '#e05555',
  'possible dupe': '#e09a3a',
  incomplete: '#e0c43a',
  error:      '#888',
};

const STATUS_ICON = {
  queued:     '○',
  extracting: '◌',
  pushing:    '◎',
  clean:      '✓',
  duplicate:  '⚑',
  'possible dupe': '~',
  incomplete: '!',
  error:      '✗',
};

export default function Progress({ items, onOpen }) {
  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const counts = { clean: 0, duplicate: 0, 'possible dupe': 0, incomplete: 0, error: 0 };
  for (const item of items) {
    if (item.status && counts[item.status] !== undefined) counts[item.status]++;
  }

  return (
    <div style={s.wrap}>
      {/* Progress bar */}
      <div style={s.barTrack}>
        <div style={{ ...s.barFill, width: `${pct}%` }} />
      </div>
      <div style={s.barLabel}>{done} / {total} scanned</div>

      {/* Summary (shown when complete) */}
      {done === total && total > 0 && (
        <div style={s.summary}>
          <span style={{ color: STATUS_COLOR.clean }}>✓ {counts.clean} clean</span>
          {counts.duplicate > 0 && <span style={{ color: STATUS_COLOR.duplicate }}>  ⚑ {counts.duplicate} dupes</span>}
          {counts['possible dupe'] > 0 && <span style={{ color: STATUS_COLOR['possible dupe'] }}>  ~ {counts['possible dupe']} possible dupes</span>}
          {counts.incomplete > 0 && <span style={{ color: STATUS_COLOR.incomplete }}>  ! {counts.incomplete} incomplete</span>}
          {counts.error > 0 && <span style={{ color: STATUS_COLOR.error }}>  ✗ {counts.error} errors</span>}
          <button style={s.notionBtn} onClick={onOpen}>Open in Notion →</button>
        </div>
      )}

      {/* Per-card list */}
      <div style={s.list}>
        {items.map((item, i) => {
          const st = item.status || (item.done ? 'error' : item.pushing ? 'pushing' : item.extracted ? 'pushing' : 'extracting');
          const color = STATUS_COLOR[st] || '#888';
          return (
            <div key={i} style={s.row}>
              <span style={{ color, fontFamily: 'monospace', fontSize: 14, width: 18, flexShrink: 0 }}>
                {STATUS_ICON[st] || '○'}
              </span>
              <span style={s.filename}>{item.filename}</span>
              {item.name && <span style={s.name}>{item.name}</span>}
              {item.flags?.length > 0 && (
                <span style={s.flags}>{item.flags.slice(0, 3).join(' · ')}</span>
              )}
              {item.error && <span style={{ ...s.flags, color: '#e05555' }}>{item.error}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  wrap: { width: '100%', display: 'flex', flexDirection: 'column', gap: 12 },
  barTrack: { height: 6, background: '#1e1e1e', borderRadius: 99, overflow: 'hidden' },
  barFill: { height: '100%', background: '#5cb85c', borderRadius: 99, transition: 'width 0.3s ease' },
  barLabel: { fontSize: 12, color: '#666', textAlign: 'right', marginTop: -8 },
  summary: {
    background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10,
    padding: '12px 16px', fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
  },
  notionBtn: {
    marginLeft: 'auto', background: '#222', border: '1px solid #333', borderRadius: 6,
    color: '#bbb', fontSize: 12, padding: '5px 12px', cursor: 'pointer',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 0', borderBottom: '1px solid #1a1a1a', fontSize: 13,
  },
  filename: { color: '#555', fontSize: 11, width: 160, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name: { color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  flags: { color: '#666', fontSize: 11, flexShrink: 0 },
};
