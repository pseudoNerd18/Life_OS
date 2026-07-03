/**
 * Route-segment loading UI. Next renders this instantly while the server
 * component streams — so navigating between workspace pages feels immediate
 * instead of frozen.
 */
export default function AppLoading() {
  return (
    <div className="flex-1 px-6 lg:px-10 py-8 max-w-6xl mx-auto w-full">
      <div className="animate-pulse space-y-8">
        {/* header */}
        <div className="space-y-3">
          <div className="h-3 w-24 rounded bg-secondary" />
          <div className="h-10 w-72 rounded-lg bg-secondary" />
        </div>
        {/* a tall card */}
        <div className="h-28 rounded-xl bg-secondary/70" />
        {/* a row */}
        <div className="h-12 rounded-xl bg-secondary/50" />
        {/* grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-80 rounded-xl bg-secondary/60" />
          <div className="space-y-6">
            <div className="h-36 rounded-xl bg-secondary/60" />
            <div className="h-36 rounded-xl bg-secondary/60" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
