// Dashboard page — weekly coverage view for managers showing shift staffing status.
import { useState, useEffect, useCallback } from "react";
import * as api from "../api/client";

interface ShiftData {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  req_doctors: number;
  req_nurses: number;
  req_receptionists: number;
  assigned_doctors: number;
  assigned_nurses: number;
  assigned_receptionists: number;
  status: "fully_staffed" | "partially_staffed" | "empty";
  missingRoles: string[];
  totalRequired: number;
  totalAssigned: number;
  assignments: Array<{ userId: number; fullName: string; profession: string }>;
}

function getMonday(dateStr?: string): Date {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h!);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${suffix}`;
}

const STATUS_STYLES = {
  fully_staffed: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    badge: "bg-emerald-500/20 text-emerald-400",
    label: "Fully Staffed",
    dot: "bg-emerald-400",
  },
  partially_staffed: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    badge: "bg-amber-500/20 text-amber-400",
    label: "Partial",
    dot: "bg-amber-400",
  },
  empty: {
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    badge: "bg-rose-500/20 text-rose-400",
    label: "Empty",
    dot: "bg-rose-400",
  },
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function DashboardPage() {
  const [weekStart, setWeekStart] = useState(() =>
    getMonday().toISOString().slice(0, 10)
  );
  const [shifts, setShifts] = useState<ShiftData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCoverage = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCoverage(weekStart);
      setShifts(data.shifts);
    } catch (err) {
      console.error("Failed to load coverage:", err);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    fetchCoverage();
  }, [fetchCoverage]);

  function navigateWeek(delta: number) {
    const current = new Date(weekStart);
    current.setDate(current.getDate() + delta * 7);
    setWeekStart(current.toISOString().slice(0, 10));
  }

  function goToToday() {
    setWeekStart(getMonday().toISOString().slice(0, 10));
  }

  // Group shifts by date for the week view.
  const shiftsByDay = new Map<string, ShiftData[]>();
  const monday = new Date(weekStart);
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    shiftsByDay.set(key, []);
  }
  for (const shift of shifts) {
    const existing = shiftsByDay.get(shift.date);
    if (existing) existing.push(shift);
  }

  const weekEndDate = new Date(monday);
  weekEndDate.setDate(monday.getDate() + 6);

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Coverage Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">
            {formatDate(weekStart)} — {formatDate(weekEndDate.toISOString().slice(0, 10))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateWeek(-1)}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-2 bg-primary-600/20 hover:bg-primary-600/30 border border-primary-500/30 rounded-lg text-sm text-primary-400 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => navigateWeek(1)}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
          >
            Next →
          </button>
          <input
            type="date"
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:ring-2 focus:ring-primary-500 focus:outline-none"
            onChange={(e) => {
              if (e.target.value) {
                setWeekStart(getMonday(e.target.value).toISOString().slice(0, 10));
              }
            }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
          {Array.from(shiftsByDay.entries()).map(([date, dayShifts], idx) => (
            <div
              key={date}
              className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden"
            >
              <div className="px-3 py-2.5 bg-slate-800/50 border-b border-slate-800">
                <p className="text-xs font-semibold text-primary-400 uppercase tracking-wider">
                  {DAY_NAMES[idx]}
                </p>
                <p className="text-sm text-slate-300">{formatDate(date)}</p>
              </div>
              <div className="p-2 space-y-2 min-h-[100px]">
                {dayShifts.length === 0 ? (
                  <p className="text-xs text-slate-600 text-center py-4">No shifts</p>
                ) : (
                  dayShifts.map((shift) => {
                    const style = STATUS_STYLES[shift.status];
                    return (
                      <div
                        key={shift.id}
                        className={`p-2.5 rounded-lg border ${style.bg} ${style.border} transition-all hover:scale-[1.02]`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-slate-200">
                            {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
                          </span>
                          {shift.is_overnight && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-primary-500/20 text-primary-400 rounded-full">
                              🌙
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mb-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                          <span className={`text-[10px] font-medium ${style.badge} px-1.5 py-0.5 rounded-full`}>
                            {style.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 space-y-0.5">
                          <div className="flex justify-between">
                            <span>Doctors</span>
                            <span className={shift.assigned_doctors < shift.req_doctors ? "text-rose-400" : "text-emerald-400"}>
                              {shift.assigned_doctors}/{shift.req_doctors}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Nurses</span>
                            <span className={shift.assigned_nurses < shift.req_nurses ? "text-rose-400" : "text-emerald-400"}>
                              {shift.assigned_nurses}/{shift.req_nurses}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Recep.</span>
                            <span className={shift.assigned_receptionists < shift.req_receptionists ? "text-rose-400" : "text-emerald-400"}>
                              {shift.assigned_receptionists}/{shift.req_receptionists}
                            </span>
                          </div>
                        </div>
                        {shift.missingRoles.length > 0 && (
                          <p className="text-[10px] text-amber-400/80 mt-1.5 leading-tight">
                            Need: {shift.missingRoles.join(", ")}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
