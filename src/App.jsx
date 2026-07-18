import { lazy, Suspense, useEffect, useMemo, useState } from "react";
// A.O.G.D public portal entrypoint.
import { flushSync } from "react-dom";
import { authenticate, deleteRecord, loadRecords, resetLocalAdminPassword, resetLocalDemo, saveRecord } from "./api.js";
import { useInterfaceLanguage } from "./i18n.js";

const Dither = lazy(() => import("./Dither.jsx"));

const STATUS = {
  wanted: { label: "Разыскивается", tone: "danger" },
  priority: { label: "Особое внимание", tone: "warning" },
  located: { label: "Местонахождение установлено", tone: "success" },
  archived: { label: "Архив", tone: "muted" },
};

const PRIORITY = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const emptyRecord = {
  id: "",
  fileNumber: "",
  fullName: "",
  aliases: "",
  status: "wanted",
  priority: "medium",
  nationality: "",
  birthDate: "",
  gender: "",
  height: "",
  eyes: "",
  hair: "",
  languages: "",
  residence: "",
  telegramUsername: "",
  lastSeen: "",
  publicationBasis: "",
  description: "",
  identifyingMarks: "",
  contactNote: "Не предпринимайте самостоятельных действий. Передайте информацию организации.",
  photoUrl: "",
};

function Icon({ name, size = 20 }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    shield: <path d="M12 3 4.5 6v5.4c0 4.8 3.2 8 7.5 9.6 4.3-1.6 7.5-4.8 7.5-9.6V6L12 3Z"/>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    edit: <><path d="m4 16-.8 4 4-.8L18.5 7.9l-3.4-3.4L4 16Z"/><path d="m13.8 5.8 3.4 3.4"/></>,
    trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/></>,
    close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/></>,
    logout: <><path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4"/><path d="M18 12H9"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></>,
    moon: <path d="M20.5 14.2A7.7 7.7 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    print: <><path d="M7 9V4h10v5"/><path d="M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/></>,
    check: <><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Emblem({ compact = false }) {
  return (
    <div className={`emblem ${compact ? "emblem--compact" : ""}`} aria-label="Эмблема A.O.G.D">
      <img src="/aogd-emblem.png" alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
      <span className="emblem__fallback"><Icon name="shield" size={compact ? 22 : 30} /></span>
    </div>
  );
}

const ADMIN_HASH = "#/aogd-vault-7m4k9p";

function isAdminLocation() {
  return window.location.hash === ADMIN_HASH;
}

function go(route) {
  window.location.hash = route === "admin" ? ADMIN_HASH.slice(1) : "/";
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SettingsPanel({ theme, onThemeChange, comfort, onComfortChange, onClose }) {
  const [tab, setTab] = useState("appearance");
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="Настройки интерфейса">
        <div className="settings-heading">
          <div><span>Персонализация</span><h2>Настройки</h2></div>
          <button className="settings-close" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
        </div>
        <div className="settings-tabs" role="tablist">
          <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>Оформление</button>
          <button className={tab === "comfort" ? "active" : ""} onClick={() => setTab("comfort")}>Интерфейс</button>
        </div>
        {tab === "appearance" ? (
          <div className="settings-content">
            <div className="setting-intro"><h3>Цветовая тема</h3><p>Выберите оформление, которое приятнее для глаз.</p></div>
            <div className="theme-options">
              {[
                { value: "light", label: "Светлая", icon: "sun" },
                { value: "default", label: "Синяя", icon: "shield" },
                { value: "dark", label: "Тёмная", icon: "moon" },
              ].map((item) => <button key={item.value} className={theme === item.value ? "active" : ""} onClick={() => onThemeChange(item.value)}><Icon name={item.icon} /><span>{item.label}</span>{theme === item.value && <small>Выбрано</small>}</button>)}
            </div>
          </div>
        ) : (
          <div className="settings-content">
            <div className="setting-row setting-row--stack">
              <div><h3>Размер текста</h3><p>Настройте удобный масштаб интерфейса.</p></div>
              <div className="size-options">
                {[{ value: "small", label: "Меньше" }, { value: "normal", label: "Обычно" }, { value: "large", label: "Крупнее" }].map((item) => <button key={item.value} className={comfort.fontSize === item.value ? "active" : ""} onClick={() => onComfortChange("fontSize", item.value)}>{item.label}</button>)}
              </div>
            </div>
            <label className="setting-row"><div><h3>Компактные карточки</h3><p>Показывать больше досье на экране.</p></div><input type="checkbox" checked={comfort.compactCards} onChange={(event) => onComfortChange("compactCards", event.target.checked)} /><span className="switch" /></label>
            <label className="setting-row"><div><h3>Меньше анимаций</h3><p>Уменьшить движение и плавные эффекты.</p></div><input type="checkbox" checked={comfort.reduceMotion} onChange={(event) => onComfortChange("reduceMotion", event.target.checked)} /><span className="switch" /></label>
          </div>
        )}
        <div className="settings-footer">Настройки сохраняются только на этом устройстве.</div>
      </section>
    </div>
  );
}

function Header({ route, theme, onThemeChange, language, onLanguageChange, comfort, onComfortChange }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <><header className="site-header">
      <button className="brand" onClick={() => go("public")} aria-label="На главную">
        <Emblem compact />
        <span><strong>A.O.G.D</strong><small>Agency Of Good Deeds</small></span>
      </button>
      <nav aria-label="Основная навигация">
        {route === "public" ? <>
          <button className="header-nav-link" onClick={() => scrollToSection("registry")}>Реестр</button>
          <button className="header-nav-link" onClick={() => scrollToSection("principles")}>Принципы</button>
          <button className="header-report-link" onClick={() => scrollToSection("report")}>Передать сведения</button>
        </> : <button className="header-nav-link" onClick={() => go("public")}>Открытые досье</button>}
        <button className="settings-button" onClick={() => setSettingsOpen(true)} aria-label="Настройки" title="Настройки"><Icon name="settings" size={17} /></button>
        <div className="language-picker" aria-label="Language">
          <button className={language === "ru" ? "active" : ""} onClick={() => onLanguageChange("ru")} aria-label="Русский язык" title="Русский">RU</button>
          <button className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")} aria-label="English language" title="English">EN</button>
        </div>
      </nav>
    </header>{settingsOpen && <SettingsPanel theme={theme} onThemeChange={onThemeChange} comfort={comfort} onComfortChange={onComfortChange} onClose={() => setSettingsOpen(false)} />}</>
  );
}

function StatusBadge({ status }) {
  const item = STATUS[status] || STATUS.archived;
  return <span className={`status status--${item.tone}`}>{item.label}</span>;
}

function Portrait({ record, large = false }) {
  const initials = record.fullName?.split(/\s+/).slice(0, 2).map((word) => word[0]).join("") || "?";
  return (
    <div className={`portrait ${large ? "portrait--large" : ""}`}>
      {record.photoUrl ? <img src={record.photoUrl} alt={`Фотография: ${record.fullName}`} /> : <span>{initials}</span>}
      <div className="portrait__scanline" />
    </div>
  );
}

function RecordCard({ record, onOpen }) {
  return (
    <article className="record-card">
      <button className="record-card__main" onClick={() => onOpen(record)} aria-label={`Открыть запись: ${record.fullName}`}>
        <div className="record-card__photo"><Portrait record={record} /></div>
        <div className="record-card__body">
          <div className="record-card__top"><StatusBadge status={record.status} /><span>{record.fileNumber}</span></div>
          <h3>{record.fullName || "Без имени"}</h3>
          <p className="alias">{record.aliases ? `Также известен(-на) как: ${record.aliases}` : "Псевдонимы не указаны"}</p>
          <dl className="card-facts">
            <div><dt>Юзернейм</dt><dd>{record.telegramUsername || "Не указан"}</dd></div>
            <div><dt>Место обитания</dt><dd>{record.residence || "Не указано"}</dd></div>
            <div><dt>Дата рождения</dt><dd>{formatDate(record.birthDate)}</dd></div>
          </dl>
          <span className="details-link">Открыть досье <Icon name="arrow" size={16} /></span>
        </div>
      </button>
    </article>
  );
}

function formatDate(value) {
  if (!value) return "Не указана";
  const date = new Date(`${value}T00:00:00`);
  const locale = localStorage.getItem("aogd-language") === "en" ? "en-US" : "ru-RU";
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function DetailRow({ label, children }) {
  return <div className="detail-row"><dt>{label}</dt><dd>{children || "Не указано"}</dd></div>;
}

function RecordDetail({ record, onClose }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const handleKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(record.fileNumber || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="record-detail" role="dialog" aria-modal="true" aria-labelledby="record-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
        <div className="detail-hero">
          <Portrait record={record} large />
          <div>
            <div className="eyebrow">Публичная информационная запись · {record.fileNumber}</div>
            <StatusBadge status={record.status} />
            <h2 id="record-title">{record.fullName}</h2>
            <p>{record.aliases ? `Псевдонимы: ${record.aliases}` : "Псевдонимы не указаны"}</p>
          </div>
        </div>
        <div className="detail-actions" aria-label="Действия с досье">
          <button type="button" onClick={copyNumber}><Icon name={copied ? "check" : "copy"} size={17} />{copied ? "Номер скопирован" : "Скопировать номер"}</button>
          <button type="button" onClick={() => window.print()}><Icon name="print" size={17} />Версия для печати</button>
          <span>Дата обновления: {record.updatedAt ? formatDate(String(record.updatedAt).slice(0, 10)) : "не указана"}</span>
        </div>
        {record.isDemo && <div className="notice notice--info"><Icon name="info" /><span><strong>Демонстрационные данные.</strong> Эта запись вымышленная и нужна только для знакомства с интерфейсом.</span></div>}
        <div className="detail-section">
          <h3>Идентификационные данные</h3>
          <dl className="detail-grid">
            <DetailRow label="Место обитания">{record.residence}</DetailRow>
            <DetailRow label="Юзернейм">{record.telegramUsername}</DetailRow>
            <DetailRow label="Дата рождения">{formatDate(record.birthDate)}</DetailRow>
            <DetailRow label="Гражданство">{record.nationality}</DetailRow>
            <DetailRow label="Пол">{record.gender}</DetailRow>
            <DetailRow label="Рост">{record.height}</DetailRow>
            <DetailRow label="Глаза">{record.eyes}</DetailRow>
            <DetailRow label="Волосы">{record.hair}</DetailRow>
            <DetailRow label="Языки">{record.languages}</DetailRow>
            <DetailRow label="Уровень внимания">{PRIORITY[record.priority] || "Не указан"}</DetailRow>
          </dl>
        </div>
        <div className="detail-section detail-copy">
          <h3>Основание публикации</h3><p>{record.publicationBasis || "Не указано."}</p>
          <h3>Описание</h3><p>{record.description || "Описание отсутствует."}</p>
          <h3>Особые приметы</h3><p>{record.identifyingMarks || "Не указаны."}</p>
          <h3>Последнее известное местонахождение</h3><p>{record.lastSeen || "Нет данных."}</p>
        </div>
        <div className="notice notice--warning"><Icon name="info" /><span>{record.contactNote || "Не предпринимайте самостоятельных действий. Передайте информацию организации."}</span></div>
      </section>
    </div>
  );
}

function PublicDatabase({ records, loading, mode }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("updated");
  const [selected, setSelected] = useState(null);

  const statusCounts = useMemo(() => records.reduce((counts, record) => ({ ...counts, [record.status]: (counts[record.status] || 0) + 1 }), {}), [records]);
  const activeCount = (statusCounts.wanted || 0) + (statusCounts.priority || 0);
  const lastUpdated = useMemo(() => {
    const dates = records.map((record) => new Date(record.updatedAt || "")).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => b - a);
    return dates[0] ? new Intl.DateTimeFormat(localStorage.getItem("aogd-language") === "en" ? "en-US" : "ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(dates[0]) : "—";
  }, [records]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return records.filter((record) => {
      const hasStatus = status === "all" || record.status === status;
      const haystack = [record.fullName, record.aliases, record.telegramUsername, record.fileNumber, record.nationality, record.residence, record.lastSeen].join(" ").toLocaleLowerCase("ru");
      return hasStatus && (!needle || haystack.includes(needle));
    }).sort((a, b) => {
      if (sort === "name") return (a.fullName || "").localeCompare(b.fullName || "", "ru");
      if (sort === "priority") return ["critical", "high", "medium", "low"].indexOf(a.priority) - ["critical", "high", "medium", "low"].indexOf(b.priority);
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
  }, [records, query, status, sort]);

  return (
    <main>
      <section className="hero" id="top">
        <div className="hero__content">
          <div className="eyebrow">Открытый информационный реестр</div>
          <h1>Информация,<br />которая имеет значение</h1>
          <p>Официальный публичный реестр A.O.G.D для поиска по опубликованным ориентировкам и проверенным информационным записям.</p>
          <div className="search-box"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, псевдоним, номер или место…" aria-label="Поиск по базе" />{query && <button onClick={() => setQuery("")} aria-label="Очистить поиск"><Icon name="close" size={17} /></button>}</div>
          <div className="hero-actions"><button className="button button--primary" onClick={() => scrollToSection("registry")}>Перейти к реестру <Icon name="arrow" size={17} /></button><button className="button button--secondary" onClick={() => scrollToSection("report")}>Передать сведения</button></div>
        </div>
        <div className="hero__seal"><Emblem /><span>Public information & digital safety bureau</span><small>AOGD / Telegram security initiative</small></div>
      </section>

      <section className="registry-overview" aria-label="Сводка реестра">
        <div><span>Публичных записей</span><strong>{records.length}</strong><small>доступно для поиска</small></div>
        <div><span>В активном статусе</span><strong>{activeCount}</strong><small>требуют внимания</small></div>
        <div><span>Статусов реестра</span><strong>{Object.keys(STATUS).length}</strong><small>единая классификация</small></div>
        <div><span>Последнее обновление</span><strong className="overview-date">{lastUpdated}</strong><small>по данным публикаций</small></div>
      </section>

      <section className="database-section" id="registry">
        <div className="section-heading">
          <div><span className="eyebrow">Актуальные публикации</span><h2>Записи базы</h2></div>
          <div className="counter"><strong>{visible.length}</strong><span>найдено</span></div>
        </div>
        <div className="records-controls">
          <div className="toolbar" aria-label="Фильтры статуса">
            {[{ value: "all", label: "Все записи", count: records.length }, ...Object.entries(STATUS).map(([value, item]) => ({ value, label: item.label, count: statusCounts[value] || 0 }))].map((item) => <button key={item.value} className={status === item.value ? "active" : ""} onClick={() => setStatus(item.value)}>{item.label}<span>{item.count}</span></button>)}
          </div>
          <label className="sort-control"><span>Сортировка</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">Сначала обновлённые</option><option value="priority">По уровню внимания</option><option value="name">По имени</option></select></label>
        </div>
        {loading ? <div className="empty-state">Загрузка записей…</div> : visible.length ? <div className="records-grid">{visible.map((record) => <RecordCard key={record.id} record={record} onOpen={setSelected} />)}</div> : <div className="empty-state"><Icon name="search" size={28} /><h3>Ничего не найдено</h3><p>Измените запрос или выберите другой статус.</p></div>}
      </section>

      <section className="principles-section" id="principles">
        <div className="section-intro"><span className="eyebrow">Стандарт публичной работы</span><h2>Ответственность начинается<br />с точности информации</h2><p>Реестр создаётся как понятный и дисциплинированный инструмент: минимум лишних данных, ясный статус записи и возможность сообщить об ошибке.</p></div>
        <div className="principles-grid">
          <article><span className="principle-number">01</span><Icon name="check" /><h3>Проверяемость</h3><p>Основание публикации указывается прямо в досье, чтобы происхождение записи было понятно посетителю.</p></article>
          <article><span className="principle-number">02</span><Icon name="shield" /><h3>Цифровая безопасность</h3><p>Наша задача — снизить риск для пользователей Telegram и помочь передать важную информацию безопасным способом.</p></article>
          <article><span className="principle-number">03</span><Icon name="book" /><h3>Право на уточнение</h3><p>Ошибочные или устаревшие сведения можно направить на повторную проверку через официальный канал проекта.</p></article>
        </div>
      </section>

      <section className="report-section" id="report">
        <div className="report-card">
          <div className="report-card__copy"><span className="eyebrow">Защищённый канал связи</span><h2>У вас есть значимые сведения?</h2><p>Сообщите команде A.O.G.D номер досье и только те факты, которые можно проверить. Не вступайте в контакт с человеком из ориентировки и не публикуйте личные данные в открытых комментариях.</p><div className="report-points"><span><Icon name="check" size={16} />Укажите номер записи</span><span><Icon name="check" size={16} />Приложите подтверждение</span><span><Icon name="check" size={16} />Сохраните конфиденциальность</span></div></div>
          <a className="telegram-action" href="https://t.me/AgencyofGoodDeeds" target="_blank" rel="noreferrer"><Icon name="send" size={22} /><span><strong>Связаться в Telegram</strong><small>t.me/AgencyofGoodDeeds</small></span><Icon name="arrow" size={20} /></a>
        </div>
      </section>

      <section className="help-section">
        <div className="section-intro"><span className="eyebrow">Справочный центр</span><h2>Как устроен реестр</h2><p>Короткие ответы на вопросы, которые чаще всего возникают при просмотре публичных записей.</p></div>
        <div className="faq-list">
          <details><summary><span>Что означает статус записи?</span><Icon name="plus" size={18} /></summary><p>Статус показывает текущее состояние публикации: активный поиск, особое внимание, установленное местонахождение или архив.</p></details>
          <details><summary><span>Как сообщить об ошибке в досье?</span><Icon name="plus" size={18} /></summary><p>Передайте номер досье и описание неточности через официальный Telegram-канал. Не отправляйте чувствительные сведения без необходимости.</p></details>
          <details><summary><span>Как понять, что досье актуально?</span><Icon name="plus" size={18} /></summary><p>Проверьте текущий статус и дату обновления в открытом досье. Записи с завершённой проверкой переводятся в архив или получают новый статус.</p></details>
        </div>
      </section>

      <section className="legal-note"><Icon name="shield" /><div><h2>Независимый информационный проект</h2><p>A.O.G.D не является подразделением INTERPOL или государственного органа. Реестр предназначен для общественной осведомлённости и цифровой безопасности пользователей Telegram.</p></div></section>
      {selected && <RecordDetail record={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

function PublicFooter() {
  return <footer className="public-footer"><div className="footer-brand"><Emblem compact /><div><strong>A.O.G.D</strong><span>Agency Of Good Deeds</span><p>Public records & Telegram digital safety initiative</p></div></div><div className="footer-links"><div><strong>Навигация</strong><button onClick={() => scrollToSection("registry")}>Публичный реестр</button><button onClick={() => scrollToSection("principles")}>Принципы работы</button><button onClick={() => scrollToSection("report")}>Передать сведения</button></div><div><strong>Официальный канал</strong><a href="https://t.me/AgencyofGoodDeeds" target="_blank" rel="noreferrer">Telegram A.O.G.D</a><span>Только проверяемые сведения</span></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} A.O.G.D</span><span>Independent public information project</span><button onClick={() => scrollToSection("top")}>Наверх ↑</button></div></footer>;
}

function AdminLogin({ onSuccess, mode }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await authenticate(token); sessionStorage.setItem("aogd-admin-token", token); onSuccess(token); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function resetPassword() {
    resetLocalAdminPassword();
    sessionStorage.removeItem("aogd-admin-token");
    setToken("");
    setError("");
    window.alert(localStorage.getItem("aogd-language") === "en" ? "The local password has been reset. Enter a new password of at least 8 characters." : "Локальный пароль сброшен. Теперь введите новый пароль длиной от 8 символов.");
  }
  return (
    <main className="admin-shell login-shell">
      <section className="login-card">
        <Emblem />
        <div className="eyebrow">Закрытый раздел</div><h1>Панель управления</h1>
        <p>Введите секретный пароль администратора. Он не сохраняется в базе и действует только в этой вкладке.</p>
        <form onSubmit={submit}>
          <label>Пароль администратора<input type="password" value={token} onChange={(event) => setToken(event.target.value)} minLength={8} autoComplete="current-password" required placeholder="Не менее 8 символов" /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button--primary" disabled={busy}>{busy ? "Проверка…" : "Войти"} <Icon name="arrow" size={17} /></button>
        </form>
        {mode === "local" && <><p className="login-hint">Демо-режим: при первом входе придумайте пароль. На опубликованном сайте пароль задаётся секретом Cloudflare.</p><button type="button" className="text-button reset-password" onClick={resetPassword}>Сбросить локальный пароль</button></>}
      </section>
    </main>
  );
}

async function compressImage(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("Выберите изображение JPG, PNG или WebP.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Исходный файл должен быть меньше 10 МБ.");
  const bitmap = await createImageBitmap(file);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob) throw new Error("Не удалось обработать фотографию.");
  if (blob.size > 5 * 1024 * 1024) throw new Error("После обработки фотография превышает 5 МБ.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "portrait"}.webp`, { type: "image/webp" });
}

function RecordForm({ initial, token, onSaved, onCancel }) {
  const [form, setForm] = useState({ ...emptyRecord, ...initial });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(initial?.photoUrl || "");
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function choosePhoto(event) {
    const source = event.target.files?.[0]; if (!source) return;
    try { const next = await compressImage(source); setPhoto(next); setRemovePhoto(false); setPreview(URL.createObjectURL(next)); }
    catch (err) { setError(err.message); }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const saved = await saveRecord({ token, record: form, photo, removePhoto }); onSaved(saved); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop form-backdrop">
      <form className="record-form" onSubmit={submit}>
        <div className="form-header"><div><span className="eyebrow">Редактор записи</span><h2>{initial?.id ? "Изменить досье" : "Новое досье"}</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Закрыть"><Icon name="close" /></button></div>
        <div className="form-layout">
          <aside>
            <label className="photo-drop">
              {preview && !removePhoto ? <img src={preview} alt="Предпросмотр" /> : <><Icon name="upload" size={28} /><strong>Загрузить фото</strong><span>JPG, PNG или WebP до 10 МБ</span></>}
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />
            </label>
            {preview && !removePhoto && <button type="button" className="text-button danger" onClick={() => { setRemovePhoto(true); setPhoto(null); }}>Удалить фотографию</button>}
            <p className="helper">Фото автоматически уменьшается и переводится в WebP перед загрузкой.</p>
          </aside>
          <div className="form-fields">
            <fieldset><legend>Основное</legend><div className="field-grid">
              <label className="span-2">Полное имя *<input value={form.fullName} onChange={update("fullName")} required /></label>
              <label>Номер досье<input value={form.fileNumber} onChange={update("fileNumber")} placeholder="Создастся автоматически" /></label>
              <label>Псевдонимы<input value={form.aliases} onChange={update("aliases")} /></label>
              <label>Статус<select value={form.status} onChange={update("status")}>{Object.entries(STATUS).map(([value, item]) => <option value={value} key={value}>{item.label}</option>)}</select></label>
              <label>Уровень внимания<select value={form.priority} onChange={update("priority")}>{Object.entries(PRIORITY).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            </div></fieldset>
            <fieldset><legend>Идентификация</legend><div className="field-grid">
              <label>Место обитания<input value={form.residence} onChange={update("residence")} placeholder="Город, район или регион" /></label>
              <label>Юзернейм Telegram<input value={form.telegramUsername} onChange={update("telegramUsername")} placeholder="@username" /></label>
              <label>Дата рождения<input type="date" value={form.birthDate} onChange={update("birthDate")} /></label>
              <label>Гражданство<input value={form.nationality} onChange={update("nationality")} /></label>
              <label>Пол<input value={form.gender} onChange={update("gender")} /></label>
              <label>Рост<input value={form.height} onChange={update("height")} placeholder="Например: 181 см" /></label>
              <label>Цвет глаз<input value={form.eyes} onChange={update("eyes")} /></label>
              <label>Цвет волос<input value={form.hair} onChange={update("hair")} /></label>
              <label className="span-2">Языки<input value={form.languages} onChange={update("languages")} /></label>
            </div></fieldset>
            <fieldset><legend>Сведения</legend><div className="field-grid one-column">
              <label>Последнее известное место<textarea rows="2" value={form.lastSeen} onChange={update("lastSeen")} /></label>
              <label>Основание публикации *<textarea rows="3" value={form.publicationBasis} onChange={update("publicationBasis")} required /></label>
              <label>Описание<textarea rows="4" value={form.description} onChange={update("description")} /></label>
              <label>Особые приметы<textarea rows="3" value={form.identifyingMarks} onChange={update("identifyingMarks")} /></label>
              <label>Предупреждение посетителям<textarea rows="2" value={form.contactNote} onChange={update("contactNote")} /></label>
            </div></fieldset>
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions"><button type="button" className="button button--secondary" onClick={onCancel}>Отмена</button><button className="button button--primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить запись"}</button></div>
      </form>
    </div>
  );
}

function AdminPanel({ records, setRecords, mode, token, setToken }) {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const visible = records.filter((record) => [record.fullName, record.fileNumber, record.aliases].join(" ").toLowerCase().includes(query.toLowerCase()));
  if (!token) return <AdminLogin mode={mode} onSuccess={setToken} />;
  function logout() { sessionStorage.removeItem("aogd-admin-token"); setToken(""); }
  function saved(record) { setRecords((current) => { const exists = current.some((item) => item.id === record.id); return exists ? current.map((item) => item.id === record.id ? record : item) : [record, ...current]; }); setEditing(null); setCreating(false); }
  async function remove(record) {
    const message = localStorage.getItem("aogd-language") === "en" ? `Delete “${record.fullName}”? This action cannot be undone.` : `Удалить запись «${record.fullName}»? Это действие нельзя отменить.`;
    if (!window.confirm(message)) return;
    setError("");
    try { await deleteRecord(token, record.id); setRecords((current) => current.filter((item) => item.id !== record.id)); }
    catch (err) { setError(err.message); }
  }
  return (
    <main className="admin-shell">
      <div className="admin-heading"><div><div className="eyebrow">A.O.G.D control room</div><h1>Управление базой</h1><p>Добавляйте, обновляйте и архивируйте публичные записи.</p></div><div className="admin-actions"><button className="button button--secondary" onClick={logout}><Icon name="logout" size={17} /> Выйти</button><button className="button button--primary" onClick={() => setCreating(true)}><Icon name="plus" size={17} /> Добавить запись</button></div></div>
      <div className={`mode-card mode-card--${mode}`}><span className="mode-dot" /><div><strong>{mode === "cloud" ? "Постоянное хранилище подключено" : "Локальный демо-режим"}</strong><p>{mode === "cloud" ? "Данные и фотографии сохраняются в Cloudflare." : "Изменения видны только в этом браузере. Подключите Cloudflare перед рабочей публикацией."}</p></div></div>
      <section className="admin-card">
        <div className="admin-toolbar"><div className="search-box search-box--small"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти запись…" /></div><span>{visible.length} записей</span></div>
        {error && <div className="form-error admin-error">{error}</div>}
        <div className="records-table-wrap"><table className="records-table"><thead><tr><th>Запись</th><th>Номер</th><th>Статус</th><th>Обновлено</th><th>Действия</th></tr></thead><tbody>{visible.map((record) => <tr key={record.id}><td><div className="table-person"><Portrait record={record} /><div><strong>{record.fullName}</strong><span>{record.aliases || "Без псевдонимов"}</span></div></div></td><td>{record.fileNumber}</td><td><StatusBadge status={record.status} /></td><td>{record.updatedAt ? new Intl.DateTimeFormat(localStorage.getItem("aogd-language") === "en" ? "en-US" : "ru-RU").format(new Date(record.updatedAt)) : "—"}</td><td><div className="row-actions"><button className="icon-button" onClick={() => setEditing(record)} title="Изменить"><Icon name="edit" size={18} /></button><button className="icon-button danger" onClick={() => remove(record)} title="Удалить"><Icon name="trash" size={18} /></button></div></td></tr>)}</tbody></table>{!visible.length && <div className="empty-state"><h3>Записей пока нет</h3><p>Создайте первую публикацию.</p></div>}</div>
        {mode === "local" && <button className="text-button" onClick={() => { const message = localStorage.getItem("aogd-language") === "en" ? "Restore the demo record? Current local records will be replaced." : "Вернуть демонстрационную запись? Текущие локальные записи будут заменены."; if (window.confirm(message)) setRecords(resetLocalDemo()); }}>Восстановить демонстрационные данные</button>}
      </section>
      {(creating || editing) && <RecordForm initial={editing || emptyRecord} token={token} onSaved={saved} onCancel={() => { setEditing(null); setCreating(false); }} />}
    </main>
  );
}

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === "true";

function MaintenancePage({ language, reduceMotion }) {
  const isEnglish = language === "en";
  return (
    <main className="maintenance-page">
      <div className="maintenance-dither" aria-hidden="true">
        <Suspense fallback={<div className="maintenance-dither-fallback" />}>
          <Dither
            waveColor={[0.08, 0.3, 0.62]}
            disableAnimation={reduceMotion}
            enableMouseInteraction={false}
            mouseRadius={0.5}
            colorNum={18}
            pixelSize={1.5}
            waveAmplitude={0.27}
            waveFrequency={1.55}
            waveSpeed={0.19}
          />
        </Suspense>
      </div>
      <div className="maintenance-shade" aria-hidden="true" />
      <div className="maintenance-card">
        <Emblem />
        <p className="maintenance-eyebrow">A.O.G.D · Agency Of Good Deeds</p>
        <h1>{isEnglish ? "Technical maintenance" : "Технические работы"}</h1>
        <p>{isEnglish ? "The portal is temporarily unavailable while we prepare an update." : "Портал временно закрыт, пока мы готовим обновление."}</p>
        <span>{isEnglish ? "Please check back later." : "Пожалуйста, зайдите позже."}</span>
        <a className="maintenance-telegram" href="https://t.me/AgencyofGoodDeeds" target="_blank" rel="noreferrer">
          <span aria-hidden="true">✈</span>
          t.me/AgencyofGoodDeeds
        </a>
      </div>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(isAdminLocation() ? "admin" : "public");
  const [records, setRecords] = useState([]);
  const [mode, setMode] = useState("unknown");
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(() => sessionStorage.getItem("aogd-admin-token") || "");
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("aogd-theme");
    return ["default", "light", "dark"].includes(saved) ? saved : "default";
  });
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem("aogd-language");
    if (["ru", "en"].includes(saved)) return saved;
    return navigator.languages?.some((item) => item.toLowerCase().startsWith("ru")) ? "ru" : "en";
  });
  const [comfort, setComfort] = useState(() => {
    try {
      return { fontSize: "normal", compactCards: false, reduceMotion: false, ...JSON.parse(localStorage.getItem("aogd-comfort") || "{}") };
    } catch {
      return { fontSize: "normal", compactCards: false, reduceMotion: false };
    }
  });
  useInterfaceLanguage(language);
  useEffect(() => { const handler = () => setRoute(isAdminLocation() ? "admin" : "public"); window.addEventListener("hashchange", handler); return () => window.removeEventListener("hashchange", handler); }, []);
  useEffect(() => { loadRecords().then((result) => { setRecords(result.records); setMode(result.mode); }).finally(() => setLoading(false)); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("aogd-theme", theme); }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.fontSize = comfort.fontSize;
    document.documentElement.dataset.compactCards = String(comfort.compactCards);
    document.documentElement.dataset.reduceMotion = String(comfort.reduceMotion);
    localStorage.setItem("aogd-comfort", JSON.stringify(comfort));
  }, [comfort]);
  function changeTheme(nextTheme, event) {
    if (nextTheme === theme) return;
    const reduceMotion = comfort.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduceMotion) { setTheme(nextTheme); return; }
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? 0;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => flushSync(() => setTheme(nextTheme)));
    transition.ready.then(() => document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
      { duration: 650, easing: "cubic-bezier(.22, .8, .25, 1)", pseudoElement: "::view-transition-new(root)" },
    ));
  }
  function changeLanguage(nextLanguage) {
    localStorage.setItem("aogd-language", nextLanguage);
    setLanguage(nextLanguage);
  }
  function changeComfort(key, value) {
    setComfort((current) => ({ ...current, [key]: value }));
  }
  if (MAINTENANCE_MODE && route !== "admin") return <MaintenancePage language={language} reduceMotion={comfort.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches} />;
  return <div className="app"><Header route={route} theme={theme} onThemeChange={changeTheme} language={language} onLanguageChange={changeLanguage} comfort={comfort} onComfortChange={changeComfort} />{route === "admin" ? <><AdminPanel records={records} setRecords={setRecords} mode={mode} token={token} setToken={setToken} /><footer className="admin-footer"><span>© {new Date().getFullYear()} A.O.G.D</span><span>Restricted administration workspace</span></footer></> : <><PublicDatabase records={records} loading={loading} mode={mode} /><PublicFooter /></>}</div>;
}
