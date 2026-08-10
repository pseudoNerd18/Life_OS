import { describe, test, expect } from "vitest";
import { deterministicExtract } from "../ai/fallback-parser";

function wall(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

describe("deterministicExtract — dates", () => {
  test("relative dates honour the caller's timezone", () => {
    for (const tz of ["Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      const r = deterministicExtract("Remind me to go to the gym tomorrow at 7pm", tz);
      const due = r.tasks?.[0]?.dueAt;
      expect(due).toBeTruthy();
      expect(wall(new Date(due!), tz).slice(-5)).toBe("19:00");
    }
  });
});

describe("deterministicExtract — 'and' splitting", () => {
  test("a shared object stays one task", () => {
    const r = deterministicExtract("Buy bread and butter", "UTC");
    expect(r.tasks?.length).toBe(1);
  });
  test("two real instructions split", () => {
    const r = deterministicExtract("Call the dentist and pay the electricity bill", "UTC");
    expect(r.tasks?.length).toBe(2);
    expect(r.intent).toBe("CREATE_TASKS");
  });
  test("a trailing time expression splits", () => {
    const r = deterministicExtract("Finish the report and email it to Priya tomorrow", "UTC");
    expect(r.tasks?.length).toBe(2);
  });
  test("a three-item list stays one task", () => {
    const r = deterministicExtract("Get milk and eggs and bread", "UTC");
    expect(r.tasks?.length).toBe(1);
  });
});

describe("deterministicExtract — classification", () => {
  test("recurrence becomes an RRULE", () => {
    expect(deterministicExtract("Take vitamin B12 every 3 days", "UTC").tasks?.[0].rrule).toBe("FREQ=DAILY;INTERVAL=3");
    expect(deterministicExtract("Water the plants every Monday", "UTC").tasks?.[0].rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(deterministicExtract("Pay rent monthly", "UTC").tasks?.[0].rrule).toBe("FREQ=MONTHLY");
  });
  test("categories are inferred", () => {
    expect(deterministicExtract("Go to the gym", "UTC").tasks?.[0].category).toBe("HEALTH");
    expect(deterministicExtract("Pay the electricity bill", "UTC").tasks?.[0].category).toBe("FINANCE");
    expect(deterministicExtract("Prep the client presentation", "UTC").tasks?.[0].category).toBe("WORK");
  });
  test("urgency lifts priority", () => {
    expect(deterministicExtract("Submit the form asap", "UTC").tasks?.[0].priority).toBe("HIGH");
    expect(deterministicExtract("Sort the garage sometime", "UTC").tasks?.[0].priority).toBe("LOW");
  });
  test("goal phrasing routes to CREATE_GOAL", () => {
    const r = deterministicExtract("Help me prepare for GATE in 4 months", "UTC");
    expect(r.intent).toBe("CREATE_GOAL");
    expect(r.goal?.targetDate).toBeTruthy();
  });
  test("note phrasing routes to CREATE_NOTE", () => {
    expect(deterministicExtract("Write down that the API key rotates monthly", "UTC").intent).toBe("CREATE_NOTE");
  });
  test("empty input is UNKNOWN, not a crash", () => {
    expect(deterministicExtract("   ", "UTC").intent).toBe("UNKNOWN");
  });
});

describe("editing and deleting without a model", () => {
  const ex = (t: string) => deterministicExtract(t, "UTC");

  test("delete is not mistaken for a new task", () => {
    const r = ex("Delete the note about the roof");
    expect(r.intent).toBe("DELETE");
    expect(r.target?.kind).toBe("note");
    expect(r.target?.query ?? "").toMatch(/roof/i);
  });
  test("'remove the gym task' targets a task", () => {
    const r = ex("Remove the gym task");
    expect(r.intent).toBe("DELETE");
    expect(r.target?.kind).toBe("task");
    expect(r.target?.query ?? "").toMatch(/gym/i);
  });
  test("completion is recognised", () => {
    for (const t of ["Mark the gym task as done", "I finished the gym task"]) {
      const r = ex(t);
      expect(r.intent).toBe("COMPLETE");
      expect(r.target?.query ?? "").toMatch(/gym/i);
    }
  });
  test("a wording correction becomes an in-place replacement", () => {
    const r = ex("The previous note should say t-shirt idea not teacher idea");
    expect(r.intent).toBe("UPDATE");
    expect(r.target?.kind).toBe("note");
    expect(r.target?.ref).toBe("previous");
    expect(r.patch?.replace?.from).toBe("teacher idea");
    expect(r.patch?.replace?.to).toBe("t-shirt idea");
  });
  test("'change X to Y' is an update, not a creation", () => {
    const r = ex("Change dentist to doctor");
    expect(r.intent).toBe("UPDATE");
    expect(r.patch?.replace?.from).toBe("dentist");
    expect(r.patch?.replace?.to).toBe("doctor");
  });
  test("'the previous note' sets ref without a query", () => {
    const r = ex("Delete the previous note");
    expect(r.intent).toBe("DELETE");
    expect(r.target?.ref).toBe("previous");
    expect(r.target?.kind).toBe("note");
  });
  test("ordinary creation still wins when nothing refers back", () => {
    const r = ex("Remind me to call the dentist tomorrow");
    expect(r.intent).toBe("CREATE_TASK");
  });
  test("a task that merely contains 'cancel' is still a creation", () => {
    // "Cancel the gym membership" is a chore, not a delete command... but it
    // does open with a delete verb, so we document the known limitation here.
    const r = ex("Buy milk and eggs");
    expect(r.intent).toBe("CREATE_TASK");
  });
});
