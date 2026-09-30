// components/Joystick2D.tsx
'use client';

import React, { useRef, useState, useCallback } from 'react';
import styles from './Joystick.module.css';

interface Position {
  x: number;
  y: number;
}

interface Joystick2DProps {
  size?: number;
  baseColor?: string;
  stickColor?: string;
  disabled?: boolean;
  onChange?: (x: number, y: number) => void;
  onEnd?: () => void;
  label?: string;
  reportInterval?: number;
}

export const Joystick2D: React.FC<Joystick2DProps> = ({
  size = 100,
  baseColor = '#444',
  stickColor = '#00A6FB',
  disabled = false,
  onChange,
  onEnd,
  label,
  reportInterval = 200
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [normalizedPosition, setNormalizedPosition] = useState<Position>({ x: 0, y: 0 });
  const lastReportTimeRef = useRef<number>(0);
  const lastPositionRef = useRef<Position>({ x: 0, y: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportChange = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastReportTimeRef.current >= reportInterval) {
      onChange?.(x, y);
      lastReportTimeRef.current = now;
      lastPositionRef.current = { x, y };
    } else if (timeoutRef.current === null) {
      timeoutRef.current = setTimeout(() => {
        if (lastPositionRef.current.x !== x || lastPositionRef.current.y !== y) {
          onChange?.(x, y);
          lastPositionRef.current = { x, y };
        }
        timeoutRef.current = null;
      }, reportInterval - (now - lastReportTimeRef.current));
    }
  }, [onChange, reportInterval]);

  const updatePosition = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = clientX - centerX;
    const deltaY = centerY - clientY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const maxDistance = rect.width / 2;
    const normalizedDistance = Math.min(distance, maxDistance);
    const angle = Math.atan2(deltaY, deltaX);

    const x = Math.cos(angle) * normalizedDistance;
    const y = Math.sin(angle) * normalizedDistance;
    const normalizedX = x / maxDistance;
    const normalizedY = y / maxDistance;

    setPosition({ x, y });
    setNormalizedPosition({ x: normalizedX, y: normalizedY });
    reportChange(normalizedX, normalizedY);
  }, [reportChange]);

  const resetPosition = useCallback(() => {
    setPosition({ x: 0, y: 0 });
    setNormalizedPosition({ x: 0, y: 0 });
    onChange?.(0, 0);
    lastPositionRef.current = { x: 0, y: 0 };
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    onEnd?.();
  }, [onChange, onEnd]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Capture the pointer so all subsequent events (move, up) are delivered
    // to this element even if the pointer leaves its bounds. This eliminates
    // the race condition where a fast lift fires pointerup before the
    // window-level listener was registered.
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePosition(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updatePosition(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    resetPosition();
  };

  return (
    <div className={styles.joystickWrapper}>
      {label && <div className={styles.joystickLabel + ' text-base-content'}>{label}</div>}
      <div className={styles.joystickContainer} style={{ width: size, height: size }}>
        <div
          ref={containerRef}
          className={styles.joystickBase}
          style={{ backgroundColor: baseColor, touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className={styles.joystickStick}
            style={{
              backgroundColor: stickColor,
              transform: `translate(${position.x}px, ${-position.y}px)`,
              opacity: disabled ? 0.5 : 1,
            }}
          />
        </div>
      </div>
      <div className={styles.coordinates}>
        <span className='text-base-content'>X: {normalizedPosition.x.toFixed(2)}</span>
        <span className='text-base-content'>Y: {normalizedPosition.y.toFixed(2)}</span>
      </div>
    </div>
  );
};
