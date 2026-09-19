"use client";

import { useState } from "react";
import SlingNav from "@/components/admin/SlingNav";
import ShiftsAdmin from "@/components/admin/ShiftsAdmin";
import HoursAdmin from "@/components/admin/HoursAdmin";
import PayrollReport from "@/components/admin/PayrollReport";
import RosterSettings from "@/components/admin/RosterSettings";
import PositionsPanel from "@/components/admin/PositionsPanel";
import { EmployeesReference, LocationsReference } from "@/components/admin/RosterReference";
import { SHIFT_LOCATIONS } from "@/lib/hours/locations";

// Shift Roster — everything that was Sling, on one tab with Sling's own tile
// menu across the top.
//
// Karim, 17 Sep: "i find the admin view very messy. i want the Sling functions
// to be on its own… the menu at the top can be as attached from the sling so i
// can see and access easily the pages i need to go to."
//
// So the Admin page now has two tabs — Admin (accounts, invitations, access)
// and this — and the seven tiles below are the pages. Three of Sling's tiles
// (Groups, Tags, Announcements) are deliberately absent: LQK has nothing behind
// them, and a tile that opens an empty page makes somebody wonder what they
// have failed to set up.
//
// WHAT A CENTRE IT HEAD SEES. Schedule, Employees, Positions and Locations —
// the four that are about rostering. Work hours, Labour cost and Settings are
// full-admin only, because the first two are pay and the third can stop every
// teacher in the company clocking in.

export default function ShiftRoster({
  teachers,
  locations,
  shiftLocations,
  initialShifts,
  initialHours,
  initialPayroll,
  fullAdmin,
  managedBranches,
  fenceOn = null,
  positions = null,
}) {
  const [section, setSection] = useState("schedule");

  const missed = initialShifts?.missed?.length || 0;
  const uncovered = initialShifts?.relief?.uncovered?.length || 0;
  const pendingHours = initialHours?.pending?.length || 0;

  const tiles = [
    {
      key: "schedule",
      label: "Schedule",
      icon: "calendar",
      // No count: "how many shifts" depends on which month you are looking at,
      // and a number that changes when you page the calendar is noise on a
      // navigation tile. The stat strip inside answers it for the month shown.
      count: null,
      // One badge, for the two things that need somebody to act.
      badge: missed + uncovered || null,
      hint: "The month and week calendar, plus attendance, missed clock-ins and the relief board",
    },
    {
      key: "employees",
      label: "Employees",
      icon: "users",
      count: teachers.length,
      hint: "Who can be rostered, with their position and centre",
    },
    {
      key: "positions",
      label: "Positions",
      icon: "clipboard-check",
      // The LIVE count, not the code list's — the point of the screen is that
      // Karim can change it, so the tile has to follow.
      count: (positions || []).filter((p) => !p.archivedAt).length || null,
      hint: fullAdmin
        ? "Add, rename and archive the positions a shift can be worked in"
        : "The positions a shift can be worked in, and which pay as teaching",
    },
    {
      key: "locations",
      label: "Locations",
      icon: "map-pin",
      count: SHIFT_LOCATIONS.length,
      hint: "Where a shift can be, and whether clocking in there is checked",
    },
  ];

  if (fullAdmin) {
    tiles.push(
      {
        key: "hours",
        label: "Work hours",
        icon: "clock",
        count: null,
        badge: pendingHours || null,
        hint: "Approve or reject clock-ins, and the month's totals",
      },
      {
        key: "cost",
        label: "Labour cost",
        icon: "dollar-sign",
        count: null,
        hint: "The monthly payroll report, and the CSV export",
      },
      {
        key: "settings",
        label: "Settings",
        icon: "settings",
        count: null,
        hint: "Public holidays and the clock-in location check",
      }
    );
  }

  return (
    <div>
      <SlingNav items={tiles} active={section} onSelect={setSection} />

      {section === "schedule" && (
        <ShiftsAdmin
          teachers={teachers}
          locations={shiftLocations}
          initial={initialShifts}
          positions={positions}
          fullAdmin={fullAdmin}
          managedBranches={managedBranches}
        />
      )}

      {section === "employees" && <EmployeesReference teachers={teachers} locations={locations} />}
      {/* Editable for a full admin, read-only for a centre IT Head: the list
          decides how every shift is classified on the payroll report. */}
      {section === "positions" && <PositionsPanel canEdit={fullAdmin} />}
      {section === "locations" && <LocationsReference fenceOn={fenceOn} />}

      {/* Guarded again here, not only by the tile list. The tile being absent
          stops a click; it does not stop a `section` value arriving some other
          way, and these three are pay and the clock-in switch. */}
      {section === "hours" && fullAdmin && initialHours && <HoursAdmin initial={initialHours} />}
      {section === "cost" && fullAdmin && initialPayroll && <PayrollReport initial={initialPayroll} />}
      {section === "settings" && fullAdmin && <RosterSettings />}
    </div>
  );
}
