const STORAGE_KEY = "aogd-records-v1";
const LOCAL_ADMIN_KEY = "aogd-local-admin-hash";

const demoRecords = [
  {
    id: "demo-record",
    fileNumber: "AOGD-DEMO-001",
    fullName: "Алекс Рейн",
    aliases: "NORTH",
    status: "wanted",
    priority: "high",
    nationality: "Не указано",
    birthDate: "1991-04-18",
    gender: "Мужской",
    height: "181 см",
    eyes: "Серые",
    hair: "Тёмные",
    languages: "Русский, английский",
    residence: "Северный округ",
    telegramUsername: "@north_demo",
    lastSeen: "Северный округ, 14 июня 2026",
    publicationBasis: "Демонстрационная запись для проверки интерфейса.",
    description:
      "Это вымышленный профиль. Удалите его в административной панели перед публикацией настоящей базы.",
    identifyingMarks: "Нет данных",
    contactNote: "Не предпринимайте самостоятельных действий. Передайте информацию организации.",
    photoUrl: "",
    isDemo: true,
    createdAt: "2026-06-14T10:00:00.000Z",
    updatedAt: "2026-06-14T10:00:00.000Z",
  },
];

let currentMode = "unknown";

function isLocalPreview() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function getLocalRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved.map((record) => record.id === "demo-record" ? { ...demoRecords[0], ...record, residence: record.residence || demoRecords[0].residence, telegramUsername: record.telegramUsername || demoRecords[0].telegramUsername } : record) : demoRecords;
  } catch {
    return demoRecords;
  }
}

function setLocalRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function localAuth(token) {
  if (!token || token.length < 8) {
    throw new Error("Локальный пароль должен содержать не менее 8 символов.");
  }

  const candidate = await hash(token);
  const existing = localStorage.getItem(LOCAL_ADMIN_KEY);
  if (!existing) {
    localStorage.setItem(LOCAL_ADMIN_KEY, candidate);
    return true;
  }
  if (existing !== candidate) throw new Error("Неверный пароль администратора.");
  return true;
}

async function parseResponse(response) {
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(body?.error || `Ошибка запроса (${response.status})`);
    error.code = body?.code || "";
    error.requestId = body?.requestId || response.headers.get("X-Request-ID") || "";
    if (error.code === "admin_auth_required") window.dispatchEvent(new Event("aogd-admin-session-expired"));
    throw error;
  }
  return body;
}

export async function loadRecords() {
  try {
    const response = await fetch("/api/records", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("API unavailable");
    const body = await parseResponse(response);
    if (!Array.isArray(body.records)) throw new Error("Invalid API response");
    currentMode = "cloud";
    return { records: body.records, mode: currentMode };
  } catch (error) {
    if (isLocalPreview()) {
      currentMode = "local";
      return { records: getLocalRecords(), mode: currentMode };
    }
    currentMode = "cloud";
    return { records: [], mode: currentMode, error: error.message };
  }
}

export async function authenticate(token, turnstileToken = "", otp = "") {
  if (currentMode === "local") return localAuth(token);
  const response = await fetch("/api/auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: token, turnstileToken, otp }),
  });
  await parseResponse(response);
  return true;
}

export async function getAdminSession() {
  if (currentMode === "local") return false;
  try {
    const response = await fetch("/api/auth", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse(response);
    return Boolean(body.authenticated);
  } catch {
    return false;
  }
}

export async function logoutAdmin() {
  if (currentMode === "local") return;
  const response = await fetch("/api/auth", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  await parseResponse(response);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Не удалось прочитать фотографию."));
    reader.readAsDataURL(file);
  });
}

export async function saveRecord({ token, record, photo, removePhoto }) {
  if (currentMode === "local") {
    await localAuth(token);
    const records = getLocalRecords();
    const now = new Date().toISOString();
    const existingIndex = records.findIndex((item) => item.id === record.id);
    const id = record.id || crypto.randomUUID();
    const existing = existingIndex >= 0 ? records[existingIndex] : null;
    let photoUrl = removePhoto ? "" : existing?.photoUrl || record.photoUrl || "";
    if (photo) photoUrl = await fileToDataUrl(photo);
    const next = {
      ...record,
      id,
      fileNumber: record.fileNumber || `AOGD-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
      photoUrl,
      isDemo: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existingIndex >= 0) records[existingIndex] = next;
    else records.unshift(next);
    setLocalRecords(records);
    return next;
  }

  const formData = new FormData();
  formData.set("record", JSON.stringify(record));
  formData.set("removePhoto", String(Boolean(removePhoto)));
  if (photo) formData.set("photo", photo, photo.name || "portrait.jpg");
  const isEditing = Boolean(record.id);
  const response = await fetch(isEditing ? `/api/records/${encodeURIComponent(record.id)}` : "/api/records", {
    method: isEditing ? "PUT" : "POST",
    credentials: "same-origin",
    body: formData,
  });
  const body = await parseResponse(response);
  return body.record;
}

export async function deleteRecord(token, id) {
  if (currentMode === "local") {
    await localAuth(token);
    setLocalRecords(getLocalRecords().filter((record) => record.id !== id));
    return;
  }

  const response = await fetch(`/api/records/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  await parseResponse(response);
}

export function resetLocalDemo() {
  localStorage.removeItem(STORAGE_KEY);
  return demoRecords;
}

export function resetLocalAdminPassword() {
  localStorage.removeItem(LOCAL_ADMIN_KEY);
}

async function accountRequest(path, options = {}) {
  const response = await fetch(`/api/account/${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return parseResponse(response);
}

export async function getCurrentUser() {
  try {
    const response = await fetch("/api/account/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
    const body = await parseResponse(response);
    return body.user || null;
  } catch {
    return null;
  }
}

export function registerAccount(data) {
  return accountRequest("register", { method: "POST", body: JSON.stringify(data) });
}

export function resendVerificationCode(email) {
  return accountRequest("resend-code", { method: "POST", body: JSON.stringify({ email }) });
}

export function verifyAccount(data) {
  return accountRequest("verify", { method: "POST", body: JSON.stringify(data) });
}

export function loginAccount(data) {
  return accountRequest("login", { method: "POST", body: JSON.stringify(data) });
}

export function logoutAccount() {
  return accountRequest("logout", { method: "POST", body: "{}" });
}

export function changeAccountPassword(data) {
  return accountRequest("change-password", { method: "POST", body: JSON.stringify(data) });
}

export function deleteAccount(currentPassword) {
  return accountRequest("delete-account", { method: "POST", body: JSON.stringify({ currentPassword }) });
}

export function requestPasswordReset(email, turnstileToken = "") {
  return accountRequest("forgot-password", { method: "POST", body: JSON.stringify({ email, turnstileToken }) });
}

export function resetAccountPassword(data) {
  return accountRequest("reset-password", { method: "POST", body: JSON.stringify(data) });
}

export async function submitSupportRequest(formData) {
  const response = await fetch("/api/support", { method: "POST", credentials: "same-origin", body: formData });
  return parseResponse(response);
}

export async function loadMySupportRequests() {
  const response = await fetch("/api/support/mine", { credentials: "same-origin", headers: { Accept: "application/json" } });
  const body = await parseResponse(response);
  return body.requests || [];
}

export async function loadLeaderboard() {
  try {
    const response = await fetch("/api/leaderboard", { headers: { Accept: "application/json" } });
    const body = await parseResponse(response);
    return body.leaders || [];
  } catch {
    return [];
  }
}

export async function loadAdminSupportRequests(token) {
  const response = await fetch("/api/support/admin", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await parseResponse(response);
  return body.requests || [];
}

export async function updateSupportRequestStatus(token, id, status) {
  const response = await fetch(`/api/support/admin/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return parseResponse(response);
}

export async function loadAdminSecurity() {
  const response = await fetch("/api/admin/security", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return parseResponse(response);
}

export async function revokeOtherAdminSessions() {
  const response = await fetch("/api/admin/security", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return parseResponse(response);
}

async function receptionRequest(path, options = {}) {
  const response = await fetch(`/api/reception${path ? `/${path}` : ""}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  return parseResponse(response);
}

export async function loadPublicReception() {
  const body = await receptionRequest("public");
  return body.threads || [];
}

export async function loadMyReception() {
  const body = await receptionRequest("mine");
  return body.threads || [];
}

export function submitReceptionThread(data) {
  return receptionRequest("", { method: "POST", body: JSON.stringify(data) });
}

export function toggleReceptionInterest(id) {
  return receptionRequest(`${encodeURIComponent(id)}/interest`, { method: "POST", body: "{}" });
}

export function deleteMyReceptionThread(id) {
  return receptionRequest(`mine/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function loadAdminReception() {
  const body = await receptionRequest("admin");
  return body.threads || [];
}

export function updateReceptionThread(id, data) {
  return receptionRequest(`admin/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function revealReceptionAuthor(id, reason) {
  return receptionRequest(`admin/${encodeURIComponent(id)}/reveal-author`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

async function staffRequest(path, options = {}) {
  const response = await fetch(`/api/staff/${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  return parseResponse(response);
}

export async function loadPublicStaff() {
  const body = await staffRequest("public");
  return body.staff || [];
}

export function sendStaffHeartbeat() {
  return staffRequest("heartbeat", { method: "POST", body: "{}" });
}

export function updatePresencePreference(visible) {
  return staffRequest("preference", { method: "PUT", body: JSON.stringify({ visible }) });
}

export function loadAdminPeople(query = "") {
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
  return staffRequest(`admin${suffix}`);
}

export function updatePersonRoles(userId, roles) {
  return staffRequest(`admin/users/${encodeURIComponent(userId)}/roles`, {
    method: "PUT",
    body: JSON.stringify({ roles }),
  });
}

export function createStaffRole(data) {
  return staffRequest("admin/roles", { method: "POST", body: JSON.stringify(data) });
}

export function deleteStaffRole(slug) {
  return staffRequest(`admin/roles/${encodeURIComponent(slug)}`, { method: "DELETE" });
}
