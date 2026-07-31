// Import report page — shows import history and detailed per-row results (manager only).
import { useState, useEffect } from "react";
import * as api from "../api/client";

interface Report {
  id: number;
  import_type: string;
  imported_at: string;
  total_rows: number;
  accepted: number;
  rejected: number;
  auto_corrected: number;
  merged: number;
}

interface ReportEntry {
  row_number: number;
  original_data: Record<string, string>;
  action: string;
  problems: string[];
  details: string;
  corrected_data: Record<string, string> | null;
}

const ACTION_STYLES: Record<string, string> = {
  accepted: "bg-emerald-500/20 text-emerald-400",
  auto_corrected: "bg-amber-500/20 text-amber-400",
  merged: "bg-blue-500/20 text-blue-400",
  rejected: "bg-rose-500/20 text-rose-400",
};

const ACTION_LABELS: Record<string, string> = {
  accepted: "Accepted",
  auto_corrected: "Auto-Corrected",
  merged: "Merged (Duplicate)",
  rejected: "Rejected",
};

export default function ImportReportPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  // CSV upload state
  const [uploadType, setUploadType] = useState<"staff" | "shifts">("staff");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    api.getImportReports().then(setReports).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function loadReport(report: Report) {
    setSelectedReport(report);
    setEntriesLoading(true);
    setFilter("all");
    try {
      const data = await api.getImportReport(report.id);
      setEntries(data.entries);
    } catch (err) {
      console.error("Failed to load report:", err);
    } finally {
      setEntriesLoading(false);
    }
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError("");
    try {
      const result = await api.uploadCsv(uploadType, uploadFile);
      // Refresh reports list and auto-select the new report.
      const updatedReports = await api.getImportReports();
      setReports(updatedReports);
      const newReport = updatedReports.find((r: Report) => r.id === result.reportId);
      if (newReport) loadReport(newReport);
      setUploadFile(null);
    } catch (err) {
      setUploadError(err instanceof api.ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const filteredEntries =
    filter === "all" ? entries : entries.filter((e) => e.action === filter);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Import Reports</h1>
      <p className="text-slate-400 text-sm mb-8">
        View import history and upload new CSV files
      </p>

      {/* Upload section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">Upload CSV</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value as "staff" | "shifts")}
            className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
          >
            <option value="staff">Staff CSV</option>
            <option value="shifts">Shifts CSV</option>
          </select>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="flex-1 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 file:mr-3 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-primary-600/20 file:text-primary-400 file:text-sm file:cursor-pointer"
          />
          <button
            onClick={handleUpload}
            disabled={!uploadFile || uploading}
            className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:bg-primary-800 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all"
          >
            {uploading ? "Importing..." : "Import"}
          </button>
        </div>
        {uploadError && (
          <p className="mt-2 text-sm text-rose-400">{uploadError}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Reports list */}
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold text-white mb-3">History</h2>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <p className="text-slate-500 text-sm">No imports yet.</p>
          ) : (
            <div className="space-y-2">
              {reports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => loadReport(report)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedReport?.id === report.id
                      ? "bg-primary-600/10 border-primary-500/30"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-white capitalize">
                      {report.import_type}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(report.imported_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-emerald-400">✓{report.accepted}</span>
                    <span className="text-amber-400">⟳{report.auto_corrected}</span>
                    <span className="text-blue-400">≡{report.merged}</span>
                    <span className="text-rose-400">✕{report.rejected}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Report detail */}
        <div className="lg:col-span-2">
          {selectedReport ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {selectedReport.import_type.charAt(0).toUpperCase() +
                    selectedReport.import_type.slice(1)}{" "}
                  Import — Report #{selectedReport.id}
                </h2>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Accepted", count: selectedReport.accepted, color: "emerald" },
                  { label: "Corrected", count: selectedReport.auto_corrected, color: "amber" },
                  { label: "Merged", count: selectedReport.merged, color: "blue" },
                  { label: "Rejected", count: selectedReport.rejected, color: "rose" },
                ].map(({ label, count, color }) => (
                  <div
                    key={label}
                    className={`p-3 rounded-lg bg-${color}-500/10 border border-${color}-500/20 text-center`}
                  >
                    <p className={`text-2xl font-bold text-${color}-400`}>{count}</p>
                    <p className="text-xs text-slate-400">{label}</p>
                  </div>
                ))}
              </div>

              {/* Filter buttons */}
              <div className="flex gap-2 mb-4 flex-wrap">
                {["all", "accepted", "auto_corrected", "merged", "rejected"].map(
                  (f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        filter === f
                          ? "bg-primary-600/20 border-primary-500/30 text-primary-400"
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      {f === "all" ? "All" : ACTION_LABELS[f]}
                    </button>
                  )
                )}
              </div>

              {/* Entries */}
              {entriesLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {filteredEntries.map((entry, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900/60 border border-slate-800 rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-slate-400">
                          Row {entry.row_number}
                        </span>
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            ACTION_STYLES[entry.action] || ""
                          }`}
                        >
                          {ACTION_LABELS[entry.action] || entry.action}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 mb-2 font-mono bg-slate-800/50 rounded-lg p-2 overflow-x-auto">
                        {Object.entries(entry.original_data)
                          .map(([k, v]) => `${k}: "${v}"`)
                          .join(" | ")}
                      </div>

                      <p className="text-sm text-slate-300">{entry.details}</p>

                      {entry.corrected_data && (
                        <div className="mt-2 text-xs text-amber-400/80 font-mono bg-amber-500/5 rounded-lg p-2">
                          Corrected → {Object.entries(entry.corrected_data)
                            .map(([k, v]) => `${k}: "${v}"`)
                            .join(" | ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500">
              <p>Select a report to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
