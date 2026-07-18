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

function encodeAdminToken(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
  if (!response.ok) throw new Error(body?.error || `Ошибка запроса (${response.status})`);
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
  } catch {
    currentMode = "local";
    return { records: getLocalRecords(), mode: currentMode };
  }
}

export async function authenticate(token) {
  if (currentMode === "local" || currentMode === "unknown") return localAuth(token);
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { Authorization: `Bearer ${encodeAdminToken(token)}` },
  });
  await parseResponse(response);
  return true;
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
    headers: { Authorization: `Bearer ${encodeAdminToken(token)}` },
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
    headers: { Authorization: `Bearer ${encodeAdminToken(token)}` },
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
