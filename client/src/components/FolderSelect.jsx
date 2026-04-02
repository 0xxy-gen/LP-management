import { useRef } from 'react';

export default function FolderSelect({ onFiles, disabled }) {
  const inputRef = useRef();

  function handleChange(e) {
    const files = [...e.target.files].filter(f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic'));
    if (files.length) onFiles(files);
    e.target.value = '';
  }

  return (
    <div style={styles.wrap}>
      <div
        style={{ ...styles.dropZone, opacity: disabled ? 0.5 : 1 }}
        onClick={() => !disabled && inputRef.current.click()}
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => {
          e.preventDefault();
          if (disabled) return;
          const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic'));
          if (files.length) onFiles(files);
        }}
      >
        <div style={styles.icon}>📇</div>
        <div style={styles.title}>Drop a folder or images here</div>
        <div style={styles.sub}>or click to select</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.heic"
          style={styles.hidden}
          onChange={handleChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

const styles = {
  wrap: { width: '100%' },
  dropZone: {
    border: '2px dashed #2a2a2a',
    borderRadius: 16,
    padding: '56px 40px',
    textAlign: 'center',
    cursor: 'pointer',
    background: '#141414',
    transition: 'border-color 0.15s',
  },
  icon: { fontSize: 48, marginBottom: 14, opacity: 0.6 },
  title: { fontSize: 18, fontWeight: 500, color: '#ccc', marginBottom: 6 },
  sub: { fontSize: 13, color: '#555' },
  hidden: { display: 'none' },
};
