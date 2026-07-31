// API client — centralized fetch wrapper with auth token injection.

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary).
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new ApiError(res.status, body.error || "Request failed", body.details);
  }

  return res.json();
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(
    status: number,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// --- Auth ---
export function login(email: string, password: string) {
  return request<{
    token: string;
    user: { userId: number; email: string; role: string; profession: string | null };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// --- Shifts ---
export function getShifts(dateFrom?: string, dateTo?: string) {
  const params = new URLSearchParams();
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const qs = params.toString();
  return request<any[]>(`/shifts${qs ? `?${qs}` : ""}`);
}

export function getShift(id: number) {
  return request<any>(`/shifts/${id}`);
}

export function createShift(data: {
  date: string;
  start_time: string;
  end_time: string;
  req_doctors: number;
  req_nurses: number;
  req_receptionists: number;
}) {
  return request<any>("/shifts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateShift(id: number, data: Record<string, unknown>) {
  return request<any>(`/shifts/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteShift(id: number) {
  return request<any>(`/shifts/${id}`, { method: "DELETE" });
}

export function claimShift(id: number) {
  return request<any>(`/shifts/${id}/claim`, { method: "POST" });
}

export function unclaimShift(id: number) {
  return request<any>(`/shifts/${id}/claim`, { method: "DELETE" });
}

export function assignStaff(shiftId: number, userId: number) {
  return request<any>(`/shifts/${shiftId}/assign`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function unassignStaff(shiftId: number, userId: number) {
  return request<any>(`/shifts/${shiftId}/assign/${userId}`, { method: "DELETE" });
}

export function getAllStaff() {
  return request<any[]>("/shifts/staff/all");
}

// --- Dashboard ---
export function getCoverage(weekStart?: string) {
  const qs = weekStart ? `?week_start=${weekStart}` : "";
  return request<any>(`/dashboard/coverage${qs}`);
}

// --- Import ---
export function uploadCsv(type: "staff" | "shifts", file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<any>(`/import/${type}`, {
    method: "POST",
    body: formData,
  });
}

export function getImportReports() {
  return request<any[]>("/import/reports");
}

export function getImportReport(id: number) {
  return request<any>(`/import/reports/${id}`);
}
