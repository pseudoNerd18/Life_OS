"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/primitives";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";

export function NewGoal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          targetDate: targetDate ? new Date(targetDate).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error();
      const goal = (await res.json()) as { id: string };

      // Trigger AI planner in background
      fetch("/api/ai/plan-goal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalId: goal.id }),
      }).catch(() => {});

      toast("Goal created — drafting plan…");
      setOpen(false);
      setTitle(""); setDescription(""); setTargetDate("");
      router.refresh();
      router.push(`/goals/${goal.id}`);
    } catch {
      toast.error("Failed to create goal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" /> New goal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
          <DialogDescription>
            Describe it the way you&apos;d describe it to a friend. The assistant will draft milestones.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 mt-2">
          <div className="grid gap-1.5">
            <Label htmlFor="g-title">Goal</Label>
            <Input
              id="g-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Prepare for GATE exam"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="g-desc">Notes (optional)</Label>
            <Textarea
              id="g-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything you want the planner to know."
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="g-date">Target date (optional)</Label>
            <Input
              id="g-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
