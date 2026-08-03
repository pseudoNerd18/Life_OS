import { AssistantChat } from "@/components/assistant/chat";

export default function AssistantPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="border-b border-border px-6 lg:px-10 py-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Assistant</p>
          <h1 className="mt-0.5 font-display text-2xl italic">Tell me what you&apos;re thinking.</h1>
        </div>
      </header>
      <AssistantChat />
    </div>
  );
}
