"use client";

import { useState } from "react";
import { titleCase } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import MeTab from "./MeTab";
import LeaderboardTab from "./LeaderboardTab";
import ManageTab from "./ManageTab";
import { monthLabel } from "@/lib/hours/rates";

export default function AchievementsApp({
  season,
  me,
  podium,
  branches,
  myBranch,
  monthlyTitle,
  recentHonours,
  myCerts,
  certTypes,
  myHonours,
  myNominations,
  iNominatedThisMonth,
  colleagues,
  isAdmin,
  admin,
}) {
  const [tab, setTab] = useState("me");
  const pendingForAdmin = (admin?.pendingCerts?.length || 0) + (admin?.pendingNominations?.length || 0);

  return (
    <div className="px-4 py-6 sm:p-8 max-w-5xl">
      <div className="mb-6">
        <PageHeading
          route="/achievements"
          icon="trophy"
          title="Achievements"
          subtitle={
            <>
              Your Quran habit, your hafalan milestones, and the recognition of the people you work with.{" "}
              <span className="text-charcoal-soft/80">Season: {monthLabel(season)}.</span>
            </>
          }
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-1 rounded-control bg-paper-deep p-1 w-fit">
        <Tab active={tab === "me"} onClick={() => setTab("me")} icon="star">
          Me
        </Tab>
        <Tab active={tab === "branch"} onClick={() => setTab("branch")} icon="map-pin">
          {myBranch ? titleCase(myBranch) : "Branch"}
        </Tab>
        <Tab active={tab === "everyone"} onClick={() => setTab("everyone")} icon="users">
          Everyone
        </Tab>
        {isAdmin && (
          <Tab active={tab === "manage"} onClick={() => setTab("manage")} icon="settings">
            Manage{pendingForAdmin ? ` (${pendingForAdmin})` : ""}
          </Tab>
        )}
      </div>

      {tab === "me" && (
        <MeTab
          me={me}
          season={season}
          myCerts={myCerts}
          certTypes={certTypes}
          myHonours={myHonours}
          myNominations={myNominations}
        />
      )}

      {tab === "branch" && (
        <LeaderboardTab
          scope="branch"
          season={season}
          me={me}
          rows={podium.branch}
          branches={branches}
          myBranch={myBranch}
        />
      )}

      {tab === "everyone" && (
        <LeaderboardTab
          scope="org"
          season={season}
          me={me}
          rows={podium.org}
          allTime={podium.allTime}
          branches={branches}
          monthlyTitle={monthlyTitle}
          recentHonours={recentHonours}
          colleagues={colleagues}
          iNominatedThisMonth={iNominatedThisMonth}
        />
      )}

      {tab === "manage" && admin && <ManageTab season={season} admin={admin} certTypes={certTypes} />}
    </div>
  );
}

function Tab({ active, onClick, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-[9px] px-3.5 py-2 text-[13px] font-semibold transition-colors ${
        active ? "bg-white text-charcoal shadow-[0_1px_3px_rgba(59,55,43,0.10)]" : "text-charcoal-soft hover:text-charcoal"
      }`}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}
