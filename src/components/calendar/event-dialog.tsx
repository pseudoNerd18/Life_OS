"use client";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Task, CalendarEvent } from "@prisma/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox, Label } from "@/components/ui/primitives";
import { useTasks } from "@/stores/tasks";
import { useCalendarEvents } from "@/stores/calendar-events";

/** What the dialog is currently open for. `null` means closed. */
export type CalendarTarget =
  | { mode: "create"; date: Date }
  | { mode: "edit"; kind: "task"; task: Task }
  | { mode: "edit"; kind: "event"; event: CalendarEvent };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromInputs(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

export function CalendarItemDialog({
  target,
  onClose,
}: {
  target: CalendarTarget | null;
  onClose: () => void;
}) {
  const addEvent = useCalendarEvents((s) => s.add);
  const updateEvent = useCalendarEvents((s) => s.update);
  const removeEvent = useCalendarEvents((s) => s.remove);
  const updateTask = useTasks((s) => s.update);
  const removeTask = useTasks((s) => s.remove);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    if (target.mode === "create") {
      const start = new Date(target.date);
      start.setHours(9, 0, 0, 0);
      const end = new Date(start.getTime() + 30 * 60_000);
      setTitle("");
      setDescription("");
      setLocation("");
      setAllDay(false);
      setStartDate(toDateInput(start));
      setStartTime(toTimeInput(start));
      setEndDate(toDateInput(end));
      setEndTime(toTimeInput(end));
    } else if (target.kind === "event") {
      const e = target.event;
      setTitle(e.title);
      setDescription(e.description ?? "");
      setLocation(e.location ?? "");
      setAllDay(e.allDay);
      setStartDate(toDateInput(new Date(e.startAt)));
      setStartTime(toTimeInput(new Date(e.startAt)));
      setEndDate(toDateInput(new Date(e.endAt)));
      setEndTime(toTimeInput(new Date(e.endAt)));
    } else {
      const t = target.task;
      const start = t.dueAt ? new Date(t.dueAt) : new Date();
      const end = new Date(start.getTime() + (t.durationMin ?? 30) * 60_000);
      setTitle(t.title);
      setDescription(t.description ?? "");
      setLocation("");
      setAllDay(false);
      setStartDate(toDateInput(start));
      setStartTime(toTimeInput(start));
      setEndDate(toDateInput(end));
      setEndTime(toTimeInput(end));
    }
  }, [target]);

  if (!target) return null;
  const isEdit = target.mode === "edit";
  const isTask = isEdit && target.kind === "task";

  async function handleSubmit() {
    if (!target || !title.trim()) return;
    setSaving(true);
    const start = allDay ? fromInputs(startDate, "00:00") : fromInputs(startDate, startTime);
    const end = allDay ? fromInputs(endDate, "00:00") : fromInputs(endDate, endTime);
    try {
      if (target.mode === "create") {
        await addEvent({
          title: title.trim(),
          description: description || null,
          location: location || null,
          allDay,
          startAt: start,
          endAt: end,
        });
      } else if (target.kind === "event") {
        await updateEvent(target.event.id, {
          title: title.trim(),
          description: description || null,
          location: location || null,
          allDay,
          startAt: start,
          endAt: end,
        });
      } else {
        const durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
        await updateTask(target.task.id, {
          title: title.trim(),
          description: description || null,
          dueAt: start,
          durationMin,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!target || target.mode !== "edit" || saving) return;
    setSaving(true);
    try {
      if (target.kind === "event") await removeEvent(target.event.id);
      else await removeTask(target.task.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target.mode === "create" ? "New event" : isTask ? "Edit task" : "Edit event"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />

          <div className="flex items-center gap-2">
            <Checkbox
              id="all-day"
              checked={allDay}
              onCheckedChange={(v) => setAllDay(!!v)}
              disabled={isTask}
            />
            <Label htmlFor="all-day">All day</Label>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Starts</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1 min-w-0"
                />
                {!allDay && (
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-32 shrink-0"
                  />
                )}
              </div>
            </div>
            {!isTask && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Ends</Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="flex-1 min-w-0"
                  />
                  {!allDay && (
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-32 shrink-0"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {!isTask && (
            <Input
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}

          <Textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          {isEdit ? (
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={saving} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving || !title.trim()}>
              {target.mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
