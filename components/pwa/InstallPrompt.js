"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

const DISMISS_KEY = "lqk-install-dismissed";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true
  );
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function isIOSSafari() {
  const ua = navigator.userAgent;
  return isIOS() && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

// Registers the service worker and offers install: a one-tap button on Android/
// Chrome (via beforeinstallprompt), or an "Add to Home Screen" hint on iOS
// Safari (which has no install API). Hidden when already installed or dismissed.
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    if (isStandalone()) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    if (dismissed) return;

    if (isIOSSafari()) {
      setIos(true);
      setShow(true);
      return;
    }

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  }

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-card border-[0.5px] border-line bg-white p-3.5 shadow-[0_12px_40px_rgba(58,48,38,0.18)] sm:inset-x-auto sm:right-4">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="h-11 w-11 flex-none rounded-[12px]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-charcoal">Install LQK Teachers</div>
          {ios ? (
            <p className="mt-0.5 text-[12px] leading-relaxed text-charcoal-soft">
              Tap{" "}
              <span className="inline-flex h-4 w-4 -translate-y-px items-center justify-center align-middle text-ink">
                <Icon name="share" size={13} />
              </span>{" "}
              Share, then <strong className="font-semibold text-charcoal">Add to Home Screen</strong>.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-relaxed text-charcoal-soft">
              Add it to your home screen for one-tap access.
            </p>
          )}
          {!ios && (
            <button
              type="button"
              onClick={install}
              className="mt-2 rounded-control bg-ink px-3.5 py-2 text-[12px] font-semibold text-paper transition-colors hover:bg-ink-deep"
            >
              Install
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-charcoal-soft hover:bg-paper-deep"
        >
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>
  );
}
