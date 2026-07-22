"use client";

import Icon from "@/components/Icon";

export default function VerseCard({ verse, state, store, onWordTap, cardRef }) {
  const p = state.playback;
  const isCurrent = p.verseKey === verse.verseKey;
  const isPlaying = isCurrent && (p.playing || p.loading);
  const isActive = isCurrent && p.continuous;
  const isBookmarked = state.bookmark && state.bookmark.verseKey === verse.verseKey;

  return (
    <article
      ref={cardRef}
      className={`bg-white rounded-card p-5 mb-4 border-[0.5px] transition-colors ${
        isActive ? "border-ink ring-1 ring-ink" : "border-line"
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="bg-sage-soft text-sage text-[11px] font-bold rounded-pill px-2.5 py-1">
          Ayah {verse.number}
        </span>
        <div className="ml-auto flex gap-2">
          <IconButton
            on={isBookmarked}
            label={isBookmarked ? "Bookmarked" : "Bookmark this ayah"}
            title="Save your place"
            onClick={() => store.setBookmark(verse.verseKey)}
          >
            <Icon name="bookmark" size={15} filled={isBookmarked} />
          </IconButton>
          <IconButton
            on={isPlaying}
            label={isPlaying ? "Pause" : "Play this ayah"}
            onClick={() => store.togglePlay(verse.verseKey)}
          >
            <Icon name={isPlaying ? "pause" : "play"} size={14} />
          </IconButton>
        </div>
      </div>

      <p className="font-arabic text-right leading-[2.1] text-[30px] text-charcoal" lang="ar" dir="rtl">
        {verse.words.length > 0
          ? verse.words.map((w, i) => (
              <span key={i}>
                <span
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer rounded px-0.5 hover:bg-gold-soft/50 focus:bg-gold-soft/50 focus:outline-none"
                  onClick={() => onWordTap(w)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onWordTap(w);
                    }
                  }}
                >
                  {w.text}
                </span>{" "}
              </span>
            ))
          : verse.textUthmani}
      </p>

      {state.showText && (verse.transliteration || verse.translation) && (
        <div className="border-t-[0.5px] border-line mt-4 pt-3 space-y-1.5">
          {verse.transliteration && (
            <p className="italic text-[13px] text-charcoal-soft">{verse.transliteration}</p>
          )}
          {verse.translation && <p className="text-[14px] text-charcoal">{verse.translation}</p>}
        </div>
      )}
    </article>
  );
}

function IconButton({ on, label, title, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title || label}
      onClick={onClick}
      className={`w-9 h-9 rounded-full text-[13px] flex items-center justify-center border-[0.5px] transition-colors ${
        on
          ? "bg-ink border-ink text-paper"
          : "bg-white border-line text-charcoal-soft hover:bg-paper-deep hover:text-charcoal"
      }`}
    >
      {children}
    </button>
  );
}
