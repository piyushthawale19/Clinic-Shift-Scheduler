# DECISIONS.md — Design Decisions for the Clinic Shift Scheduler

Every ambiguous requirement or data-handling decision is documented here with reasoning.

---

## Authentication & Accounts

### Staff account creation is seed + CSV import only
**Decision:** Staff cannot self-register. Accounts are created via the seed script (which imports `staff.csv`) or when a manager uploads a new CSV through the UI.
**Reasoning:** The brief says "seed at least one manager login and several staff logins" and the CSV import creates staff records. There's no mention of a self-registration flow, and in a real clinic, staff accounts would be provisioned by management.

### All staff get the same default password (`Staff123!`)
**Decision:** For testing/demo purposes, all imported staff share one default password.
**Reasoning:** In production, this would be replaced with invite links or temporary passwords. For a take-home assessment, it keeps testing simple while clearly documenting the credentials.

---

## CSV Import — Staff

### Profession normalization: alias mapping
**Decision:** All known profession variations map to one of three canonical values:
- **Doctor:** "Doctor", "Physician", "MD"
- **Nurse:** "Nurse", "RN", "Registered Nurse"
- **Receptionist:** "Receptionist", "Reception", "recep."

Matching is case-insensitive with leading/trailing whitespace trimmed.
**Reasoning:** The clinic clearly uses these three professions. The aliases are unambiguous, so auto-correcting them is safer than rejecting valid staff.

### Unsupported professions are rejected
**Decision:** Rows with professions like "Janitor" that don't map to any canonical value are rejected entirely.
**Reasoning:** Importing them as an arbitrary profession would create data integrity issues. The Import Report tells the manager exactly which rows were rejected and why.

### Malformed emails are rejected (not auto-corrected)
**Decision:** Emails like `name(at)domain.test` are rejected, not auto-corrected to `name@domain.test`.
**Reasoning:** While `(at)` → `@` seems obvious, auto-correcting emails is risky — if the correction is wrong, the staff member gets the wrong account. Better to reject and let the manager fix the source data.

### Placeholder names are rejected
**Decision:** Names matching patterns like "J. Placeholder", "Test User", "TBD" are rejected.
**Reasoning:** These are clearly not real staff members. Importing them would pollute the staff list.

### Exact duplicate rows are merged (deduplicated)
**Decision:** If the same `staff_id`, `full_name`, `email`, and `profession` appear twice, the duplicate is silently merged (kept first, skipped second) and recorded in the report.
**Reasoning:** Exact duplicates are a common spreadsheet artifact. No data is lost.

### Conflicting staff_id → rejected
**Decision:** If the same `staff_id` appears with different data (different name/email/profession), the second row is rejected.
**Reasoning:** We cannot determine which row is "correct" without human review. The Import Report flags the conflict.

### Same person, different staff_id → rejected
**Decision:** If the same email appears under two different `staff_id`s (e.g., Zainab Volkov under 999 and 105), the second row is rejected.
**Reasoning:** This is likely a data entry error. Silently merging could assign shifts to the wrong internal ID.

### Name normalization: auto-corrected
**Decision:** Leading/trailing whitespace is trimmed, internal whitespace is collapsed, and title case is applied.
**Reasoning:** These are clearly formatting issues, not data issues. The original and corrected values are both recorded.

---

## CSV Import — Shifts

### Date parsing strategy: separator-based format detection
**Decision:**
- `YYYY-MM-DD` (ISO): parsed directly
- `XX/XX/YYYY` (slashes): treated as **DD/MM/YYYY** (European convention)
- `XX-XX-YYYY` (dashes, non-ISO): treated as **MM-DD-YYYY** (US convention)

**Reasoning:** This strategy is consistent with the actual data:
- `29/08/2026` must be DD/MM since 29 can't be a month → confirms slash = DD/MM
- `08-13-2026` must be MM-DD since 13 can't be a month → confirms dash = MM-DD
- All other dates in the dataset are consistent with this interpretation

### Impossible calendar dates (e.g., Feb 30) are rejected
**Decision:** After parsing, the date is validated against the Gregorian calendar. Invalid dates are rejected.
**Reasoning:** No defensible way to guess what the intended date was.

### Overnight shifts (end_time < start_time) are valid
**Decision:** Shifts like 22:00–06:00 are accepted as overnight shifts. The `is_overnight` flag is set, and overlap calculations use date rollover (end = next day).
**Reasoning:** Night shifts are a standard healthcare pattern. The brief explicitly mentions this.

### Zero-duration shifts (start_time == end_time) are rejected
**Decision:** A shift with start_time 12:00 and end_time 12:00 is rejected as invalid.
**Reasoning:** A 24-hour shift would typically be represented as 00:00–00:00 or use explicit notation. 12:00–12:00 is more likely a data entry error. A zero-duration shift is meaningless either way.

### Malformed time "10:00+1" is rejected
**Decision:** The `+1` suffix is not a standard time format. The row is rejected.
**Reasoning:** The meaning is ambiguous — could mean "10:00 next day" or "11:00" or something else entirely. Rather than guess, we reject and let the manager fix the data.

### Free-text requirements are parsed best-effort
**Decision:** "two nurses and a doctor" is parsed using a rule-based parser that matches number words + profession keywords.
**Reasoning:** This specific pattern is common enough that a simple parser handles it reliably. If the parser can't confidently extract professions, the row is rejected (not silently defaulted).

### Missing profession in requirements = 0 required
**Decision:** If requirements only specify "nurses=1" with no doctors/receptionists key, the missing roles default to 0.
**Reasoning:** Absence of a requirement means "none needed," not an error. This is explicitly called out in the prompt.

### Exact duplicate shift rows are merged
**Decision:** Same logic as staff — if all fields are identical, the duplicate is skipped and recorded.

---

## Shift Editing with Existing Claims

### Edits that cause overlaps are rejected entirely
**Decision:** When a manager edits a shift's date/time, all existing claims are re-validated. If any claim would now overlap with that staff member's other shifts, the edit is rejected with a specific error listing the conflicts.
**Reasoning:** Silently dropping claims would surprise the affected staff member. The manager should first remove the conflicting assignments, then edit the shift. This is the most defensible approach because it never silently changes someone's schedule.

### Capacity reduction below current assignments is rejected
**Decision:** If a shift has 2 nurses assigned and the manager tries to change `req_nurses` to 1, the edit is rejected.
**Reasoning:** Same principle — don't silently remove assignments. The manager should unassign one nurse first.

---

## Concurrency Control

### SELECT ... FOR UPDATE row-level locking on shift
**Decision:** All claim/unclaim/assign operations lock the shift row at the start of the transaction, then count assignments and check overlaps.
**Reasoning:** This serializes concurrent operations on the same shift. If two staff claim the last slot simultaneously, one transaction blocks until the other commits/rolls back, then sees the updated count. The unique constraint on `(shift_id, user_id)` is a final safety net.

---

## What I'd Do Differently With More Time

1. **WebSocket live updates** — currently the UI requires manual refresh to see other users' changes
2. **Comprehensive test suite** — unit tests for all normalizers and integration tests for the claim transaction
3. **Recurring shifts** — the stretch goal for repeating shift patterns
4. **Email notifications** — alert staff when they're assigned/unassigned
5. **Pagination** — the shifts list currently loads all shifts at once; would add cursor-based pagination for production scale
