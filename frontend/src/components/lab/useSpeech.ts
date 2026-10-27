"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typing for the Web Speech API (not in TypeScript's DOM lib).
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

/** Browser speech-to-text. `onText` receives the final transcript plus the live interim text. */
export function useSpeech(onText: (finalText: string, interim: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript + " ";
        else interim += res[0].transcript;
      }
      cb.current(finalText.trim(), interim);
    };
    r.onend = () => {
      finalText = "";
      setListening(false);
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech error: ${e.error}`);
      setListening(false);
    };
    rec.current = r;
    queueMicrotask(() => setSupported(true));
    return () => r.stop();
  }, []);

  const toggle = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    setError(null);
    if (listening) {
      r.stop();
      setListening(false);
    } else {
      try {
        r.start();
        setListening(true);
      } catch (err) {
        setError(String(err));
      }
    }
  }, [listening]);

  return { supported, listening, error, toggle };
}
