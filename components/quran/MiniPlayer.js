"use client";

import Icon from "@/components/Icon";

export default function MiniPlayer({ state, store }) {
  const p = state.playback;
  const total = state.verses.length;
  const currentIndex = p.verseKey ? state.verses.findIndex((v) => v.verseKey === p.verseKey) : -1;
  const isPlaying = p.playing || p.loading;
  const scroll = state.autoscroll;

  return (
    <div className="flex-none border-t-[0.5px] border-line bg-white px-5 py-3">
      <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-3">
        <select
          aria-label="Reciter"
          value={state.reciterId}
          onChange={(e) => store.setReciterId(e.target.value)}
          className="min-w-0 flex-1 rounded-control border-[0.5px] border-line bg-paper px-3 py-2 text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
        >
          {state.reciters.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.style ? ` (${r.style})` : ""}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <ControlButton label="Previous ayah" onClick={() => store.prev()}>
            <Icon name="skip-back" size={16} />
          </ControlButton>
          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play surah"}
            onClick={() => (isPlaying ? store.pause() : store.playChapter())}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-paper shadow-sm transition-colors hover:bg-ink-deep"
          >
            <Icon name={isPlaying ? "pause" : "play"} size={18} />
          </button>
          <ControlButton label="Next ayah" onClick={() => store.next()}>
            <Icon name="skip-forward" size={16} />
          </ControlButton>
        </div>

        <div className="flex w-full items-center gap-3">
          <span className="text-[12px] text-charcoal-soft">
            {currentIndex >= 0 ? `Ayah ${currentIndex + 1} of ${total}` : total > 0 ? `${total} ayahs` : ""}
          </span>

          {/* Hands-free constant-speed auto-scroll */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              role="switch"
              aria-checked={scroll.active}
              onClick={() => store.toggleAutoscroll()}
              title="Scroll the page automatically at a steady speed"
              className={`flex items-center gap-1.5 rounded-pill border-[0.5px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                scroll.active ? "border-ink bg-ink text-paper" : "border-line bg-white text-charcoal-soft hover:text-charcoal"
              }`}
            >
              <Icon name="chevrons-down" size={14} />
              Auto-scroll
            </button>
            {scroll.active && (
              <div className="flex items-center gap-1">
                <StepButton
                  label="Slower"
                  disabled={scroll.speed <= 1}
                  onClick={() => store.setAutoscrollSpeed(scroll.speed - 1)}
                >
                  <Icon name="minus" size={13} />
                </StepButton>
                <span className="w-4 text-center text-[12px] tabular-nums text-charcoal-soft" aria-label="Scroll speed">
                  {scroll.speed}
                </span>
                <StepButton
                  label="Faster"
                  disabled={scroll.speed >= 10}
                  onClick={() => store.setAutoscrollSpeed(scroll.speed + 1)}
                >
                  <Icon name="plus" size={13} />
                </StepButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-[13px] text-charcoal-soft transition-colors hover:bg-paper-deep hover:text-charcoal"
    >
      {children}
    </button>
  );
}

function StepButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft transition-colors hover:bg-paper-deep hover:text-charcoal disabled:opacity-40"
    >
      {children}
    </button>
  );
}
