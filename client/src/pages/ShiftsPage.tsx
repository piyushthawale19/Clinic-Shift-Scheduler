// Shifts page — staff can browse/claim/unclaim shifts; managers can create/edit/delete/assign.
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import * as api from "../api/client";

interface Assignment {
  id: number;
  userId: number;
  fullName: string;
  profession: string;
}

interface Shift {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  req_doctors: number;
  req_nurses: number;
  req_receptionists: number;
  assignments: Assignment[];
}

interface StaffMember {
  id: number;
  full_name: string;
  profession: string;
  email: string;
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h!);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${suffix}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const PROFESSION_COLORS: Record<string, string> = {
  doctor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  nurse: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  receptionist: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export default function ShiftsPage() {
  const { user, isManager } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Create/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [formData, setFormData] = useState({
    date: "",
    start_time: "08:00",
    end_time: "16:00",
    req_doctors: 1,
    req_nurses: 1,
    req_receptionists: 0,
  });

  // Assign modal state
  const [assignShiftId, setAssignShiftId] = useState<number | null>(null);
  const [assignUserId, setAssignUserId] = useState<number | "">("");

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getShifts();
      setShifts(data);
    } catch (err) {
      console.error("Failed to load shifts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShifts();
    if (isManager) {
      api.getAllStaff().then(setStaffList).catch(console.error);
    }
  }, [fetchShifts, isManager]);

  async function handleClaim(shiftId: number) {
    setActionLoading(shiftId);
    setError("");
    try {
      await api.claimShift(shiftId);
      await fetchShifts();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Claim failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnclaim(shiftId: number) {
    setActionLoading(shiftId);
    setError("");
    try {
      await api.unclaimShift(shiftId);
      await fetchShifts();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Unclaim failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(shiftId: number) {
    if (!confirm("Delete this shift? All assignments will be removed.")) return;
    setActionLoading(shiftId);
    try {
      await api.deleteShift(shiftId);
      await fetchShifts();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Delete failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCreateOrEdit() {
    setError("");
    try {
      if (editingShift) {
        await api.updateShift(editingShift.id, formData);
      } else {
        await api.createShift(formData);
      }
      setShowModal(false);
      setEditingShift(null);
      await fetchShifts();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Save failed");
    }
  }

  async function handleAssign() {
    if (!assignShiftId || !assignUserId) return;
    setError("");
    try {
      await api.assignStaff(assignShiftId, assignUserId as number);
      setAssignShiftId(null);
      setAssignUserId("");
      await fetchShifts();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Assign failed");
    }
  }

  async function handleUnassign(shiftId: number, userId: number) {
    setError("");
    try {
      await api.unassignStaff(shiftId, userId);
      await fetchShifts();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Unassign failed");
    }
  }

  function openCreateModal() {
    setEditingShift(null);
    setFormData({
      date: new Date().toISOString().slice(0, 10),
      start_time: "08:00",
      end_time: "16:00",
      req_doctors: 1,
      req_nurses: 1,
      req_receptionists: 0,
    });
    setShowModal(true);
  }

  function openEditModal(shift: Shift) {
    setEditingShift(shift);
    setFormData({
      date: shift.date,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      req_doctors: shift.req_doctors,
      req_nurses: shift.req_nurses,
      req_receptionists: shift.req_receptionists,
    });
    setShowModal(true);
  }

  function isClaimedByMe(shift: Shift): boolean {
    return shift.assignments.some((a) => a.userId === user?.userId);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {isManager ? "Manage Shifts" : "Available Shifts"}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {isManager
              ? "Create, edit, and assign staff to shifts"
              : "Browse and claim shifts"}
          </p>
        </div>
        {isManager && (
          <button
            onClick={openCreateModal}
            className="px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-primary-600/25"
          >
            + New Shift
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
          {error}
          <button onClick={() => setError("")} className="float-right text-rose-400/60 hover:text-rose-400">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : shifts.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-lg">No shifts found</p>
          {isManager && <p className="text-sm mt-2">Create your first shift to get started.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {shifts.map((shift) => {
            const claimed = isClaimedByMe(shift);
            const totalReq = shift.req_doctors + shift.req_nurses + shift.req_receptionists;
            const totalFilled = shift.assignments.length;

            return (
              <div
                key={shift.id}
                className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white font-semibold">{formatDate(shift.date)}</p>
                    <p className="text-slate-400 text-sm">
                      {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                      {shift.is_overnight && (
                        <span className="ml-1.5 text-primary-400 text-xs">🌙 overnight</span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      totalFilled === totalReq
                        ? "bg-emerald-500/20 text-emerald-400"
                        : totalFilled > 0
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-rose-500/20 text-rose-400"
                    }`}
                  >
                    {totalFilled}/{totalReq}
                  </span>
                </div>

                {/* Requirements */}
                <div className="flex gap-2 mb-3 flex-wrap">
                  {shift.req_doctors > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/20">
                      {shift.assignments.filter((a) => a.profession === "doctor").length}/{shift.req_doctors} Doctors
                    </span>
                  )}
                  {shift.req_nurses > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      {shift.assignments.filter((a) => a.profession === "nurse").length}/{shift.req_nurses} Nurses
                    </span>
                  )}
                  {shift.req_receptionists > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full border bg-purple-500/10 text-purple-400 border-purple-500/20">
                      {shift.assignments.filter((a) => a.profession === "receptionist").length}/{shift.req_receptionists} Recep.
                    </span>
                  )}
                </div>

                {/* Assigned staff */}
                {shift.assignments.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {shift.assignments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${PROFESSION_COLORS[a.profession] || ""}`}>
                            {a.profession}
                          </span>
                          <span className="text-slate-300">{a.fullName}</span>
                          {a.userId === user?.userId && (
                            <span className="text-primary-400 text-[10px]">(you)</span>
                          )}
                        </span>
                        {isManager && (
                          <button
                            onClick={() => handleUnassign(shift.id, a.userId)}
                            className="text-rose-400/60 hover:text-rose-400 transition-colors"
                            title="Remove assignment"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-4 pt-3 border-t border-slate-800">
                  {!isManager && (
                    <>
                      {claimed ? (
                        <button
                          onClick={() => handleUnclaim(shift.id)}
                          disabled={actionLoading === shift.id}
                          className="flex-1 py-2 text-sm bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-lg transition-all disabled:opacity-50"
                        >
                          {actionLoading === shift.id ? "..." : "Unclaim"}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleClaim(shift.id)}
                          disabled={actionLoading === shift.id}
                          className="flex-1 py-2 text-sm bg-primary-600/20 hover:bg-primary-600/30 border border-primary-500/30 text-primary-400 rounded-lg transition-all disabled:opacity-50"
                        >
                          {actionLoading === shift.id ? "..." : "Claim"}
                        </button>
                      )}
                    </>
                  )}
                  {isManager && (
                    <>
                      <button
                        onClick={() => setAssignShiftId(shift.id)}
                        className="flex-1 py-2 text-sm bg-primary-600/20 hover:bg-primary-600/30 border border-primary-500/30 text-primary-400 rounded-lg transition-all"
                      >
                        Assign
                      </button>
                      <button
                        onClick={() => openEditModal(shift)}
                        className="py-2 px-3 text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-all"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(shift.id)}
                        disabled={actionLoading === shift.id}
                        className="py-2 px-3 text-sm bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-lg transition-all disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">
              {editingShift ? "Edit Shift" : "Create Shift"}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">End Time</label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Doctors</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.req_doctors}
                    onChange={(e) => setFormData({ ...formData, req_doctors: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Nurses</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.req_nurses}
                    onChange={(e) => setFormData({ ...formData, req_nurses: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Recep.</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.req_receptionists}
                    onChange={(e) => setFormData({ ...formData, req_receptionists: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowModal(false); setEditingShift(null); }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateOrEdit}
                className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-primary-600/25"
              >
                {editingShift ? "Save Changes" : "Create Shift"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {assignShiftId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Assign Staff</h2>
            <select
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value ? parseInt(e.target.value) : "")}
              className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none mb-4"
            >
              <option value="">Select staff member...</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.profession})
                </option>
              ))}
            </select>
            <div className="flex gap-3">
              <button
                onClick={() => { setAssignShiftId(null); setAssignUserId(""); }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={!assignUserId}
                className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:bg-primary-800 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all"
              >
                Assign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
