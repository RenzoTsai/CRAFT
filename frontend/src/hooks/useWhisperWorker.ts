import { useState } from "react";

export interface MessageEventHandler {
    (event: MessageEvent): void;
}

// Keep a global singleton worker across hot reloads / component remounts
declare const globalThis: {
    __whisperWorker?: Worker;
} & typeof global;

export function useWhisperWorker(messageEventHandler: MessageEventHandler): Worker | null {
    const [worker] = useState(() => getOrCreateWorker(messageEventHandler));
    return worker;
}

function getOrCreateWorker(messageEventHandler: MessageEventHandler): Worker | null {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
        console.warn('Worker not available in this environment (SSR)');
        return null;
    }

    if (globalThis.__whisperWorker) {
        // Attach new listener and reuse existing worker
        globalThis.__whisperWorker.addEventListener("message", messageEventHandler);
        return globalThis.__whisperWorker;
    }

    const worker = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), {
        type: "module",
    });
    worker.addEventListener("message", messageEventHandler);
    globalThis.__whisperWorker = worker;
    return worker;
}
