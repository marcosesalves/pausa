import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "./hooks/useSettings";
import { useTips } from "./hooks/useTips";
import { useProgress } from "./hooks/useProgress";
import { growthFor } from "./lib/growth";
import { isQuietNow } from "./lib/quiet";
import type { Tip } from "./lib/types";
import { Home, homeStateOf } from "./components/Home";
import { useNextNudge } from "./hooks/useNextNudge";
import { useHistory } from "./hooks/useHistory";
import { Settings } from "./components/Settings";
import { TipHistory } from "./components/TipHistory";
import { Breathe } from "./components/Breathe";
import { Garden } from "./components/Garden";
import { Feedback, type FeedbackKind } from "./components/Feedback";
import { Onboarding } from "./components/Onboarding";
import { CloseNotice } from "./components/CloseNotice";
import { TitleBar } from "./components/TitleBar";
import { isWindows } from "./lib/platform";
import { applyTheme } from "./lib/theme";
import { NavBar, type Tab } from "./components/NavBar";
import { Companion } from "./components/Companion";
import { Icon } from "./components/Icon";

type View = "tips" | "settings" | "history" | "breathe" | "garden" | "feedback";

function Ambient() {
  return (
    <>
      <div className="ambient" aria-hidden="true">
        <span className="ambient__blob ambient__blob--1" />
        <span className="ambient__blob ambient__blob--2" />
        <span className="ambient__blob ambient__blob--3" />
      </div>
      <div className="grain" aria-hidden="true" />
    </>
  );
}

function App() {
  const [view, setView] = useState<View>("tips");
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>("feedback");
  // A Breathe session screen is open: the shell hides the navigation so the session has the whole window
  const [breatheActive, setBreatheActive] = useState(false);
  // Settings opens straight on the categories picker when Home's "Choose categories" sent us there
  const [settingsOpensCategories, setSettingsOpensCategories] = useState(false);
  const { settings, loading, updateSettings } = useSettings();
  const { currentTip, fetchNextTip } = useTips();
  const history = useHistory();
  const progress = useProgress();

  // The tray menu's "Report a bug…" / "Give feedback…" open the form
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("open-feedback", (e) => {
      setFeedbackKind(e.payload === "bug" ? "bug" : "feedback");
      setView("feedback");
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  // The window's close button was pressed for the first time: explain that Pausa keeps running
  const [closeNoticeOpen, setCloseNoticeOpen] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("close-requested", () => setCloseNoticeOpen(true)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);
  const closeNotice = closeNoticeOpen ? <CloseNotice onDone={() => setCloseNoticeOpen(false)} /> : null;
  // Windows has no native title bar (it is switched off at start-up), so the page draws one
  const titleBar = isWindows ? <TitleBar /> : null;

  // Home always has a tip ready: fetch one when the window first opens, so the screen is never an empty
  // "Get a Tip" card. (The ref keeps React's dev double-run from fetching two.)
  const [fetching, setFetching] = useState(false);
  const startedFetch = useRef(false);
  const needsTip = Boolean(settings?.onboarded) && currentTip === null;
  useEffect(() => {
    if (!needsTip || startedFetch.current) return;
    startedFetch.current = true;
    setFetching(true);
    fetchNextTip().finally(() => setFetching(false));
  }, [needsTip, fetchNextTip]);

  // Light, dark or system: the page follows the chosen theme (the backend handles the native window parts)
  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings?.theme]);

  // When the next reminder is due, for "Next nudge in 42 min"
  const nextNudgeAt = useNextNudge(`${settings?.interval_minutes}-${settings?.paused}`);

  // Re-render twice a minute so the quiet-hours state flips while the window stays open
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (loading || !settings) {
    return (
      <div className="mf app">
        <Ambient />
        {titleBar}
        <div
          className="main"
          style={{ justifyContent: "center", alignItems: "center", gap: 14 }}
          aria-busy="true"
        >
          <Companion state="focused" size={88} />
          <span className="loader" role="status" aria-label="Loading">
            <span />
            <span />
            <span />
          </span>
          <span className="view-sub">Finding a tip for you…</span>
        </div>
        {closeNotice}
      </div>
    );
  }

  if (!settings.onboarded) {
    return (
      <div className="mf app">
        <Ambient />
        {titleBar}
        <Onboarding settings={settings} onFinish={updateSettings} />
        {closeNotice}
      </div>
    );
  }

  const name = settings.companion_name || "Pip";
  const showCompanion = settings.show_companion;
  const stage = growthFor(progress.total_pauses).stage.n;
  const quiet = isQuietNow(settings);
  const homeState = homeStateOf(settings, quiet, fetching);

  const backToTips = () => setView("tips");

  // Sections: history belongs to Home, feedback to Settings
  const activeTab: Tab =
    view === "breathe" ? "breathe"
    : view === "garden" ? "garden"
    : view === "settings" || view === "feedback" ? "settings"
    : "home";
  const selectTab = (tab: Tab) => {
    setSettingsOpensCategories(false);
    setView(tab === "home" ? "tips" : tab);
  };

  // "Take a moment": hand the current tip to the focus overlay and get the window out of the way
  const takeAMoment = (tip: Tip) => {
    invoke("show_focus_for", { tip }).catch(console.error);
  };

  const resume = () => updateSettings({ ...settings, paused: false });
  const togglePause = () => updateSettings({ ...settings, paused: !settings.paused });

  // Take a moment works in every state, even paused: with no tip yet it fetches one first
  const takeAMomentNow = async () => {
    const tip = currentTip ?? (await fetchNextTip());
    if (tip) takeAMoment(tip);
  };

  // Open Settings scrolled to one of its sections (the bar's "Change hours" and "Choose categories")
  const openSettingsAt = (sectionId: string) => {
    // "Choose categories" opens the picker itself; "Change hours" scrolls to the quiet-hours card
    setSettingsOpensCategories(sectionId === "settings-categories");
    setView("settings");
    if (sectionId !== "settings-categories") {
      window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ block: "start" }), 80);
    }
  };

  return (
    <div className="mf app">
      <Ambient />
      {titleBar}
      <div className={`shell${breatheActive && view === "breathe" ? " shell--session" : ""}`}>
        <NavBar variant="rail" active={activeTab} onSelect={selectTab} />
        <div className="shell__col">
          {view === "tips" && (
            <header className="shell__head">
              {/* The brand, as in the first beta: the sprout (asleep while resting) and "Pausa" */}
              <h1 className="header-title">
                <Icon name={settings.paused || quiet ? "t-sprout-paused" : "t-sprout"} />
                Pausa
              </h1>
              <div className="header-actions">
                {/* Recent tips: an icon only, next to Pause and Resume */}
                <button
                  className="header-btn"
                  onClick={() => setView("history")}
                  title="Recent tips"
                  aria-label="Recent tips"
                >
                  <Icon name="i-history" />
                </button>
                {/* Pause and Resume always carry their word, never just the icon */}
                <button
                  className={`btn ${settings.paused ? "btn--primary" : "btn--soft"} shell__pause`}
                  onClick={togglePause}
                >
                  <Icon name={settings.paused ? "i-play" : "i-pause"} />
                  <span>{settings.paused ? "Resume" : "Pause"}</span>
                </button>
              </div>
            </header>
          )}

      <main className="main" data-view={view}>
        {view === "tips" && (
          <Home
            state={homeState}
            settings={settings}
            tip={currentTip}
            nextNudgeAt={nextNudgeAt}
            totalPauses={progress.total_pauses}
            showCompanion={showCompanion}
            stage={stage}
            onNextTip={fetchNextTip}
            onTakeAMoment={takeAMoment}
            onTakeAMomentNow={takeAMomentNow}
            onResume={resume}
            onChangeHours={() => openSettingsAt("settings-quiet-hours")}
            onChooseCategories={() => openSettingsAt("settings-categories")}
            onOpenGarden={() => setView("garden")}
          />
        )}
        {view === "settings" && (
          <Settings
            settings={settings}
            onUpdate={updateSettings}
            nextNudgeAt={nextNudgeAt}
            startInCategories={settingsOpensCategories}
            onOpenFeedback={(kind) => {
              setFeedbackKind(kind);
              setView("feedback");
            }}
          />
        )}
        {view === "history" && (
          <TipHistory
            items={history}
            totalPauses={progress.total_pauses}
            onBack={backToTips}
            onGetTip={fetchNextTip}
            showCompanion={showCompanion}
            stage={stage}
          />
        )}
        {view === "breathe" && (
          <Breathe
            onBack={backToTips}
            onSessionChange={setBreatheActive}
            showCompanion={showCompanion}
            stage={stage}
            totalPauses={progress.total_pauses}
          />
        )}
        {view === "feedback" && (
          <Feedback
            initialKind={feedbackKind}
            onBack={backToTips}
            showCompanion={showCompanion}
            stage={stage}
          />
        )}
        {view === "garden" && (
          <Garden
            name={name}
            totalPauses={progress.total_pauses}
            showCompanion={showCompanion}
          />
        )}
      </main>

          <NavBar variant="tabs" active={activeTab} onSelect={selectTab} />
        </div>
      </div>
      {closeNotice}
    </div>
  );
}

export default App;
