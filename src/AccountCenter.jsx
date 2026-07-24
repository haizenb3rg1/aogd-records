import { useEffect, useState } from "react";
import {
  changeAccountPassword,
  deleteAccount,
  loadMySupportRequests,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestPasswordReset,
  resendVerificationCode,
  resetAccountPassword,
  submitSupportRequest,
  updatePresencePreference,
  verifyAccount,
} from "./api.js";
import TurnstileWidget, { turnstileEnabled } from "./TurnstileWidget.jsx";
import { MyReception, ReceptionSubmit } from "./ReceptionCenter.jsx";
import { RoleBadges } from "./StaffPresence.jsx";

function FormMessage({ error, success }) {
  if (error) return <div className="account-message account-message--error">{error}</div>;
  if (success) return <div className="account-message account-message--success">{success}</div>;
  return null;
}

function AuthPanel({ onUserChange }) {
  const [view, setView] = useState("login");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);

  function switchView(next) {
    setView(next); setError(""); setSuccess(""); setCode("");
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      if (view === "register") {
        await registerAccount({ email, nickname, password, turnstileToken });
        setView("verify"); setSuccess("Код подтверждения отправлен на почту. Он действует 15 минут.");
      } else if (view === "verify") {
        const result = await verifyAccount({ email, code });
        onUserChange(result.user);
      } else if (view === "forgot") {
        const result = await requestPasswordReset(email, turnstileToken);
        setView("reset"); setSuccess(result.message || "Код отправлен на почту.");
      } else if (view === "reset") {
        await resetAccountPassword({ email, code, password });
        setPassword(""); setCode(""); setView("login"); setSuccess("Пароль обновлён. Теперь войдите в аккаунт.");
      } else {
        const result = await loginAccount({ email, password, turnstileToken });
        onUserChange(result.user);
      }
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
      if (["register", "login", "forgot"].includes(view)) setTurnstileReset((value) => value + 1);
    }
  }

  async function resend() {
    setBusy(true); setError("");
    try { await resendVerificationCode(email); setSuccess("Новый код отправлен."); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  const title = { login: "Вход в аккаунт", register: "Регистрация", verify: "Подтверждение почты", forgot: "Восстановление пароля", reset: "Новый пароль" }[view];
  return (
    <section className="account-card auth-card">
      <span className="eyebrow">Личный кабинет</span>
      <h2>{title}</h2>
      <p>{view === "register" ? "После регистрации мы отправим шестизначный код на вашу почту." : view === "verify" ? `Введите код, отправленный на ${email}.` : view === "forgot" || view === "reset" ? "Доступ восстанавливается только через подтверждённую почту." : "Войдите, чтобы отслеживать обращения и участвовать в рейтинге."}</p>
      <form className="account-form" onSubmit={submit}>
        {view === "register" && <label>Публичный никнейм<input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength="3" maxLength="32" placeholder="Например: CyberHelper" required /></label>}
        {view !== "verify" && <label>Электронная почта<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>}
        {(view === "verify" || view === "reset") && <label>Код из письма<input className="code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required /></label>}
        {!["verify", "forgot"].includes(view) && <label>{view === "reset" ? "Новый пароль" : "Пароль"}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="15" maxLength="128" autoComplete={view === "login" ? "current-password" : "new-password"} required /><small>Не менее 15 символов; удобнее использовать длинную парольную фразу</small></label>}
        {["register", "login", "forgot"].includes(view) && <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} action={`account_${view}`} />}
        <FormMessage error={error} success={success} />
        <button className="button button--primary" disabled={busy || (turnstileEnabled() && ["register", "login", "forgot"].includes(view) && !turnstileToken)}>{busy ? "Подождите…" : view === "register" ? "Создать аккаунт" : view === "verify" ? "Подтвердить" : view === "forgot" ? "Отправить код" : view === "reset" ? "Сохранить пароль" : "Войти"}</button>
      </form>
      <div className="auth-links">
        {view === "login" && <><button onClick={() => switchView("register")}>Создать аккаунт</button><button onClick={() => switchView("forgot")}>Забыли пароль?</button></>}
        {view === "register" && <button onClick={() => switchView("login")}>Уже есть аккаунт</button>}
        {view === "verify" && <><button disabled={busy} onClick={resend}>Отправить код повторно</button><button onClick={() => switchView("login")}>Вернуться ко входу</button></>}
        {["forgot", "reset"].includes(view) && <button onClick={() => switchView("login")}>Вернуться ко входу</button>}
      </div>
    </section>
  );
}

async function preparePhoto(file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Выберите JPG, PNG или WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Исходное изображение должно быть меньше 8 МБ.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.78, 0.64, 0.5]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.size <= 700 * 1024) return new File([blob], "support-photo.webp", { type: "image/webp" });
  }
  throw new Error("Не удалось уменьшить изображение до 700 КБ.");
}

function SupportForm({ user, onSubmitted }) {
  const [category, setCategory] = useState("technical");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoName, setPhotoName] = useState("");
  const [agreement, setAgreement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);

  async function choosePhoto(event) {
    const source = event.target.files?.[0];
    if (!source) return;
    try { const next = await preparePhoto(source); setPhoto(next); setPhotoName(source.name); setError(""); }
    catch (nextError) { setError(nextError.message); }
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      const data = new FormData();
      data.set("category", category); data.set("subject", subject); data.set("description", description);
      data.set("telegramUsername", telegramUsername); data.set("agreement", String(agreement));
      data.set("turnstileToken", turnstileToken);
      if (!user) data.set("email", email);
      if (photo) data.set("photo", photo, photo.name);
      const result = await submitSupportRequest(data);
      setSubject(""); setDescription(""); setTelegramUsername(""); setPhoto(null); setPhotoName(""); setAgreement(false);
      setSuccess(`Обращение принято. Номер: ${result.request.id}`);
      onSubmitted?.();
    } catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); setTurnstileReset((value) => value + 1); }
  }

  return (
    <section className="account-card support-card">
      <span className="eyebrow">Центр поддержки</span>
      <h2>Новое обращение</h2>
      <p>Опишите вопрос и приложите подтверждающий снимок. Команда увидит обращение в закрытой панели.</p>
      <form className="support-form" onSubmit={submit}>
        <div className="support-grid">
          <label>Категория<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="technical">Техническая проблема</option><option value="correction">Исправление информации</option><option value="report">Предложение или заявка</option><option value="other">Другое</option></select></label>
          {!user && <label>Почта для ответа<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}
          <label>Telegram username<input value={telegramUsername} onChange={(event) => setTelegramUsername(event.target.value)} placeholder="@username" /></label>
          <label className="span-2">Тема<input value={subject} onChange={(event) => setSubject(event.target.value)} minLength="4" maxLength="120" required /></label>
          <label className="span-2">Описание<textarea rows="7" value={description} onChange={(event) => setDescription(event.target.value)} minLength="20" maxLength="4000" required placeholder="Что произошло, на какой странице и какой результат вы ожидали?" /></label>
          <label className="support-upload span-2"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} /><span>＋ {photoName || "Приложить фотографию или скриншот"}</span><small>JPG, PNG или WebP; изображение автоматически уменьшится до 700 КБ</small></label>
        </div>
        <label className="support-agreement"><input type="checkbox" checked={agreement} onChange={(event) => setAgreement(event.target.checked)} required /><span>Я имею право передать эти материалы и отвечаю за содержание обращения. Я не отправляю личную, заведомо недостоверную или полученную незаконным способом информацию, включая адреса проживания, документы, пароли и платёжные данные.</span></label>
        <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} action="support_submit" />
        <FormMessage error={error} success={success} />
        <button className="button button--primary" disabled={busy || !agreement || (turnstileEnabled() && !turnstileToken)}>{busy ? "Отправка…" : "Отправить в поддержку"}</button>
      </form>
    </section>
  );
}

function RequestHistory({ refreshKey }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); loadMySupportRequests().then(setRequests).catch(() => setRequests([])).finally(() => setLoading(false)); }, [refreshKey]);
  const labels = { pending: "На рассмотрении", approved: "Одобрено", rejected: "Отклонено", resolved: "Закрыто" };
  return <section className="account-card request-history"><span className="eyebrow">История</span><h2>Мои обращения</h2>{loading ? <p>Загрузка…</p> : requests.length ? <div className="request-list">{requests.map((item) => <article key={item.id}><div><strong>{item.subject}</strong><span>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(item.createdAt))}</span></div><mark className={`request-status request-status--${item.status}`}>{labels[item.status] || item.status}</mark><p>{item.description}</p></article>)}</div> : <div className="account-empty">Вы ещё не отправляли обращений.</div>}</section>;
}

function AccountSecurity({ user, onDeleted }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function changePassword(event) {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    try {
      await changeAccountPassword({ currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword("");
      setSuccess("Пароль изменён. Остальные активные сеансы завершены.");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (!currentPassword) { setError("Для удаления аккаунта введите текущий пароль."); return; }
    if (!window.confirm(`Удалить аккаунт ${user.nickname}, его обращения и все сеансы? Это действие нельзя отменить.`)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await deleteAccount(currentPassword);
      onDeleted();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="account-card auth-card">
    <span className="eyebrow">Безопасность</span>
    <h2>Пароль и данные</h2>
    <p>После смены пароля все другие активные сеансы будут завершены. Здесь же можно удалить аккаунт и связанные с ним обращения.</p>
    <form className="account-form" onSubmit={changePassword}>
      <label>Текущий пароль<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
      <label>Новый пароль<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength="15" maxLength="128" autoComplete="new-password" required /><small>От 15 до 128 символов</small></label>
      <FormMessage error={error} success={success} />
      <button className="button button--primary" disabled={busy}>{busy ? "Подождите…" : "Изменить пароль"}</button>
      <button type="button" className="button button--secondary" disabled={busy} onClick={removeAccount}>Удалить мой аккаунт и обращения</button>
    </form>
  </section>;
}

function ProfileSummary({ user, onUserChange, onReception, onSupport, onLogout }) {
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [presenceError, setPresenceError] = useState("");
  const staff = Boolean(user.roles?.length);
  async function changePresence(event) {
    const visible = event.target.checked;
    setPresenceBusy(true); setPresenceError("");
    try {
      await updatePresencePreference(visible);
      onUserChange({ ...user, presenceVisible: visible });
    } catch (error) {
      setPresenceError(error.message);
    } finally {
      setPresenceBusy(false);
    }
  }
  return <section className="account-card profile-card">
    <div className="profile-avatar">{user.nickname.slice(0, 2).toUpperCase()}{staff && <span className="profile-staff-pulse" aria-hidden="true" />}</div>
    <div className="profile-summary">
      <div className="profile-badges-line">
        <span className="verified-badge">✓ Почта подтверждена</span>
        <span className="profile-public-id">ID {String(Number(user.publicId) || 0).padStart(6, "0")}</span>
      </div>
      <h2>{user.nickname}</h2>
      <p>{user.email}</p>
      {staff ? <div className="profile-staff-block">
        <span className="profile-staff-label">Назначения в A.O.G.D</span>
        <RoleBadges roles={user.roles} />
        <label className="presence-preference">
          <input type="checkbox" checked={user.presenceVisible !== false} disabled={presenceBusy} onChange={changePresence} />
          <span><strong>Показывать статус «в сети»</strong><small>Публикуется только общий статус. IP и точное время активности остаются скрытыми.</small></span>
        </label>
        {presenceError && <div className="account-message account-message--error">{presenceError}</div>}
      </div> : <small>В рейтинге учитываются только одобренные обращения этого аккаунта.</small>}
      <div className="profile-actions">
        <button className="button button--primary" onClick={onReception}>Задать вопрос администрации</button>
        <button className="button button--secondary" onClick={onSupport}>Поддержка</button>
        <button className="button button--secondary" onClick={onLogout}>Выйти</button>
      </div>
    </div>
  </section>;
}

export default function AccountCenter({ user, onUserChange, onBack }) {
  const [tab, setTab] = useState(user ? "profile" : "support");
  const [refreshKey, setRefreshKey] = useState(0);
  const [receptionRefreshKey, setReceptionRefreshKey] = useState(0);
  async function logout() { await logoutAccount(); onUserChange(null); setTab("support"); }
  return (
    <main className="account-shell">
      <div className="account-heading"><div><span className="eyebrow">A.O.G.D member area</span><h1>Профиль и поддержка</h1><p>Закрытый раздел для обращений, статусов и управления аккаунтом.</p></div><button className="button button--secondary" onClick={onBack}>← На главную</button></div>
      <div className="account-tabs">
        {user && <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Профиль</button>}
        <button className={tab === "reception" ? "active" : ""} onClick={() => setTab("reception")}>Приёмная</button>
        {user && <button className={tab === "reception-history" ? "active" : ""} onClick={() => setTab("reception-history")}>Мои вопросы</button>}
        <button className={tab === "support" ? "active" : ""} onClick={() => setTab("support")}>Обращение</button>
        {user && <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Мои заявки</button>}
        {user && <button className={tab === "security" ? "active" : ""} onClick={() => setTab("security")}>Безопасность</button>}
        {!user && <button className={tab === "auth" ? "active" : ""} onClick={() => setTab("auth")}>Вход и регистрация</button>}
      </div>
      {tab === "auth" && !user && <AuthPanel onUserChange={(next) => { onUserChange(next); setTab("profile"); }} />}
      {tab === "reception" && <ReceptionSubmit user={user} onRequireAuth={() => setTab("auth")} onSubmitted={() => setReceptionRefreshKey((value) => value + 1)} />}
      {tab === "reception-history" && user && <MyReception refreshKey={receptionRefreshKey} />}
      {tab === "support" && <SupportForm user={user} onSubmitted={() => setRefreshKey((value) => value + 1)} />}
      {tab === "history" && user && <RequestHistory refreshKey={refreshKey} />}
      {tab === "security" && user && <AccountSecurity user={user} onDeleted={() => { onUserChange(null); setTab("support"); }} />}
      {tab === "profile" && user && <ProfileSummary user={user} onUserChange={onUserChange} onReception={() => setTab("reception")} onSupport={() => setTab("support")} onLogout={logout} />}
    </main>
  );
}
