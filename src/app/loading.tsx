export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="skeleton h-9 w-64" />
      <div className="mt-2 skeleton h-4 w-96 max-w-full" />
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-raised p-4">
            <div className="skeleton h-3 w-20" />
            <div className="mt-2 skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-8 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 w-full rounded-xl" />
        ))}
      </div>
      <span className="sr-only" role="status">Loading</span>
    </div>
  );
}
