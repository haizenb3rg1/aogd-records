import { useEffect, useMemo, useState } from "react";
import {
  deleteMyReceptionThread,
  loadAdminReception,
  loadMyReception,
  loadPublicReception,
  revealReceptionAuthor,
  submitReceptionThread,
  toggleReceptionInterest,
  updateReceptionThread,
} from "./api.js";
import TurnstileWidget, { turnstileEnabled } from "./TurnstileWidget.jsx";

const CONSENT_VERSION = "2026-07-24-reception-v1";

const CATEGORY_LABELS = {
  question: "Вопрос администрации",
  proposal: "Предложение",
  technical: "Технический вопрос",
  complaint: "Жалоба",
  correction: "Исправление данных",
  security: "Сообщение о безопасности",
};

const STATUS_LABELS = {
  pending: "На модерации",
  needs_info: "Нужны сведения",
  published: "Опубликовано",
  accepted: "Принято",
  rejected: "Отклонено",
  resolved: "Решено",
  archived: "Архив",
};

const PRIVATE_CATEGORIES = new Set(["complaint", "correction", "security"]);

function formatDate(value, withTime = false) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      ...(withTime ? { timeStyle: "short" } : {}),
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function Message({ error, success }) {
  if (error) return <div className="account-message account-message--error">{error}</div>;
  if (success) return <div className="account-message account-message--success">{success}</div>;
  return null;
}

function Status({ value }) {
  return <mark className={`reception-status reception-status--${value}`}>{STATUS_LABELS[value] || value}</mark>;
}

export function PublicReception({ user, onBack, onOpenProfile }) {
  const [threads, setThreads] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  function reload() {
    setLoading(true);
    setError("");
    loadPublicReception()
      .then(setThreads)
      .catch((nextError) => setError(nextError.message))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (category !== "all" && thread.category !== category) return false;
      if (!needle) return true;
      return [thread.title, thread.body, thread.officialAnswer, thread.author]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [threads, query, category]);

  async function toggleInterest(thread) {
    if (!user) {
      onOpenProfile();
      return;
    }
    setBusyId(thread.id);
    setError("");
    try {
      const result = await toggleReceptionInterest(thread.id, !thread.interested);
      setThreads((current) => current.map((item) => item.id === thread.id
        ? { ...item, interested: result.interested, interestCount: result.interestCount }
        : item));
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="reception-shell">
      <section className="reception-hero">
        <div>
          <span className="eyebrow">Официальный диалог</span>
          <h1>Приёмная A.O.G.D</h1>
          <p>Публичные вопросы, предложения и официальные ответы администрации. Каждая публикация проходит предварительную модерацию.</p>
          <div className="reception-hero-actions">
            <button className="button button--primary" onClick={onOpenProfile}>Задать вопрос</button>
            <button className="button button--secondary" onClick={onBack}>← На главную</button>
          </div>
        </div>
        <div className="reception-principles">
          <div><strong>01</strong><span>Премодерация до публикации</span></div>
          <div><strong>02</strong><span>Официальный ответ выделен</span></div>
          <div><strong>03</strong><span>Приватные жалобы не публикуются</span></div>
        </div>
      </section>

      <section className="reception-directory">
        <div className="reception-toolbar">
          <label className="reception-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength="80" placeholder="Найти вопрос или ответ…" />
          </label>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория">
            <option value="all">Все категории</option>
            <option value="question">Вопросы</option>
            <option value="proposal">Предложения</option>
            <option value="technical">Технические вопросы</option>
          </select>
          <button type="button" className="reception-refresh" onClick={reload}>Обновить</button>
        </div>
        <Message error={error} />
        {loading ? <div className="reception-empty">Загрузка официальных материалов…</div> : visible.length ? (
          <div className="reception-list">
            {visible.map((thread) => (
              <article className="reception-thread" key={thread.id}>
                <div className="reception-thread-meta">
                  <span>{CATEGORY_LABELS[thread.category]}</span>
                  <Status value={thread.status} />
                  <time>{formatDate(thread.publishedAt || thread.updatedAt)}</time>
                </div>
                <h2>{thread.title}</h2>
                <p className="reception-question">{thread.body}</p>
                <div className="reception-author">
                  <span className={`reception-avatar${thread.anonymous ? " reception-avatar--anonymous" : ""}`}>
                    {thread.anonymous ? "A" : thread.author.slice(0, 2).toUpperCase()}
                  </span>
                  <div><strong>{thread.author}</strong><small>{thread.anonymous ? "Имя скрыто от публики" : "Подтверждённый участник"}</small></div>
                </div>
                {thread.officialAnswer ? (
                  <section className="official-answer">
                    <div className="official-answer-heading"><span>Официальный ответ</span><strong>A.O.G.D</strong></div>
                    <p>{thread.officialAnswer}</p>
                    <time>{formatDate(thread.answeredAt, true)}</time>
                  </section>
                ) : <div className="answer-pending">Ответ администрации готовится</div>}
                <div className="reception-thread-footer">
                  <button
                    type="button"
                    className={thread.interested ? "interested" : ""}
                    disabled={busyId === thread.id}
                    onClick={() => toggleInterest(thread)}
                  >
                    {thread.interested ? "✓ Интересует" : "Мне тоже интересно"} · {thread.interestCount}
                  </button>
                  <span>№ {thread.id.slice(0, 8).toUpperCase()}</span>
                </div>
              </article>
            ))}
          </div>
        ) : <div className="reception-empty"><strong>Подходящих публикаций пока нет</strong><span>Измените фильтр или задайте новый вопрос.</span></div>}
      </section>
    </main>
  );
}

export function ReceptionSubmit({ user, onRequireAuth, onSubmitted }) {
  const [category, setCategory] = useState("question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [anonymous, setAnonymous] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);

  function changeCategory(next) {
    setCategory(next);
    if (PRIVATE_CATEGORIES.has(next)) setVisibility("private");
  }

  async function submit(event) {
    event.preventDefault();
    if (!user) {
      onRequireAuth?.();
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await submitReceptionThread({
        category,
        title,
        body,
        visibility,
        anonymous,
        consent,
        consentVersion: CONSENT_VERSION,
        turnstileToken,
      });
      setTitle("");
      setBody("");
      setAnonymous(false);
      setConsent(false);
      setSuccess(`Обращение принято на модерацию. Номер: ${result.thread.id}`);
      onSubmitted?.();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
      setTurnstileReset((value) => value + 1);
    }
  }

  if (!user) {
    return <section className="account-card reception-auth-required">
      <span className="eyebrow">Приёмная A.O.G.D</span>
      <h2>Требуется подтверждённый аккаунт</h2>
      <p>Это защищает раздел от спама и позволяет вам получать ответы. Публично адрес почты никогда не показывается.</p>
      <button className="button button--primary" onClick={onRequireAuth}>Войти или зарегистрироваться</button>
    </section>;
  }

  const forcedPrivate = PRIVATE_CATEGORIES.has(category);
  return <section className="account-card reception-submit-card">
    <span className="eyebrow">Приёмная A.O.G.D</span>
    <h2>Новое обращение</h2>
    <p>Публичные вопросы появляются только после проверки. Жалобы, исправления данных и сообщения о безопасности всегда остаются приватными.</p>
    <form className="support-form" onSubmit={submit}>
      <div className="support-grid">
        <label>Категория<select value={category} onChange={(event) => changeCategory(event.target.value)}>
          <option value="question">Вопрос администрации</option>
          <option value="proposal">Предложение по развитию</option>
          <option value="technical">Технический вопрос</option>
          <option value="complaint">Жалоба</option>
          <option value="correction">Исправление данных</option>
          <option value="security">Проблема безопасности</option>
        </select></label>
        <label>Видимость<select value={visibility} disabled={forcedPrivate} onChange={(event) => setVisibility(event.target.value)}>
          <option value="public">Публично после модерации</option>
          <option value="private">Только мне и администрации</option>
        </select></label>
        <label className="span-2">Заголовок<input value={title} onChange={(event) => setTitle(event.target.value)} minLength="6" maxLength="140" required placeholder="Кратко сформулируйте вопрос" /></label>
        <label className="span-2">Содержание<textarea rows="8" value={body} onChange={(event) => setBody(event.target.value)} minLength="30" maxLength="5000" required placeholder="Опишите ситуацию без паролей, документов, адресов и других личных данных." /></label>
      </div>
      {visibility === "public" && <label className="reception-option">
        <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
        <span><strong>Скрыть мой никнейм от публики</strong><small>Посетители увидят «Анонимный участник». Администрация сможет установить автора для предотвращения нарушений; такое действие фиксируется в журнале.</small></span>
      </label>}
      <label className="support-agreement">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
        <span>Я отвечаю за содержание обращения и разрешаю публикацию только при выбранной публичной видимости. Я не отправляю угрозы, оскорбления, пароли, документы, адреса, платёжные данные или материалы, полученные незаконным способом.</span>
      </label>
      <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} action="reception_submit" />
      <Message error={error} success={success} />
      <button className="button button--primary" disabled={busy || !consent || (turnstileEnabled() && !turnstileToken)}>
        {busy ? "Отправка…" : visibility === "public" ? "Отправить на модерацию" : "Отправить приватно"}
      </button>
    </form>
  </section>;
}

export function MyReception({ refreshKey }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  function reload() {
    setLoading(true);
    setError("");
    loadMyReception()
      .then(setThreads)
      .catch((nextError) => setError(nextError.message))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [refreshKey]);

  async function remove(thread) {
    if (!window.confirm(`Удалить обращение «${thread.title}»? Оно сразу исчезнет и из публичной приёмной.`)) return;
    setBusyId(thread.id);
    setError("");
    try {
      await deleteMyReceptionThread(thread.id);
      setThreads((current) => current.filter((item) => item.id !== thread.id));
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyId("");
    }
  }

  return <section className="account-card my-reception">
    <div className="account-card-heading"><div><span className="eyebrow">История диалога</span><h2>Мои вопросы</h2></div><button className="text-button" onClick={reload}>Обновить</button></div>
    <Message error={error} />
    {loading ? <p>Загрузка…</p> : threads.length ? <div className="my-reception-list">
      {threads.map((thread) => <article key={thread.id}>
        <div className="my-reception-top"><span>{CATEGORY_LABELS[thread.category]}</span><Status value={thread.status} /><time>{formatDate(thread.createdAt)}</time></div>
        <h3>{thread.title}</h3>
        <p>{thread.body}</p>
        <div className="my-reception-privacy">
          <span>{thread.visibility === "private" ? "🔒 Приватно" : "◉ Публичная заявка"}</span>
          {thread.anonymous && <span>Анонимно для посетителей</span>}
          {thread.interestCount > 0 && <span>Интересует: {thread.interestCount}</span>}
        </div>
        {thread.officialAnswer && <section className="official-answer official-answer--compact"><div className="official-answer-heading"><span>Ответ администрации</span><strong>A.O.G.D</strong></div><p>{thread.officialAnswer}</p></section>}
        {thread.moderatorNote && <div className="moderator-note"><strong>Комментарий модератора</strong><p>{thread.moderatorNote}</p></div>}
        <button className="reception-delete" disabled={busyId === thread.id} onClick={() => remove(thread)}>Удалить обращение</button>
      </article>)}
    </div> : <div className="account-empty">Вы ещё не обращались в приёмную.</div>}
  </section>;
}

function AdminReceptionItem({ thread, onChanged, canModerate, canRevealAuthor }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(thread.status);
  const [answer, setAnswer] = useState(thread.officialAnswer);
  const [note, setNote] = useState(thread.moderatorNote);
  const [author, setAuthor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    if (!canModerate) return;
    setBusy(true);
    setError("");
    try {
      const result = await updateReceptionThread(thread.id, {
        status,
        officialAnswer: answer,
        moderatorNote: note,
      });
      onChanged({ ...thread, ...result.thread });
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    const reason = window.prompt("Укажите служебную причину просмотра личности автора. Действие будет записано в журнал безопасности.");
    if (reason === null) return;
    if (reason.trim().length < 10) {
      setError("Причина должна содержать не менее 10 символов.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await revealReceptionAuthor(thread.id, reason);
      setAuthor(result.author);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  }

  return <article className={`admin-reception-item${open ? " open" : ""}`}>
    <button className="admin-reception-summary" onClick={() => setOpen((value) => !value)}>
      <span className="support-admin-category">{CATEGORY_LABELS[thread.category]}</span>
      <div><strong>{thread.title}</strong><small>{thread.author} · {thread.visibility === "private" ? "приватно" : "публичная заявка"}</small></div>
      <time>{formatDate(thread.createdAt)}</time>
      <Status value={thread.status} />
      <span aria-hidden="true">{open ? "↑" : "↓"}</span>
    </button>
    {open && <form className="admin-reception-detail" onSubmit={save}>
      <div className="admin-reception-question"><span>Текст обращения</span><p>{thread.body}</p></div>
      <div className="admin-reception-metadata">
        <span>Номер: {thread.id}</span>
        <span>{thread.anonymous ? "Автор скрыт от публики" : `Автор: ${thread.author}`}</span>
        <span>Интересует пользователей: {thread.interestCount}</span>
      </div>
      {thread.authorRevealRequired && canRevealAuthor && <div className="author-reveal">
        {!author ? <button type="button" disabled={busy} onClick={reveal}>Установить автора по служебной причине</button> : <div><strong>{author.nickname}</strong><span>{author.email}</span><small>ID: {author.userId}</small></div>}
        <p>Просмотр личности анонимного автора фиксируется в журнале безопасности.</p>
      </div>}
      <div className="admin-reception-form">
        <label>Статус<select disabled={!canModerate} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="pending">На модерации</option>
          <option value="needs_info">Нужны сведения</option>
          {thread.visibility === "public" && <option value="published">Опубликовано</option>}
          <option value="accepted">Принято</option>
          <option value="rejected">Отклонено</option>
          <option value="resolved">Решено</option>
          <option value="archived">Архив</option>
        </select></label>
        <label>Официальный ответ<textarea disabled={!canModerate} rows="6" value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength="5000" placeholder="Ответ будет виден автору и, для публичного вопроса, всем посетителям." /></label>
        <label>Внутренняя заметка<textarea disabled={!canModerate} rows="3" value={note} onChange={(event) => setNote(event.target.value)} maxLength="1200" placeholder="Автор увидит заметку в своём кабинете; публично она не выводится." /></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      {canModerate && <button className="button button--primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить решение"}</button>}
    </form>}
  </article>;
}

export function AdminReceptionManager({ canModerate = false, canRevealAuthor = false }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function reload() {
    setLoading(true);
    setError("");
    loadAdminReception()
      .then(setThreads)
      .catch((nextError) => setError(nextError.message))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  function changed(next) {
    setThreads((current) => current.map((thread) => thread.id === next.id ? next : thread));
  }

  if (loading) return <section className="admin-card"><div className="empty-state">Загрузка приёмной…</div></section>;
  return <section className="admin-card admin-reception">
    <div className="admin-toolbar"><div><strong>Приёмная A.O.G.D</strong><span>Публичные вопросы проходят премодерацию. Приватные обращения нельзя сделать публичными.</span></div><button className="button button--secondary" onClick={reload}>Обновить</button></div>
    <Message error={error} />
    <div className="admin-reception-list">
      {threads.map((thread) => <AdminReceptionItem key={thread.id} thread={thread} onChanged={changed} canModerate={canModerate} canRevealAuthor={canRevealAuthor} />)}
      {!threads.length && <div className="empty-state"><h3>Обращений пока нет</h3><p>Новые вопросы появятся здесь.</p></div>}
    </div>
  </section>;
}
