// ============================================================================
// Kopiqo — авторизация через Supabase Auth.
//
// Пользователь видит только Никнейм + PIN-код (6 цифр).
// Внутри приложения пара преобразуется в email/password для Supabase:
//   никнейм  wolf5er  ->  wolf5er@kopiqo.app
//   PIN      123456   ->  123456
// Email нигде не показывается.
//
// Экспортирует:
//   ensureSession()   — вернёт активную сессию; при её отсутствии покажет
//                       экран Вход/Регистрация и дождётся успешного входа.
//   mountLogoutButton(onBeforeSignOut) — плавающая кнопка «Выйти».
// ============================================================================
import { supabase, nicknameToEmail } from "./supabase-client.js";

const NICKNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PIN_RE = /^\d{6}$/;

/* ----------------------------- Публичное API ----------------------------- */

export async function ensureSession() {
  // Стандартная система сессий Supabase: если пользователь уже входил,
  // сессия восстанавливается автоматически и экран входа не показывается.
  const { data, error } = await supabase.auth.getSession();
  if (!error && data && data.session) return data.session;
  return showAuthScreen();
}

export function mountLogoutButton(onBeforeSignOut) {
  injectStyles();
  const btn = document.createElement("button");
  btn.className = "kq-logout-btn";
  btn.type = "button";
  btn.title = "Выйти из аккаунта";
  btn.setAttribute("aria-label", "Выйти из аккаунта");
  btn.innerHTML = ICON_LOGOUT;
  btn.addEventListener("click", () => openLogoutConfirm(onBeforeSignOut));
  document.body.appendChild(btn);
}

/* ------------------------------ Выход ------------------------------------ */

export function openLogoutConfirm(onBeforeSignOut) {
  const overlay = document.createElement("div");
  overlay.className = "kq-auth-overlay kq-confirm-overlay";
  overlay.innerHTML = `
    <div class="kq-card kq-confirm-card" role="dialog" aria-modal="true">
      <p class="kq-confirm-title">Выйти из аккаунта?</p>
      <p class="kq-confirm-text">Ваши данные сохранены в облаке и будут доступны после следующего входа.</p>
      <div class="kq-confirm-actions">
        <button type="button" class="kq-btn-secondary" data-act="cancel">Отмена</button>
        <button type="button" class="kq-btn-primary is-ready" data-act="logout">Выйти</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (e.target === overlay || act === "cancel") {
      overlay.remove();
      return;
    }
    if (act === "logout") {
      const b = overlay.querySelector('[data-act="logout"]');
      b.disabled = true;
      b.textContent = "Выходим…";
      try {
        if (typeof onBeforeSignOut === "function") await onBeforeSignOut();
      } catch (_) { /* не блокируем выход, если финальная синхронизация не удалась */ }
      try {
        if (window.__kopiqoBus) window.__kopiqoBus.emit("logout", {});
        await supabase.auth.signOut();
      } finally {
        window.location.reload();
      }
    }
  });
}

/* --------------------------- Экран авторизации --------------------------- */

function showAuthScreen() {
  injectStyles();

  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "kq-auth-screen";
    root.innerHTML = `
      <div class="kq-card kq-auth-card">
        <img src="icon-192.png" alt="" class="kq-auth-logo" />
        <h1 class="kq-auth-title">Kopiqo</h1>
        <p class="kq-auth-subtitle">Личный финансовый трекер</p>

        <div class="kq-tabs" role="tablist">
          <button type="button" role="tab" class="kq-tab is-active" data-tab="login">Вход</button>
          <button type="button" role="tab" class="kq-tab" data-tab="register">Регистрация</button>
        </div>

        <div class="kq-field">
          <label class="kq-label" for="kq-nickname">Никнейм</label>
          <input id="kq-nickname" class="kq-input" type="text" autocomplete="username"
                 autocapitalize="none" spellcheck="false" maxlength="20" placeholder="например, wolf5er" />
        </div>

        <div class="kq-field">
          <label class="kq-label" for="kq-pin">PIN-код</label>
          <input id="kq-pin" class="kq-input kq-input-pin" type="password" inputmode="numeric"
                 autocomplete="current-password" maxlength="6" placeholder="6 цифр" />
        </div>

        <p class="kq-error" hidden></p>

        <button type="button" class="kq-btn-primary" data-submit>Войти</button>

        <p class="kq-auth-hint" data-hint>
          Введите никнейм и PIN-код, чтобы открыть свои данные на этом устройстве.
        </p>
      </div>`;
    document.body.appendChild(root);

    const el = {
      tabs: root.querySelectorAll(".kq-tab"),
      nickname: root.querySelector("#kq-nickname"),
      pin: root.querySelector("#kq-pin"),
      error: root.querySelector(".kq-error"),
      submit: root.querySelector("[data-submit]"),
      hint: root.querySelector("[data-hint]"),
    };

    let mode = "login";
    let busy = false;

    const setError = (msg) => {
      el.error.textContent = msg || "";
      el.error.hidden = !msg;
    };

    const updateReady = () => {
      const ready =
        NICKNAME_RE.test(el.nickname.value.trim()) && PIN_RE.test(el.pin.value);
      el.submit.classList.toggle("is-ready", ready && !busy);
    };

    const setMode = (next) => {
      mode = next;
      el.tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === mode));
      el.submit.textContent = mode === "login" ? "Войти" : "Создать аккаунт";
      el.pin.autocomplete = mode === "login" ? "current-password" : "new-password";
      el.hint.textContent =
        mode === "login"
          ? "Введите никнейм и PIN-код, чтобы открыть свои данные на этом устройстве."
          : "Придумайте никнейм (латиница, цифры, «_», 3–20 символов) и PIN-код из 6 цифр.";
      setError("");
      updateReady();
    };

    el.tabs.forEach((t) =>
      t.addEventListener("click", () => !busy && setMode(t.dataset.tab))
    );

    el.nickname.addEventListener("input", () => {
      el.nickname.value = el.nickname.value.replace(/\s+/g, "");
      setError("");
      updateReady();
    });
    el.pin.addEventListener("input", () => {
      el.pin.value = el.pin.value.replace(/\D/g, "").slice(0, 6);
      setError("");
      updateReady();
    });
    [el.nickname, el.pin].forEach((inp) =>
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      })
    );

    async function submit() {
      if (busy) return;
      const nickname = el.nickname.value.trim();
      const pin = el.pin.value;

      if (!NICKNAME_RE.test(nickname)) {
        setError("Никнейм: 3–20 символов, только латинские буквы, цифры и «_».");
        return;
      }
      if (!PIN_RE.test(pin)) {
        setError("PIN-код должен состоять ровно из 6 цифр.");
        return;
      }

      busy = true;
      el.submit.classList.remove("is-ready");
      const label = el.submit.textContent;
      el.submit.textContent = mode === "login" ? "Входим…" : "Создаём аккаунт…";

      try {
        const session =
          mode === "login"
            ? await doLogin(nickname, pin)
            : await doRegister(nickname, pin);
        root.classList.add("is-leaving");
        setTimeout(() => root.remove(), 250);
        resolve(session);
        return;
      } catch (err) {
        setError(humanizeAuthError(err, mode));
      } finally {
        busy = false;
        el.submit.textContent = label;
        updateReady();
      }
    }

    el.submit.addEventListener("click", submit);
    setMode("login");
    el.nickname.focus();
  });
}

/* ------------------------------ Логика Auth ------------------------------ */

async function doLogin(nickname, pin) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: nicknameToEmail(nickname),
    password: pin,
  });
  if (error) throw error;
  if (!data.session) throw new Error("NO_SESSION");
  if (window.__kopiqoBus) window.__kopiqoBus.emit("login", { isNewAccount: false });
  return data.session;
}

async function doRegister(nickname, pin) {
  // 1) Проверяем, свободен ли никнейм (RPC nickname_exists из SQL-скрипта).
  const { data: exists, error: rpcError } = await supabase.rpc("nickname_exists", {
    nick: nickname,
  });
  if (rpcError) {
    // RPC недоступна (например, скрипт ещё не применён) — не блокируем
    // регистрацию: занятость никнейма поймает сам signUp ниже.
    console.warn("Kopiqo: nickname_exists RPC недоступна:", rpcError.message);
  } else if (exists === true) {
    const e = new Error("NICKNAME_TAKEN");
    e.code = "NICKNAME_TAKEN";
    throw e;
  }

  // 2) Регистрируем пользователя во встроенном Supabase Auth.
  const { data, error } = await supabase.auth.signUp({
    email: nicknameToEmail(nickname),
    password: pin,
  });
  if (error) throw error;

  // Если в Supabase включено подтверждение email, identities у существующего
  // пользователя приходит пустым — трактуем как занятый никнейм.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    const e = new Error("NICKNAME_TAKEN");
    e.code = "NICKNAME_TAKEN";
    throw e;
  }

  // 3) Автоматический вход после регистрации.
  if (data.session) {
    if (window.__kopiqoBus) window.__kopiqoBus.emit("login", { isNewAccount: true });
    return data.session;
  }
  return doLogin(nickname, pin);
}

function humanizeAuthError(err, mode) {
  const msg = String(err?.message || err || "");
  if (err?.code === "NICKNAME_TAKEN" || /already registered|user_already_exists/i.test(msg)) {
    return "Этот никнейм уже занят. Попробуйте другой.";
  }
  if (/invalid login credentials/i.test(msg) || err?.code === "invalid_credentials") {
    return "Неверный никнейм или PIN-код.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "Аккаунт не активирован. В настройках Supabase нужно отключить подтверждение email (см. инструкцию по настройке).";
  }
  if (/rate limit|too many requests/i.test(msg)) {
    return "Слишком много попыток. Подождите минуту и попробуйте снова.";
  }
  if (/failed to fetch|network|load failed/i.test(msg)) {
    return "Нет соединения с сервером. Проверьте интернет и попробуйте снова.";
  }
  return mode === "login"
    ? "Не удалось войти. Попробуйте ещё раз."
    : "Не удалось создать аккаунт. Попробуйте ещё раз.";
}

/* -------------------------------- Стили ---------------------------------- */

const ICON_LOGOUT =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .kq-auth-screen {
      position: fixed; inset: 0; z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      background: #F3EEE3; padding: 20px;
      font-family: 'Inter', Arial, sans-serif; color: #3E3B33;
      transition: opacity 0.25s ease;
    }
    .kq-auth-screen.is-leaving { opacity: 0; pointer-events: none; }
    .kq-card {
      background: #FFFFFF; border: 1px solid #E2DBC8; border-radius: 16px;
      box-shadow: 0 14px 40px rgba(62, 59, 51, 0.10);
    }
    .kq-auth-card {
      width: 100%; max-width: 360px; padding: 30px 26px 24px;
      display: flex; flex-direction: column; align-items: stretch; text-align: center;
    }
    .kq-auth-logo { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 14px; }
    .kq-auth-title { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 600; margin: 0; }
    .kq-auth-subtitle { font-size: 12px; color: #8C8875; margin: 4px 0 20px; }
    .kq-tabs {
      display: flex; gap: 4px; background: #ECE6D6; border-radius: 10px;
      padding: 4px; margin-bottom: 18px;
    }
    .kq-tab {
      flex: 1; padding: 8px 6px; border: none; border-radius: 8px;
      background: transparent; color: #8C8875; font: 600 13px 'Inter', sans-serif;
      cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .kq-tab.is-active { background: #FFFFFF; color: #3E3B33; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .kq-field { text-align: left; margin-bottom: 12px; }
    .kq-label { display: block; font-size: 11px; font-weight: 600; color: #8C8875; margin-bottom: 5px; letter-spacing: 0.2px; }
    .kq-input {
      width: 100%; box-sizing: border-box;
      background: #FFFFFF; border: 1px solid #E2DBC8; border-radius: 8px;
      padding: 10px 12px; font: 500 14px 'Inter', sans-serif; color: #3E3B33; outline: none;
      transition: border-color 0.15s;
    }
    .kq-input:focus { border-color: #9AC1A7; }
    .kq-input-pin { font-family: 'IBM Plex Mono', monospace; letter-spacing: 5px; }
    .kq-error {
      background: rgba(227, 111, 111, 0.10); border: 1px solid rgba(227, 111, 111, 0.35);
      color: #B0524B; border-radius: 8px; padding: 9px 11px;
      font-size: 12px; line-height: 1.45; margin: 2px 0 4px; text-align: left;
    }
    .kq-btn-primary {
      margin-top: 8px; width: 100%; padding: 11px; border-radius: 8px; border: none;
      font: 600 13px 'Inter', sans-serif; background: #E2DBC8; color: #8C8875;
      cursor: not-allowed; transition: background 0.15s, color 0.15s;
    }
    .kq-btn-primary.is-ready { background: #9AC1A7; color: #FFFFFF; cursor: pointer; }
    .kq-btn-primary.is-ready:hover { background: #8AB598; }
    .kq-btn-secondary {
      width: 100%; padding: 11px; border-radius: 8px; border: 1px solid #E2DBC8;
      background: #FFFFFF; color: #8C8875; font: 600 13px 'Inter', sans-serif; cursor: pointer;
    }
    .kq-auth-hint { font-size: 11px; color: #8C8875; line-height: 1.5; margin: 14px 0 0; }

    .kq-logout-btn {
      position: fixed; bottom: 20px; left: 20px; z-index: 60;
      width: 42px; height: 42px; border-radius: 50%;
      background: var(--surface, #FFFFFF); color: var(--muted, #8C8875);
      border: 1px solid var(--border, #E2DBC8);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; box-shadow: 0 8px 20px rgba(0,0,0,0.18);
      transition: color 0.15s, border-color 0.15s;
    }
    .kq-logout-btn:hover { color: var(--rose-text, #B0524B); border-color: var(--rose-text, #B0524B); }

    .kq-auth-overlay {
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(40, 38, 32, 0.45);
      display: flex; align-items: center; justify-content: center; padding: 20px;
      font-family: 'Inter', Arial, sans-serif;
    }
    .kq-confirm-card { width: 100%; max-width: 320px; padding: 22px 20px; text-align: center; }
    .kq-confirm-title { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; color: #3E3B33; margin: 0 0 8px; }
    .kq-confirm-text { font-size: 12px; color: #8C8875; line-height: 1.5; margin: 0 0 16px; }
    .kq-confirm-actions { display: flex; gap: 10px; }
    .kq-confirm-actions .kq-btn-primary { margin-top: 0; }
  `;
  document.head.appendChild(style);
}
