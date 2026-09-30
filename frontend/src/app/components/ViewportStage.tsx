'use client';

import React, { useLayoutEffect, useRef } from 'react';

// Keep the established desktop layout while fitting the available display.
const DESIGN_WIDTH = 1508;
const DESIGN_HEIGHT = 825;

export function stageDimensions(width: number, height: number) {
  const portrait = width < 760 && height > width;
  const scale = portrait ? 1 : Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  return { scale, width: width / scale, height: height / scale };
}

export default function ViewportStage({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const area = areaRef.current;
    const stage = stageRef.current;
    if (!viewport || !area || !stage) return;

    const update = () => {
      const visible = window.visualViewport;
      viewport.style.width = `${visible?.width ?? window.innerWidth}px`;
      viewport.style.height = `${visible?.height ?? window.innerHeight}px`;
      viewport.style.left = `${visible?.offsetLeft ?? 0}px`;
      viewport.style.top = `${visible?.offsetTop ?? 0}px`;
      const { width, height, scale } = stageDimensions(area.clientWidth, area.clientHeight);
      if (!Number.isFinite(scale) || scale <= 0) return;
      stage.style.width = `${width}px`;
      stage.style.height = `${height}px`;
      stage.style.transform = `scale(${scale})`;
      stage.style.setProperty('--craft-stage-width', `${width}px`);
      stage.style.setProperty('--craft-stage-height', `${height}px`);
      stage.style.setProperty('--craft-stage-scale', String(scale));
    };

    const observer = new ResizeObserver(update);
    observer.observe(area);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return <div ref={viewportRef} className="craft-viewport">
    <div ref={areaRef} className="craft-viewport-area">
      <div ref={stageRef} className="craft-stage">{children}</div>
    </div>
  </div>;
}
