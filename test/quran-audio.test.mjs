// Recitation audio URLs.
//
// The Quran.com API hands back audio paths in three different shapes, and the
// reader has to play all of them. Three reciters — Mahmoud Khalil Al-Husary,
// Al-Husary (Muallim) and Mohamed al-Tablawi — are served from the everyayah
// mirror and come back PROTOCOL-RELATIVE ("//mirrors.quranicaudio.com/…").
// Those used to be treated as CDN-relative paths, which built
// audio.qurancdn.com/mirrors.quranicaudio.com/… → 404, so those three reciters
// silently refused to play on every single surah. Reported from An-Naba'.
//
// Run with `npm test`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { audioUrl } from "../lib/quran/data.js";

describe("audioUrl", () => {
  test("a CDN-relative path gets the Quran.com audio host", () => {
    assert.equal(
      audioUrl("Alafasy/mp3/078001.mp3"),
      "https://audio.qurancdn.com/Alafasy/mp3/078001.mp3"
    );
    assert.equal(
      audioUrl("AbdulBaset/Murattal/mp3/078001.mp3"),
      "https://audio.qurancdn.com/AbdulBaset/Murattal/mp3/078001.mp3"
    );
  });

  test("a protocol-relative mirror url keeps its own host — the Husary/Tablawi bug", () => {
    assert.equal(
      audioUrl("//mirrors.quranicaudio.com/everyayah/Husary_64kbps/078001.mp3"),
      "https://mirrors.quranicaudio.com/everyayah/Husary_64kbps/078001.mp3"
    );
    assert.equal(
      audioUrl("//mirrors.quranicaudio.com/everyayah/Husary_Muallim_128kbps/078001.mp3"),
      "https://mirrors.quranicaudio.com/everyayah/Husary_Muallim_128kbps/078001.mp3"
    );
    assert.equal(
      audioUrl("//mirrors.quranicaudio.com/everyayah/Mohammad_al_Tablaway_128kbps/078001.mp3"),
      "https://mirrors.quranicaudio.com/everyayah/Mohammad_al_Tablaway_128kbps/078001.mp3"
    );
  });

  test("an already-absolute url is left alone", () => {
    assert.equal(
      audioUrl("https://mirrors.quranicaudio.com/everyayah/Husary_64kbps/078001.mp3"),
      "https://mirrors.quranicaudio.com/everyayah/Husary_64kbps/078001.mp3"
    );
    assert.equal(audioUrl("http://example.com/a.mp3"), "http://example.com/a.mp3");
  });

  test("a single leading slash is a CDN path, not a host", () => {
    assert.equal(audioUrl("/Alafasy/mp3/001001.mp3"), "https://audio.qurancdn.com/Alafasy/mp3/001001.mp3");
  });

  test("nothing in, nothing out — never the bare CDN host", () => {
    assert.equal(audioUrl(""), "");
    assert.equal(audioUrl(null), "");
    assert.equal(audioUrl(undefined), "");
  });
});
