import { create } from "zustand";
import type { ExtractedIntent } from "@/lib/validation";

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  intent?: ExtractedIntent;
  createdAt: number;
  pending?: boolean;
}

interface AssistantState {
  conversationId: string | null;
  messages: ChatMessage[];
  sending: boolean;
  setConversation: (id: string | null) => void;
  push: (m: ChatMessage) => void;
  patch: (id: string, patch: Partial<ChatMessage>) => void;
  reset: () => void;
  setSending: (b: boolean) => void;
}

export const useAssistant = create<AssistantState>((set) => ({
  conversationId: null,
  messages: [],
  sending: false,
  setConversation: (id) => set({ conversationId: id }),
  push: (m) => set((s) => ({ messages: [...s.messages, m] })),
  patch: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  reset: () => set({ conversationId: null, messages: [], sending: false }),
  setSending: (b) => set({ sending: b }),
}));

interface VoiceState {
  recording: boolean;
  transcribing: boolean;
  transcript: string;
  preview: ExtractedIntent | null;
  language: string;
  setRecording: (b: boolean) => void;
  setTranscribing: (b: boolean) => void;
  setTranscript: (t: string) => void;
  setPreview: (p: ExtractedIntent | null) => void;
  setLanguage: (l: string) => void;
  reset: () => void;
}

export const useVoice = create<VoiceState>((set) => ({
  recording: false,
  transcribing: false,
  transcript: "",
  preview: null,
  language: "en",
  setRecording: (b) => set({ recording: b }),
  setTranscribing: (b) => set({ transcribing: b }),
  setTranscript: (t) => set({ transcript: t }),
  setPreview: (p) => set({ preview: p }),
  setLanguage: (l) => set({ language: l }),
  reset: () => set({ recording: false, transcribing: false, transcript: "", preview: null }),
}));
