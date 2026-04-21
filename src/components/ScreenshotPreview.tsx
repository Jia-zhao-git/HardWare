import { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { invoke } from '../api/electron-bridge';

interface ScreenshotPreviewProps {
  isOpen: boolean;
  imagePath: string;
  onClose: () => void;
}

export default function ScreenshotPreview({ isOpen, imagePath, onClose }: ScreenshotPreviewProps) {
  const [scale, setScale] = useState(1);
  const [imageData, setImageData] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && imagePath) {
      setLoading(true);
      invoke<{ success: boolean; data?: string; error?: string }>('read_file_base64', { filePath: imagePath })
        .then(r => {
          if (r?.success && r.data) {
            setImageData(r.data);
          } else {
            // Fallback: try file URL
            setImageData(imagePath.startsWith('file://') ? imagePath : `file:///${imagePath.replace(/\\/g, '/')}`);
          }
        })
        .catch(() => {
          setImageData(imagePath.startsWith('file://') ? imagePath : `file:///${imagePath.replace(/\\/g, '/')}`);
        })
        .finally(() => setLoading(false));
    } else {
      setImageData('');
      setScale(1);
    }
  }, [isOpen, imagePath]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleZoomIn = () => setScale(s => Math.min(s + 0.25, 3));
  const handleZoomOut = () => setScale(s => Math.max(s - 0.25, 0.5));
  const handleReset = () => setScale(1);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      animation: 'fadeIn 0.2s ease-out',
    }}>
      {/* Header */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '16px 24px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: '#fff', fontSize: '14px', fontFamily: 'monospace' }}>
          {imagePath.split(/[/\\]/).pop()}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleZoomOut} title="缩小" style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><ZoomOut size={18} /></button>
          <button onClick={handleReset} title="重置" style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600,
          }}>{Math.round(scale * 100)}%</button>
          <button onClick={handleZoomIn} title="放大" style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><ZoomIn size={18} /></button>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(239,68,68,0.5)',
            background: 'rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><X size={18} /></button>
        </div>
      </div>

      {/* Image */}
      {loading ? (
        <div style={{ color: '#fff', fontSize: 14 }}>加载截图中...</div>
      ) : imageData ? (
        <img
          src={imageData}
          alt="Screenshot"
          style={{
            maxWidth: '90vw',
            maxHeight: '85vh',
            objectFit: 'contain',
            borderRadius: 8,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            transform: `scale(${scale})`,
            transition: 'transform 0.3s ease',
          }}
        />
      ) : (
        <div style={{ color: '#fff', fontSize: 14 }}>无法加载截图</div>
      )}

      {/* Footer hint */}
      <div style={{ position: 'absolute', bottom: 20, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
        按 ESC 关闭 | 滚轮缩放
      </div>
    </div>
  );
}
