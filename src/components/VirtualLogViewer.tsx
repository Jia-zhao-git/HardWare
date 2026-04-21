import React, { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react';

interface LogLine {
  text: string;
  type: 'error' | 'warning' | 'success' | 'info' | 'default';
}

interface VirtualLogViewerProps {
  logs: string[];
  height?: number;
  itemHeight?: number;
  style?: React.CSSProperties;
}

const detectLogType = (line: string): LogLine['type'] => {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('fail') || lower.includes('错误') || lower.includes('失败')) return 'error';
  if (lower.includes('warn') || lower.includes('警告')) return 'warning';
  if (lower.includes('success') || lower.includes('done') || lower.includes('ok') || lower.includes('成功') || lower.includes('完成')) return 'success';
  if (lower.includes('info') || lower.includes('start') || lower.includes('连接') || lower.includes('启动')) return 'info';
  return 'default';
};

const typeColors: Record<LogLine['type'], string> = {
  error: '#ef4444',
  warning: '#f59e0b',
  success: '#10b981',
  info: '#00d4ff',
  default: '#c9d1d9',
};

const VirtualLogViewer: React.FC<VirtualLogViewerProps> = ({ 
  logs = [], 
  height = 400, 
  itemHeight = 20,
  style = {},
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(height);
  const lastLogsLengthRef = useRef(logs.length);

  // 计算可见区域
  const { startIndex, endIndex, visibleLogs, offsetY, totalHeight } = useMemo(() => {
    const vStart = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const vEnd = Math.min(vStart + visibleCount + 1, logs.length);

    // 预加载缓冲区
    const bufferSize = 10;
    const sIndex = Math.max(0, vStart - bufferSize);
    const eIndex = Math.min(logs.length, vEnd + bufferSize);

    console.log('[VirtualLogViewer] Render calculation:', {
      containerHeight,
      itemHeight,
      visibleCount,
      scrollTop,
      vStart,
      vEnd,
      sIndex,
      eIndex,
      renderedCount: eIndex - sIndex,
      totalLogs: logs.length
    });

    return {
      startIndex: sIndex,
      endIndex: eIndex,
      visibleLogs: logs.slice(sIndex, eIndex),
      offsetY: sIndex * itemHeight,
      totalHeight: logs.length * itemHeight,
    };
  }, [scrollTop, containerHeight, itemHeight, logs]);

  // 滚动处理 - 使用 requestAnimationFrame 节流
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target) {
      requestAnimationFrame(() => {
        setScrollTop(target.scrollTop);
      });
    }
  }, []);

  // 监听容器高度变化
  useEffect(() => {
    if (!containerRef.current) return;

    console.log('[VirtualLogViewer] Initializing height detection');

    // 立即获取初始高度
    const updateHeight = () => {
      if (containerRef.current) {
        const newHeight = containerRef.current.clientHeight;
        console.log('[VirtualLogViewer] Checking height:', newHeight, 'current:', containerHeight);
        if (newHeight > 0 && Math.abs(newHeight - containerHeight) > 1) {
          console.log('[VirtualLogViewer] Height updated:', newHeight, 'was:', containerHeight);
          setContainerHeight(newHeight);
        }
      }
    };

    // 立即执行一次
    updateHeight();

    // 使用 ResizeObserver 监听变化
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        console.log('[VirtualLogViewer] ResizeObserver triggered:', newHeight);
        if (newHeight > 0 && Math.abs(newHeight - containerHeight) > 1) {
          console.log('[VirtualLogViewer] Height from ResizeObserver:', newHeight);
          setContainerHeight(newHeight);
        }
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    // 多次延迟检查，确保布局完成
    const timers = [
      setTimeout(updateHeight, 50),
      setTimeout(updateHeight, 100),
      setTimeout(updateHeight, 300),
      setTimeout(updateHeight, 500),
    ];
    
    console.log('[VirtualLogViewer] Height detection setup complete');
    
    return () => {
      console.log('[VirtualLogViewer] Cleaning up height detection');
      resizeObserver.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [containerHeight]);

  // 新日志自动滚动到底部
  useEffect(() => {
    if (!containerRef.current || logs.length === 0) return;

    const isNewLog = logs.length > lastLogsLengthRef.current;
    lastLogsLengthRef.current = logs.length;

    if (isNewLog) {
      // 检查用户是否已经在底部附近（50px 范围内）
      const currentScrollTop = containerRef.current.scrollTop;
      const scrollHeight = containerRef.current.scrollHeight;
      const clientHeight = containerRef.current.clientHeight;
      const isNearBottom = (scrollHeight - currentScrollTop - clientHeight) < 50;
      
      console.log('[VirtualLogViewer] Auto-scroll check:', {
        isNewLog,
        scrollHeight,
        clientHeight,
        currentScrollTop,
        isNearBottom,
        logsLength: logs.length
      });
      
      // 如果用户在底部附近，自动滚动到最新日志
      if (isNearBottom) {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
            console.log('[VirtualLogViewer] Scrolled to bottom');
          }
        });
      }
    }
  }, [logs.length]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        background: '#050a12',
        fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
        fontSize: '12px',
        ...style,
        // maxHeight 优先，如果没有则使用固定高度
        maxHeight: style?.maxHeight || `${height}px`,
        height: style?.maxHeight ? 'auto' : `${height}px`,
      }}
    >
      <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${offsetY}px)`,
            willChange: 'transform',
          }}
        >
          {visibleLogs.map((log, index) => {
            const actualIndex = startIndex + index;
            const logType = detectLogType(log);
            
            return (
              <div
                key={actualIndex}
                style={{
                  height: `${itemHeight}px`,
                  lineHeight: `${itemHeight}px`,
                  paddingLeft: '12px',
                  paddingRight: '12px',
                  overflow: 'hidden',
                  whiteSpace: 'pre',
                  textOverflow: 'ellipsis',
                  color: typeColors[logType],
                  borderBottom: '1px solid rgba(255,255,255,0.02)',
                }}
                title={log}
              >
                <span style={{ 
                  color: 'var(--text-muted)', 
                  marginRight: '12px',
                  userSelect: 'none',
                }}>
                  {String(actualIndex + 1).padStart(4, ' ')}
                </span>
                {log}
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 滚动指示器 */}
      {logs.length > endIndex && (
        <div
          style={{
            position: 'sticky',
            bottom: '10px',
            right: '10px',
            marginLeft: 'auto',
            width: 'fit-content',
            padding: '6px 14px',
            background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
            color: '#fff',
            borderRadius: '20px',
            fontSize: '11px',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0, 212, 255, 0.3)',
            cursor: 'pointer',
            animation: 'pulse 2s ease-in-out infinite',
          }}
          onClick={() => {
            if (containerRef.current) {
              containerRef.current.scrollTop = totalHeight;
            }
          }}
        >
          ↓ {logs.length - endIndex} 条新日志
        </div>
      )}
    </div>
  );
};

export default memo(VirtualLogViewer);
