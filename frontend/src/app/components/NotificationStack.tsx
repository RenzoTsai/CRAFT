'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';

/** Keep complete notifications clear of the active authoring cards. */
export default function NotificationStack({ children, hasAuthoringContent }: {
  children: React.ReactNode;
  hasAuthoringContent: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [belowCards, setBelowCards] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.craft-authoring-layout > *'));
    const hint = document.querySelector<HTMLElement>('.craft-mode-hint');
    const measure = () => {
      if (!hasAuthoringContent || !element.offsetHeight) {
        setBelowCards(null);
        return;
      }
      const stage = element.closest<HTMLElement>('.craft-stage');
      const bounds = stage?.getBoundingClientRect();
      const scale = stage && bounds ? bounds.width / stage.offsetWidth : 1;
      const width = stage?.offsetWidth ?? window.innerWidth;
      const boxInStage = (node: HTMLElement) => {
        const box = node.getBoundingClientRect();
        return { left: (box.left - (bounds?.left ?? 0)) / scale,
          right: (box.right - (bounds?.left ?? 0)) / scale,
          top: (box.top - (bounds?.top ?? 0)) / scale,
          bottom: (box.bottom - (bounds?.top ?? 0)) / scale };
      };
      const left = width - 20 - element.offsetWidth;
      const bottom = 4 + element.offsetHeight;
      const obstacles = [...cards, ...(hint ? [hint] : [])].map(boxInStage);
      const overlaps = obstacles.some(box => left < box.right && width - 20 > box.left && 4 < box.bottom && bottom > box.top);
      const next = overlaps ? Math.max(...cards.map(card => boxInStage(card).bottom), 80) + 16 : null;
      setBelowCards(previous => previous === next ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    [element, ...(element.closest('.craft-stage') ? [element.closest('.craft-stage')!] : []), ...cards, ...(hint ? [hint] : [])].forEach(node => observer.observe(node));
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [children, hasAuthoringContent]);

  return <div ref={ref} className="craft-notifications"
    style={belowCards === null ? undefined : { top: belowCards, right: 120 }}>
    {children}
  </div>;
}
