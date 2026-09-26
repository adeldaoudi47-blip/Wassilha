'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { shouldForceUpdate } from '@/lib/version';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * In-app force update gate.
 *
 * Mounted once in the root layout. On every cold start it reads the *installed
 * native* version (Capacitor `App.getInfo().version` = the APK's versionName)
 * and asks /api/version whether that build is older than the server's minimum.
 * If it is, it renders a modal that cannot be dismissed — no close button, no
 * overlay click-through, and the app behind it stays unresponsive — so the only
 * way forward is to download the update.
 *
 * Why the *native* version and not the web bundle's: capacitor.config.ts
 * points `server.url` at the live production site, so this shell always runs
 * the newest JS. The bundle version would therefore read as current even on a
 * months-old APK, and the gate could never fire. Only versionName identifies
 * the outdated installation.
 *
 * Native shells only (`Capacitor.isNativePlatform()`). A browser user is
 * always running the bundle the server just shipped, so there is no APK for
 * them to fetch and a "download the app" lock screen would be meaningless.
 *
 * If `App.getInfo()` rejects *or hangs* — both are tell-tale signs of a v1.0
 * shell that predates the `@capacitor/app` plugin — the gate does NOT give up.
 * A missing plugin can leave the bridge pending forever, so the call is raced
 * against a short timeout; whichever way it fails, the check then proceeds
 * assuming the oldest possible version, so those installs get gated too
 * instead of silently passing as "current" (the web bundle would always say
 * that). Only a failure of the *version endpoint itself* (network down, API
 * 500, malformed body) resolves to no gate, so this can never take the app
 * offline by accident.
 */
export function ForceUpdateGate() {
  const [state, setState] = useState<{
    open: boolean;
    latestVersion?: string;
    apkUrl?: string;
  }>({ open: false });

  useEffect(() => {
    // The version check is only meaningful for an installed app. Bail out
    // before any fetch on the web so the endpoint isn't hit needlessly on
    // every browser page load.
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;

    // A bridge that never resolves AND never rejects is the worst case: an
    // outdated shell with no @capacitor/app plugin can leave the call pending
    // forever, which would freeze the whole check and neither success nor catch
    // would ever run. Cap the wait so we still get an answer either way.
    const GET_INFO_TIMEOUT_MS = 3000;

    const run = async () => {
      // DIAGNOSTIC: confirms the effect actually ran and that we are on a
      // native platform (the web bails out before this point).
      console.info('[ForceUpdate] initializing gate');

      // Assume the oldest build by default. On a v1.0 shell this is the truth
      // (there is no plugin to ask), and it is also the safe direction: a
      // device we cannot identify gets gated rather than waved through.
      let installedVersion = '0.0.0';

      try {
        // Race the native call against a timeout. A missing @capacitor/app
        // plugin can leave the bridge pending forever — neither resolving nor
        // rejecting — which would freeze this await and the gate along with
        // it. The executor wires `rejectOnTimeout` synchronously, so the timer
        // can fire the rejection; `finally` clears it so a fast native call
        // leaves no dangling 3s timer behind.
        let rejectOnTimeout!: (reason: unknown) => void;
        const timer = setTimeout(
          () => rejectOnTimeout(new Error('App.getInfo() timed out')),
          GET_INFO_TIMEOUT_MS
        );
        try {
          // Dynamic import of the Capacitor plugin. `@capacitor/app` is a
          // native-only dependency and its static import used to be evaluated
          // for every browser load too — if that module graph ever fails to
          // resolve on a given build/host (older Capacitor, a tree-shaking
          // surprise, a bundler misconfiguration), a top-level `import { App }`
          // throws during module evaluation and Next turns it into
          // "Application error: a client-side exception has occurred" on a
          // blank page, before this effect can even run. Loading it lazily
          // inside the native branch confines any such failure to the try
          // below, where it is caught and the gate degrades to the same
          // "assume the oldest build" path as a missing plugin.
          const { App } = await import('@capacitor/app');
          const info = await Promise.race([
            App.getInfo(),
            new Promise<never>((_, reject) => {
              rejectOnTimeout = reject;
            }),
          ]);
          // A resolved-but-empty version is treated exactly like no answer:
          // better to assume old than to trust a field we cannot read.
          if (typeof info?.version === 'string' && info.version.trim()) {
            installedVersion = info.version;
          }
        } finally {
          clearTimeout(timer);
        }
        if (cancelled) return;
      } catch {
        // App.getInfo() rejected or timed out: this shell predates
        // @capacitor/app (the v1.0 APK has no such plugin, so the bridge
        // reports it as unimplemented) or hit an OEM WebView quirk. We
        // deliberately do NOT bail out here. Falling back to the web bundle's
        // version would be wrong — the WebView loads the live site, so the
        // bundle always reports the newest build and the gate would never fire
        // for the exact outdated installs we need to block. We keep the
        // '0.0.0' default and let the server decide. If the server is then
        // unreachable, shouldForceUpdate() still fails open, so a broken API
        // can never brick the app.
        console.warn(
          'ForceUpdate: App.getInfo failed or timed out, assuming old version.'
        );
      }

      // Reached on the happy path and on every failure mode. The only thing
      // that can resolve to "no gate" from here is the version endpoint
      // answering minVersion >= installedVersion (or being unreachable, which
      // fails open).
      const result = await shouldForceUpdate(installedVersion);
      if (cancelled) return;

      // Diagnostic: trace the actual decision point. If the modal ever fails to
      // appear on an outdated device, this line distinguishes "the client
      // decided false" (fix the comparison/version plumbing) from "the client
      // decided true and React still did not open the dialog" (fix the view).
      console.info('[ForceUpdate] check complete', {
        installedVersion,
        forceUpdate: result.forceUpdate,
        latestVersion: result.latestVersion,
        apkUrl: result.apkUrl,
      });

      if (!result.forceUpdate) return;

      // DIAGNOSTIC: last possible failure point. If this prints and the modal
      // still does not appear, the defect is in the Dialog render, not the
      // check.
      console.info('[ForceUpdate] showing dialog');

      setState({
        open: true,
        latestVersion: result.latestVersion,
        apkUrl: result.apkUrl,
      });
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show: the installed build is current (or the check failed and
  // we are deliberately failing open).
  if (!state.open) return null;

  const handleDownload = async () => {
    // Fallback to the canonical public APK path if the API omitted a url.
    const url = state.apkUrl ?? 'https://wassilha.vercel.app/wassilha.apk';
    // Inside a Capacitor WebView, window.open() does NOT trigger a file
    // download — the WebView has no download manager, so the APK either opens
    // as a blank/broken page or the call is swallowed entirely. The official
    // @capacitor/browser plugin hands the URL to the *system* browser
    // (Chrome/Safari), whose download manager handles the .apk and shows the
    // OS install prompt — which is the only path that actually installs the
    // update. Loaded dynamically so the plugin module is only resolved on a
    // native shell (the web never reaches this handler anyway, since the gate
    // is native-only).
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } catch {
      // TIER 2 — copy + instruct. Reached when the plugin is missing or
      // rejected: a v1.0 shell that predates @capacitor/browser (the exact
      // outdated installs this gate exists to catch), or a plain browser. We
      // do NOT jump straight to window.open: inside a WebView that call is
      // silently useless, which would strand the user on this modal with a
      // button that appears to do nothing. Copying the URL and telling the
      // user to open the phone browser manually is the reliable escape hatch.
      try {
        await navigator.clipboard.writeText(url);
        alert(
          'تعذر فتح المتصفح الخارجي تلقائياً. تم نسخ رابط التحديث. يرجى فتح متصفح الهاتف (Chrome) ولصق الرابط لتحميل التطبيق.'
        );
      } catch {
        // TIER 3 — last resort. The clipboard API is unavailable or rejected
        // (an old/insecure WebView context, or the permission was denied).
        // Attempt window.open anyway in case a real browser is hosting this,
        // then spell out the raw URL so the user can type it by hand. The
        // short host form is intentional — it is readably short to retype.
        window.open(url, '_blank', 'noopener,noreferrer');
        alert(
          'تعذر تحميل التحديث تلقائياً. يرجى فتح متصفح الهاتف (Chrome) والذهاب إلى: wassilha.vercel.app/wassilha.apk'
        );
      }
    }
  };

  return (
    <Dialog open>
      <DialogContent
        // Hide the X and make the backdrop non-dismissable. Radix also gets
        // `onEscapeKeyDown`/`onPointerDownOutside` swallowed below so the only
        // exit from this screen is the download button.
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-md [&_*]:text-center"
      >
        <DialogHeader>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <ShieldAlert className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-lg font-bold">
            يلزم تحديث التطبيق
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            يتوفر إصدار جديد يحتوي على تحديثات وميزات مهمة. الرجاء تحديث
            التطبيق قبل الاستمرار.
          </DialogDescription>
        </DialogHeader>

        {state.latestVersion && (
          <p className="text-sm font-medium text-muted-foreground">
            الإصدار المتاح:{' '}
            <span className="text-foreground">{state.latestVersion}</span>
          </p>
        )}

        <div className="mt-2 flex flex-col gap-2">
          <Button onClick={handleDownload} size="lg" className="w-full">
            <RefreshCw className="h-4 w-4" />
            تحميل التحديث
          </Button>
          <p className="text-xs text-muted-foreground">
            عند انتهاء التنزيل، ثبّت التحديث ثم أعد فتح التطبيق.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
