// components/Joystick1D.tsx
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import styles from './Joystick.module.css';

interface Joystick1DProps {
  size?: number;
  baseColor?: string;
  stickColor?: string;
  vertical?: boolean;
  disabled?: boolean;
  onChange?: (value: number) => void;
  onEnd?: () => void;
  label?: string;
  reportInterval?: number;
}

export const Joystick1D: React.FC<Joystick1DProps> = ({
  size = 100,
  baseColor = '#444',
  stickColor = '#00A6FB',
  vertical = true,
  disabled = false,
  onChange,
  onEnd,
  label,
  reportInterval = 200 // Default to 200ms if not specified
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState(0);
  const [normalizedPosition, setNormalizedPosition] = useState(0);
  const lastReportTimeRef = useRef<number>(0);
  const lastPositionRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const reportChange = useCallback((value: number) => {
    const now = Date.now();
    if (now - lastReportTimeRef.current >= reportInterval) {
      onChange?.(value);
      lastReportTimeRef.current = now;
      lastPositionRef.current = value;
    } else if (timeoutRef.current === null) {
      // Schedule next report if position is different from last reported
      timeoutRef.current = setTimeout(() => {
        if (lastPositionRef.current !== value) {
          onChange?.(value);
          lastPositionRef.current = value;
        }
        timeoutRef.current = null;
      }, reportInterval - (now - lastReportTimeRef.current));
    }
  }, [onChange, reportInterval]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    setDragging(true);
    updatePosition(e);
  };

  const handleMouseMove = (e: MouseEvent | TouchEvent) => {
    if (!dragging || disabled) return;
    updatePosition(e);
  };

  const handleMouseUp = () => {
    if (disabled) return;
    setDragging(false);
    setPosition(0);
    setNormalizedPosition(0);
    // Always report the final position
    onChange?.(0);
    lastPositionRef.current = 0;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    onEnd?.();
  };

  const updatePosition = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const center = vertical
      ? rect.top + rect.height / 2
      : rect.left + rect.width / 2;

    let clientPos: number;

    if ('touches' in e) {
      clientPos = vertical ? e.touches[0].clientY : e.touches[0].clientX;
    } else {
      clientPos = vertical ? (e as MouseEvent).clientY : (e as MouseEvent).clientX;
    }

    const delta = vertical ? center - clientPos : clientPos - center;
    const maxDistance = (vertical ? rect.height : rect.width) / 2 - size / 8 - 5;
    const normalizedDistance = Math.max(Math.min(delta, maxDistance), -maxDistance);

    setPosition(normalizedDistance);
    const normalized = normalizedDistance / maxDistance;
    setNormalizedPosition(normalized);
    reportChange(normalized);
  };

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove);
      window.addEventListener('touchend', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [dragging]);

  return (
    <div className={styles.joystickWrapper}>
      {label && <div className={styles.joystickLabel + ' text-base-content'}>{label}</div>}
      <div 
        className={styles.joystickContainer1D} 
        style={{ 
          height: vertical ? size : size / 4,
          width: vertical ? size / 4 : size
        }}
      >
        <div
          ref={containerRef}
          className={vertical ? styles.joystickBase1DVertical : styles.joystickBase1DHorizontal}
          style={{ backgroundColor: baseColor }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleMouseDown}
        >
          <div
            className={vertical ? styles.joystickStick1DVertical : styles.joystickStick1DHorizontal}
            style={{
              backgroundColor: stickColor,
              transform: vertical 
                ? `translateY(${-position}px)` 
                : `translateX(${position}px)`,
              opacity: disabled ? 0.5 : 1,
            }}
          />
        </div>
      </div>
      <div className={styles.coordinates}>
        <span className='text-base-content'>{normalizedPosition.toFixed(2)}</span>
      </div>
    </div>
  );
};