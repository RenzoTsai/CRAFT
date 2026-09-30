//frontend/src/app/components/ProcessingIndicator.tsx
'use client';

import React from 'react';
import { FaSpinner } from 'react-icons/fa';

interface ProcessingIndicatorProps {
  visible: boolean;
}

export default function ProcessingIndicator({ visible }: ProcessingIndicatorProps) {
  if (!visible) return null;

  return (
    <div className="craft-processing flex flex-col items-center gap-2" role="status">
      <FaSpinner className="animate-spin text-green-500" size={48} />
      <div className="text-green-500 text-sm">Processing...</div>
    </div>
  );
}
