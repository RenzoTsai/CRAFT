//frontend/src/app/components/Notification.tsx
'use client';

import React from 'react';

interface NotificationProps {
  notification: { type: string; message: string } | null;
}

export default function Notification({ notification }: NotificationProps) {
  if (!notification) return null;

  const { type, message } = notification;
  const isAISuggestion = type === 'ai_suggestion';

  return (
    <div
      className={`max-w-sm min-w-0 break-words p-3 rounded-lg ${
        isAISuggestion
          ? 'bg-blue-800 border border-blue-500'
          : 'bg-green-800 border border-green-500'
      }`}
    >
      <p>{message}</p>
    </div>
  );
}
